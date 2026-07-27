from concurrent.futures import ThreadPoolExecutor

import config
from providers import Candidate
from providers import archive_org, google_cse, pexels, pixabay, wikimedia, youtube_search

POR_FONTE_IMAGEM = 2
POR_FONTE_VIDEO = 3


def _seguro(fonte: str, func, *args) -> list[Candidate]:
    """Chama um provider sem deixar erro de rede/API derrubar a pagina inteira."""
    try:
        return func(*args)
    except Exception as e:
        print(f"[aviso] busca em {fonte} falhou: {e}")
        return []


def _rodar_em_paralelo(chamadas: list[tuple]) -> list[Candidate]:
    candidatos: list[Candidate] = []
    with ThreadPoolExecutor(max_workers=len(chamadas)) as executor:
        futuros = [executor.submit(_seguro, *chamada) for chamada in chamadas]
        for futuro in futuros:
            candidatos += futuro.result()
    return candidatos


def buscar_candidatos(query: str, categoria: str) -> list[Candidate]:
    """categoria: 'imagem' ou 'video'.

    Imagem: Google (Reddit/noticias/blogs), Wikimedia (sem chave, licenca
    sempre clara), Pexels e Pixabay entram sempre juntos - a maioria do
    conteudo real da Geekko e documental especifico demais pra estar num
    banco de imagem de estoque.

    Video: organico e o que importa aqui, entao a fonte principal e busca
    no YouTube; Internet Archive (arquivo/historico, sem chave) completa
    quando o YouTube nao tiver o video especifico certo. Pexels/Pixabay
    ficam de fora do video de proposito.
    """
    if categoria == "video":
        return _rodar_em_paralelo([
            ("YouTube", youtube_search.search_videos, query, config.GOOGLE_API_KEY, POR_FONTE_VIDEO),
            ("Internet Archive", archive_org.search_videos, query, POR_FONTE_VIDEO),
        ])

    return _rodar_em_paralelo([
        ("Google", google_cse.search_images, query, config.GOOGLE_API_KEY, config.GOOGLE_CSE_ID, POR_FONTE_IMAGEM),
        ("Wikimedia", wikimedia.search_images, query, POR_FONTE_IMAGEM),
        ("Pexels", pexels.search_images, query, config.PEXELS_API_KEY, POR_FONTE_IMAGEM),
        ("Pixabay", pixabay.search_images, query, config.PIXABAY_API_KEY, POR_FONTE_IMAGEM),
    ])
