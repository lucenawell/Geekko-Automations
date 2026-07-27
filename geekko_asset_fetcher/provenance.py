import csv
from datetime import datetime
from pathlib import Path

COLUNAS = [
    "numero",
    "arquivo",
    "busca",
    "fonte",
    "url_original",
    "pagina_origem",
    "licenca",
    "data_hora",
]


def registrar(
    log_path: Path,
    numero: str,
    arquivo: str,
    busca: str,
    fonte: str,
    url_original: str,
    pagina_origem: str,
    licenca: str,
) -> None:
    novo = not log_path.exists()
    with open(log_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if novo:
            writer.writerow(COLUNAS)
        writer.writerow(
            [
                numero,
                arquivo,
                busca,
                fonte,
                url_original,
                pagina_origem,
                licenca,
                datetime.now().isoformat(timespec="seconds"),
            ]
        )
