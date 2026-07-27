import requests

from . import Candidate

LICENSE_LABEL = "Internet Archive (dominio publico/licenca aberta - conferir na pagina do item)"
EXTENSOES_VIDEO = (".mp4", ".ogv", ".webm", ".mpeg", ".avi", ".mov")


def _melhor_arquivo_video(identifier: str) -> str | None:
    resp = requests.get(f"https://archive.org/metadata/{identifier}", timeout=15)
    resp.raise_for_status()
    arquivos = resp.json().get("files", [])
    candidatos = [f for f in arquivos if f.get("name", "").lower().endswith(EXTENSOES_VIDEO)]
    if not candidatos:
        return None
    mp4 = next((f for f in candidatos if f["name"].lower().endswith(".mp4")), None)
    escolhido = mp4 or candidatos[0]
    return f"https://archive.org/download/{identifier}/{escolhido['name']}"


def search_videos(query: str, per_page: int = 3) -> list[Candidate]:
    """Internet Archive - sem chave, forte em video de arquivo/historico
    (dominio publico), bom complemento pro YouTube."""
    resp = requests.get(
        "https://archive.org/advancedsearch.php",
        params={
            "q": f"{query} AND mediatype:(movies) AND NOT collection:(tvarchive)",
            "fl[]": ["identifier", "title"],
            "rows": per_page,
            "output": "json",
        },
        timeout=15,
    )
    resp.raise_for_status()
    docs = resp.json().get("response", {}).get("docs", [])

    candidatos = []
    for doc in docs:
        identifier = doc.get("identifier")
        if not identifier:
            continue
        try:
            download_url = _melhor_arquivo_video(identifier)
        except Exception:
            download_url = None
        if not download_url:
            continue
        candidatos.append(
            Candidate(
                fonte="Internet Archive",
                tipo="video",
                thumb_url=f"https://archive.org/services/img/{identifier}",
                download_url=download_url,
                pagina_url=f"https://archive.org/details/{identifier}",
                licenca=LICENSE_LABEL,
                titulo=doc.get("title", ""),
            )
        )
    return candidatos
