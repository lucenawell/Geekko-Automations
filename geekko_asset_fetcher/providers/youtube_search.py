import requests

from . import Candidate

LICENSE_LABEL = "YouTube - verificar direitos do video original antes de uso comercial"


def search_videos(query: str, api_key: str, max_results: int = 3) -> list[Candidate]:
    """Busca video no YouTube (reaproveita a GOOGLE_API_KEY, precisa da
    'YouTube Data API v3' ativada no mesmo projeto do Google Cloud).
    Devolve so os metadados - o download de verdade acontece via yt-dlp
    quando o candidato e escolhido."""
    if not api_key:
        return []
    resp = requests.get(
        "https://www.googleapis.com/youtube/v3/search",
        params={
            "key": api_key,
            "q": query,
            "part": "snippet",
            "type": "video",
            "maxResults": max_results,
            "safeSearch": "moderate",
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    candidatos = []
    for item in data.get("items", []):
        video_id = item.get("id", {}).get("videoId")
        if not video_id:
            continue
        snippet = item.get("snippet", {})
        url = f"https://www.youtube.com/watch?v={video_id}"
        candidatos.append(
            Candidate(
                fonte="YouTube",
                tipo="video",
                thumb_url=snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
                download_url=url,
                pagina_url=url,
                licenca=LICENSE_LABEL,
                titulo=snippet.get("title", ""),
            )
        )
    return candidatos
