import csv
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Scene:
    numero: str
    arquivo: str
    tipo_bruto: str
    busca: str
    categoria: str  # "imagem" | "video" | "url" | "ilustracao" | "manual"


def _strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )


def _classify(tipo: str, busca: str) -> str:
    busca_norm = busca.strip()
    if busca_norm.lower().startswith("http"):
        return "url"

    tipo_norm = _strip_accents(tipo).lower()
    if "ilustracao" in tipo_norm or "gerar" in tipo_norm:
        return "ilustracao"
    if "manual" in tipo_norm:
        return "manual"
    if "video" in tipo_norm:
        return "video"
    return "imagem"


def _scenes_from_blocks(text: str) -> list[Scene]:
    blocks = re.split(r"\n\s*\n", text.strip())
    scenes = []
    for block in blocks:
        if not block.strip():
            continue
        fields = {}
        for line in block.splitlines():
            line = line.strip()
            if not line or ":" not in line:
                continue
            key, _, value = line.partition(":")
            key_norm = _strip_accents(key).strip().lower()
            fields[key_norm] = value.strip()

        numero = fields.get("cena", "")
        arquivo = fields.get("arquivo final", "")
        tipo = fields.get("tipo", "")
        busca = fields.get("busca", "").strip().strip('"')

        if not arquivo:
            continue

        scenes.append(
            Scene(
                numero=numero,
                arquivo=arquivo,
                tipo_bruto=tipo,
                busca=busca,
                categoria=_classify(tipo, busca),
            )
        )
    return scenes


def _scenes_from_csv(path: Path) -> list[Scene]:
    scenes = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            numero = (row.get("numero") or "").strip()
            arquivo = (row.get("arquivo") or "").strip()
            tipo = (row.get("tipo") or "").strip()
            busca = (row.get("busca") or "").strip()

            if not arquivo:
                continue

            scenes.append(
                Scene(
                    numero=numero,
                    arquivo=arquivo,
                    tipo_bruto=tipo,
                    busca=busca,
                    categoria=_classify(tipo, busca),
                )
            )
    return scenes


def find_roteiro_file(pasta_roteiro: Path) -> Path | None:
    txt_path = pasta_roteiro / "cenas.txt"
    csv_path = pasta_roteiro / "assets.csv"
    if txt_path.exists():
        return txt_path
    if csv_path.exists():
        return csv_path
    return None


def load_scenes(path: Path) -> list[Scene]:
    if path.suffix.lower() == ".csv":
        return _scenes_from_csv(path)
    text = path.read_text(encoding="utf-8")
    return _scenes_from_blocks(text)
