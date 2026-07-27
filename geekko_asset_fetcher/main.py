import sys
import threading
import webbrowser
from pathlib import Path

import config
from roteiro import find_roteiro_file
from web_ui import create_app


def main():
    if len(sys.argv) > 1:
        bruto = sys.argv[1]
    else:
        bruto = input("Cole o caminho da pasta do video (ex: GEEKKO_012_tema): ")

    pasta_projeto = Path(bruto.strip().strip('"'))
    if not pasta_projeto.exists():
        print(f"Pasta nao encontrada: {pasta_projeto}")
        sys.exit(1)

    pasta_roteiro = pasta_projeto / "01_roteiro"
    pasta_assets = pasta_projeto / "02_assets"
    log_path = pasta_assets / "log.csv"

    roteiro_path = find_roteiro_file(pasta_roteiro)
    if roteiro_path is None:
        print(f"Nao encontrei 'cenas.txt' nem 'assets.csv' dentro de {pasta_roteiro}")
        print("Crie um desses arquivos com a lista de cenas (veja exemplo_cenas.txt).")
        sys.exit(1)

    print(f"Roteiro: {roteiro_path}")
    print(f"Assets:  {pasta_assets}")
    print(f"Log:     {log_path}")

    app = create_app(roteiro_path, pasta_assets, log_path)

    url = f"http://127.0.0.1:{config.PORT}"
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    print(f"\nAbrindo {url} no navegador...")
    app.run(port=config.PORT, debug=False)


if __name__ == "__main__":
    main()
