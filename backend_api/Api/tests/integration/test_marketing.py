# backend_api/Api/tests/integration/test_marketing.py
"""
Marketing: time, marca, IA (posts, plano), aprovação humana antes de publicar,
publicação nas redes (APIs simuladas), OAuth, mídia pública, criativos e cortes.
"""
import io
import json
import shutil
import subprocess
import uuid
from datetime import timedelta
from unittest.mock import patch

import httpx
import pytest
from cryptography.fernet import Fernet
from django.utils import timezone
from PIL import Image

from ingestion.connectors import safe_http
from marketing.redes import base as redes_base

API = "/api/v1/marketing"


@pytest.fixture(autouse=True)
def ambiente(settings, tmp_path, monkeypatch):
    settings.ENCRYPTION_KEY = Fernet.generate_key().decode()
    settings.MEDIA_ROOT = str(tmp_path)
    settings.FRONTEND_URL = "https://app.exemplo.com"
    settings.PUBLIC_API_URL = ""
    settings.CELERY_BROKER_URL = "memory://"
    monkeypatch.setattr(safe_http, "_resolve", lambda host, port: ["93.184.216.34"])
    monkeypatch.setattr(redes_base, "dormir", lambda s: None)
    monkeypatch.setattr("marketing.redes.x.dormir", lambda s: None)
    monkeypatch.setattr("marketing.redes.meta.dormir", lambda s: None)
    monkeypatch.setattr("marketing.redes.tiktok.dormir", lambda s: None)
    # Celery sem worker: a view roda na hora
    monkeypatch.setattr("marketing.tasks.despachar", _na_hora)
    monkeypatch.setattr("marketing.views.despachar", _na_hora)


def _na_hora(tarefa, *args):
    tarefa(*args)
    return False


class Rede:
    """Transporte httpx simulado: registra as chamadas e responde por rota."""

    def __init__(self, rotas):
        self.rotas = rotas
        self.chamadas = []

    def __call__(self, request: httpx.Request):
        self.chamadas.append(request)
        for (metodo, trecho), resposta in self.rotas.items():
            if request.method == metodo and trecho in str(request.url):
                r = resposta(request) if callable(resposta) else resposta
                if isinstance(r, httpx.Response):
                    return r
                return httpx.Response(200, json=r)
        return httpx.Response(404, json={"error": {"message": f"rota não simulada: {request.url}"}})


@pytest.fixture
def rede(monkeypatch):
    def instalar(rotas):
        r = Rede(rotas)
        monkeypatch.setattr(safe_http, "_transport", httpx.MockTransport(r))
        return r

    return instalar


def fake_chat(respostas):
    """chat_completion simulado: devolve a próxima resposta (dict vira JSON)."""
    fila = list(respostas)

    def _chat(*a, **k):
        r = fila.pop(0) if len(fila) > 1 else fila[0]
        return json.dumps(r) if isinstance(r, dict) else r

    return _chat


@pytest.fixture
def time_mkt(auth_client):
    r = auth_client.post(f"{API}/time/")
    assert r.status_code == 201
    return r.json()


def _conta(tenant_id, rede, conta_id="123", token="tok", **kw):
    from marketing.models import ContaSocial

    c = ContaSocial(tenant_id=tenant_id, rede=rede, conta_id=conta_id, nome=f"{rede} teste", **kw)
    c.token = token
    c.save()
    return c


def _png(w=1080, h=1080) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 30, 30)).save(buf, "PNG")
    return buf.getvalue()


# ─── Time, marca ─────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_montar_time_e_idempotente(auth_client, tenant_id):
    from agency.models import Agent

    r1 = auth_client.post(f"{API}/time/").json()
    assert r1["setor_criado"] and len(r1["criados"]) == 7
    r2 = auth_client.post(f"{API}/time/").json()
    assert not r2["setor_criado"] and r2["criados"] == [] and len(r2["existentes"]) == 7
    head = Agent.objects.get(tenant_id=tenant_id, name="Head de Marketing")
    assert head.access_level == "sector_orchestrator" and head.sector.name == "Marketing"
    assert "PUBLICAR é decisão de uma pessoa" in head.instructions
    assert Agent.objects.get(tenant_id=tenant_id, name="Copywriter").autonomy_level == 0
    t = auth_client.get(f"{API}/time/").json()
    assert len(t["agentes"]) == 7 and t["faltando"] == []


@pytest.mark.django_db
def test_marca_valida_e_vira_briefing(auth_client, tenant_id):
    from marketing.services import briefing

    r = auth_client.patch(
        f"{API}/marca/",
        {
            "nome": "Pão Quente",
            "ramo": "alimentacao",
            "pilares": ["Receitas", " ", "Bastidores"],
            "cor_primaria": "#F59E0B",
        },
        format="json",
    )
    assert r.status_code == 200 and r.json()["pilares"] == ["Receitas", "Bastidores"]
    assert r.json()["cor_primaria"] == "#f59e0b"
    assert (
        auth_client.patch(f"{API}/marca/", {"cor_texto": "vermelho"}, format="json").status_code
        == 400
    )
    b = briefing(tenant_id)
    assert "Pão Quente" in b and "Receitas, Bastidores" in b
    assert len(auth_client.get(f"{API}/ramos/").json()) >= 10


# ─── IA: post e plano ────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_ia_escreve_post_por_rede_e_avisa_limite(auth_client, tenant_id, time_mkt):
    x = _conta(tenant_id, "x", "1")
    li = _conta(tenant_id, "linkedin", "2")
    resposta = {
        "titulo": "3 erros no delivery",
        "gancho": "Seu delivery perde clientes?",
        "texto": "Texto base do post.",
        "variacoes": {"x": "a" * 300, "linkedin": "Texto do LinkedIn", "tiktok": "ignorada"},
        "hashtags": ["delivery", "#padaria"],
        "ideia_visual": "foto do motoboy",
    }
    with patch("harness.providers.chat_completion", side_effect=fake_chat([resposta])):
        r = auth_client.post(
            f"{API}/publicacoes/gerar/",
            {"tema": "erros no delivery", "contas": [x.id, li.id], "formato": "post"},
            format="json",
        )
    assert r.status_code == 201, r.content
    d = r.json()
    assert d["status"] == "rascunho" and d["escrita_por_ia"] and d["agente_nome"] == "Copywriter"
    assert d["hashtags"] == "#delivery #padaria"
    textos = {x["rede"]: x["texto"] for x in d["destinos"]}
    assert textos["linkedin"] == "Texto do LinkedIn" and len(textos["x"]) == 300
    assert any("X: 300 caracteres" in a for a in d["avisos"])
    # custo registrado no agente
    from agency.models import AgentInteraction

    assert AgentInteraction.objects.filter(agent__name="Copywriter").count() == 1


@pytest.mark.django_db
def test_ia_fora_do_formato_e_erro_explicito(auth_client, tenant_id, time_mkt):
    with patch("harness.providers.chat_completion", side_effect=fake_chat(["não sei fazer JSON"])):
        r = auth_client.post(
            f"{API}/publicacoes/gerar/", {"tema": "x", "redes": ["x"]}, format="json"
        )
    assert r.status_code == 400 and "fora do formato" in r.json()["detail"]


@pytest.mark.django_db
def test_sem_time_pede_para_montar(auth_client):
    r = auth_client.post(f"{API}/publicacoes/gerar/", {"tema": "x", "redes": ["x"]}, format="json")
    assert r.status_code == 400 and "Montar time" in r.json()["detail"]


@pytest.mark.django_db
def test_plano_do_periodo_filtra_itens_invalidos(auth_client, tenant_id, time_mkt):
    from marketing.models import Publicacao

    ig = _conta(tenant_id, "instagram", "10")
    li = _conta(tenant_id, "linkedin", "11")
    inicio = timezone.localdate() + timedelta(days=1)
    itens = [
        {
            "data": (inicio + timedelta(days=1)).isoformat(),
            "hora": "09:30",
            "pilar": "Dicas",
            "formato": "carrossel",
            "tema": "Como conservar pão",
            "gancho": "Pão durinho?",
            "redes": ["instagram"],
        },
        {
            "data": (inicio + timedelta(days=2)).isoformat(),
            "hora": "xx",
            "pilar": "Bastidores",
            "formato": "inventado",
            "tema": "Um dia na padaria",
            "redes": ["linkedin", "tiktok"],
        },
        {"data": (inicio + timedelta(days=60)).isoformat(), "tema": "fora do período"},
        {"data": "ontem", "tema": "data ruim"},
    ]
    with patch("harness.providers.chat_completion", side_effect=fake_chat([{"itens": itens}])):
        r = auth_client.post(
            f"{API}/publicacoes/planejar/",
            {
                "inicio": inicio.isoformat(),
                "semanas": 1,
                "por_semana": 3,
                "contas": [ig.id, li.id],
                "objetivo": "vender mais",
            },
            format="json",
        )
    assert r.status_code == 201, r.content
    pubs = list(Publicacao.objects.filter(tenant_id=tenant_id).order_by("agendada_para"))
    assert [p.titulo for p in pubs] == ["Como conservar pão", "Um dia na padaria"]
    assert pubs[0].formato == "carrossel" and timezone.localtime(pubs[0].agendada_para).hour == 9
    assert pubs[1].formato == "post" and timezone.localtime(pubs[1].agendada_para).hour == 12
    assert [d.conta.rede for d in pubs[0].destinos.all()] == ["instagram"]
    assert [d.conta.rede for d in pubs[1].destinos.all()] == ["linkedin"]
    assert all(p.status == "rascunho" for p in pubs)


# ─── Aprovação e publicação ─────────────────────────────────────────────────


@pytest.mark.django_db
def test_nada_publica_sem_aprovacao_e_confere_antes(auth_client, tenant_id, rede):
    ig = _conta(tenant_id, "instagram", "10")
    yt = _conta(tenant_id, "youtube", "UC1")
    r = auth_client.post(
        f"{API}/publicacoes/",
        {"titulo": "Post", "texto": "Olá", "contas": [ig.id, yt.id]},
        format="json",
    )
    pid = r.json()["id"]
    chamadas = rede({})
    # publicar sem aprovação: recusado
    assert auth_client.post(f"{API}/publicacoes/{pid}/publicar/").status_code == 400
    r = auth_client.post(f"{API}/publicacoes/{pid}/aprovar/", {}, format="json")
    assert r.status_code == 400
    msg = r.json()["detail"]
    assert "Instagram: precisa de imagem ou vídeo" in msg and "YouTube: precisa de um vídeo" in msg
    assert chamadas.chamadas == []


@pytest.mark.django_db
def test_aprovar_publica_no_discord_e_no_x(auth_client, tenant_id, rede):
    from marketing.models import Publicacao

    dc = _conta(
        tenant_id,
        "discord",
        "wh1",
        token="https://discord.com/api/webhooks/1/abc",
        config={"guild_id": "9", "channel_id": "8"},
    )
    x = _conta(tenant_id, "x", "55", usuario="padaria")
    img = auth_client.post(
        f"{API}/midias/", {"arquivo": io.BytesIO(_png()), "titulo": "foto"}, format="multipart"
    ).json()
    assert img["tipo"] == "imagem" and img["largura"] == 1080
    r = auth_client.post(
        f"{API}/publicacoes/",
        {
            "titulo": "Novidade",
            "texto": "Chegou o pão de fermentação natural!",
            "hashtags": "#pao",
            "link": "https://paoquente.com.br",
            "contas": [dc.id, x.id],
            "midias_ids": [img["id"]],
        },
        format="json",
    )
    pid = r.json()["id"]
    redes = rede(
        {
            ("POST", "discord.com/api/webhooks/1/abc"): {"id": "777", "channel_id": "8"},
            ("POST", "api.x.com/2/media/upload"): {"data": {"id": "m1"}},
            ("POST", "api.x.com/2/tweets"): {"data": {"id": "t1"}},
        }
    )
    r = auth_client.post(
        f"{API}/publicacoes/{pid}/aprovar/", {"publicar_agora": True}, format="json"
    )
    assert r.status_code == 200, r.content
    pub = Publicacao.objects.get(pk=pid)
    assert pub.status == "publicada" and pub.aprovada_por == "teste@example.com"
    dest = {d.conta.rede: d for d in pub.destinos.all()}
    assert dest["discord"].url == "https://discord.com/channels/9/8/777"
    assert dest["x"].url == "https://x.com/padaria/status/t1"
    tweet = next(c for c in redes.chamadas if c.url.path == "/2/tweets")
    corpo = json.loads(tweet.content)
    assert corpo["media"]["media_ids"] == ["m1"]
    assert "#pao" in corpo["text"] and "https://paoquente.com.br" in corpo["text"]
    assert tweet.headers["authorization"] == "Bearer tok"
    # publicar de novo não duplica
    assert auth_client.post(f"{API}/publicacoes/{pid}/publicar/").status_code == 400


@pytest.mark.django_db
def test_erro_em_uma_rede_nao_derruba_a_outra_e_da_pra_tentar_de_novo(auth_client, tenant_id, rede):
    from marketing.models import Publicacao

    dc = _conta(tenant_id, "discord", "wh1", token="https://discord.com/api/webhooks/1/abc")
    x = _conta(tenant_id, "x", "55")
    pid = auth_client.post(
        f"{API}/publicacoes/",
        {"titulo": "T", "texto": "Olá", "contas": [dc.id, x.id]},
        format="json",
    ).json()["id"]
    rede(
        {
            ("POST", "discord.com"): {"id": "1"},
            ("POST", "api.x.com/2/tweets"): httpx.Response(
                403, json={"title": "Forbidden", "detail": "Seu plano não permite publicar."}
            ),
        }
    )
    auth_client.post(f"{API}/publicacoes/{pid}/aprovar/", {}, format="json")
    pub = Publicacao.objects.get(pk=pid)
    assert pub.status == "parcial"
    erro_x = pub.destinos.get(conta=x)
    assert erro_x.status == "erro" and "Seu plano não permite publicar" in erro_x.erro
    rotas = rede({("POST", "api.x.com/2/tweets"): {"data": {"id": "t9"}}})
    assert auth_client.post(f"{API}/publicacoes/{pid}/publicar/").status_code == 200
    pub.refresh_from_db()
    assert pub.status == "publicada"
    assert not any("discord" in str(c.url) for c in rotas.chamadas)  # o que já saiu não repete


@pytest.mark.django_db
def test_agendada_so_sai_na_hora_e_editar_volta_pra_revisao(auth_client, tenant_id, rede):
    from marketing.models import Publicacao
    from marketing.tasks import publicar_agendadas_task

    dc = _conta(tenant_id, "discord", "wh1", token="https://discord.com/api/webhooks/1/abc")
    futuro = (timezone.now() + timedelta(hours=2)).isoformat()
    pid = auth_client.post(
        f"{API}/publicacoes/",
        {"titulo": "T", "texto": "Olá", "contas": [dc.id], "agendada_para": futuro},
        format="json",
    ).json()["id"]
    rotas = rede({("POST", "discord.com"): {"id": "1"}})
    auth_client.post(f"{API}/publicacoes/{pid}/aprovar/", {}, format="json")
    assert Publicacao.objects.get(pk=pid).status == "agendada"
    assert publicar_agendadas_task() == 0 and rotas.chamadas == []
    # editar depois de aprovada: volta pra revisão (aprovação vale pro que foi aprovado)
    auth_client.patch(f"{API}/publicacoes/{pid}/", {"texto": "Olá de novo"}, format="json")
    pub = Publicacao.objects.get(pk=pid)
    assert pub.status == "revisao" and not pub.aprovada_em
    auth_client.post(f"{API}/publicacoes/{pid}/aprovar/", {}, format="json")
    Publicacao.objects.filter(pk=pid).update(agendada_para=timezone.now() - timedelta(minutes=1))
    assert publicar_agendadas_task() == 1
    assert Publicacao.objects.get(pk=pid).status == "publicada"
    assert json.loads(rotas.chamadas[0].content)["content"] == "Olá de novo"


# ─── OAuth ───────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_oauth_x_com_pkce_state_de_uso_unico(auth_client, tenant_id, api_client, rede, settings):
    from urllib.parse import parse_qs, urlparse

    from marketing.models import ContaSocial

    settings.PUBLIC_API_URL = "https://api.exemplo.com"
    assert (
        auth_client.post(f"{API}/contas/conectar/", {"provedor": "x"}, format="json").status_code
        == 400
    )
    r = auth_client.post(
        f"{API}/apps/", {"provedor": "x", "client_id": "cid", "client_secret": "sec"}, format="json"
    )
    assert r.status_code == 201 and r.json()["secret_definido"] and "client_secret" not in r.json()
    url = auth_client.post(f"{API}/contas/conectar/", {"provedor": "x"}, format="json").json()[
        "url"
    ]
    q = parse_qs(urlparse(url).query)
    assert q["redirect_uri"] == ["https://api.exemplo.com/api/v1/marketing/oauth/callback/"]
    assert q["code_challenge_method"] == ["S256"] and "offline.access" in q["scope"][0]
    state = q["state"][0]
    chamadas = rede(
        {
            ("POST", "api.x.com/2/oauth2/token"): {
                "access_token": "AT",
                "refresh_token": "RT",
                "expires_in": 7200,
                "scope": "tweet.write",
            },
            ("GET", "api.x.com/2/users/me"): {
                "data": {"id": "42", "name": "Padaria", "username": "padaria"}
            },
        }
    )
    r = api_client.get(f"{API}/oauth/callback/", {"state": state, "code": "abc"})
    assert r.status_code == 302 and "ok=1" in r["Location"]
    token_req = chamadas.chamadas[0]
    corpo = parse_qs(token_req.content.decode())
    assert corpo["code_verifier"][0] and token_req.headers["authorization"].startswith("Basic ")
    c = ContaSocial.objects.get(tenant_id=tenant_id, rede="x")
    assert c.token == "AT" and c.refresh_token == "RT" and c.usuario == "padaria" and c.expira_em
    assert "AT" not in c._token  # cifrado
    # segundo uso do mesmo state: recusado
    r = api_client.get(f"{API}/oauth/callback/", {"state": state, "code": "abc"})
    assert "ok=0" in r["Location"]
    assert "AT" not in json.dumps(auth_client.get(f"{API}/contas/").json())


@pytest.mark.django_db
def test_oauth_meta_cria_pagina_e_instagram(auth_client, tenant_id, api_client, rede):
    from urllib.parse import parse_qs, urlparse

    from marketing.models import ContaSocial

    auth_client.post(
        f"{API}/apps/",
        {"provedor": "meta", "client_id": "app", "client_secret": "s"},
        format="json",
    )
    url = auth_client.post(f"{API}/contas/conectar/", {"provedor": "meta"}, format="json").json()[
        "url"
    ]
    assert url.startswith("https://www.facebook.com/v23.0/dialog/oauth")
    state = parse_qs(urlparse(url).query)["state"][0]

    def token(req):
        if "fb_exchange_token" in str(req.url):
            return {"access_token": "LONGO", "expires_in": 5184000}
        return {"access_token": "CURTO"}

    rede(
        {
            ("GET", "/oauth/access_token"): token,
            ("GET", "/me/accounts"): {
                "data": [
                    {
                        "id": "P1",
                        "name": "Pão Quente",
                        "access_token": "PAGE",
                        "instagram_business_account": {"id": "IG1", "username": "paoquente"},
                    }
                ]
            },
        }
    )
    r = api_client.get(f"{API}/oauth/callback/", {"state": state, "code": "c"})
    assert "ok=1" in r["Location"]
    fb = ContaSocial.objects.get(tenant_id=tenant_id, rede="facebook")
    ig = ContaSocial.objects.get(tenant_id=tenant_id, rede="instagram")
    assert fb.token == "PAGE" and ig.token == "PAGE" and not fb.expira_em
    assert ig.config["page_id"] == "P1" and ig.usuario == "paoquente"


@pytest.mark.django_db
def test_token_vencido_e_renovado_antes_de_publicar(tenant_id, rede):
    from marketing.models import AplicativoRede
    from marketing.redes import token_valido

    app = AplicativoRede(tenant_id=tenant_id, provedor="google", client_id="g")
    app.client_secret = "s"
    app.save()
    c = _conta(
        tenant_id, "youtube", "UC1", token="velho", expira_em=timezone.now() - timedelta(minutes=1)
    )
    c.refresh_token = "R"
    c.save()
    rede({("POST", "oauth2.googleapis.com/token"): {"access_token": "novo", "expires_in": 3600}})
    assert token_valido(c) == "novo"
    c.refresh_from_db()
    assert c.token == "novo" and c.refresh_token == "R" and c.expira_em > timezone.now()


# ─── Instagram (mídia por URL pública) ──────────────────────────────────────


@pytest.mark.django_db
def test_instagram_exige_api_publica_e_publica_por_conteiner(
    auth_client, tenant_id, api_client, rede, settings
):
    from marketing.models import Publicacao

    ig = _conta(tenant_id, "instagram", "IG1", token="PAGE", usuario="paoquente")
    img = auth_client.post(
        f"{API}/midias/", {"arquivo": io.BytesIO(_png())}, format="multipart"
    ).json()
    pid = auth_client.post(
        f"{API}/publicacoes/",
        {"titulo": "T", "texto": "Legenda", "contas": [ig.id], "midias_ids": [img["id"]]},
        format="json",
    ).json()["id"]
    r = auth_client.post(f"{API}/publicacoes/{pid}/aprovar/", {}, format="json")
    assert r.status_code == 400 and "PUBLIC_API_URL" in r.json()["detail"]

    settings.PUBLIC_API_URL = "https://api.exemplo.com"
    visto = {}

    def container(req):
        dados = dict(x.split("=", 1) for x in req.content.decode().split("&"))
        visto["image_url"] = httpx.URL("http://x/?u=" + dados["image_url"]).params["u"]
        return {"id": "C1"}

    rede(
        {
            ("POST", "/IG1/media_publish"): {"id": "M1"},
            ("POST", "/IG1/media"): container,
            ("GET", "/C1"): {"status_code": "FINISHED"},
            ("GET", "/M1"): {"permalink": "https://www.instagram.com/p/abc/"},
        }
    )
    assert (
        auth_client.post(f"{API}/publicacoes/{pid}/aprovar/", {}, format="json").status_code == 200
    )
    d = Publicacao.objects.get(pk=pid).destinos.get()
    assert d.status == "publicado" and d.url == "https://www.instagram.com/p/abc/"
    # o link público serve a mídia sem login; token adulterado não
    caminho = visto["image_url"].replace("https://api.exemplo.com", "")
    resp = api_client.get(caminho)
    assert resp.status_code == 200 and resp["Content-Type"] == "image/png"
    assert api_client.get(caminho[:-5] + "xxxx/").status_code == 404


# ─── Criativos ───────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_criativo_em_varios_formatos_e_carrossel(auth_client, tenant_id, time_mkt):
    r = auth_client.post(
        f"{API}/criativos/",
        {
            "modelo": "destaque",
            "formatos": ["quadrado", "vertical", "inexistente"],
            "textos": {"titulo": "Pão quentinho às 7h", "cta": "Peça já"},
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    midias = r.json()["midias"]
    assert [(m["formato"], m["largura"], m["altura"]) for m in midias] == [
        ("quadrado", 1080, 1080),
        ("vertical", 1080, 1920),
    ]
    arq = auth_client.get(f"{API}/midias/{midias[1]['id']}/arquivo/")
    assert Image.open(io.BytesIO(b"".join(arq.streaming_content))).size == (1080, 1920)
    textos = {
        "titulo": "Guia do pão",
        "cta": "Salve",
        "laminas": [{"titulo": "Um", "texto": "a"}, {"titulo": "Dois", "texto": "b"}],
    }
    with patch("harness.providers.chat_completion", side_effect=fake_chat([textos])):
        r = auth_client.post(
            f"{API}/criativos/",
            {
                "modelo": "lista",
                "formatos": ["retrato"],
                "usar_ia": True,
                "tema": "conservar pão",
                "laminas": 2,
            },
            format="json",
        )
    assert r.status_code == 201 and len(r.json()["midias"]) == 4  # capa + 2 + fechamento
    assert auth_client.post(f"{API}/criativos/", {"textos": {}}, format="json").status_code == 400


# ─── Vídeo ───────────────────────────────────────────────────────────────────


def test_ajustar_cortes_respeita_limites_e_falas():
    from marketing.ia import ajustar_cortes

    segs = [{"inicio": i * 5.0, "fim": i * 5.0 + 5, "texto": f"fala {i}"} for i in range(20)]
    cortes = ajustar_cortes(
        [
            {"inicio": 12, "fim": 38, "nota": 9, "titulo": "A"},
            {"inicio": 14, "fim": 40, "nota": 8},  # sobrepõe o primeiro
            {"inicio": 60, "fim": 62, "nota": 7},  # curto demais → estende
            {"inicio": 99, "fim": 500, "nota": "x"},  # passa do fim do vídeo
            {"inicio": "a", "fim": 3},
        ],
        segs,
        100.0,
        n=5,
        minimo=15,
        maximo=40,
    )
    assert [(c["inicio"], c["fim"]) for c in cortes] == [(10.0, 40.0), (60.0, 75.0)]
    assert cortes[0]["nota"] == 9


def test_legenda_youtube_sem_repeticao():
    from marketing.video import parse_vtt

    vtt = (
        "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nolá<00:00:02.000><c> pessoal</c>\n\n"
        "00:00:03.000 --> 00:00:03.010\nolá pessoal\n\n"
        "00:00:03.010 --> 00:00:06.000\nolá pessoal\nhoje vamos falar de pão.\n"
    )
    assert parse_vtt(vtt) == [
        {"inicio": 1.0, "fim": 6.0, "texto": "olá pessoal hoje vamos falar de pão."}
    ]


def test_url_de_video_so_youtube_ou_twitch():
    from marketing.video import VideoError, validar_url

    assert validar_url("https://youtu.be/abc")
    for ruim in ("https://evil.com/v.mp4", "file:///etc/passwd", "http://169.254.169.254/"):
        with pytest.raises(VideoError):
            validar_url(ruim)


@pytest.mark.django_db
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg não instalado")
def test_cortes_de_video_enviado(auth_client, tenant_id, time_mkt, tmp_path):
    from marketing.models import JobVideo

    src = tmp_path / "aula.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=25",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=300",
            "-t",
            "30",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-shortest",
            str(src),
        ],
        check=True,
    )
    video = auth_client.post(
        f"{API}/midias/", {"arquivo": src.open("rb")}, format="multipart"
    ).json()
    assert video["tipo"] == "video" and round(video["duracao"]) == 30
    assert (
        auth_client.post(f"{API}/jobs/cortes/", {"midia": video["id"]}, format="json").status_code
        == 400
    )  # sem direitos
    falas = [
        {"inicio": float(i * 3), "fim": float(i * 3 + 3), "texto": f"frase número {i}."}
        for i in range(10)
    ]
    escolha = {
        "cortes": [
            {
                "inicio": 3,
                "fim": 15,
                "titulo": "Melhor parte",
                "gancho": "Veja isso",
                "nota": 9,
                "legenda": "Legenda",
                "hashtags": ["#pao"],
            }
        ]
    }
    with patch("harness.providers.transcribe", return_value=falas) as tr, patch(
        "harness.providers.chat_completion", side_effect=fake_chat([escolha])
    ):
        r = auth_client.post(
            f"{API}/jobs/cortes/",
            {"midia": video["id"], "direitos": True, "minimo": 8, "maximo": 20},
            format="json",
        )
    assert r.status_code == 201, r.content
    tr.assert_called_once()
    job = JobVideo.objects.get(pk=r.json()["id"])
    assert job.status == "concluido", job.erro
    corte = job.midias.get()
    assert (corte.largura, corte.altura) == (1080, 1920) and 11 <= corte.duracao <= 13
    assert corte.origem == "corte" and "#pao" in corte.legenda_sugerida and corte.miniatura


@pytest.mark.django_db
def test_video_ia_pelo_moneyprinter(auth_client, tenant_id, time_mkt, rede):
    from integrations.models import ServiceCredential
    from marketing.models import JobVideo

    cred = ServiceCredential(
        tenant_id=tenant_id, provider="moneyprinter", account_ref="http://mp.exemplo.com:8080"
    )
    cred.token = "k"
    cred.save()
    roteiro = {
        "titulo": "Pão",
        "roteiro": "Você sabia que o pão...",
        "termos": ["bread", "bakery"],
        "legenda": "L",
        "hashtags": ["#pao"],
    }
    with patch("harness.providers.chat_completion", side_effect=fake_chat([roteiro])):
        r = auth_client.post(f"{API}/jobs/roteiro/", {"tema": "pão", "segundos": 30}, format="json")
    assert r.status_code == 200 and r.json()["termos"] == ["bread", "bakery"]
    mp4 = b"\x00\x00\x00\x18ftypmp42" + b"0" * 2000
    chamadas = rede(
        {
            ("POST", "/api/v1/videos"): {"status": 200, "data": {"task_id": "T1"}},
            ("GET", "/api/v1/tasks/T1"): {
                "data": {"state": 1, "progress": 100, "videos": ["/tasks/T1/final-1.mp4"]}
            },
            ("GET", "/tasks/T1/final-1.mp4"): httpx.Response(200, content=mp4),
        }
    )
    r = auth_client.post(
        f"{API}/jobs/video-ia/",
        {"titulo": "Pão", "roteiro": "Você sabia que o pão...", "termos": ["bread"]},
        format="json",
    )
    assert r.status_code == 201
    job = JobVideo.objects.get(pk=r.json()["id"])
    assert job.status == "concluido", job.erro
    assert job.midias.get().origem == "video_ia"
    criar = chamadas.chamadas[0]
    assert criar.headers["x-api-key"] == "k"
    corpo = json.loads(criar.content)
    assert corpo["video_script"] == "Você sabia que o pão..." and corpo["video_terms"] == ["bread"]
    assert corpo["video_aspect"] == "9:16"


# ─── Isolamento e utilitários ───────────────────────────────────────────────


@pytest.mark.django_db
def test_isolamento_por_tenant(auth_client, tenant_id):
    from marketing.models import Publicacao

    outro = uuid.uuid4()
    c = _conta(outro, "x", "1")
    p = Publicacao.objects.create(tenant_id=outro, titulo="alheia")
    assert auth_client.get(f"{API}/contas/").json() == []
    assert auth_client.get(f"{API}/publicacoes/{p.id}/").status_code == 404
    r = auth_client.post(
        f"{API}/publicacoes/", {"titulo": "minha", "contas": [c.id]}, format="json"
    )
    assert r.json()["destinos"] == []  # conta de outro tenant é ignorada


def test_linkedin_little_text_e_tiktok_partes():
    from marketing.redes.linkedin import little_text
    from marketing.redes.tiktok import partes

    assert little_text("Novo (grátis) #pao_quente") == "Novo \\(grátis\\) {hashtag|\\#|pao_quente}"
    assert partes(3 * 1024 * 1024) == (3 * 1024 * 1024, 1)
    assert partes(100 * 1024 * 1024) == (10 * 1024 * 1024, 10)
