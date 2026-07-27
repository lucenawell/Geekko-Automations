import shutil
from pathlib import Path

import requests
import yt_dlp


def is_youtube_url(url: str) -> bool:
    return "youtube.com" in url or "youtu.be" in url


def _time_to_seconds(t: str) -> float:
    partes = [float(p) for p in t.split(":")]
    segundos = 0.0
    for p in partes:
        segundos = segundos * 60 + p
    return segundos


def parse_youtube_spec(busca: str) -> tuple[str, tuple[float, float] | None]:
    """Aceita 'URL' ou 'URL|HH:MM:SS-HH:MM:SS' (trecho a cortar)."""
    if "|" in busca:
        url, rango = busca.split("|", 1)
        inicio_str, fim_str = rango.split("-")
        return url.strip(), (
            _time_to_seconds(inicio_str.strip()),
            _time_to_seconds(fim_str.strip()),
        )
    return busca.strip(), None


def download_direct(url: str, dest_path: Path) -> None:
    """Baixa pra um arquivo temporario e so move pro nome final se der certo -
    assim uma falha no meio do download nunca deixa um arquivo quebrado com
    o nome certo (o que faria a cena parecer 'baixada' sem estar)."""
    resp = requests.get(
        url,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0 (compatible; GeekkoAssetFetcher/1.0)"},
        stream=True,
    )
    resp.raise_for_status()

    tmp_path = dest_path.with_name(dest_path.name + ".part")
    try:
        with open(tmp_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
        tmp_path.replace(dest_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def download_youtube(busca: str, dest_path: Path) -> str:
    """Baixa (e corta, se pedido e ffmpeg disponivel) com yt-dlp direto no dest_path.
    Retorna um aviso (string vazia se nada a avisar)."""
    url, rango = parse_youtube_spec(busca)
    tem_ffmpeg = shutil.which("ffmpeg") is not None

    outtmpl = str(dest_path.with_suffix("")) + ".%(ext)s"
    format_str = (
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        if tem_ffmpeg
        else "best[ext=mp4]/best"
    )
    ydl_opts = {
        "outtmpl": outtmpl,
        "format": format_str,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
    }

    aviso = ""
    if rango and tem_ffmpeg:
        ydl_opts["download_ranges"] = yt_dlp.utils.download_range_func(None, [rango])
        ydl_opts["force_keyframes_at_cuts"] = True
    elif rango and not tem_ffmpeg:
        aviso = "ffmpeg nao encontrado no sistema - baixado o video inteiro, sem corte"

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    baixado = next(dest_path.parent.glob(dest_path.stem + ".*"), None)
    if baixado is not None and baixado != dest_path:
        baixado.replace(dest_path)

    return aviso
