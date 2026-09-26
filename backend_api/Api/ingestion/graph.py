# backend_api/Api/ingestion/graph.py
"""
Grafo de conhecimento a partir dos Documents já indexados — o "Cérebro"
que o Escritório 3D abre quando se clica nele.

Nós = Documents (uma nota do Obsidian, um upload, ...). Arestas = links
`[[wikilink]]` do Obsidian resolvidos para outro Document da MESMA fonte
ou de outra fonte do MESMO tenant (quem chama já filtrou por tenant — este
módulo é puro, não faz query nenhuma, pra ser testável sem banco).

Não guarda nada novo no banco: os links são extraídos do `content` que o
sync do Obsidian já grava (`ingestion.services.sync_obsidian_source`), então
funciona com vaults já sincronizados, sem precisar de resync/migration.
"""
import re
from pathlib import PurePosixPath

# [[alvo]], [[alvo|apelido]], [[alvo#seção]], [[alvo#^bloco|apelido]], ![[embed]]
_WIKILINK = re.compile(r"!?\[\[([^\[\]|#^]+)(?:[#^][^\[\]|]*)?(?:\|[^\[\]]*)?\]\]")
_FENCE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE = re.compile(r"`[^`\n]*`")
_WIKI_TEXT = re.compile(r"!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_LIST_MARK = re.compile(r"(?m)^\s*(?:[-+*]|\d+\.)\s+")
_MD_MARKS = re.compile(r"[#>*_`~]+")

EXCERPT_CHARS = 280


def extract_wikilinks(content: str) -> list[str]:
    """
    Alvos dos `[[wikilinks]]` de uma nota, na ordem, sem repetição.
    Ignora o que está dentro de bloco de código (``` ... ``` e `inline`) —
    exemplo de sintaxe numa nota técnica não é um link de verdade.
    """
    if not content:
        return []
    text = _INLINE_CODE.sub("", _FENCE.sub("", content))
    seen: list[str] = []
    for m in _WIKILINK.finditer(text):
        target = m.group(1).strip()
        if target and target not in seen:
            seen.append(target)
    return seen


def _norm(s: str) -> str:
    return s.strip().lower().removesuffix(".md")


def note_excerpt(content: str) -> str:
    """Começo da nota em texto corrido (sem marcação Markdown) pra prévia no grafo."""
    text = _FENCE.sub(" ", content or "")
    text = _WIKI_TEXT.sub(lambda m: (m.group(2) or m.group(1)).split("#")[0], text)
    text = _MD_LINK.sub(r"\1", text)
    text = _LIST_MARK.sub(" ", text)
    text = _MD_MARKS.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:EXCERPT_CHARS] + ("…" if len(text) > EXCERPT_CHARS else "")


MAX_BROKEN_PER_NODE = 20


def build_knowledge_graph(documents) -> dict:
    """
    `documents`: iterável de objetos com id, source_id, title, external_id,
    content, metadata, status, updated_at. Devolve {nodes, edges, unresolved}.
    Se `metadata` já traz "links" e "excerpt" (gravados em index_document),
    `content` nem é lido — pode vir vazio.

    Resolução de link igual ao Obsidian, na ordem: caminho relativo exato
    (sem .md) → nome do arquivo → título. Link pra nota que não existe (ou
    que não foi indexada — `private: true`, fora de `include_tags`) conta em
    `unresolved`, nunca vira nó: a planta não inventa nota que não está no
    banco do tenant.
    """
    docs = list(documents)
    by_path: dict[str, int] = {}
    by_stem: dict[str, int] = {}
    by_title: dict[str, int] = {}
    for d in docs:
        path = _norm(d.external_id or "")
        if path:
            by_path.setdefault(path, d.id)
            by_stem.setdefault(_norm(PurePosixPath(path).name), d.id)
        if d.title:
            by_title.setdefault(_norm(d.title), d.id)

    nodes = []
    edges: set[tuple[int, int]] = set()
    unresolved = 0
    for d in docs:
        # Links/trecho gravados na indexação (index_document); nota antiga,
        # indexada antes disso, cai no cálculo a partir do conteúdo.
        meta = d.metadata or {}
        if "links" in meta and "excerpt" in meta:
            targets, excerpt = list(meta["links"] or []), str(meta["excerpt"] or "")
        else:
            targets, excerpt = extract_wikilinks(d.content or ""), note_excerpt(d.content or "")
        broken: list[str] = []
        for t in targets:
            key = _norm(t)
            target_id = (
                by_path.get(key)
                or by_stem.get(_norm(PurePosixPath(key).name))
                or by_title.get(key)
            )
            if target_id is None:
                unresolved += 1
                if t not in broken:
                    broken.append(t)
            elif target_id != d.id:
                edges.add((d.id, target_id))

        path = d.external_id or ""
        parts = PurePosixPath(path).parts
        metadata = d.metadata or {}
        nodes.append({
            "id": d.id,
            "title": d.title or PurePosixPath(path).stem or f"Documento {d.id}",
            "path": path,
            "folder": parts[0] if len(parts) > 1 else "",
            "source": d.source_id,
            "tags": list(metadata.get("tags") or []),
            "status": d.status,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None,
            "excerpt": excerpt,
            # Links desta nota que não apontam pra nenhuma nota indexada do
            # tenant (inexistente, privada, fora de include_tags) — o nome do
            # link é o que já está escrito na própria nota, nada vazado.
            "broken_links": broken[:MAX_BROKEN_PER_NODE],
        })

    return {
        "nodes": nodes,
        "edges": sorted([list(e) for e in edges]),
        "unresolved": unresolved,
    }
