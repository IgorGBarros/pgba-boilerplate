# backend_api/Api/marketing/redes/oauth.py
"""
Login OAuth 2.0 de cada provedor (authorization code; PKCE onde o provedor
pede ou aceita). O `state` é aleatório e o verificador PKCE fica só no banco
(`OAuthPendente`) — nunca na URL.

Cada provedor: `url_autorizacao` → (pessoa autoriza na rede) → callback →
`trocar` (code → tokens) → `perfis` (quais contas/páginas/canais o login deu).
"""
from __future__ import annotations

from urllib.parse import urlencode

from marketing.redes.base import Perfil, RedeError, Tokens, chamar, json_de
from marketing.redes.meta import graph


def _tokens(d: dict) -> Tokens:
    if not d.get("access_token"):
        raise RedeError(d.get("error_description") or "A rede não devolveu o token de acesso.")
    exp = d.get("expires_in")
    return Tokens(
        access=d["access_token"],
        refresh=d.get("refresh_token") or "",
        expires_in=int(exp) if exp else None,
        escopos=" ".join(d["scope"]) if isinstance(d.get("scope"), list) else d.get("scope") or "",
        extra={k: v for k, v in d.items() if k in ("open_id", "id_token")},
    )


class Provedor:
    key = ""
    nome = ""
    authorize_url = ""
    token_url = ""
    escopos: list[str] = []
    separador = " "
    pkce = False
    portal = ""
    redes: list[str] = []

    def params_autorizacao(self, app, redirect_uri, state) -> dict:
        return {
            "client_id": app.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": self.separador.join(self.escopos),
            "state": state,
        }

    def url_autorizacao(self, app, redirect_uri, state, challenge="") -> str:
        p = self.params_autorizacao(app, redirect_uri, state)
        if self.pkce and challenge:
            p.update({"code_challenge": challenge, "code_challenge_method": "S256"})
        return f"{self.authorize_url}?{urlencode(p)}"

    def _form(self, app, extra: dict) -> Tokens:
        data = {"client_id": app.client_id, "client_secret": app.client_secret, **extra}
        return _tokens(
            json_de(
                chamar("POST", self.token_url, data=data, headers={"Accept": "application/json"})
            )
        )

    def trocar(self, app, code, redirect_uri, verificador="") -> Tokens:
        extra = {"code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri}
        if self.pkce and verificador:
            extra["code_verifier"] = verificador
        return self._form(app, extra)

    def renovar(self, app, refresh) -> Tokens:
        return self._form(app, {"grant_type": "refresh_token", "refresh_token": refresh})

    def perfis(self, app, tokens: Tokens) -> list[Perfil]:
        raise NotImplementedError


class XOAuth(Provedor):
    key = "x"
    nome = "X (Twitter)"
    authorize_url = "https://x.com/i/oauth2/authorize"
    token_url = "https://api.x.com/2/oauth2/token"
    escopos = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"]
    pkce = True
    portal = "https://developer.x.com/en/portal/dashboard"
    redes = ["x"]

    def _form(self, app, extra):
        # Cliente confidencial: Basic auth com client id/secret
        data = {"client_id": app.client_id, **extra}
        return _tokens(
            json_de(
                chamar("POST", self.token_url, data=data, auth=(app.client_id, app.client_secret))
            )
        )

    def perfis(self, app, tokens):
        d = (
            json_de(
                chamar(
                    "GET",
                    "https://api.x.com/2/users/me",
                    headers={"Authorization": f"Bearer {tokens.access}"},
                )
            ).get("data")
            or {}
        )
        u = d.get("username", "")
        return [Perfil("x", str(d.get("id")), d.get("name") or u, u, f"https://x.com/{u}")]


class GoogleOAuth(Provedor):
    key = "google"
    nome = "Google (YouTube)"
    authorize_url = "https://accounts.google.com/o/oauth2/v2/auth"
    token_url = "https://oauth2.googleapis.com/token"
    escopos = [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
    ]
    pkce = True
    portal = "https://console.cloud.google.com/apis/credentials"
    redes = ["youtube"]

    def params_autorizacao(self, app, redirect_uri, state):
        return {
            **super().params_autorizacao(app, redirect_uri, state),
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
        }

    def perfis(self, app, tokens):
        d = json_de(
            chamar(
                "GET",
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "snippet", "mine": "true"},
                headers={"Authorization": f"Bearer {tokens.access}"},
            )
        )
        out = []
        for c in d.get("items") or []:
            sn = c.get("snippet") or {}
            handle = sn.get("customUrl", "")
            out.append(
                Perfil(
                    "youtube",
                    c["id"],
                    sn.get("title") or c["id"],
                    handle,
                    f"https://www.youtube.com/{handle}"
                    if handle
                    else f"https://www.youtube.com/channel/{c['id']}",
                )
            )
        if not out:
            raise RedeError("Essa conta Google não tem canal no YouTube.")
        return out


class TikTokOAuth(Provedor):
    key = "tiktok"
    nome = "TikTok"
    authorize_url = "https://www.tiktok.com/v2/auth/authorize/"
    token_url = "https://open.tiktokapis.com/v2/oauth/token/"
    escopos = ["user.info.basic", "video.upload", "video.publish"]
    separador = ","
    portal = "https://developers.tiktok.com/apps"
    redes = ["tiktok"]

    def params_autorizacao(self, app, redirect_uri, state):
        p = super().params_autorizacao(app, redirect_uri, state)
        p["client_key"] = p.pop("client_id")
        return p

    def _form(self, app, extra):
        data = {"client_key": app.client_id, "client_secret": app.client_secret, **extra}
        return _tokens(
            json_de(
                chamar(
                    "POST",
                    self.token_url,
                    data=data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            )
        )

    def perfis(self, app, tokens):
        d = json_de(
            chamar(
                "GET",
                "https://open.tiktokapis.com/v2/user/info/",
                params={"fields": "open_id,display_name,avatar_url"},
                headers={"Authorization": f"Bearer {tokens.access}"},
            )
        )
        u = (d.get("data") or {}).get("user") or {}
        oid = u.get("open_id") or tokens.extra.get("open_id")
        if not oid:
            raise RedeError("TikTok não devolveu a conta.")
        return [Perfil("tiktok", oid, u.get("display_name") or "Conta TikTok")]


class LinkedInOAuth(Provedor):
    key = "linkedin"
    nome = "LinkedIn"
    authorize_url = "https://www.linkedin.com/oauth/v2/authorization"
    token_url = "https://www.linkedin.com/oauth/v2/accessToken"
    escopos = ["openid", "profile", "w_member_social"]
    portal = "https://www.linkedin.com/developers/apps"
    redes = ["linkedin"]

    def perfis(self, app, tokens):
        d = json_de(
            chamar(
                "GET",
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {tokens.access}"},
            )
        )
        if not d.get("sub"):
            raise RedeError("LinkedIn não devolveu o perfil (escopo openid/profile).")
        return [Perfil("linkedin", d["sub"], d.get("name") or "Perfil LinkedIn")]


class TwitchOAuth(Provedor):
    key = "twitch"
    nome = "Twitch"
    authorize_url = "https://id.twitch.tv/oauth2/authorize"
    token_url = "https://id.twitch.tv/oauth2/token"
    escopos = ["moderator:manage:announcements"]
    portal = "https://dev.twitch.tv/console/apps"
    redes = ["twitch"]

    def perfis(self, app, tokens):
        d = json_de(
            chamar(
                "GET",
                "https://api.twitch.tv/helix/users",
                headers={"Authorization": f"Bearer {tokens.access}", "Client-Id": app.client_id},
            )
        )
        u = (d.get("data") or [{}])[0]
        if not u.get("id"):
            raise RedeError("Twitch não devolveu o canal.")
        login = u.get("login", "")
        return [
            Perfil(
                "twitch",
                u["id"],
                u.get("display_name") or login,
                login,
                f"https://www.twitch.tv/{login}",
            )
        ]


class MetaOAuth(Provedor):
    key = "meta"
    nome = "Meta (Instagram + Facebook)"
    escopos = [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "business_management",
        "instagram_basic",
        "instagram_content_publish",
    ]
    separador = ","
    portal = "https://developers.facebook.com/apps"
    redes = ["instagram", "facebook"]

    @property
    def authorize_url(self):  # type: ignore[override]
        return f"https://www.facebook.com/{graph().rsplit('/', 1)[-1]}/dialog/oauth"

    @property
    def token_url(self):  # type: ignore[override]
        return f"{graph()}/oauth/access_token"

    def trocar(self, app, code, redirect_uri, verificador=""):
        curto = _tokens(
            json_de(
                chamar(
                    "GET",
                    self.token_url,
                    params={
                        "client_id": app.client_id,
                        "client_secret": app.client_secret,
                        "redirect_uri": redirect_uri,
                        "code": code,
                    },
                )
            )
        )
        # Token de longa duração (~60 dias); os tokens de página derivados dele não vencem
        return _tokens(
            json_de(
                chamar(
                    "GET",
                    self.token_url,
                    params={
                        "grant_type": "fb_exchange_token",
                        "client_id": app.client_id,
                        "client_secret": app.client_secret,
                        "fb_exchange_token": curto.access,
                    },
                )
            )
        )

    def renovar(self, app, refresh):
        raise RedeError("Meta não renova por refresh token — conecte de novo.")

    def perfis(self, app, tokens):
        d = json_de(
            chamar(
                "GET",
                f"{graph()}/me/accounts",
                params={
                    "fields": (
                        "id,name,link,access_token," "instagram_business_account{id,username,name}"
                    ),
                    "limit": 100,
                    "access_token": tokens.access,
                },
            )
        )
        out = []
        for p in d.get("data") or []:
            out.append(
                Perfil(
                    "facebook",
                    p["id"],
                    p.get("name") or p["id"],
                    url=p.get("link") or f"https://www.facebook.com/{p['id']}",
                    token=p.get("access_token"),
                )
            )
            ig = p.get("instagram_business_account")
            if ig and ig.get("id"):
                u = ig.get("username", "")
                out.append(
                    Perfil(
                        "instagram",
                        ig["id"],
                        ig.get("name") or u or ig["id"],
                        u,
                        f"https://www.instagram.com/{u}" if u else "",
                        token=p.get("access_token"),
                        config={"page_id": p["id"]},
                    )
                )
        if not out:
            raise RedeError(
                "Nenhuma página do Facebook liberada nesse login. Na tela da Meta, escolha a "
                "página (e a conta profissional do Instagram ligada a ela)."
            )
        return out


PROVEDORES = {
    p.key: p
    for p in (MetaOAuth(), GoogleOAuth(), TikTokOAuth(), LinkedInOAuth(), XOAuth(), TwitchOAuth())
}
