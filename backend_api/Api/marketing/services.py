# backend_api/Api/marketing/services.py
"""
Regras do Marketing sem depender de request/DRF:

- `briefing` — o perfil da marca em texto (todo agente lê antes de escrever);
- `texto_para` / `conferir` — o texto final de cada rede e o que impede publicar;
- `aprovar` / `publicar` — publicar é SEMPRE depois de uma pessoa aprovar;
- OAuth (`iniciar_oauth`, `concluir_oauth`) e mídia pública assinada.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone

from marketing.models import (
    PROVEDOR_OAUTH,
    AplicativoRede,
    ContaSocial,
    Destino,
    OAuthPendente,
    PerfilMarca,
    Publicacao,
)
from marketing.redes import REDES, RedeError, rede, token_valido

logger = logging.getLogger(__name__)

SAL_MIDIA = "marketing.midia-publica"
VALIDADE_MIDIA = 2 * 24 * 3600
VALIDADE_OAUTH = timedelta(minutes=15)


class MarketingError(Exception):
    pass


# ─── Marca ───────────────────────────────────────────────────────────────────


def perfil(tenant_id) -> PerfilMarca:
    obj, _ = PerfilMarca.objects.get_or_create(tenant_id=tenant_id)
    return obj


def briefing(tenant_id) -> str:
    p = PerfilMarca.objects.filter(tenant_id=tenant_id).first()
    if p is None or not (p.nome or p.descricao):
        from erp.models import DadosEmpresa

        d = DadosEmpresa.objects.filter(tenant_id=tenant_id).first()
        nome = (d.nome_fantasia or d.razao_social) if d else ""
        return (
            f"Empresa: {nome or '(sem nome)'}. Perfil da marca ainda não preenchido — "
            "escreva de forma neutra e profissional, sem inventar dados da empresa."
        )
    linhas = [
        f"Marca: {p.nome}",
        f"Ramo: {p.ramo}" if p.ramo else "",
        f"O que faz: {p.descricao}" if p.descricao else "",
        f"Público: {p.publico_alvo}" if p.publico_alvo else "",
        f"Tom de voz: {p.tom_de_voz}" if p.tom_de_voz else "",
        f"Pilares de conteúdo: {', '.join(p.pilares)}" if p.pilares else "",
        f"Diferenciais: {p.diferenciais}" if p.diferenciais else "",
        f"Nunca usar/prometer: {p.evitar}" if p.evitar else "",
        f"Hashtags da marca: {p.hashtags}" if p.hashtags else "",
        f"Chamada padrão (CTA): {p.cta_padrao}" if p.cta_padrao else "",
        f"Site: {p.site}" if p.site else "",
        f"Idioma: {p.idioma}",
    ]
    return "\n".join(x for x in linhas if x)


# ─── Mídia pública (Instagram/TikTok buscam por URL) ─────────────────────────


def api_publica() -> str:
    return (getattr(settings, "PUBLIC_API_URL", "") or "").rstrip("/")


def url_publica(midia) -> str:
    base = api_publica()
    if not base:
        raise RedeError(
            "Defina PUBLIC_API_URL (endereço https público desta API): a rede busca a mídia "
            "por um link público."
        )
    token = signing.dumps({"t": str(midia.tenant_id), "m": midia.pk}, salt=SAL_MIDIA)
    return f"{base}/api/v1/marketing/publico/midia/{token}/"


def midia_do_token(token: str):
    from marketing.models import Midia

    try:
        d = signing.loads(token, salt=SAL_MIDIA, max_age=VALIDADE_MIDIA)
    except signing.BadSignature:
        return None
    return Midia.objects.filter(pk=d.get("m"), tenant_id=d.get("t"), is_active=True).first()


# ─── Texto por rede e conferência ───────────────────────────────────────────


def texto_para(pub: Publicacao, destino: Destino) -> str:
    """Texto que vai pra essa conta: o da rede (se escrito) ou o base + hashtags + link."""
    if destino.texto.strip():
        return destino.texto.strip()
    r = REDES.get(destino.conta.rede)
    partes = [pub.texto.strip()]
    tags = [t for t in (pub.hashtags or "").split() if t.startswith("#")]
    faltando = [t for t in tags if t.lower() not in pub.texto.lower()]
    if faltando and destino.conta.rede not in ("twitch", "discord"):
        partes.append(" ".join(faltando))
    if pub.link and pub.link not in pub.texto and (r is None or r.link_clicavel):
        partes.append(pub.link)
    return "\n\n".join(p for p in partes if p)


def conferir(pub: Publicacao) -> list[str]:
    erros = []
    destinos = list(pub.destinos.select_related("conta"))
    if not destinos:
        return ["Escolha pelo menos uma conta pra publicar."]
    midias = list(pub.midias.filter(is_active=True))
    for d in destinos:
        if not d.conta.is_active:
            erros.append(f"{d.conta}: conta desconectada.")
            continue
        erros += rede(d.conta.rede).conferir(texto_para(pub, d), midias, pub.formato)
        if not texto_para(pub, d) and d.conta.rede in ("x", "twitch", "discord", "linkedin"):
            erros.append(f"{d.conta}: falta o texto.")
    return erros


# ─── Aprovar e publicar ─────────────────────────────────────────────────────


def aprovar(pub: Publicacao, quem: str) -> Publicacao:
    if pub.status in ("publicada", "publicando"):
        raise MarketingError("Essa publicação já saiu.")
    if erros := conferir(pub):
        raise MarketingError(" · ".join(erros))
    pub.status = "agendada"
    pub.aprovada_por = quem
    pub.aprovada_em = timezone.now()
    pub.save(update_fields=["status", "aprovada_por", "aprovada_em"])
    return pub


def reivindicar(pub_id, tenant_id) -> bool:
    """Marca 'publicando' de forma atômica — duas execuções nunca publicam a mesma."""
    return bool(
        Publicacao.objects.filter(
            pk=pub_id, tenant_id=tenant_id, is_active=True, status__in=["agendada"]
        ).update(status="publicando")
    )


def publicar(pub_id, tenant_id) -> Publicacao:
    """Publica nos destinos pendentes/com erro. Só roda em publicação aprovada."""
    pub = Publicacao.objects.get(pk=pub_id, tenant_id=tenant_id)
    if pub.status != "publicando" and not reivindicar(pub_id, tenant_id):
        raise MarketingError("Só publica o que foi aprovado (e ainda não saiu).")
    pub.refresh_from_db()
    midias = list(pub.midias.filter(is_active=True).order_by("id"))
    for d in pub.destinos.select_related("conta").exclude(status="publicado"):
        d.status, d.tentativas = "publicando", d.tentativas + 1
        d.save(update_fields=["status", "tentativas"])
        try:
            if not d.conta.is_active:
                raise RedeError("Conta desconectada.")
            token_valido(d.conta)
            res = rede(d.conta.rede).publicar(d.conta, texto_para(pub, d), midias, pub)
            d.status, d.externo_id, d.url = "publicado", res.externo_id, res.url[:500]
            d.erro, d.publicado_em = res.aviso, timezone.now()
        except RedeError as exc:
            d.status, d.erro = "erro", str(exc)[:2000]
        except Exception as exc:  # noqa: BLE001 — falha inesperada numa rede não derruba as outras
            logger.exception("Falha publicando destino %s", d.pk)
            d.status, d.erro = "erro", f"Erro inesperado: {exc}"[:2000]
        d.save(update_fields=["status", "externo_id", "url", "erro", "publicado_em"])
    status = list(pub.destinos.values_list("status", flat=True))
    ok = status.count("publicado")
    pub.status = "publicada" if ok == len(status) else ("parcial" if ok else "erro")
    if ok:
        pub.publicada_em = pub.publicada_em or timezone.now()
    pub.save(update_fields=["status", "publicada_em"])
    return pub


def definir_destinos(pub: Publicacao, conta_ids: list[int], textos: dict | None = None) -> None:
    """Contas escolhidas (do mesmo tenant); tira as que saíram, mantém o que já publicou."""
    contas = ContaSocial.objects.filter(tenant_id=pub.tenant_id, is_active=True, pk__in=conta_ids)
    ids = set(contas.values_list("pk", flat=True))
    pub.destinos.exclude(conta_id__in=ids).exclude(status="publicado").delete()
    textos = textos or {}
    for c in contas:
        d, _ = Destino.objects.get_or_create(
            publicacao=pub, conta=c, defaults={"tenant_id": pub.tenant_id}
        )
        novo = textos.get(str(c.pk), textos.get(c.rede))
        if novo is not None and d.status != "publicado":
            d.texto = novo
            d.save(update_fields=["texto"])


# ─── OAuth ───────────────────────────────────────────────────────────────────


def redirect_uri(request=None) -> str:
    base = api_publica() or (request.build_absolute_uri("/").rstrip("/") if request else "")
    return f"{base}/api/v1/marketing/oauth/callback/"


def iniciar_oauth(tenant_id, provedor: str, redirect: str, usuario: str = "") -> str:
    from marketing.redes.oauth import PROVEDORES

    if provedor not in PROVEDORES:
        raise MarketingError("Provedor inválido.")
    app = AplicativoRede.objects.filter(tenant_id=tenant_id, provedor=provedor).first()
    if app is None or not app.client_id:
        raise MarketingError("Cadastre primeiro o app dessa rede (Client ID e Secret).")
    OAuthPendente.objects.filter(created_at__lt=timezone.now() - VALIDADE_OAUTH).delete()
    verificador = secrets.token_urlsafe(48) if PROVEDORES[provedor].pkce else ""
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verificador.encode()).digest())
        .rstrip(b"=")
        .decode()
        if verificador
        else ""
    )
    state = secrets.token_urlsafe(32)
    OAuthPendente.objects.create(
        tenant_id=tenant_id,
        state=state,
        provedor=provedor,
        verificador=verificador,
        redirect_uri=redirect,
        usuario=usuario,
    )
    return PROVEDORES[provedor].url_autorizacao(app, redirect, state, challenge)


def concluir_oauth(state: str, code: str) -> list[ContaSocial]:
    from marketing.redes.oauth import PROVEDORES

    with transaction.atomic():
        pend = OAuthPendente.objects.select_for_update().filter(state=state).first()
        if pend is None or pend.created_at < timezone.now() - VALIDADE_OAUTH:
            raise MarketingError("Login expirado ou já usado — comece de novo pela tela Contas.")
        dados = (pend.tenant_id, pend.provedor, pend.verificador, pend.redirect_uri, pend.usuario)
        pend.delete()  # uso único
    tenant_id, provedor, verificador, redirect, usuario = dados
    app = AplicativoRede.objects.get(tenant_id=tenant_id, provedor=provedor)
    prov = PROVEDORES[provedor]
    tokens = prov.trocar(app, code, redirect, verificador)
    contas = []
    for p in prov.perfis(app, tokens):
        conta = ContaSocial.objects.filter(
            tenant_id=tenant_id, rede=p.rede, conta_id=p.conta_id
        ).first() or ContaSocial(tenant_id=tenant_id, rede=p.rede, conta_id=p.conta_id)
        conta.nome, conta.usuario, conta.url = p.nome[:255], p.usuario[:255], p.url[:200]
        conta.token = p.token or tokens.access
        conta.refresh_token = "" if p.token else tokens.refresh
        conta.expira_em = (
            None
            if p.token or not tokens.expires_in
            else timezone.now() + timedelta(seconds=tokens.expires_in)
        )
        conta.escopos = tokens.escopos[:500]
        conta.config = {**(conta.config or {}), **p.config}
        conta.status, conta.mensagem = "conectada", ""
        conta.is_active, conta.deleted_at = True, None
        conta.conectada_por = usuario
        conta.save()
        contas.append(conta)
    return contas


def testar_conta(conta: ContaSocial) -> str:
    try:
        token_valido(conta)
        msg = rede(conta.rede).testar(conta)
        conta.status, conta.mensagem = "conectada", ""
        return msg
    except RedeError as exc:
        conta.status, conta.mensagem = "erro", str(exc)[:500]
        raise
    finally:
        conta.ultimo_teste = timezone.now()
        conta.save(update_fields=["status", "mensagem", "ultimo_teste"])


def provedor_da_rede(key: str) -> str | None:
    return PROVEDOR_OAUTH.get(key)
