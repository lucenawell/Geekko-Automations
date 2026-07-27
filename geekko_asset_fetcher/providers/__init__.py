from dataclasses import dataclass


@dataclass
class Candidate:
    fonte: str          # "Pexels" | "Pixabay" | "Google" | "Wikimedia" | "Flickr" | "YouTube"
    tipo: str           # "imagem" | "video"
    thumb_url: str
    download_url: str
    pagina_url: str
    licenca: str
    titulo: str = ""    # usado pelo YouTube (titulo do video), opcional pros demais
