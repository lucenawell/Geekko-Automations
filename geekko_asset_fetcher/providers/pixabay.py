import requests

from . import Candidate

LICENSE_LABEL = "Pixabay License (uso comercial livre, atribuicao nao obrigatoria)"


def search_images(query: str, api_key: str, per_page: int = 5) -> list[Candidate]:
    if not api_key:
        return []
    per_page = max(per_page, 3)  # minimo exigido pela API
    resp = requests.get(
        "https://pixabay.com/api/",
        params={
            "key": api_key,
            "q": query,
            "image_type": "photo",
            "per_page": per_page,
            "safesearch": "true",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    candidates = []
    for hit in data.get("hits", []):
        candidates.append(
            Candidate(
                fonte="Pixabay",
                tipo="imagem",
                thumb_url=hit.get("webformatURL", ""),
                download_url=hit.get("largeImageURL") or hit.get("webformatURL", ""),
                pagina_url=hit.get("pageURL", ""),
                licenca=LICENSE_LABEL,
            )
        )
    return candidates
