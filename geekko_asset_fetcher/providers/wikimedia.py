import requests

from . import Candidate


def search_images(query: str, per_page: int = 3) -> list[Candidate]:
    """Wikimedia Commons - sem chave, licenca sempre clara (CC/dominio publico).
    Forte em foto historica/jornalistica/documental real."""
    resp = requests.get(
        "https://commons.wikimedia.org/w/api.php",
        params={
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": query,
            "gsrlimit": per_page,
            "gsrnamespace": 6,  # namespace "File:"
            "prop": "imageinfo",
            "iiprop": "url|extmetadata",
            "iiurlwidth": 400,
        },
        headers={"User-Agent": "GeekkoAssetFetcher/1.0 (uso pessoal)"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    candidatos = []
    paginas = data.get("query", {}).get("pages", {})
    for page in paginas.values():
        infos = page.get("imageinfo")
        if not infos:
            continue
        info = infos[0]
        extmeta = info.get("extmetadata", {})
        licenca = extmeta.get("LicenseShortName", {}).get("value", "Wikimedia Commons - ver pagina")
        candidatos.append(
            Candidate(
                fonte="Wikimedia",
                tipo="imagem",
                thumb_url=info.get("thumburl", info.get("url", "")),
                download_url=info.get("url", ""),
                pagina_url=info.get("descriptionurl", ""),
                licenca=f"Wikimedia Commons ({licenca})",
            )
        )
    return candidatos
