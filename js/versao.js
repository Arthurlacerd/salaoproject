/* FONTE ÚNICA DA VERSÃO do Salão.gestão.
 * Script clássico (não módulo) para poder ser lido pela página (index.html), pelos módulos
 * (globalThis.SALAO_VERSAO) e pelo service worker (importScripts).
 * Edite SOMENTE "versao", "data" e "alteracoes" à mão. "arquivos" (lista de cache) e "integridade"
 * (SHA-256 de cada arquivo, conferido pelo service worker) são GERADOS por `python3 tools/construir_pwa.py`
 * e conferidos por `python3 tools/construir_pwa.py --verificar` e pelos testes. Não edite essas duas chaves.
 * "banco" = versão NATIVA do IndexedDB; "schema" = versão lógica das migrations. */
globalThis.SALAO_VERSAO = {
  "sistema": "Salão.gestão",
  "versao": "11.2.0",
  "data": "2026-11-26",
  "banco": 1,
  "schema": 2,
  "alteracoes": [
    "Atualização mais segura: cada arquivo da nova versão é conferido por SHA-256; uma publicação incompleta ou um cache de CDN desatualizado é recusado inteiro, e a versão atual continua funcionando",
    "Retorno de versão corrigido: só é permitido para versões compatíveis com o banco atual; versões incompatíveis são bloqueadas e nunca chegam a ser abertas",
    "Saída de emergência: tela de recuperação e endereço com ?recuperar=1 voltam para a versão atual sem tocar nos dados",
    "Diagnóstico ampliado (versão, banco, cache íntegro, persistência, atualização e última falha), sem dados de clientes no relatório",
    "Cópias locais com política de retenção (8 mais recentes + a última de cada tipo de segurança, até 40 MB); o backup baixado continua sendo a proteção principal"
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
    "js/data/diagnostico.js",
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
  ],
  "integridade": {
    "css/ds11.css": "7ddbec67416afbf2ad1e03c6b4cdc4a0d93e96d815ea0855fe43a3d142972c92",
    "css/style.css": "09fd94df914df3947b0fa3486f2a73c99cac7bff2b46393b453f2f75f9aa5580",
    "css/style8.css": "799b425f9079e5f97b6fb10b26bd3ce0ec76f4b6152227498698f75b9e3a3530",
    "fonts/dmsans-latin.woff": "17466801f4591f07e98e138f2e6c53c4539df36ed215444ef975425a2a779e26",
    "icons/apple-touch-icon.png": "ef3e66354287a99385cd65675f71cf04113069bb9819530f62aa490dbeafe109",
    "icons/icon-192.png": "37bc3f71fdae24118f8a8c33dd8864f342aa1e682e7f6f05c8751e1d99cdbe5d",
    "icons/icon-512.png": "f338ad250528947f920f4fa771bca102965525eac2c9340d8499fbc488ab84f2",
    "icons/maskable-512.png": "419ff8f3580eebfad6c4043fdc6dae4406e9133a55eceda2d1cb4111d4098ccf",
    "index.html": "12bf4bc7c481b08512bb39ae58c88059c716a49ac44590965873c63493fe9e4e",
    "js/app.js": "36212e8613585bcf98e64d5de742945ab4393efdd9ef5d71d8fff900d1863003",
    "js/charts.js": "8e51d9d70753157c1cf6e9b92d8598023d36fafa77f1ada699e06eb884867c1f",
    "js/data/agenda.js": "27d2631c3ba8c6f688f6c77b56f9ff8f7383957e5a0591f6e33e8e62b0b2fe46",
    "js/data/backup.js": "3602349438c8c75b9c42131eda2e4144bf69659d42cd469eae4a23a1792eb223",
    "js/data/clientes.js": "c0098f8522d97d3fce261a7d5fa0b6bb0fe71b980d668c2bc6f120aa6bb0e48a",
    "js/data/database.js": "4288961d10895b59b029a8b8f4a697dd53e8e11bca020a61d51038f2e5d64f57",
    "js/data/diagnostico.js": "dd7d430c281e9e463900c8154b753ff561e056e77c6673a9474b8f63479889d1",
    "js/data/financeiro.js": "744f23c3f5ef7052d5c4cc8944417e61eafe080142f65ebd7af96b308211bf1a",
    "js/data/manutencao.js": "21eb346fbc9aca32583eca841f795f58b41cbdf5de4c97bf7bb05a3cdcc4afeb",
    "js/data/migracoes.js": "6146ff3d650679d9616607357b834f7e066f7e1c9ba830c3ccf9440ac2c948f9",
    "js/data/permissoes.js": "28cd396691f1074b4268e93564a3f1f7c9e6ee7b4f5a2c34db561b44e9ef0668",
    "js/data/servicos.js": "70ee2715fbb5f10e8dbfc3261c615f8b418c3f4e5f625b26e3d4cd3dd2b085d0",
    "js/data/usuarios.js": "861df3dc44e97dcbe5f9357270ebf6341e74f524d89e6512ffa09f5a6a7a25bd",
    "js/data/zip.js": "46db4dd8cc3a7856c3d773c7957e0dca17a65940571438d89f95a6b550949ad3",
    "js/ui/icones.js": "e1db8ce43e2b0a1611735174945fd38d9ad47f6b7a7dbe3e7a19242128db399d",
    "js/ui/shell.js": "8e083b8d17a312d1b1a4cc354f534f8527dbe07f1b0ab7631624dd813ce14bcc",
    "js/ui/util.js": "b7f977eaca4c3a5ea16738349c5b2120eb8b12ea029cf005ff906e9664c574cb",
    "js/ui/views.js": "932b3484fa7a48ead1714d2358b7be0473071f8fb8daccbe4d490df5c616b4fb",
    "manifest.webmanifest": "4d3c7261f77eb7044c34be68fd3ae34cbd5edfa06e0e4fb651707acb8ae50674",
    "sw.js": "8aad47965c0e986d2c8c8f2f88f687e52fefa0036811ce0fabf099e93698d075"
  }
};
