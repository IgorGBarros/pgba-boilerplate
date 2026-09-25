"""
Busca de fornecedores via OpenStreetMap (Overpass API + Nominatim).
100% gratuito, sem API key.

Uso:
    from integrations.overpass import buscar_fornecedores_osm
    results = buscar_fornecedores_osm("fios elétricos", "São Paulo", raio_km=10)
"""
import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
_OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Mapeia palavras-chave de materiais para tags OSM relevantes
_CATEGORY_OSM_MAP: dict[str, list[str]] = {
    # Eletrônicos / Informática
    "eletrônic": ["shop=electronics", "shop=computer"],
    "eletronico": ["shop=electronics", "shop=computer"],
    "eletronic": ["shop=electronics", "shop=computer"],
    "informátic": ["shop=computer", "shop=electronics"],
    "informatica": ["shop=computer", "shop=electronics"],
    "computador": ["shop=computer"],
    "notebook": ["shop=computer"],
    "celular": ["shop=mobile_phone"],
    "smartphone": ["shop=mobile_phone"],
    "telefon": ["shop=mobile_phone", "shop=electronics"],
    "component": ["shop=electronics"],
    "semicondutor": ["shop=electronics"],
    "placa": ["shop=electronics", "shop=computer"],
    # Elétrica (instalação / cabos)
    "elétric": ["shop=electrical", "craft=electrician"],
    "eletric": ["shop=electrical", "craft=electrician"],
    "fio": ["shop=electrical"],
    "cabo": ["shop=electrical"],
    # Hidráulica
    "hidráulic": ["shop=plumbing", "craft=plumber"],
    "hidraulic": ["shop=plumbing", "craft=plumber"],
    "tubo": ["shop=plumbing"],
    "cano": ["shop=plumbing"],
    # Material de construção geral
    "construção": ["shop=doityourself", "shop=hardware"],
    "construcao": ["shop=doityourself", "shop=hardware"],
    "cimento": ["shop=doityourself"],
    "tijolo": ["shop=doityourself"],
    "areia": ["shop=doityourself"],
    "ferragem": ["shop=hardware"],
    # Madeira
    "madeira": ["shop=timber", "shop=doityourself"],
    # Tintas
    "tinta": ["shop=paint"],
    "pintur": ["shop=paint", "craft=painter"],
    # Ferramentas
    "ferrament": ["shop=hardware", "shop=doityourself"],
    # Vidro
    "vidro": ["craft=glaziery", "shop=glass"],
    # Default
    "__default__": ["shop=doityourself", "shop=hardware", "shop=wholesale"],
}

_HEADERS = {"User-Agent": "PGBA-Boilerplate/1.0 (supplier-search; contact=admin@pgba.app)"}
_TIMEOUT = 15


def _geocode_cidade(cidade: str) -> Optional[tuple[float, float]]:
    """Retorna (lat, lon) para a cidade via Nominatim."""
    try:
        resp = httpx.get(
            _NOMINATIM_URL,
            params={"q": cidade, "format": "json", "limit": 1, "countrycodes": "br"},
            headers=_HEADERS,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception as exc:
        logger.warning("Nominatim geocode falhou para '%s': %s", cidade, exc)
    return None


def _osm_tags_para_material(material: str) -> list[str]:
    """Retorna lista de tags OSM relevantes para o material."""
    material_lower = material.lower()
    for keyword, tags in _CATEGORY_OSM_MAP.items():
        if keyword != "__default__" and keyword in material_lower:
            return tags
    return _CATEGORY_OSM_MAP["__default__"]


def _overpass_query(lat: float, lon: float, raio_m: int, tags: list[str]) -> list[dict]:
    """Executa query Overpass e retorna lista de resultados."""
    # Monta filtros: cada tag vira um union
    filters = "\n".join(
        f'  node["{k}"="{v}"](around:{raio_m},{lat},{lon});'
        for tag in tags
        for k, v in [tag.split("=")]
    )
    query = f"""
[out:json][timeout:25];
(
{filters}
);
out body;
"""
    try:
        resp = httpx.post(
            _OVERPASS_URL,
            data={"data": query},
            headers=_HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("elements", [])
    except Exception as exc:
        logger.warning("Overpass query falhou: %s", exc)
        return []


def buscar_fornecedores_osm(
    material: str,
    cidade: str,
    raio_km: int = 10,
    limite: int = 10,
) -> list[dict]:
    """
    Busca fornecedores no OpenStreetMap para o material em uma cidade.

    Retorna lista de dicts com: nome, endereco, telefone, website,
    latitude, longitude, osm_id, source="openstreetmap".
    """
    coords = _geocode_cidade(cidade)
    if not coords:
        logger.warning("Não foi possível geocodificar a cidade: %s", cidade)
        return []

    lat, lon = coords
    tags = _osm_tags_para_material(material)
    raio_m = raio_km * 1000

    # Respeita rate limit do Overpass
    time.sleep(0.5)

    elementos = _overpass_query(lat, lon, raio_m, tags)

    resultados = []
    for el in elementos[:limite]:
        tags_el = el.get("tags", {})
        nome = tags_el.get("name", "").strip()
        if not nome:
            continue

        endereco_partes = [
            tags_el.get("addr:street", ""),
            tags_el.get("addr:housenumber", ""),
            tags_el.get("addr:city", ""),
            tags_el.get("addr:state", ""),
        ]
        endereco = ", ".join(p for p in endereco_partes if p)

        resultados.append({
            "nome": nome,
            "endereco": endereco or cidade,
            "cidade": tags_el.get("addr:city", cidade),
            "estado": tags_el.get("addr:state", ""),
            "telefone": tags_el.get("phone", tags_el.get("contact:phone", "")),
            "website": tags_el.get("website", tags_el.get("contact:website", "")),
            "email": tags_el.get("email", tags_el.get("contact:email", "")),
            "latitude": el.get("lat"),
            "longitude": el.get("lon"),
            "osm_id": str(el.get("id", "")),
            "source": "openstreetmap",
            "categoria": material,
        })

    return resultados
