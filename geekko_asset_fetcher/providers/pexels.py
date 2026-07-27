import requests

from . import Candidate

BASE_HEADERS_KEY = "Authorization"
LICENSE_LABEL = "Pexels License (uso comercial livre, atribuicao nao obrigatoria)"


def _headers(api_key: str) -> dict:
    return {BASE_HEADERS_KEY: api_key}


def search_images(query: str, api_key: str, per_page: int = 5) -> list[Candidate]:
    if not api_key:
        return []
    resp = requests.get(
        "https://api.pexels.com/v1/search",
        params={"query": query, "per_page": per_page},
        headers=_headers(api_key),
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    candidates = []
    for photo in data.get("photos", []):
        candidates.append(
            Candidate(
                fonte="Pexels",
                tipo="imagem",
                thumb_url=photo["src"]["medium"],
                download_url=photo["src"].get("original") or photo["src"]["large2x"],
                pagina_url=photo.get("url", ""),
                licenca=LICENSE_LABEL,
            )
        )
    return candidates
