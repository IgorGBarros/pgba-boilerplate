# backend_api/Api/tests/unit/test_ingestion_chunking.py
"""Testes unitários para ingestion.services.chunk_text."""
import pytest
from ingestion.services import chunk_text, sha256_of


def test_empty_returns_empty():
    assert chunk_text("") == []
    assert chunk_text("   ") == []
    assert chunk_text(None) == []


def test_short_text_single_chunk():
    result = chunk_text("Parágrafo curto.")
    assert len(result) == 1
    assert "Parágrafo curto." in result[0]


def test_two_paragraphs_fit_in_one_chunk():
    text = "Primeiro parágrafo.\n\nSegundo parágrafo."
    result = chunk_text(text, chunk_size=800)
    assert len(result) == 1
    assert "Primeiro" in result[0]
    assert "Segundo" in result[0]


def test_large_paragraph_split_into_slices():
    # Parágrafo que não tem \n\n, maior que chunk_size
    big = "X" * 2500
    result = chunk_text(big, chunk_size=800, overlap=0)
    assert len(result) >= 3
    for chunk in result:
        assert len(chunk) <= 800


def test_overlap_adds_tail_of_previous():
    para_a = "A" * 400
    para_b = "B" * 400
    text = f"{para_a}\n\n{para_b}"
    result = chunk_text(text, chunk_size=500, overlap=50)
    # Com overlap, o segundo chunk deve conter o final do primeiro
    assert len(result) == 2
    assert result[1].startswith("A" * 50)


def test_many_paragraphs_produce_multiple_chunks():
    paras = "\n\n".join([f"Parágrafo número {i}." for i in range(50)])
    result = chunk_text(paras, chunk_size=200, overlap=0)
    assert len(result) > 1


def test_sha256_deterministic():
    assert sha256_of("hello") == sha256_of("hello")
    assert sha256_of("hello") != sha256_of("world")
    assert len(sha256_of("hello")) == 64


def test_sha256_empty():
    assert len(sha256_of("")) == 64
    assert sha256_of("") == sha256_of(None)
