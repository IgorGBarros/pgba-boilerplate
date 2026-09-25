"""
scraping.services — lógica de scraping sem depender de request/DRF.

Dois tipos:
  1. google_maps_scrape()  — chama o container gosom/google-maps-scraper (REST)
  2. url_scrape()          — httpx fetch + LLM via harness para extração estruturada

Exige GMAPS_SCRAPER_URL no settings/env (default: http://localhost:8080).
"""
import json
import re
import logging
from typing import Optional

import httpx
from django.conf import settings

from harness.providers import chat_completion, ProviderConfigError
from harness.guardrails import extract_json, validate_schema

logger = logging.getLogger(__name__)

GMAPS_BASE = getattr(settings, "GMAPS_SCRAPER_URL", "http://localhost:8080")
GMAPS_API_KEY = getattr(settings, "GMAPS_SCRAPER_API_KEY", "")
SCRAPER_TIMEOUT = getattr(settings, "SCRAPING_TIMEOUT", 120)


# ─── Google Maps ───────────────────────────────────────────────────────────────

def _gmaps_headers() -> dict:
    h = {"Content-Type": "application/json"}
    if GMAPS_API_KEY:
        h["X-API-Key"] = GMAPS_API_KEY
    return h


def gmaps_create_job(query: str, lat: str, lng: str, depth: int = 5) -> str:
    """Cria um job no container do Google Maps scraper. Retorna o job ID externo."""
    payload: dict = {"keyword": query, "zoom": 15, "depth": depth, "lang": "pt"}
    if lat and lat not in ("", "0"):
        payload["lat"] = lat
    if lng and lng not in ("", "0"):
        payload["lng"] = lng
    r = httpx.post(
        f"{GMAPS_BASE}/api/v1/jobs",
        json=payload,
        headers=_gmaps_headers(),
        timeout=30,
    )
    if not r.is_success:
        logger.error("gmaps_create_job %s — payload=%s — body=%s", r.status_code, payload, r.text)
        raise httpx.HTTPStatusError(
            f"{r.status_code} — {r.text[:400]}",
            request=r.request,
            response=r,
        )
    data = r.json()
    # API retorna o job ID diretamente ou dentro de um objeto
    if isinstance(data, str):
        return data
    return str(data.get("id") or data.get("job_id") or data)


def gmaps_get_job(job_id: str) -> dict:
    """Retorna o status e resultado do job."""
    r = httpx.get(
        f"{GMAPS_BASE}/api/v1/jobs/{job_id}",
        headers=_gmaps_headers(),
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def gmaps_list_jobs() -> list:
    r = httpx.get(f"{GMAPS_BASE}/api/v1/jobs", headers=_gmaps_headers(), timeout=30)
    r.raise_for_status()
    return r.json()


LEAD_FIELDS = ["title", "phone", "emails", "website", "category", "address",
               "review_rating", "review_count"]


def gmaps_normalize_results(raw: list) -> list[dict]:
    """Extrai apenas os campos úteis de cada resultado do scraper."""
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        row = {}
        for f in LEAD_FIELDS:
            v = item.get(f)
            if v is not None and v != "" and v != [] and v != {}:
                row[f] = v
        if row.get("title"):
            out.append(row)
    return out


# ─── URL Scraper (ScrapeGraphAI-style, via harness + httpx) ───────────────────

_HTML_TAG = re.compile(r"<[^>]+>")
_MULTI_SPACE = re.compile(r"\s{3,}")

BUILTIN_SCHEMAS = {
    "lead": {
        "nome": "string",
        "empresa": "string",
        "email": "string",
        "telefone": "string",
        "site": "string",
        "descricao": "string",
    },
    "produto": {
        "nome": "string",
        "preco": "string",
        "descricao": "string",
        "disponibilidade": "string",
    },
    "contato": {
        "nome": "string",
        "cargo": "string",
        "email": "string",
        "telefone": "string",
        "empresa": "string",
        "linkedin": "string",
    },
}


def _fetch_page_text(url: str, timeout: int = 20) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; PGBAScraper/1.0; +https://pgbasolutions.com.br)",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    }
    r = httpx.get(url, headers=headers, timeout=timeout, follow_redirects=True)
    r.raise_for_status()
    text = _HTML_TAG.sub(" ", r.text)
    text = _MULTI_SPACE.sub(" ", text).strip()
    return text[:8000]  # limita para não explodir o contexto do LLM


def url_scrape(
    tenant_id,
    url: str,
    schema: Optional[dict] = None,
    schema_preset: Optional[str] = None,
) -> dict:
    """
    Extrai dados estruturados de uma URL usando httpx + LLM via harness.

    schema: dict com campos desejados e tipo, ex: {"nome": "string", "preco": "string"}
    schema_preset: atalho para schemas comuns ("lead", "produto", "contato")
    """
    if schema_preset and schema_preset in BUILTIN_SCHEMAS:
        schema = BUILTIN_SCHEMAS[schema_preset]

    if not schema:
        schema = {"titulo": "string", "descricao": "string", "contato": "string"}

    page_text = _fetch_page_text(url)

    schema_desc = json.dumps(schema, ensure_ascii=False, indent=2)
    prompt = (
        f"Você é um extrator de dados estruturados. Analise o texto abaixo e extraia "
        f"as informações no seguinte formato JSON:\n{schema_desc}\n\n"
        f"Regras:\n"
        f"- Retorne SOMENTE o JSON, sem explicações.\n"
        f"- Se um campo não estiver presente, use null.\n"
        f"- Não invente dados que não estejam no texto.\n\n"
        f"TEXTO:\n{page_text}"
    )

    response = chat_completion(
        tenant_id=tenant_id,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        json_mode=True,
    )

    raw_json = extract_json(response)
    if raw_json is None:
        return {"erro": "LLM não retornou JSON válido", "raw": response[:500]}

    return raw_json


# ─── Import para CRM ──────────────────────────────────────────────────────────

def import_results_to_crm(job, pipeline_id=None) -> int:
    """
    Importa os resultados de um ScrapingJob como Leads no CRM.
    Retorna o número de leads criados.
    """
    from crm.models import Lead, Pipeline

    results = job.results
    if not results:
        return 0

    if pipeline_id:
        pipeline = Pipeline.objects.filter(tenant_id=job.tenant_id, id=pipeline_id).first()
    else:
        pipeline = Pipeline.objects.filter(tenant_id=job.tenant_id).first()

    count = 0
    for item in results:
        if not isinstance(item, dict):
            continue

        nome = item.get("title") or item.get("nome") or item.get("name") or ""
        if not nome:
            continue

        email = ""
        emails = item.get("emails") or item.get("email") or []
        if isinstance(emails, list) and emails:
            email = emails[0]
        elif isinstance(emails, str):
            email = emails

        Lead.objects.get_or_create(
            tenant_id=job.tenant_id,
            nome=nome,
            email=email,
            defaults={
                "empresa": item.get("empresa") or item.get("category") or "",
                "telefone": item.get("phone") or item.get("telefone") or "",
                "origem": "outro",
                "pipeline": pipeline,
                "stage": "novo",
                "notas": (
                    f"Importado via scraping ({job.job_type}) — "
                    f"site: {item.get('website', '')} | "
                    f"avaliação: {item.get('review_rating', '')} "
                    f"({item.get('review_count', '')} avaliações)"
                ).strip(" |"),
            },
        )
        count += 1

    job.imported_to_crm = True
    job.imported_count = count
    job.save(update_fields=["imported_to_crm", "imported_count", "updated_at"])
    return count
