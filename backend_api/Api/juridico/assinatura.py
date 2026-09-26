# backend_api/Api/juridico/assinatura.py
"""
Assinatura eletrônica da própria plataforma (provedor "interno").

Base legal: MP 2.200-2/2001, art. 10, § 2º (documento assinado por meio
aceito pelas partes vale entre elas) e Lei 14.063/2020 (níveis simples,
avançada e qualificada). Esta é uma assinatura eletrônica **simples/avançada**
entre particulares — NÃO é ICP-Brasil (qualificada). Pra ato que a lei exige
certificado ICP-Brasil (ex.: alguns registros públicos), use um provedor com
certificado (ver docs/ASSINATURA_ELETRONICA.md).

    criar()   documento → PDF congelado + SHA-256, um link secreto por signatário
    enviar()  convite por e-mail (caixa do setor Jurídico) ou link pra copiar
    assinar() link + nome digitado + CPF (se informado) + código de 6 dígitos
              no e-mail (se exigido) + aceite; guarda IP, navegador e horário
    concluir() PDF final = original + "manifesto de assinaturas" (hash do
              original, quem, quando, como, trilha de eventos); SHA-256 do final
    verificar() qualquer um confere um PDF pelo hash (público)

Trilha de auditoria (`EventoAssinatura`) encadeada por hash: editar/apagar um
evento quebra a corrente (`trilha_integra`).
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import unicodedata
from datetime import timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from core.utils.lgpd import mask_cpf
from harness.crypto import decrypt_secret, encrypt_secret
from juridico import pdf
from juridico.models import Documento, EventoAssinatura, Signatario, SolicitacaoAssinatura

CODIGO_VALIDADE = timedelta(minutes=10)
CODIGO_MAX_TENTATIVAS = 5
CODIGO_REENVIO = timedelta(seconds=60)


class AssinaturaError(Exception):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cpf_valido(cpf: str) -> bool:
    d = re.sub(r"\D", "", cpf or "")
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        if int(d[n]) != (soma * 10 % 11) % 10:
            return False
    return True


def _norm(nome: str) -> str:
    s = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode()
    return " ".join(s.lower().split())


def base_url() -> str:
    return getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")


# ─── Trilha ──────────────────────────────────────────────────────────────────


def _hash_evento(prev: str, tipo: str, sig_id, detalhe: str, quando) -> str:
    return sha256(f"{prev}|{tipo}|{sig_id or ''}|{detalhe}|{quando.isoformat()}".encode())


def registrar(
    sol, tipo: str, signatario=None, detalhe: str = "", ip=None, ua: str = ""
) -> EventoAssinatura:
    ultimo = sol.eventos.order_by("-created_at", "-id").first()
    prev = ultimo.hash_encadeado if ultimo else sol.hash_original
    quando = timezone.now()
    return EventoAssinatura.objects.create(
        tenant_id=sol.tenant_id,
        solicitacao=sol,
        signatario=signatario,
        tipo=tipo,
        detalhe=detalhe[:500],
        ip=ip,
        user_agent=(ua or "")[:300],
        created_at=quando,
        hash_encadeado=_hash_evento(
            prev, tipo, getattr(signatario, "id", None), detalhe[:500], quando
        ),
    )


def trilha_integra(sol) -> bool:
    prev = sol.hash_original
    for ev in sol.eventos.order_by("created_at", "id"):
        if ev.hash_encadeado != _hash_evento(
            prev, ev.tipo, ev.signatario_id, ev.detalhe, ev.created_at
        ):
            return False
        prev = ev.hash_encadeado
    return True


# ─── Criação e envio ─────────────────────────────────────────────────────────


def pdf_do_documento(doc: Documento) -> bytes:
    if doc.arquivo and doc.arquivo.name.lower().endswith(".pdf"):
        doc.arquivo.open("rb")
        try:
            return doc.arquivo.read()
        finally:
            doc.arquivo.close()
    if doc.conteudo.strip():
        return pdf.documento_pdf(doc.titulo, doc.conteudo)
    raise AssinaturaError("Só dá pra assinar PDF ou documento gerado de modelo (texto).")


def _novo_token() -> tuple[str, str, str]:
    token = secrets.token_urlsafe(32)
    try:
        cifrado = encrypt_secret(token)
    except Exception as exc:  # noqa: BLE001
        raise AssinaturaError(
            "Defina ENCRYPTION_KEY no servidor para gerar links de assinatura."
        ) from exc
    return token, sha256(token.encode()), cifrado


def token_de(sig: Signatario) -> str:
    return decrypt_secret(sig.token_encrypted) if sig.token_encrypted else ""


def link_de(sig: Signatario) -> str:
    return f"{base_url()}/assinar/{token_de(sig)}"


@transaction.atomic
def criar(
    tenant_id,
    documento: Documento,
    signatarios: list[dict],
    *,
    titulo: str = "",
    mensagem: str = "",
    exigir_codigo_email: bool = True,
    ordem_sequencial: bool = False,
    expira_dias: int = 30,
    criado_por: str = "",
) -> SolicitacaoAssinatura:
    if documento.tenant_id != tenant_id or not documento.is_active:
        raise AssinaturaError("Documento não encontrado.")
    if not signatarios:
        raise AssinaturaError("Adicione pelo menos um signatário.")
    emails = set()
    for i, s in enumerate(signatarios, start=1):
        if not (s.get("nome") or "").strip() or not re.match(
            r"[^@\s]+@[^@\s]+\.[^@\s]+$", s.get("email") or ""
        ):
            raise AssinaturaError(f"Signatário {i}: informe nome e e-mail válido.")
        if s.get("cpf") and not cpf_valido(s["cpf"]):
            raise AssinaturaError(f"Signatário {i}: CPF inválido.")
        if s["email"].lower() in emails:
            raise AssinaturaError(f"E-mail repetido: {s['email']}.")
        emails.add(s["email"].lower())
    original = pdf_do_documento(documento)
    h = sha256(original)
    sol = SolicitacaoAssinatura.objects.create(
        tenant_id=tenant_id,
        documento=documento,
        titulo=(titulo or documento.titulo)[:255],
        mensagem=mensagem,
        exigir_codigo_email=exigir_codigo_email,
        ordem_sequencial=ordem_sequencial,
        hash_original=h,
        criado_por=criado_por[:150],
        expira_em=timezone.now() + timedelta(days=max(1, min(int(expira_dias or 30), 180))),
    )
    sol.pdf_original.save(f"original-{h[:12]}.pdf", ContentFile(original), save=True)
    for ordem, s in enumerate(signatarios, start=1):
        _, th, tc = _novo_token()
        cpf = re.sub(r"\D", "", s.get("cpf") or "")
        Signatario.objects.create(
            tenant_id=tenant_id,
            solicitacao=sol,
            nome=s["nome"].strip()[:200],
            email=s["email"].strip().lower(),
            papel=s.get("papel") or "parte",
            ordem=ordem,
            cpf_encrypted=encrypt_secret(cpf) if cpf else "",
            cpf_mascarado=mask_cpf(cpf) if cpf else "",
            token_hash=th,
            token_encrypted=tc,
        )
    registrar(
        sol, "criada", detalhe=f"Documento {documento.titulo!r}, SHA-256 {h}, por {criado_por}"
    )
    return sol


def _setor_juridico(tenant_id):
    from agency.models import Sector

    qs = Sector.objects.filter(tenant_id=tenant_id, is_active=True)
    return (
        qs.filter(slug__in=["juridico", "jurídico"]).first()
        or qs.filter(name__iexact="Jurídico").first()
        or qs.filter(name__iexact="Juridico").first()
    )


def _email(tenant_id, para: str, assunto: str, corpo: str, origem: str, aprovado_por: str) -> bool:
    """Manda na hora pela caixa do Jurídico (ou a padrão). Sem caixa pronta → False."""
    from integrations.email import account_for_sector, create_draft, send_outbound

    setor = _setor_juridico(tenant_id)
    if account_for_sector(tenant_id, getattr(setor, "id", None)) is None:
        return False
    email = create_draft(
        tenant_id,
        sector_id=getattr(setor, "id", None),
        to=[para],
        subject=assunto,
        body=corpo,
        origin=origem,
        requested_by="Assinatura eletrônica",
    )
    return send_outbound(email, approved_by=aprovado_por).status == "sent"


def _convidar(sig: Signatario, aprovado_por: str) -> bool:
    sol = sig.solicitacao
    corpo = (
        f"Olá, {sig.nome}.\n\n"
        f'Você foi convidado(a) a assinar eletronicamente o documento "{sol.titulo}".\n'
        + (f"\nMensagem: {sol.mensagem}\n" if sol.mensagem else "")
        + f"\nLeia e assine por este link (é pessoal, não encaminhe):\n{link_de(sig)}\n\n"
        f"Válido até {timezone.localtime(sol.expira_em):%d/%m/%Y}.\n"
        f"SHA-256 do documento: {sol.hash_original}"
    )
    ok = _email(
        sig.tenant_id,
        sig.email,
        f"Assinatura solicitada: {sol.titulo}",
        corpo,
        f"juridico.assinatura:{sol.id}",
        aprovado_por,
    )
    if ok:
        sig.convite_enviado_em = timezone.now()
        sig.save(update_fields=["convite_enviado_em"])
    registrar(
        sol,
        "convite" if ok else "link_gerado",
        sig,
        f"Convite enviado para {sig.email}" if ok else "Sem caixa de e-mail: link para copiar",
    )
    return ok


def _proximos(sol) -> list[Signatario]:
    pendentes = [s for s in sol.signatarios.all() if s.status not in ("assinou", "recusou")]
    if sol.ordem_sequencial:
        return pendentes[:1]
    return pendentes


def enviar(sol: SolicitacaoAssinatura, por: str) -> dict:
    if sol.status != "rascunho":
        raise AssinaturaError("Esta solicitação já foi enviada.")
    sol.status, sol.enviada_em = "enviada", timezone.now()
    sol.save(update_fields=["status", "enviada_em", "updated_at"])
    Documento.objects.filter(pk=sol.documento_id).update(status="em_assinatura")
    registrar(sol, "enviada", detalhe=f"por {por}")
    enviados = sum(_convidar(s, por) for s in _proximos(sol))
    return {"convites_enviados": enviados, "sem_email": enviados == 0}


def cancelar(sol: SolicitacaoAssinatura, por: str, motivo: str = ""):
    if sol.status in ("concluida", "cancelada"):
        raise AssinaturaError("Não dá pra cancelar esta solicitação.")
    sol.status = "cancelada"
    sol.save(update_fields=["status", "updated_at"])
    Documento.objects.filter(pk=sol.documento_id, status="em_assinatura").update(status="final")
    registrar(sol, "cancelada", detalhe=f"por {por}. {motivo}"[:500])


# ─── Lado do signatário (link público) ───────────────────────────────────────


def por_token(token: str) -> Signatario:
    sig = (
        Signatario.objects.select_related("solicitacao__documento")
        .filter(token_hash=sha256((token or "").encode()))
        .first()
    )
    if sig is None:
        raise AssinaturaError("Link inválido.")
    sol = sig.solicitacao
    if sol.status == "enviada" and sol.expira_em and sol.expira_em < timezone.now():
        sol.status = "expirada"
        sol.save(update_fields=["status", "updated_at"])
        registrar(sol, "expirada")
    return sig


def pode_assinar(sig: Signatario) -> str | None:
    """Motivo pelo qual NÃO pode assinar agora (ou None)."""
    sol = sig.solicitacao
    if sig.status == "assinou":
        return "Você já assinou este documento."
    if sig.status == "recusou":
        return "Você recusou este documento."
    if sol.status != "enviada":
        return {
            "rascunho": "Ainda não enviado para assinatura.",
            "concluida": "Documento já concluído.",
            "recusada": "Assinatura recusada por um signatário.",
            "cancelada": "Solicitação cancelada.",
            "expirada": "O prazo para assinar expirou.",
        }.get(sol.status, "Indisponível.")
    if sol.ordem_sequencial:
        antes = sol.signatarios.filter(ordem__lt=sig.ordem).exclude(status="assinou")
        if antes.exists():
            return "Aguardando a assinatura de quem vem antes de você."
    return None


def visualizou(sig: Signatario, ip=None, ua=""):
    if sig.status == "pendente":
        sig.status, sig.visualizado_em = "visualizou", timezone.now()
        sig.save(update_fields=["status", "visualizado_em"])
        registrar(sig.solicitacao, "visualizou", sig, "Abriu o documento", ip, ua)


def _hash_codigo(sig: Signatario, codigo: str) -> str:
    return hmac.new(sig.token_hash.encode(), codigo.encode(), hashlib.sha256).hexdigest()


def enviar_codigo(sig: Signatario, ip=None, ua="") -> None:
    motivo = pode_assinar(sig)
    if motivo:
        raise AssinaturaError(motivo)
    agora = timezone.now()
    if sig.codigo_expira_em and sig.codigo_expira_em - CODIGO_VALIDADE + CODIGO_REENVIO > agora:
        raise AssinaturaError("Aguarde um minuto para pedir outro código.")
    codigo = f"{secrets.randbelow(1_000_000):06d}"
    corpo = (
        f'Seu código para assinar "{sig.solicitacao.titulo}": {codigo}\n\n'
        "Vale por 10 minutos. Se não foi você, ignore este e-mail."
    )
    if not _email(
        sig.tenant_id,
        sig.email,
        f"Código de assinatura: {codigo}",
        corpo,
        f"juridico.assinatura:{sig.solicitacao_id}",
        "sistema (código de verificação)",
    ):
        raise AssinaturaError(
            "Não foi possível enviar o código: a empresa ainda não configurou a caixa de e-mail."
        )
    sig.codigo_hash, sig.codigo_expira_em, sig.codigo_tentativas = (
        _hash_codigo(sig, codigo),
        agora + CODIGO_VALIDADE,
        0,
    )
    sig.save(update_fields=["codigo_hash", "codigo_expira_em", "codigo_tentativas"])
    registrar(sig.solicitacao, "codigo_enviado", sig, f"Código enviado para {sig.email}", ip, ua)


@transaction.atomic
def assinar(
    sig: Signatario,
    *,
    nome: str,
    cpf: str = "",
    codigo: str = "",
    aceite: bool = False,
    ip=None,
    ua="",
) -> SolicitacaoAssinatura:
    sig = Signatario.objects.select_for_update().select_related("solicitacao").get(pk=sig.pk)
    sol = sig.solicitacao
    motivo = pode_assinar(sig)
    if motivo:
        raise AssinaturaError(motivo)
    if not aceite:
        raise AssinaturaError(
            "Confirme que leu o documento e concorda em assiná-lo eletronicamente."
        )
    if _norm(nome) != _norm(sig.nome):
        raise AssinaturaError("Digite seu nome completo exatamente como no convite.")
    if sig.cpf_encrypted and re.sub(r"\D", "", cpf or "") != decrypt_secret(sig.cpf_encrypted):
        registrar(sol, "cpf_invalido", sig, "CPF não confere", ip, ua)
        raise AssinaturaError("CPF não confere com o informado pelo remetente.")
    if sol.exigir_codigo_email:
        if not sig.codigo_hash or not sig.codigo_expira_em or sig.codigo_expira_em < timezone.now():
            raise AssinaturaError("Peça o código de verificação no seu e-mail.")
        if sig.codigo_tentativas >= CODIGO_MAX_TENTATIVAS:
            raise AssinaturaError("Tentativas esgotadas. Peça um novo código.")
        if not hmac.compare_digest(
            sig.codigo_hash, _hash_codigo(sig, re.sub(r"\D", "", codigo or ""))
        ):
            sig.codigo_tentativas += 1
            sig.save(update_fields=["codigo_tentativas"])
            registrar(sol, "codigo_invalido", sig, f"tentativa {sig.codigo_tentativas}", ip, ua)
            raise AssinaturaError("Código incorreto.")
        sig.codigo_verificado = True
    sig.status, sig.assinado_em = "assinou", timezone.now()
    sig.nome_assinatura, sig.ip, sig.user_agent = nome.strip()[:200], ip, (ua or "")[:300]
    sig.codigo_hash = ""
    sig.save()
    metodo = "link individual + código no e-mail" if sol.exigir_codigo_email else "link individual"
    registrar(sol, "assinou", sig, f"Assinou como {nome.strip()!r} ({metodo})", ip, ua)
    if not sol.signatarios.exclude(status="assinou").exists():
        concluir(sol)
    elif sol.ordem_sequencial:
        for prox in _proximos(sol):
            if not prox.convite_enviado_em:
                _convidar(prox, "sistema (ordem de assinatura)")
    return sol


def recusar(sig: Signatario, motivo: str, ip=None, ua=""):
    msg = pode_assinar(sig)
    if msg:
        raise AssinaturaError(msg)
    sig.status, sig.recusa_motivo = "recusou", (motivo or "").strip()[:500]
    sig.save(update_fields=["status", "recusa_motivo"])
    sol = sig.solicitacao
    sol.status = "recusada"
    sol.save(update_fields=["status", "updated_at"])
    Documento.objects.filter(pk=sol.documento_id).update(status="final")
    registrar(sol, "recusou", sig, sig.recusa_motivo or "sem motivo", ip, ua)


# ─── Conclusão e verificação ─────────────────────────────────────────────────

ROTULOS = {
    "criada": "Solicitação criada",
    "enviada": "Enviada para assinatura",
    "convite": "Convite por e-mail",
    "link_gerado": "Link gerado",
    "visualizou": "Documento aberto",
    "codigo_enviado": "Código enviado",
    "codigo_invalido": "Código incorreto",
    "cpf_invalido": "CPF não conferiu",
    "assinou": "Assinou",
    "recusou": "Recusou",
    "concluida": "Concluída",
    "cancelada": "Cancelada",
    "expirada": "Expirada",
}


def _mask_email(e: str) -> str:
    user, _, dom = e.partition("@")
    return f"{user[:2]}***@{dom}"


def manifesto(sol: SolicitacaoAssinatura) -> bytes:
    fmt = (
        lambda d: timezone.localtime(d).strftime("%d/%m/%Y %H:%M:%S (%Z)") if d else "—"
    )  # noqa: E731
    blocos = [
        ("h1", "Manifesto de assinaturas eletrônicas"),
        ("p", f"Documento: {sol.titulo}"),
        ("small", f"SHA-256 do documento original: {sol.hash_original}"),
        (
            "small",
            f"Solicitação nº {sol.id} · criada por {sol.criado_por or '—'} em {fmt(sol.created_at)}"
            f" · concluída em {fmt(sol.concluida_em)}",
        ),
        ("h2", "Signatários"),
    ]
    for s in sol.signatarios.all():
        metodo = (
            "link individual + código de verificação por e-mail"
            if s.codigo_verificado
            else "link individual"
        )
        blocos += [
            ("p", f"{s.nome_assinatura or s.nome} — {s.get_papel_display()}"),
            (
                "small",
                f"E-mail: {_mask_email(s.email)}"
                + (f" · CPF: {s.cpf_mascarado}" if s.cpf_mascarado else "")
                + f" · assinou em {fmt(s.assinado_em)} · IP {s.ip or '—'}",
            ),
            ("small", f"Autenticação: {metodo}. Navegador: {(s.user_agent or '—')[:110]}"),
        ]
    blocos.append(("h2", "Trilha de auditoria (encadeada por hash)"))
    for ev in sol.eventos.order_by("created_at", "id"):
        quem = f" — {ev.signatario.nome}" if ev.signatario_id else ""
        blocos.append(
            (
                "mono",
                f"{fmt(ev.created_at)}  {ROTULOS.get(ev.tipo, ev.tipo)}{quem}"
                f"  {ev.detalhe[:90]}  #{ev.hash_encadeado[:16]}",
            )
        )
    blocos += [
        ("h2", "Validade"),
        (
            "small",
            "Assinatura eletrônica nos termos da MP 2.200-2/2001, art. 10, § 2º, e da "
            "Lei 14.063/2020, admitida pelas partes como meio de comprovação de autoria e "
            "integridade. Qualquer alteração no documento muda o seu SHA-256.",
        ),
        ("small", f"Verifique a autenticidade em {base_url()}/verificar e envie este PDF."),
    ]
    return pdf.text_pdf(blocos, f"Manifesto - {sol.titulo}")


def concluir(sol: SolicitacaoAssinatura):
    sol.status, sol.concluida_em = "concluida", timezone.now()
    sol.save(update_fields=["status", "concluida_em", "updated_at"])
    registrar(sol, "concluida", detalhe="Todos os signatários assinaram")
    sol.pdf_original.open("rb")
    try:
        original = sol.pdf_original.read()
    finally:
        sol.pdf_original.close()
    final = pdf.juntar(original, manifesto(sol))
    sol.hash_assinado = sha256(final)
    sol.arquivo_assinado.save(
        f"assinado-{sol.hash_assinado[:12]}.pdf", ContentFile(final), save=False
    )
    sol.save(update_fields=["arquivo_assinado", "hash_assinado", "updated_at"])
    Documento.objects.filter(pk=sol.documento_id).update(status="assinado")
    for s in sol.signatarios.all():
        _email(
            sol.tenant_id,
            s.email,
            f"Documento assinado: {sol.titulo}",
            f'Todos assinaram "{sol.titulo}".\n\nBaixe a via assinada: {link_de(s)}\n\n'
            f"SHA-256 da via assinada: {sol.hash_assinado}",
            f"juridico.assinatura:{sol.id}",
            "sistema (conclusão)",
        )


def verificar(hash_hex: str) -> dict | None:
    h = (hash_hex or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", h):
        return None
    sol = (
        SolicitacaoAssinatura.objects.filter(hash_assinado=h).first()
        or SolicitacaoAssinatura.objects.filter(hash_original=h).first()
    )
    if sol is None:
        return None
    return {
        "arquivo": "via assinada" if sol.hash_assinado == h else "documento original",
        "titulo": sol.titulo,
        "status": sol.status,
        "concluida_em": sol.concluida_em,
        "hash_original": sol.hash_original,
        "hash_assinado": sol.hash_assinado,
        "trilha_integra": trilha_integra(sol),
        "signatarios": [
            {
                "nome": s.nome_assinatura or s.nome,
                "papel": s.get_papel_display(),
                "status": s.status,
                "assinado_em": s.assinado_em,
                "email": _mask_email(s.email),
            }
            for s in sol.signatarios.all()
        ],
    }
