#!/usr/bin/env python3
"""Build e validação do PWA Salão.gestão (somente biblioteca padrão do Python 3.8+).

Uso:
  python3 tools/construir_pwa.py              # GERA: atualiza "arquivos" e "integridade" em js/versao.js e valida tudo
  python3 tools/construir_pwa.py --verificar  # SÓ VERIFICA: falha se js/versao.js estiver desatualizado (uso em CI/PR)
  python3 tools/construir_pwa.py --relatorio docs/relatorio-build.md   # também grava um relatório em Markdown
  python3 tools/construir_pwa.py --raiz /outra/pasta                   # valida outra cópia do app

O que faz:
  1. descobre os arquivos do PWA (index.html, manifest.webmanifest, sw.js e tudo em css/, js/, icons/, fonts/);
  2. gera (ou confere) a lista "arquivos" de js/versao.js — a lista de cache do service worker;
  3. gera (ou confere) "integridade": SHA-256 de cada arquivo (o service worker recusa versão com arquivo divergente);
  4. confere que todo arquivo referenciado (HTML, imports JS, url() do CSS, ícones, importScripts) existe e está no cache;
  5. detecta arquivos listados mas inexistentes;
  6. valida manifest, ícones (PNG real e dimensões), service worker e consistência de versão/banco/schema.
Código de saída: 0 = tudo certo; 1 = há problemas (listados na saída); 2 = erro de uso.
O build NUNCA toca em dados: só lê os arquivos do app e, no modo GERA, reescreve js/versao.js.
"""
import argparse
import hashlib
import json
import posixpath
import re
import struct
import sys
from pathlib import Path
from urllib.parse import urljoin, urlparse

PASTAS_APP = ["css", "js", "icons", "fonts"]           # tudo nestas pastas faz parte do app (e do cache offline)
RAIZ_APP = ["index.html", "manifest.webmanifest", "sw.js"]
FORA_DA_LISTA = {"index.html", "sw.js"}                 # o sw.js já os acrescenta por conta própria
SEM_HASH = {"js/versao.js"}                             # não pode conter o próprio hash; o SW confere o conteúdo inteiro
DISPLAY_OK = {"standalone", "fullscreen", "minimal-ui"}
RE_VERSAO = re.compile(r"^(?P<cab>[\s\S]*?)globalThis\.SALAO_VERSAO\s*=\s*(?P<json>\{[\s\S]*\})\s*;?\s*$")


class Relatorio:
    def __init__(self):
        self.erros, self.avisos, self.ok = [], [], []

    def erro(self, m): self.erros.append(m)
    def aviso(self, m): self.avisos.append(m)
    def certo(self, m): self.ok.append(m)


def descobrir(raiz: Path):
    achados = [f for f in RAIZ_APP if (raiz / f).is_file()]
    for p in PASTAS_APP:
        base = raiz / p
        if base.is_dir():
            for f in sorted(base.rglob("*")):
                rel = f.relative_to(raiz).as_posix()
                if f.is_file() and not any(parte.startswith(".") for parte in rel.split("/")):
                    achados.append(rel)
    return sorted(set(achados))


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def ler_versao(raiz: Path):
    txt = (raiz / "js/versao.js").read_text(encoding="utf-8")
    m = RE_VERSAO.match(txt)
    if not m:
        raise ValueError("js/versao.js fora do formato esperado (globalThis.SALAO_VERSAO = {...};)")
    return txt, m.group("cab"), json.loads(m.group("json"))


def serializar_versao(cab: str, dados: dict) -> str:
    return cab + "globalThis.SALAO_VERSAO = " + json.dumps(dados, ensure_ascii=False, indent=2) + ";\n"


def png_info(p: Path):
    b = p.read_bytes()[:24]
    if len(b) < 24 or b[:8] != b"\x89PNG\r\n\x1a\n" or b[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", b[16:24])


def resolver(origem: str, alvo: str) -> str:
    """Caminho relativo à raiz do app de `alvo`, referenciado a partir do arquivo `origem`."""
    return posixpath.normpath(posixpath.join(posixpath.dirname(origem), alvo.split("?")[0].split("#")[0]))


def referencias(raiz: Path, rel: str):
    """Arquivos locais que `rel` carrega (HTML: href/src; JS: import; CSS: url(); SW: importScripts)."""
    txt = (raiz / rel).read_text(encoding="utf-8", errors="replace")
    refs = []
    if rel.endswith(".html"):
        refs = re.findall(r'(?:href|src)="([^"#:]+)"', txt)
    elif rel.endswith(".js"):
        refs = re.findall(r'^\s*import\s[^;]*?from\s+"([^"]+)"', txt, re.M) + re.findall(r'import\(\s*"([^"]+)"\s*\)', txt)
        refs += re.findall(r'^\s*import\s+"([^"]+)"', txt, re.M)  # import só por efeito colateral
        refs += re.findall(r'importScripts\(\s*"([^"]+)"\s*\)', txt)
    elif rel.endswith(".css"):
        refs = [u for u in re.findall(r"url\(\s*['\"]?([^'\")]+)['\"]?\s*\)", txt) if not u.startswith("data:")]
    return refs


def checar_referencias(raiz: Path, arquivos: list, rel_: Relatorio):
    conjunto, grafo = set(arquivos), {}
    for f in arquivos:
        if not f.endswith((".html", ".js", ".css")):
            continue
        for ref in referencias(raiz, f):
            if ref.startswith("/") or urlparse(ref).scheme:
                rel_.erro(f"{f}: caminho absoluto ou externo “{ref}” (quebra o app em subpasta do GitHub Pages / offline)")
                continue
            alvo = resolver(f, ref)
            grafo.setdefault(f, []).append(alvo)
            if not (raiz / alvo).is_file():
                rel_.erro(f"{f}: referencia “{ref}”, que não existe")
            elif alvo not in conjunto:
                rel_.erro(f"{f}: referencia “{ref}”, que não está na lista de cache (quebraria offline)")
    return grafo


def requisicoes_iniciais(grafo: dict, manifest: dict):
    """Estimativa estática do que a primeira abertura baixa: index.html + tudo que ele carrega (transitivo)."""
    vistos, fila = set(), ["index.html"]
    while fila:
        f = fila.pop()
        if f in vistos:
            continue
        vistos.add(f)
        fila.extend(grafo.get(f, []))
    return sorted(vistos)


def checar_manifest(raiz: Path, rel_: Relatorio):
    p = raiz / "manifest.webmanifest"
    if not p.is_file():
        rel_.erro("manifest.webmanifest não existe")
        return None
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        rel_.erro(f"manifest.webmanifest não é JSON válido: {e}")
        return None
    base = "https://exemplo.invalid/app/manifest.webmanifest"  # simula a subpasta do GitHub Pages
    for campo in ("name", "short_name", "start_url", "scope", "display", "icons"):
        if not m.get(campo):
            rel_.erro(f"manifest: falta “{campo}”")
    if m.get("short_name") and len(m["short_name"]) > 12:
        rel_.erro(f"manifest: short_name com {len(m['short_name'])} caracteres (o Android corta acima de 12)")
    if m.get("display") and m["display"] not in DISPLAY_OK:
        rel_.erro(f"manifest: display “{m['display']}” não abre como aplicativo")
    escopo = urljoin(base, m.get("scope", "./"))
    inicio = urljoin(base, m.get("start_url", ""))
    if not inicio.startswith(escopo):
        rel_.erro("manifest: start_url fora do scope")
    if urlparse(escopo).path != "/app/":
        rel_.erro("manifest: scope deve ser a pasta do app (\"./\")")
    # Identidade estável (definida na 11.1): SEM "id" => identidade = start_url sem o fragmento = pasta do app.
    # Um "id" faria o Chrome tratar como OUTRO aplicativo (ex.: "./" é resolvido a partir da RAIZ do domínio).
    if "id" in m:
        rel_.erro(f"manifest: “id” presente ({m['id']!r}); a identidade do app é a da 11.1 (sem id) e não pode mudar")
    identidade = inicio.split("#")[0]
    if identidade != escopo:
        rel_.erro(f"manifest: identidade {urlparse(identidade).path} diferente da pasta do app {urlparse(escopo).path}")
    tem = {"any192": False, "any512": False, "maskable": False}
    for ic in m.get("icons") or []:
        src, sizes, fins = ic.get("src", ""), str(ic.get("sizes", "")), str(ic.get("purpose", "any")).split()
        f = raiz / src
        if src.startswith("/") or not f.is_file():
            rel_.erro(f"manifest: ícone “{src}” não existe (ou caminho absoluto)")
            continue
        if ic.get("type") != "image/png":
            rel_.erro(f"manifest: ícone {src} sem type image/png")
        dims = png_info(f)
        if not dims:
            rel_.erro(f"ícone {src} não é um PNG válido")
            continue
        if f"{dims[0]}x{dims[1]}" != sizes.split()[0]:
            rel_.erro(f"ícone {src} tem {dims[0]}x{dims[1]}, mas o manifest declara {sizes}")
        if dims[0] >= 192 and "any" in fins: tem["any192"] = True
        if dims[0] >= 512 and "any" in fins: tem["any512"] = True
        if "maskable" in fins: tem["maskable"] = True
    if not tem["any192"]: rel_.erro("manifest: falta ícone 192x192 (purpose any)")
    if not tem["any512"]: rel_.erro("manifest: falta ícone 512x512 (purpose any)")
    if not tem["maskable"]: rel_.aviso("manifest: falta ícone adaptável (maskable)")
    html = (raiz / "index.html").read_text(encoding="utf-8") if (raiz / "index.html").is_file() else ""
    cor = re.search(r'<meta name="theme-color" content="([^"]+)"', html)
    if cor and m.get("theme_color") and cor.group(1).lower() != m["theme_color"].lower():
        rel_.aviso("theme_color do manifest difere do <meta name=theme-color> do index.html")
    at = raiz / "icons/apple-touch-icon.png"
    if at.is_file() and png_info(at) != (180, 180):
        rel_.aviso("icons/apple-touch-icon.png não tem 180x180")
    if not rel_.erros:
        rel_.certo(f"manifest: {m.get('name')} · {m.get('display')} · scope {m.get('scope')} · start_url {m.get('start_url')} · sem id (identidade = pasta do app)")
    return m


def sem_comentarios_js(txt: str) -> str:
    txt = re.sub(r"/\*[\s\S]*?\*/", "", txt)
    return re.sub(r"(^|[^:\"'\\])//[^\n]*", r"\1", txt)


def checar_sw(raiz: Path, rel_: Relatorio):
    p = raiz / "sw.js"
    if not p.is_file():
        rel_.erro("sw.js não existe")
        return
    codigo = sem_comentarios_js(p.read_text(encoding="utf-8"))
    regras = [
        ('importScripts("js/versao.js")' in codigo, "sw.js precisa carregar js/versao.js (fonte única da versão)"),
        (re.search(r'PREFIXO\s*=\s*"salao-static-v"', codigo) and "CACHE = PREFIXO + V.versao" in codigo, "sw.js: nome do cache precisa ser salao-static-v<versão>"),
        ("V.integridade" in codigo, "sw.js precisa conferir a integridade (hash) de cada arquivo"),
        ("indexedDB" not in codigo and "deleteDatabase" not in codigo, "sw.js NÃO pode acessar o IndexedDB"),
        ('c.match("index.html")' in codigo and 'r.mode === "navigate"' in codigo, "sw.js precisa do fallback offline de navegação para index.html"),
        ("localStorage" not in codigo, "sw.js não pode usar localStorage"),
    ]
    for ok, msg in regras:
        if not ok:
            rel_.erro(msg)
    # skipWaiting só pode acontecer quando a página pede (depois do backup)
    for m in re.finditer(r"skipWaiting\(", codigo):
        trecho = codigo[max(0, m.start() - 120):m.start()]
        if "pular-espera" not in trecho:
            rel_.erro("sw.js: skipWaiting fora do pedido da página (atualizaria sem backup)")
    if not any(r for r in rel_.erros if r.startswith("sw.js")):
        rel_.certo("sw.js: cache versionado, integridade por hash, fallback offline, sem acesso ao IndexedDB, ativação só a pedido")


def migracoes(raiz: Path):
    txt = (raiz / "js/data/migracoes.js").read_text(encoding="utf-8")
    ini = txt.index("export const MIGRACOES")
    corpo = txt[ini:txt.index("\n];", ini)]  # só o array MIGRACOES
    partes = re.split(r"\{\s*versao:\s*(\d+)\s*,", corpo)[1:]
    lista = [(int(partes[i]), "estrutura(" in partes[i + 1]) for i in range(0, len(partes), 2)]
    nativa = max([v for v, e in lista if e] or [0])
    logica = max([v for v, _ in lista] or [0])
    return lista, nativa, logica


def checar_versao(raiz: Path, dados: dict, rel_: Relatorio):
    v = dados.get("versao", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+", v):
        rel_.erro(f"versao.js: versao “{v}” não é X.Y.Z")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dados.get("data", "")):
        rel_.erro("versao.js: data precisa ser AAAA-MM-DD")
    if not dados.get("alteracoes"):
        rel_.erro("versao.js: lista “alteracoes” vazia")
    lista, nativa, logica = migracoes(raiz)
    nums = [n for n, _ in lista]
    if nums != sorted(nums) or len(set(nums)) != len(nums) or nums != list(range(1, len(nums) + 1)):
        rel_.erro(f"migracoes.js: versões das migrations precisam ser 1..N sem buracos/repetição (achadas {nums})")
    if dados.get("banco") != nativa:
        rel_.erro(f"versao.js: banco={dados.get('banco')} mas migracoes.js define versão nativa {nativa} (mudar o banco exige migration)")
    if dados.get("schema") != logica:
        rel_.erro(f"versao.js: schema={dados.get('schema')} mas migracoes.js define versão lógica {logica}")
    if re.fullmatch(r"\d+\.\d+\.\d+", v):
        maj, mnr, _ = v.split(".")
        if not (raiz / f"docs/CHANGELOG_{maj}_{mnr}.md").is_file():
            rel_.aviso(f"docs/CHANGELOG_{maj}_{mnr}.md não encontrado")
    if not any(r for r in rel_.erros if r.startswith(("versao.js", "migracoes.js"))):
        rel_.certo(f"versão {v} ({dados.get('data')}) · banco nativo v{nativa} · schema v{logica} · {len(lista)} migration(s)")


def construir(raiz: Path, verificar: bool):
    rel_ = Relatorio()
    try:
        txt_antes, cab, dados = ler_versao(raiz)
    except (OSError, ValueError, json.JSONDecodeError) as e:
        rel_.erro(f"js/versao.js: {e}")
        return rel_, None
    achados = descobrir(raiz)
    for f in RAIZ_APP:
        if f not in achados:
            rel_.erro(f"{f} não existe")
    arquivos = [f for f in achados if f not in FORA_DA_LISTA]
    listados = dados.get("arquivos", [])
    for f in listados:
        if not (raiz / f).is_file():
            (rel_.erro if verificar else rel_.aviso)(f"versao.js lista “{f}”, que não existe" + ("" if verificar else " (removido da lista)"))
    if not verificar:
        for f in sorted(set(arquivos) - set(listados)):
            rel_.aviso(f"arquivo novo incluído na lista de cache: {f}")
    novos = dict(dados)
    novos["arquivos"] = arquivos
    novos["integridade"] = {f: sha256(raiz / f) for f in sorted(set(achados)) if f not in SEM_HASH}
    txt_depois = serializar_versao(cab, novos)
    if verificar:
        faltando = sorted(set(arquivos) - set(listados))
        if faltando:
            rel_.erro("arquivos do app fora da lista de cache: " + ", ".join(faltando))
        if txt_depois != txt_antes:
            mudou = [f for f, h in novos["integridade"].items() if (dados.get("integridade") or {}).get(f) != h]
            rel_.erro("js/versao.js desatualizado (rode: python3 tools/construir_pwa.py)" + (f" — hash diferente: {', '.join(mudou)}" if mudou else ""))
    elif txt_depois != txt_antes:
        (raiz / "js/versao.js").write_text(txt_depois, encoding="utf-8")
        # o hash dos outros arquivos não depende de versao.js, então uma passada basta
    if not rel_.erros:
        rel_.certo(f"lista de cache: {len(arquivos)} arquivos + index.html + sw.js; integridade SHA-256 de {len(novos['integridade'])}")
    grafo = checar_referencias(raiz, sorted(set(achados)), rel_)
    manifest = checar_manifest(raiz, rel_)
    checar_sw(raiz, rel_)
    checar_versao(raiz, novos, rel_)
    tamanhos = {f: (raiz / f).stat().st_size for f in achados}
    iniciais = requisicoes_iniciais(grafo, manifest or {})
    medidas = {
        "versao": novos.get("versao"), "arquivos": len(achados), "bytes_total": sum(tamanhos.values()),
        "por_tipo": {}, "requisicoes_iniciais": len(iniciais) + (1 if manifest else 0),
        "bytes_iniciais": sum(tamanhos.get(f, 0) for f in iniciais),
        "maiores": sorted(tamanhos.items(), key=lambda x: -x[1])[:5],
    }
    for f, t in tamanhos.items():
        ext = f.rsplit(".", 1)[-1]
        medidas["por_tipo"][ext] = medidas["por_tipo"].get(ext, 0) + t
    return rel_, medidas


def markdown(rel_: Relatorio, med: dict, verificar: bool) -> str:
    l = [f"# Relatório de build — Salão.gestão {med.get('versao') if med else '?'}", "",
         f"Modo: {'verificação' if verificar else 'geração'} · Resultado: **{'FALHOU' if rel_.erros else 'APROVADO'}** "
         f"({len(rel_.erros)} erro(s), {len(rel_.avisos)} aviso(s))", ""]
    for t, xs in (("Erros", rel_.erros), ("Avisos", rel_.avisos), ("Conferido", rel_.ok)):
        if xs:
            l += [f"## {t}", ""] + [f"- {x}" for x in xs] + [""]
    if med:
        kb = lambda n: f"{n / 1024:.1f} KB"
        l += ["## Medidas", "", f"- Arquivos do app: {med['arquivos']}", f"- Tamanho total: {kb(med['bytes_total'])}",
              f"- Requisições da primeira abertura (estimativa estática): {med['requisicoes_iniciais']} · {kb(med['bytes_iniciais'])}",
              "- Por tipo: " + ", ".join(f"{k} {kb(v)}" for k, v in sorted(med["por_tipo"].items())),
              "- Maiores: " + ", ".join(f"{f} ({kb(t)})" for f, t in med["maiores"]), ""]
    return "\n".join(l)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build e validação do PWA Salão.gestão")
    ap.add_argument("--verificar", action="store_true", help="não grava nada; falha se js/versao.js estiver desatualizado")
    ap.add_argument("--relatorio", help="grava relatório Markdown neste caminho")
    ap.add_argument("--raiz", default=str(Path(__file__).resolve().parent.parent), help="pasta do app (padrão: a do repositório)")
    ap.add_argument("--quieto", action="store_true")
    a = ap.parse_args(argv)
    raiz = Path(a.raiz).resolve()
    if not raiz.is_dir():
        print(f"pasta inexistente: {raiz}", file=sys.stderr)
        return 2
    rel_, med = construir(raiz, a.verificar)
    texto = markdown(rel_, med, a.verificar)
    if a.relatorio:
        Path(a.relatorio).write_text(texto + "\n", encoding="utf-8")
    if not a.quieto or rel_.erros:
        print(texto)
    return 1 if rel_.erros else 0


if __name__ == "__main__":
    sys.exit(main())
