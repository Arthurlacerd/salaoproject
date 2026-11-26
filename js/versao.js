/* FONTE ÚNICA DA VERSÃO do Salão.gestão.
 * Script clássico (não módulo) para poder ser lido pela página (index.html), pelos módulos
 * (globalThis.SALAO_VERSAO) e pelo service worker (importScripts).
 * Edite SOMENTE "versao", "data" e "alteracoes" à mão; "arquivos" é gerado por
 * `python3 tools/construir_pwa.py` (e conferido pelos testes).
 * "banco" = versão NATIVA do IndexedDB; "schema" = versão lógica das migrations. */
globalThis.SALAO_VERSAO = {
  "sistema": "Salão.gestão",
  "versao": "11.0.0",
  "data": "2026-11-26",
  "banco": 1,
  "schema": 2,
  "alteracoes": [
    "Nova identidade visual: cards com contorno firme, sombras sólidas, tipografia forte e ícones em tiles",
    "Design System central (tokens de cor, tipografia, bordas, raios, sombras, espaçamento e movimento)",
    "Dashboard Hoje modular, navegação agrupada, menu inferior flutuante no celular e modais próprios",
    "Backup, restauração, atualização segura, IndexedDB e modo offline preservados"
  ],
  "arquivos": [
    "css/ds11.css",
    "css/style.css",
    "css/style8.css",
    "fonts/dmsans-latin.woff",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/maskable-512.png",
    "js/app.js",
    "js/charts.js",
    "js/data/agenda.js",
    "js/data/backup.js",
    "js/data/clientes.js",
    "js/data/database.js",
    "js/data/financeiro.js",
    "js/data/manutencao.js",
    "js/data/migracoes.js",
    "js/data/permissoes.js",
    "js/data/servicos.js",
    "js/data/usuarios.js",
    "js/data/zip.js",
    "js/ui/icones.js",
    "js/ui/shell.js",
    "js/ui/util.js",
    "js/ui/views.js",
    "js/versao.js",
    "manifest.webmanifest"
  ]
};
