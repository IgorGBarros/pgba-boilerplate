# backend_api/Api/tests/integration/test_juridico.py
"""
Jurídico: número CNJ, prazos em dias úteis, modelos, painel (provisão),
DataJud (simulado) e assinatura eletrônica ponta a ponta.
"""
import io
import re
import uuid

import httpx
import pytest
from cryptography.fernet import Fernet
from pypdf import PdfReader

from ingestion.connectors import safe_http
from juridico import assinatura as assin
from juridico.cnj import check_digits

API = "/api/v1/juridico"


def cnj_valido(seq="1002345", ano="2023", j="8", tr="26", orig="0100"):
    return f"{seq}-{check_digits(seq, ano, j, tr, orig)}.{ano}.{j}.{tr}.{orig}"


@pytest.fixture(autouse=True)
def ambiente(settings, tmp_path, monkeypatch):
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    settings.MEDIA_ROOT = str(tmp_path)
    settings.FRONTEND_URL = "https://app.exemplo.com"
    monkeypatch.setattr(safe_http, "_resolve", lambda host, port: ["93.184.216.34"])


class FakeSMTP:
    sent: list = []

    def __init__(self, *a, **k):
        pass

    def login(self, u, p):
        pass

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)

    def quit(self):
        pass


@pytest.fixture
def caixa(tenant_id, monkeypatch):
    """Caixa do setor Jurídico pronta (SMTP simulado)."""
    from integrations.models import EmailAccount
    from tests.factories import SectorFactory

    FakeSMTP.sent = []
    monkeypatch.setattr("integrations.email.smtplib.SMTP_SSL", FakeSMTP)
    setor = SectorFactory(tenant_id=tenant_id, name="Jurídico", slug="juridico")
    acc = EmailAccount(
        tenant_id=tenant_id,
        sector=setor,
        address="juridico@empresa.com.br",
        smtp_host="smtp.hostinger.com",
        status="ready",
    )
    acc.password = "x"
    acc.save()
    return FakeSMTP


def _corpo(msg) -> str:
    return msg.get_body().get_content()


# ─── Contencioso, prazos, modelos ────────────────────────────────────────────


@pytest.mark.django_db
def test_processo_cnj_valida_formata_e_nao_duplica(auth_client):
    n = cnj_valido()
    res = auth_client.post(
        f"{API}/processos/",
        {"titulo": "Ação de cobrança", "parte": "Empresa", "numero_cnj": re.sub(r"\D", "", n)},
        format="json",
    )
    assert res.status_code == 201, res.data
    assert res.data["numero_cnj"] == n and res.data["tribunal"] == "tjsp"
    ruim = n[:-1] + ("1" if n[-1] != "1" else "2")
    assert "dígito" in str(
        auth_client.post(
            f"{API}/processos/", {"titulo": "x", "parte": "y", "numero_cnj": ruim}, format="json"
        ).data
    )
    dup = auth_client.post(
        f"{API}/processos/", {"titulo": "x", "parte": "y", "numero_cnj": n}, format="json"
    )
    assert dup.status_code == 400 and "Já existe" in str(dup.data)
    # Excluir é lógico
    pid = res.data["id"]
    assert auth_client.delete(f"{API}/processos/{pid}/").status_code == 204
    from juridico.models import Processo

    assert Processo.objects.get(pk=pid).is_active is False
    assert auth_client.get(f"{API}/processos/").data["count"] == 0


@pytest.mark.django_db
def test_prazo_em_dias_uteis_calculado_pelo_cpc(auth_client):
    calc = auth_client.post(
        f"{API}/prazos/calcular/", {"inicio": "2026-09-25", "dias": 15}, format="json"
    ).data
    assert calc["vencimento"] == "2026-10-19"
    assert calc["pulados"] == [{"data": "2026-10-12", "motivo": "Nossa Senhora Aparecida"}]
    res = auth_client.post(
        f"{API}/prazos/",
        {"titulo": "Contestação", "data_inicio": "2026-12-15", "dias": 5},
        format="json",
    )
    assert (
        res.status_code == 201 and res.data["prazo"] == "2027-01-22"
    )  # recesso 20/12–20/01 suspende
    assert (
        auth_client.post(f"{API}/prazos/", {"titulo": "sem data"}, format="json").status_code == 400
    )


@pytest.mark.django_db
def test_modelos_padrao_gerar_documento_e_campos_faltando(auth_client, tenant_id):
    from erp.models import DadosEmpresa

    DadosEmpresa.objects.create(
        tenant_id=tenant_id,
        razao_social="Acme Serviços Ltda",
        cnpj="12.345.678/0001-90",
        municipio="São Paulo",
        uf="SP",
    )
    assert auth_client.post(f"{API}/modelos/padrao/", {}, format="json").data["criados"] == 4
    assert auth_client.post(f"{API}/modelos/padrao/", {}, format="json").data["criados"] == 0
    nda = next(m for m in auth_client.get(f"{API}/modelos/").data["results"] if "NDA" in m["nome"])
    assert "empresa.razao_social" in nda["campos"]
    contrato = auth_client.post(
        f"{API}/contratos/",
        {"titulo": "Projeto Alfa", "partes": "Beta S.A.", "data_inicio": "2026-10-01"},
        format="json",
    ).data
    doc = auth_client.post(
        f"{API}/modelos/{nda['id']}/gerar/", {"contrato": contrato["id"]}, format="json"
    ).data
    assert "Acme Serviços Ltda" in doc["conteudo"] and "Beta S.A." in doc["conteudo"]
    assert "parte.documento" in doc["faltando"] and "[[parte.documento?]]" in doc["conteudo"]
    pdf = auth_client.get(f"{API}/documentos/{doc['id']}/pdf/")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert "Acme" in PdfReader(io.BytesIO(pdf.content)).pages[0].extract_text()


@pytest.mark.django_db
def test_painel_provisao_por_probabilidade(auth_client):
    for prob, valor in (("provavel", 100000), ("possivel", 40000), ("remota", 5000)):
        auth_client.post(
            f"{API}/processos/",
            {
                "titulo": prob,
                "parte": "E",
                "probabilidade_perda": prob,
                "valor_estimado_perda": valor,
                "valor_causa": valor * 2,
            },
            format="json",
        )
    auth_client.post(
        f"{API}/processos/", {"titulo": "ganho", "parte": "E", "status": "ganho"}, format="json"
    )
    p = auth_client.get(f"{API}/painel/").data
    assert p["processos_ativos"] == 3 and float(p["provisao"]) == 100000
    assert float(p["contingencia_possivel"]) == 40000 and p["taxa_exito"] == 100


@pytest.mark.django_db
def test_datajud_sincroniza_andamentos_sem_duplicar(auth_client, tenant_id, monkeypatch):
    from integrations.models import ServiceCredential

    n = cnj_valido()
    chamadas = []

    def handler(req: httpx.Request):
        chamadas.append((req.url.path, req.headers.get("authorization")))
        return httpx.Response(
            200,
            json={
                "hits": {
                    "hits": [
                        {
                            "_source": {
                                "classe": {"nome": "Procedimento Comum Cível"},
                                "orgaoJulgador": {"nome": "1ª Vara Cível"},
                                "dataAjuizamento": "2023-03-10T00:00:00",
                                "assuntos": [{"nome": "Cobrança"}],
                                "movimentos": [
                                    {
                                        "codigo": 26,
                                        "nome": "Distribuição",
                                        "dataHora": "2023-03-10T10:00:00",
                                    },
                                    {
                                        "codigo": 51,
                                        "nome": "Conclusão",
                                        "dataHora": "2023-04-01T09:00:00",
                                        "complementosTabelados": [
                                            {"nome": "tipo", "descricao": "para decisão"}
                                        ],
                                    },
                                ],
                            }
                        }
                    ]
                }
            },
        )

    monkeypatch.setattr(safe_http, "_transport", httpx.MockTransport(handler))
    pid = auth_client.post(
        f"{API}/processos/", {"titulo": "Cobrança", "parte": "E", "numero_cnj": n}, format="json"
    ).data["id"]
    assert (
        "não configurado" in auth_client.post(f"{API}/processos/{pid}/sincronizar/").data["detail"]
    )
    cred = ServiceCredential(tenant_id=tenant_id, provider="datajud")
    cred.token = "chave-publica"
    cred.save()
    r = auth_client.post(f"{API}/processos/{pid}/sincronizar/").data
    assert r["novos"] == 2 and chamadas[-1] == ("/api_publica_tjsp/_search", "APIKey chave-publica")
    assert auth_client.post(f"{API}/processos/{pid}/sincronizar/").data["novos"] == 0
    proc = auth_client.get(f"{API}/processos/{pid}/").data
    assert (
        proc["classe"] == "Procedimento Comum Cível" and proc["orgao_julgador"] == "1ª Vara Cível"
    )
    andamentos = auth_client.get(f"{API}/andamentos/?processo={pid}").data["results"]
    assert "Conclusão (tipo: para decisão)" in [a["descricao"] for a in andamentos]


# ─── Assinatura eletrônica ───────────────────────────────────────────────────


def _documento(auth_client):
    return auth_client.post(
        f"{API}/documentos/",
        {
            "titulo": "Contrato Alfa",
            "tipo": "contrato",
            "conteudo": "Cláusula única: as partes concordam.",
        },
        format="json",
    ).data


@pytest.mark.django_db
def test_assinatura_completa_com_codigo_email_ordem_e_verificacao(auth_client, api_client, caixa):
    doc = _documento(auth_client)
    res = auth_client.post(
        f"{API}/assinaturas/",
        {
            "documento": doc["id"],
            "ordem_sequencial": True,
            "signatarios": [
                {"nome": "Ana Souza", "email": "ana@cliente.com", "cpf": "529.982.247-25"},
                {"nome": "Bruno Lima", "email": "bruno@empresa.com", "papel": "testemunha"},
            ],
        },
        format="json",
    )
    assert res.status_code == 201, res.data
    sol = res.data
    assert (
        sol["status"] == "enviada" and sol["envio"]["convites_enviados"] == 1
    )  # sequencial: só a 1ª
    assert "cpf" not in str(sol["signatarios"][0]) or sol["signatarios"][0][
        "cpf_mascarado"
    ].startswith("***")
    convite = _corpo(caixa.sent[-1])
    token_ana = re.search(r"/assinar/([\w-]+)", convite).group(1)
    assert sol["hash_original"] in convite

    links = {
        x["nome"]: x["link"] for x in auth_client.get(f"{API}/assinaturas/{sol['id']}/links/").data
    }
    token_bruno = links["Bruno Lima"].rsplit("/", 1)[1]
    info = api_client.get(f"{API}/assinar/{token_bruno}/").data
    assert info["bloqueio"] and "antes de você" in info["bloqueio"]

    info = api_client.get(f"{API}/assinar/{token_ana}/").data
    assert (
        info["bloqueio"] is None
        and info["pedir_cpf"]
        and info["signatario"]["email"].startswith("an***")
    )
    assert api_client.get(f"{API}/assinar/{token_ana}/pdf/").content.startswith(b"%PDF")

    # Sem código não assina; código errado conta tentativa; CPF errado recusa
    dados = {"nome": "ana souza", "cpf": "52998224725", "aceite": True}
    assert (
        "código"
        in api_client.post(f"{API}/assinar/{token_ana}/assinar/", dados, format="json").data[
            "detail"
        ]
    )
    assert (
        api_client.post(f"{API}/assinar/{token_ana}/codigo/", {}, format="json").status_code == 200
    )
    codigo = re.search(r"\b(\d{6})\b", _corpo(caixa.sent[-1])).group(1)
    assert (
        "Aguarde"
        in api_client.post(f"{API}/assinar/{token_ana}/codigo/", {}, format="json").data["detail"]
    )
    errado = f"{(int(codigo) + 1) % 1_000_000:06d}"
    assert (
        "incorreto"
        in api_client.post(
            f"{API}/assinar/{token_ana}/assinar/", {**dados, "codigo": errado}, format="json"
        ).data["detail"]
    )
    assert (
        "CPF"
        in api_client.post(
            f"{API}/assinar/{token_ana}/assinar/",
            {**dados, "cpf": "11144477735", "codigo": codigo},
            format="json",
        ).data["detail"]
    )
    ok = api_client.post(
        f"{API}/assinar/{token_ana}/assinar/",
        {**dados, "codigo": codigo},
        format="json",
        HTTP_USER_AGENT="Firefox/130",
        REMOTE_ADDR="200.10.20.30",
    )
    assert ok.status_code == 200 and ok.data["concluida"] is False
    # Ordem: agora o Bruno recebeu convite
    assert "bruno@empresa.com" in caixa.sent[-1]["To"]
    assert api_client.get(f"{API}/assinar/{token_bruno}/").data["bloqueio"] is None
    api_client.post(f"{API}/assinar/{token_bruno}/codigo/", {}, format="json")
    codigo_b = re.search(r"\b(\d{6})\b", _corpo(caixa.sent[-1])).group(1)
    fim = api_client.post(
        f"{API}/assinar/{token_bruno}/assinar/",
        {"nome": "Bruno Lima", "codigo": codigo_b, "aceite": True},
        format="json",
    ).data
    assert fim["concluida"] is True

    # Via assinada = original + manifesto; hash confere; verificação pública
    assinado = auth_client.get(f"{API}/assinaturas/{sol['id']}/arquivo/?via=assinada").content
    original = auth_client.get(f"{API}/assinaturas/{sol['id']}/arquivo/").content
    assert (
        assin.sha256(assinado) == fim["hash_assinado"]
        and assin.sha256(original) == sol["hash_original"]
    )
    paginas = PdfReader(io.BytesIO(assinado)).pages
    manifesto = "".join(
        p.extract_text() for p in paginas[len(PdfReader(io.BytesIO(original)).pages) :]
    )
    assert (
        "Manifesto de assinaturas" in manifesto
        and "Ana Souza" in manifesto
        and "200.10.20.30" in manifesto
    )
    assert sol["hash_original"] in manifesto and "***.982.***-25" in manifesto
    from django.core.files.uploadedfile import SimpleUploadedFile

    v = api_client.post(
        f"{API}/verificar/", {"arquivo": SimpleUploadedFile("x.pdf", assinado)}, format="multipart"
    ).data
    assert v["encontrado"] and v["arquivo"] == "via assinada" and v["trilha_integra"] is True
    assert [s["nome"] for s in v["signatarios"]] == ["ana souza", "Bruno Lima"]
    assert (
        api_client.post(f"{API}/verificar/", {"hash": "0" * 64}, format="json").data["encontrado"]
        is False
    )
    assert auth_client.get(f"{API}/documentos/{doc['id']}/").data["status"] == "assinado"
    # Documento assinado não muda
    assert (
        auth_client.patch(
            f"{API}/documentos/{doc['id']}/", {"titulo": "x"}, format="json"
        ).status_code
        == 400
    )

    # Trilha encadeada: mexer num evento quebra a integridade
    from juridico.models import EventoAssinatura, SolicitacaoAssinatura

    ev = EventoAssinatura.objects.filter(solicitacao_id=sol["id"], tipo="assinou").first()
    EventoAssinatura.objects.filter(pk=ev.pk).update(detalhe="adulterado")
    assert assin.trilha_integra(SolicitacaoAssinatura.objects.get(pk=sol["id"])) is False


@pytest.mark.django_db
def test_sem_caixa_de_email_link_para_copiar_e_recusa(auth_client, api_client):
    doc = _documento(auth_client)
    sol = auth_client.post(
        f"{API}/assinaturas/",
        {
            "documento": doc["id"],
            "exigir_codigo_email": False,
            "signatarios": [
                {"nome": "Carla Dias", "email": "carla@x.com"},
                {"nome": "Davi", "email": "davi@x.com"},
            ],
        },
        format="json",
    ).data
    assert sol["envio"]["sem_email"] is True
    links = auth_client.get(f"{API}/assinaturas/{sol['id']}/links/").data
    tok_c, tok_d = (x["link"].rsplit("/", 1)[1] for x in links)
    assert links[0]["link"].startswith("https://app.exemplo.com/assinar/")
    assert (
        "nome completo"
        in api_client.post(
            f"{API}/assinar/{tok_c}/assinar/",
            {"nome": "Outra Pessoa", "aceite": True},
            format="json",
        ).data["detail"]
    )
    ok = api_client.post(
        f"{API}/assinar/{tok_c}/assinar/", {"nome": "Carla Dias", "aceite": True}, format="json"
    )
    assert ok.status_code == 200
    assert (
        api_client.post(
            f"{API}/assinar/{tok_d}/recusar/", {"motivo": "Valor errado"}, format="json"
        ).status_code
        == 200
    )
    s = auth_client.get(f"{API}/assinaturas/{sol['id']}/").data
    assert s["status"] == "recusada" and s["assinados"] == {"feitos": 1, "total": 2}
    assert api_client.get(f"{API}/assinar/{tok_c}/").data["status"] == "recusada"
    ev = auth_client.get(f"{API}/assinaturas/{sol['id']}/eventos/").data
    assert ev["trilha_integra"] and [e["tipo"] for e in ev["eventos"]][-1] == "recusou"


@pytest.mark.django_db
def test_assinatura_isolada_por_tenant_e_token_invalido(auth_client, api_client):
    doc = _documento(auth_client)
    sol = auth_client.post(
        f"{API}/assinaturas/",
        {
            "documento": doc["id"],
            "exigir_codigo_email": False,
            "signatarios": [{"nome": "Eva", "email": "eva@x.com"}],
        },
        format="json",
    ).data
    from juridico.models import SolicitacaoAssinatura

    SolicitacaoAssinatura.objects.filter(pk=sol["id"]).update(tenant_id=uuid.uuid4())
    assert auth_client.get(f"{API}/assinaturas/{sol['id']}/").status_code == 404
    assert api_client.get(f"{API}/assinar/nao-existe/").status_code == 404
    bad = auth_client.post(
        f"{API}/assinaturas/",
        {
            "documento": doc["id"],
            "signatarios": [{"nome": "X", "email": "x@x.com", "cpf": "123.456.789-00"}],
        },
        format="json",
    )
    assert bad.status_code == 400 and "CPF inválido" in bad.data["detail"]
