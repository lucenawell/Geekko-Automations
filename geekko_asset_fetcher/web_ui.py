from pathlib import Path

from flask import Flask, redirect, render_template_string, request, url_for

import provenance
import search
from downloader import download_direct, download_youtube, is_youtube_url
from roteiro import Scene, load_scenes

CANDIDATOS_CACHE: dict[str, list] = {}

BASE_CSS = """
body { font-family: -apple-system, Segoe UI, Arial, sans-serif; margin: 0; padding: 24px; background: #f4f2ee; color: #222; }
h1 { font-size: 22px; }
table { border-collapse: collapse; width: 100%; background: white; }
th, td { padding: 8px 12px; border-bottom: 1px solid #e2ddd4; text-align: left; font-size: 14px; }
th { background: #efe9de; }
.status-pendente { color: #b8860b; font-weight: 600; }
.status-baixada { color: #2e7d32; font-weight: 600; }
.status-pulada { color: #999; }
a.btn, button.btn { display: inline-block; padding: 6px 14px; background: #2e7d32; color: white; text-decoration: none;
  border-radius: 4px; border: none; cursor: pointer; font-size: 14px; }
a.btn.secundario, button.btn.secundario { background: #6c757d; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-top: 16px; }
.card { background: white; border: 1px solid #e2ddd4; border-radius: 6px; padding: 10px; }
.card img, .card video { width: 100%; height: 150px; object-fit: cover; border-radius: 4px; background: #ddd; }
.badge { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 3px; background: #efe9de; margin: 6px 0; }
.licenca { font-size: 11px; color: #666; display: block; margin-bottom: 8px; }
input[type=text] { width: 100%; padding: 6px; font-size: 14px; box-sizing: border-box; }
.topo { margin-bottom: 16px; }
.aviso { background: #fff3cd; padding: 10px; border-radius: 4px; margin-bottom: 12px; }
"""

INDEX_HTML = """
<html><head><meta charset="utf-8"><title>Geekko Asset Fetcher</title><style>{{ css }}</style></head>
<body>
<h1>Cenas — {{ scenes|length }} no total</h1>
<table>
<tr><th>#</th><th>Arquivo</th><th>Tipo</th><th>Busca</th><th>Status</th><th></th></tr>
{% for s, status in linhas %}
<tr>
  <td>{{ s.numero }}</td>
  <td>{{ s.arquivo }}</td>
  <td>{{ s.tipo_bruto }}</td>
  <td>{{ s.busca }}</td>
  <td class="status-{{ status.split('-')[0] }}">{{ status }}</td>
  <td>
    {% if status in ('pendente', 'baixada') %}
      <a class="btn secundario" href="{{ url_for('ver_cena', numero=s.numero) }}">Revisar</a>
    {% endif %}
  </td>
</tr>
{% endfor %}
</table>
</body></html>
"""

CENA_BUSCA_HTML = """
<html><head><meta charset="utf-8"><title>Cena {{ s.numero }}</title><style>{{ css }}</style></head>
<body>
<div class="topo">
  <a class="btn secundario" href="{{ url_for('index') }}">&larr; voltar pra lista</a>
</div>
<h1>Cena {{ s.numero }} — {{ s.arquivo }}</h1>

<form method="get">
  <input type="text" name="q" value="{{ query }}">
  <button class="btn secundario" type="submit" style="margin-top:8px;">Buscar de novo</button>
</form>

<form method="post" action="{{ url_for('baixar_manual', numero=s.numero) }}" style="margin-top:16px;">
  <input type="text" name="url" placeholder="ou cole uma URL de imagem/video manualmente">
  <input type="hidden" name="q" value="{{ query }}">
  <button class="btn" type="submit" style="margin-top:8px;">Baixar dessa URL</button>
</form>

<div class="grid">
{% for c in candidatos %}
  <div class="card">
    {% if c.fonte == 'YouTube' %}
      <a href="{{ c.pagina_url }}" target="_blank"><img src="{{ c.thumb_url }}" loading="lazy"></a>
      <span style="font-size:12px; display:block; margin-top:4px;">{{ c.titulo }}</span>
    {% elif c.tipo == 'video' %}
      <video src="{{ c.download_url }}" muted controls preload="metadata"></video>
    {% else %}
      <img src="{{ c.thumb_url }}" loading="lazy">
    {% endif %}
    <span class="badge">{{ c.fonte }}</span>
    <span class="licenca">{{ c.licenca }}</span>
    <form method="post" action="{{ url_for('baixar_candidato', numero=s.numero) }}">
      <input type="hidden" name="idx" value="{{ loop.index0 }}">
      <input type="hidden" name="q" value="{{ query }}">
      <button class="btn" type="submit">Baixar esta</button>
    </form>
  </div>
{% endfor %}
</div>
{% if not candidatos %}
<p class="aviso">Nenhum candidato encontrado. Tente editar o termo de busca acima, ou cole uma URL manual.</p>
{% endif %}
{% if erro %}
<p class="aviso">Nao consegui baixar esse candidato ({{ erro }}). Tente outro, ou cole uma URL manual.</p>
{% endif %}
</body></html>
"""

CENA_URL_HTML = """
<html><head><meta charset="utf-8"><title>Cena {{ s.numero }}</title><style>{{ css }}</style></head>
<body>
<div class="topo">
  <a class="btn secundario" href="{{ url_for('index') }}">&larr; voltar pra lista</a>
</div>
<h1>Cena {{ s.numero }} — {{ s.arquivo }}</h1>
<p class="aviso">Essa cena aponta pra uma URL direta (video do YouTube ou arquivo). Confira/edite abaixo e baixe.</p>
{% if erro %}
<p class="aviso">Nao consegui baixar ({{ erro }}). Confira o link e tente de novo.</p>
{% endif %}
<form method="post" action="{{ url_for('baixar_url_direta', numero=s.numero) }}">
  <input type="text" name="url" value="{{ url_valor }}">
  <p style="font-size:12px;color:#666;">Pra cortar um trecho de video do YouTube, use o formato:
  URL|00:01:23-00:01:30 (precisa do ffmpeg instalado, senao baixa o video inteiro)</p>
  <button class="btn" type="submit">Baixar</button>
</form>
</body></html>
"""

PULADA_HTML = """
<html><head><meta charset="utf-8"><title>Cena {{ s.numero }}</title><style>{{ css }}</style></head>
<body>
<div class="topo">
  <a class="btn secundario" href="{{ url_for('index') }}">&larr; voltar pra lista</a>
</div>
<h1>Cena {{ s.numero }} — {{ s.arquivo }}</h1>
<p class="aviso">Essa cena e do tipo "{{ s.tipo_bruto }}" — fora do escopo do download automatico. Pulada.</p>
</body></html>
"""


def _status(scene: Scene, pasta_assets: Path) -> str:
    if scene.categoria == "ilustracao":
        return "pulada-ilustracao"
    if scene.categoria == "manual":
        return "pulada-manual"
    if (pasta_assets / scene.arquivo).exists():
        return "baixada"
    return "pendente"


def _find_scene(scenes: list[Scene], numero: str) -> Scene | None:
    return next((s for s in scenes if s.numero == numero), None)


def _proxima_pendente(scenes: list[Scene], pasta_assets: Path, numero_atual: str) -> str | None:
    idx = next((i for i, s in enumerate(scenes) if s.numero == numero_atual), None)
    if idx is None:
        return None
    for s in scenes[idx + 1:]:
        if _status(s, pasta_assets) == "pendente":
            return s.numero
    return None


def create_app(roteiro_path: Path, pasta_assets: Path, log_path: Path) -> Flask:
    app = Flask(__name__)
    pasta_assets.mkdir(parents=True, exist_ok=True)

    def _scenes():
        return load_scenes(roteiro_path)

    @app.route("/")
    def index():
        scenes = _scenes()
        linhas = [(s, _status(s, pasta_assets)) for s in scenes]
        return render_template_string(INDEX_HTML, css=BASE_CSS, scenes=scenes, linhas=linhas)

    @app.route("/cena/<numero>")
    def ver_cena(numero):
        scenes = _scenes()
        s = _find_scene(scenes, numero)
        if s is None:
            return redirect(url_for("index"))

        if s.categoria in ("ilustracao", "manual"):
            return render_template_string(PULADA_HTML, css=BASE_CSS, s=s)

        if s.categoria == "url":
            erro = request.args.get("erro", "")
            url_valor = request.args.get("url", s.busca)
            return render_template_string(
                CENA_URL_HTML, css=BASE_CSS, s=s, erro=erro, url_valor=url_valor
            )

        query = request.args.get("q", s.busca)
        erro = request.args.get("erro", "")
        candidatos = search.buscar_candidatos(query, s.categoria)
        CANDIDATOS_CACHE[numero] = candidatos
        return render_template_string(
            CENA_BUSCA_HTML, css=BASE_CSS, s=s, query=query, candidatos=candidatos, erro=erro
        )

    @app.route("/cena/<numero>/baixar", methods=["POST"])
    def baixar_candidato(numero):
        scenes = _scenes()
        s = _find_scene(scenes, numero)
        if s is None:
            return redirect(url_for("index"))

        idx = int(request.form["idx"])
        query = request.form.get("q", s.busca)
        candidatos = CANDIDATOS_CACHE.get(numero, [])
        if idx >= len(candidatos):
            return redirect(url_for("ver_cena", numero=numero, q=query))

        candidato = candidatos[idx]
        dest = pasta_assets / s.arquivo
        try:
            if candidato.fonte == "YouTube":
                download_youtube(candidato.download_url, dest)
            else:
                download_direct(candidato.download_url, dest)
        except Exception as e:
            return redirect(url_for("ver_cena", numero=numero, q=query, erro=str(e)[:200]))

        provenance.registrar(
            log_path, s.numero, s.arquivo, query, candidato.fonte,
            candidato.download_url, candidato.pagina_url, candidato.licenca,
        )
        return _avancar(scenes, numero)

    @app.route("/cena/<numero>/baixar-manual", methods=["POST"])
    def baixar_manual(numero):
        scenes = _scenes()
        s = _find_scene(scenes, numero)
        if s is None:
            return redirect(url_for("index"))

        url = request.form["url"].strip()
        query = request.form.get("q", s.busca)
        if not url:
            return redirect(url_for("ver_cena", numero=numero, q=query))

        dest = pasta_assets / s.arquivo
        try:
            download_direct(url, dest)
        except Exception as e:
            return redirect(url_for("ver_cena", numero=numero, q=query, erro=str(e)[:200]))

        provenance.registrar(
            log_path, s.numero, s.arquivo, query, "Manual (URL colada)", url, "", "Desconhecida - verificar",
        )
        return _avancar(scenes, numero)

    @app.route("/cena/<numero>/baixar-url", methods=["POST"])
    def baixar_url_direta(numero):
        scenes = _scenes()
        s = _find_scene(scenes, numero)
        if s is None:
            return redirect(url_for("index"))

        url = request.form["url"].strip()
        dest = pasta_assets / s.arquivo

        try:
            if is_youtube_url(url):
                aviso = download_youtube(url, dest)
                provenance.registrar(
                    log_path, s.numero, s.arquivo, url, "YouTube (yt-dlp)", url, url,
                    aviso or "Verificar termos de uso do video original",
                )
            else:
                download_direct(url, dest)
                provenance.registrar(
                    log_path, s.numero, s.arquivo, url, "URL direta", url, "", "Desconhecida - verificar",
                )
        except Exception as e:
            return redirect(url_for("ver_cena", numero=numero, url=url, erro=str(e)[:200]))

        return _avancar(scenes, numero)

    def _avancar(scenes, numero_atual):
        proxima = _proxima_pendente(scenes, pasta_assets, numero_atual)
        if proxima:
            return redirect(url_for("ver_cena", numero=proxima))
        return redirect(url_for("index"))

    return app
