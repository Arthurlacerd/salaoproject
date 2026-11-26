# Build e testes — Salão.gestão

O Salão.gestão é um PWA estático, **sem dependências e sem empacotador**: os arquivos do repositório são exatamente os
arquivos publicados. O "build" não transforma código. Ele **gera e confere os metadados de publicação** em `js/versao.js`
e reprova o que quebraria a instalação, o modo offline ou a atualização.

## Requisitos

| Para | Precisa |
|---|---|
| Build e testes unitários | Python 3.8+ e Node 20+ (só a biblioteca padrão; nenhum `npm install`) |
| Testes de integração (navegador) | Playwright com Chromium disponível para o Node |

## Desenvolver

1. Crie uma branch a partir da `main` (`git checkout -b minha-mudanca`).
2. Sirva a pasta do repositório com qualquer servidor estático. Exemplo, de **fora** do repositório:
   `python3 -m http.server 8000 --directory ..`, depois abra `http://localhost:8000/salaoproject/`.
   `localhost` conta como contexto seguro, então o service worker e o IndexedDB funcionam.
3. O service worker usa cache-first. Para ver mudanças durante o desenvolvimento, use o DevTools
   (Application › Service Workers › "Update on reload") ou rode o build e use **Atualizar agora**.

## Gerar o build

```bash
python3 tools/construir_pwa.py              # gera "arquivos" + "integridade" em js/versao.js e valida tudo
python3 tools/construir_pwa.py --verificar  # só confere (CI/PR): falha se js/versao.js estiver desatualizado
python3 tools/construir_pwa.py --relatorio /tmp/relatorio.md   # também grava um relatório em Markdown
```

O build é obrigatório depois de **qualquer** alteração em `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/`,
`icons/` ou `fonts/`. Sem ele, os hashes não conferem e o service worker recusa a nova versão. Essa recusa é proposital:
é melhor não atualizar do que instalar uma versão inconsistente.

### O que o build faz

| # | Verificação | Falha quando |
|---|---|---|
| 1 | Descobre os arquivos do app: `index.html`, `manifest.webmanifest`, `sw.js` e tudo em `css/`, `js/`, `icons/`, `fonts/` | — |
| 2 | Gera ou confere `arquivos` (lista de cache do SW) | arquivo do app fora da lista |
| 3 | Gera ou confere `integridade` (SHA-256 de cada arquivo, menos `js/versao.js`) | arquivo alterado sem rodar o build |
| 4 | Referências: `href`/`src` do HTML, `import` do JS, `url()` do CSS, `importScripts` | referência inexistente, fora do cache, absoluta (`/…`) ou externa |
| 5 | Arquivos listados | listado mas inexistente |
| 6 | Manifest | JSON inválido; falta `name`, `short_name` (≤ 12), `start_url`, `scope` ou `display`; `start_url` fora do scope; **`id` presente** |
| 7 | Ícones | não é PNG, tamanho diferente do declarado, falta o 192 ou o 512 `any` (o `maskable` ausente gera aviso) |
| 8 | Service worker | não carrega `js/versao.js`; cache não versionado; sem conferência de hash; **acessa o IndexedDB**; sem fallback offline; `skipWaiting` fora do pedido da página |
| 9 | Versão | `versao` fora do formato X.Y.Z; `data` inválida; `alteracoes` vazia; `banco`/`schema` diferentes do que `js/data/migracoes.js` define |

Código de saída: `0` aprovado, `1` com problemas (listados), `2` erro de uso.

**O build nunca toca em dados.** Ele só lê os arquivos do app e, no modo de geração, reescreve `js/versao.js`.

### O que se edita à mão em `js/versao.js`

Somente `versao`, `data` e `alteracoes`. Os campos `banco` e `schema` só mudam junto com uma migration nova em
`js/data/migracoes.js`, e o build confere que batem. `arquivos` e `integridade` são gerados: nunca os edite.

## Testes

```bash
npm test             # build --verificar + unitários + integração (o mesmo que os três comandos abaixo)
npm run verificar    # só o build
npm run test:unit    # node --test "tests/unit/*.test.js"   (sem navegador, roda em qualquer lugar)
npm run test:e2e     # node --test --test-concurrency=1 "tests/e2e/*.test.js"   (Chromium via Playwright)
```

O `npm` aqui é só um atalho: não há `node_modules`, e os comandos podem ser rodados diretamente.

| Arquivo | Cobre |
|---|---|
| `tests/unit/manifest.test.js` | JSON, name/short_name, scope/start_url, display, ícones reais, ausência de `id` |
| `tests/unit/sw.test.js` | versão e nome do cache, arquivos existentes, hashes, nenhum acesso ao IndexedDB, fallback offline, ativação só a pedido, versão fixada compatível, `?recuperar=1`, cache sem reaproveitamento |
| `tests/unit/indexeddb.test.js` | migrations numeradas, versão nativa/lógica = `versao.js`, nada destrutivo, migration 2 idempotente e reversível |
| `tests/unit/backup.test.js` | checksum canônico idêntico ao do Python (9.x), validação, adulteração, formato futuro, órfãos, senha, backup 9.x, retenção |
| `tests/unit/manutencao.test.js` | P1: compatibilidade de retorno de versão |
| `tests/unit/build.test.js` | o build aprova o repositório e reprova 12 tipos de problema |
| `tests/e2e/pwa.test.js` | instalação do SW, IndexedDB real, migration única, offline, Diagnóstico sem dados pessoais, medidas |
| `tests/e2e/atualizacao.test.js` | **11.1.0 → 11.2.0 real**, 11.2.0 → próxima versão (sintética), CDN desatualizada, backup antes, dados preservados, retorno, P1, emergência |
| `tests/e2e/backup.test.js` | exportação, restauração, rollback automático, estado inconsistente, adulteração, retenção no banco real |
| `tests/e2e/recuperacao.test.js` | tela de recuperação do boot sem loop e sem downgrade do banco |
| `tests/e2e/responsivo.test.js` | 11 telas sem rolagem horizontal em 320, 375, 390, 430, 768, 1024, 1280, 1440 e 1920 px |

### Testes de integração

Usam um servidor local que imita o GitHub Pages: o app fica em `/salaoproject/` e o servidor envia `Cache-Control: max-age=600`.
Cada teste usa um **perfil de navegador novo e descartável**: nenhum dado real é lido ou alterado. O teste de atualização
extrai a 11.1.0 publicada (commit `b8061f2`) do histórico do git. Para usar outra referência, defina `SALAO_REF_ANTERIOR`.
Se o Playwright não estiver disponível, esses testes aparecem como *ignorados*, e não como aprovados.

Capturas de tela e medidas ficam em `tests/e2e/saida/`, que não vai para o git.

### Integração contínua

`.github/workflows/verificar.yml` roda o build em modo de verificação e os testes unitários em todo Pull Request e em todo
push na `main`. Os testes de navegador rodam localmente antes de abrir o PR (veja `docs/PWA_UPDATE_PROCESS.md`).
