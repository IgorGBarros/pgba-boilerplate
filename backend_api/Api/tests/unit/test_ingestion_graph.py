# backend_api/Api/tests/unit/test_ingestion_graph.py
"""Grafo do "Cérebro" (ingestion/graph.py) — funções puras, sem banco."""
from datetime import datetime, timezone
from types import SimpleNamespace

from ingestion.graph import build_knowledge_graph, extract_wikilinks


def _doc(id, path, content="", title=None, source=1, tags=None):
    return SimpleNamespace(
        id=id, source_id=source, external_id=path,
        title=title or path.rsplit("/", 1)[-1].removesuffix(".md"),
        content=content, metadata={"tags": tags or []}, status="indexed",
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def test_extract_wikilinks_variants():
    content = (
        "Ver [[ICP]], [[Pricing|a tabela]], [[Vendas/Playbook#Objeções]] e ![[diagrama.png]]. "
        "De novo [[ICP]]."
    )
    assert extract_wikilinks(content) == ["ICP", "Pricing", "Vendas/Playbook", "diagrama.png"]


def test_extract_wikilinks_ignores_code():
    content = "Real: [[A]]\n```md\nexemplo [[Falso]]\n```\ne `[[TambemFalso]]`"
    assert extract_wikilinks(content) == ["A"]


def test_graph_resolves_by_path_stem_and_title():
    docs = [
        _doc(1, "10-Business/icp.md",
             "Liga [[10-Business/pricing]] e [[playbook]] e [[Regras de Pipeline]]"),
        _doc(2, "10-Business/pricing.md"),
        _doc(3, "60-Sales/playbook.md"),
        _doc(4, "60-Sales/pipeline-rules.md", title="Regras de Pipeline"),
    ]
    g = build_knowledge_graph(docs)
    assert g["edges"] == [[1, 2], [1, 3], [1, 4]]
    assert g["unresolved"] == 0
    node = next(n for n in g["nodes"] if n["id"] == 1)
    assert node["folder"] == "10-Business"
    assert node["title"] == "icp"


def test_graph_counts_unresolved_and_skips_self_links():
    docs = [_doc(1, "a.md", "[[a]] [[nao-existe]] [[privada]]"), _doc(2, "b.md", "[[a]]")]
    g = build_knowledge_graph(docs)
    assert g["edges"] == [[2, 1]]
    assert g["unresolved"] == 2  # nota inexistente/privada nunca vira nó inventado


def test_graph_excerpt_is_plain_text_and_short():
    body = "# Título\n- item com [[Nota|apelido]] e [link](http://x)\n" + "palavra " * 100
    g = build_knowledge_graph([_doc(1, "n.md", body)])
    excerpt = g["nodes"][0]["excerpt"]
    assert excerpt.startswith("Título item com apelido e link")
    assert "[[" not in excerpt and "#" not in excerpt
    assert len(excerpt) <= 281
