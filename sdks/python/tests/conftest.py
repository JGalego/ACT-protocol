import json
from pathlib import Path

import pytest

VECTORS_DIR = Path(__file__).resolve().parents[3] / "conformance" / "vectors"


def load_vector(name: str):
    with open(VECTORS_DIR / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def canonicalization_vectors():
    return load_vector("canonicalization")


@pytest.fixture(scope="session")
def digest_vectors():
    return load_vector("digest")


@pytest.fixture(scope="session")
def ids_vectors():
    return load_vector("ids")


@pytest.fixture(scope="session")
def dsse_pae_vectors():
    return load_vector("dsse-pae")


@pytest.fixture(scope="session")
def keys_vectors():
    return load_vector("keys")


@pytest.fixture(scope="session")
def signatures_vectors():
    return load_vector("signatures")


@pytest.fixture(scope="session")
def envelopes_vectors():
    return load_vector("envelopes")


@pytest.fixture(scope="session")
def key_lifecycle_vectors():
    return load_vector("key-lifecycle")
