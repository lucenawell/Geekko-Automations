import requests

from . import Candidate

LICENSE_LABEL = "Desconhecida - verificar antes de uso comercial"


def search_images(query: str, api_key: str, cse_id: str, num: int = 5) -> list[Candidate]:
    if not api_key or not cse_id:
        return []
    resp = requests.get(
        "https://www.googleapis.com/customsearch/v1",
        params={
            "key": api_key,
            "cx": cse_id,
            "q": query,
            "searchType": "image",
            "num": min(num, 10),
            "safe": "active",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    candidates = []
    for item in data.get("items", []):
        image_info = item.get("image", {})
        candidates.append(
            Candidate(
                fonte="Google",
                tipo="imagem",
                thumb_url=image_info.get("thumbnailLink", item.get("link", "")),
                download_url=item.get("link", ""),
                pagina_url=image_info.get("contextLink", ""),
                licenca=LICENSE_LABEL,
            )
        )
    return candidates
