# backend_api/Api/juridico/cnj.py
"""
Número único de processo (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO

- DD = dígito verificador, ISO 7064 módulo 97-10:
  DD = 98 - (NNNNNNN AAAA J TR OOOO 00  mod 97)
- J = segmento do Judiciário, TR = tribunal. Juntos dão a sigla do índice no
  DataJud (API pública do CNJ): 8.26 → tjsp, 5.02 → trt2, 4.03 → trf3.
Funções puras.
"""
from __future__ import annotations

import re

UFS_TJ = {
    "01": "ac",
    "02": "al",
    "03": "ap",
    "04": "am",
    "05": "ba",
    "06": "ce",
    "07": "dft",
    "08": "es",
    "09": "go",
    "10": "ma",
    "11": "mt",
    "12": "ms",
    "13": "mg",
    "14": "pa",
    "15": "pb",
    "16": "pr",
    "17": "pe",
    "18": "pi",
    "19": "rj",
    "20": "rn",
    "21": "rs",
    "22": "ro",
    "23": "rr",
    "24": "sc",
    "25": "se",
    "26": "sp",
    "27": "to",
}


class CnjError(ValueError):
    pass


def digits(numero: str) -> str:
    return re.sub(r"\D", "", numero or "")


def check_digits(n7: str, ano: str, j: str, tr: str, orig: str) -> str:
    base = int(f"{n7}{ano}{j}{tr}{orig}00")
    return f"{98 - (base % 97):02d}"


def parse(numero: str) -> dict:
    d = digits(numero)
    if len(d) != 20:
        raise CnjError("O número CNJ tem 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO).")
    n7, dd, ano, j, tr, orig = d[:7], d[7:9], d[9:13], d[13], d[14:16], d[16:]
    if check_digits(n7, ano, j, tr, orig) != dd:
        raise CnjError("Número CNJ inválido: o dígito verificador não confere.")
    return {"sequencial": n7, "dv": dd, "ano": ano, "segmento": j, "tribunal": tr, "origem": orig}


def format_cnj(numero: str) -> str:
    p = parse(numero)
    return f"{p['sequencial']}-{p['dv']}.{p['ano']}.{p['segmento']}.{p['tribunal']}.{p['origem']}"


def tribunal_alias(numero: str) -> str | None:
    """Sigla do tribunal no DataJud, ou None se o segmento não é coberto aqui."""
    p = parse(numero)
    j, tr = p["segmento"], p["tribunal"]
    if j == "8":
        uf = UFS_TJ.get(tr)
        return f"tj{uf}" if uf else None
    if j == "5":
        return "tst" if tr == "00" else f"trt{int(tr)}"
    if j == "4":
        return f"trf{int(tr)}" if 1 <= int(tr) <= 6 else None
    if j == "3":
        return "stj"
    if j == "6":
        return "tse" if tr == "00" else None
    return None
