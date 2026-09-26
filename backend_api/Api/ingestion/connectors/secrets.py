# backend_api/Api/ingestion/connectors/secrets.py
"""
Segredos dos conectores: gravados cifrados em `KnowledgeSource.secret_config`
e nunca devolvidos pela API — só "••••1234" pra pessoa saber que existe.
Mandar o valor mascarado de volta (formulário de edição) mantém o segredo.
"""
from __future__ import annotations

SECRET_FIELDS: dict[str, list[str]] = {
    "rest_api": ["api_key"],
    "google_sheets": ["service_account_json"],
    "slack": ["bot_token"],
    "notion": ["integration_token"],
    "hubspot": ["api_key"],
    "salesforce": ["client_secret"],
    "email": ["password"],
    "webhook": ["secret"],
    "sql": ["password"],
}

MASK = "••••"


def mask(value: str) -> str:
    value = str(value or "")
    return f"{MASK}{value[-4:]}" if len(value) > 8 else MASK


def is_masked(value) -> bool:
    return isinstance(value, str) and value.startswith(MASK)


def split_config(source_type: str, incoming: dict, current_secrets: dict) -> tuple[dict, dict]:
    """
    Separa o que veio da tela em (config público, segredos). Segredo mascarado
    ou vazio mantém o valor salvo; `null` explícito apaga.
    """
    names = set(SECRET_FIELDS.get(source_type, []))
    public, secrets = {}, dict(current_secrets or {})
    for key, value in (incoming or {}).items():
        if key not in names:
            public[key] = value
        elif value is None:
            secrets.pop(key, None)
        elif value == "" or is_masked(value):
            continue
        else:
            secrets[key] = value
    return public, secrets


def masked_view(source) -> tuple[dict, list[str]]:
    """Config pra devolver na API: público + segredos mascarados, e quais estão salvos."""
    try:
        secrets = source.get_secrets()
    except Exception:  # ENCRYPTION_KEY trocada: mostra que existe, sem decifrar
        secrets = (
            {k: "" for k in SECRET_FIELDS.get(source.source_type, [])}
            if source.secret_config
            else {}
        )
    names = SECRET_FIELDS.get(source.source_type, [])
    view = {k: v for k, v in (source.config or {}).items() if k not in names}
    # Segredo antigo que ainda está no config (sem ENCRYPTION_KEY na migração) também sai mascarado
    legacy = {k: (source.config or {}).get(k) for k in names if (source.config or {}).get(k)}
    for k, v in {**legacy, **secrets}.items():
        view[k] = mask(v)
    return view, sorted({*secrets.keys(), *legacy.keys()})
