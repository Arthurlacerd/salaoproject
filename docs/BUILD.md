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
| `tests/unit/sw.test.js` | versão e nome do cache, arquivos existentes, hashes, nenhum acesso ao IndexedDB, fallback offline, ativação só a pedido, versão fixada compatível, versão mínima de retorno (igual à da página, comparação numérica), `?recuperar=1`, cache sem reaproveitamento |
| `tests/unit/indexeddb.test.js` | migrations numeradas, versão nativa/lógica = `versao.js`, nada destrutivo, migration 2 idempotente e reversível |
| `tests/unit/backup.test.js` | checksum canônico idêntico ao do Python, validação, adulteração, formato futuro, órfãos, senha, cabeçalho 9.x (sem prometer compatibilidade), retenção |
| `tests/unit/senha.test.js` | formato do `senha_hash`: válido, limites de iterações, campos, algoritmo (Werkzeug/scrypt gerados pelo Python real), hexadecimal (caso da investigação), SHA-512, sal e hash inválidos; login tolerante sem erro técnico |
| `tests/unit/validacao_backup.test.js` | validação completa antes de gravar: cabeçalho, checksum, **cada campo obrigatório de cada tabela**, listas fechadas, ids (até 2^31 − 1), datas do calendário, forma de pagamento, relacionamentos, usuários, regras de acesso, mensagens sem dados pessoais, alarmes para mudanças futuras |
| `tests/unit/manutencao.test.js` | P1: compatibilidade de retorno de versão; versão mínima segura 11.3.0 (comparação numérica, formato inválido recusado) |
| `tests/unit/build.test.js` | o build aprova o repositório e reprova 12 tipos de problema |
| `tests/unit/valores.test.js` | 11.3.1: valores com ponto de milhar ("1.500" = R$ 1.500,00), formatos antigos iguais, inválidos recusados, valor pré-preenchido volta igual; todos os formulários de valor usam `parseMoeda` |
| `tests/unit/tamanho_backup.test.js` | 11.3.1: limite de 30 MB sem mudança; sem alerta abaixo de 24 MB, alerta em 24 MB, forte a partir de 27 MB, "ultrapassou o limite" a partir de 30 MB |
| `tests/unit/datas.test.js` | 11.3.1 (fuso de São Paulo): "Gerado em" na hora local; "próximo atendimento" de hoje não some depois das 21h |
| `tests/unit/bytes.test.js` | 11.3.2: contagem de bytes UTF-8 igual à do `TextEncoder` (acentos, emoji, ideogramas, substitutos soltos, 3.000 textos aleatórios); cópia antiga sem `bytes` usa `tamanho`; retenção sem mudança (por `tamanho`); limite e formato sem mudança |
| `tests/e2e/pwa.test.js` | instalação do SW, IndexedDB real, migration única, offline, Diagnóstico sem dados pessoais, medidas |
| `tests/e2e/atualizacao.test.js` | atualização real **11.1.0 → atual**, **11.2.0 → atual**, **11.3.0 → atual** e **11.3.1 → atual**, retorno **atual → 11.3.0 e → 11.3.1 pela tela** (a versão anterior lê as cópias com `bytes`) (e "Usar a mais recente" / `?recuperar=1`), versões bloqueadas exibidas sem botão, atual → próxima versão (sintética), CDN desatualizada, backup antes, dados preservados, retorno para 11.1/11.2 **recusado** (página, service worker e tela, sem alterar nada), retorno permitido para a versão mínima segura, P1, emergência |
| `tests/e2e/backup.test.js` | exportação, restauração com prova de acesso, ids repetidos recusados antes de gravar, estado inconsistente (D2), adulteração, retenção no banco real |
| `tests/e2e/restauracao.test.js` | **inválido → recusado → estado intacto** (18 problemas), restauração válida pela tela, requisito 11, prova de acesso (D4), falha simulada na gravação e na cópia, D1/A2 (com admin, recepção conectada, sem admin que consiga entrar, primeiro acesso), backup sem usuários, desfazer com e sem login, A1 (nunca para estado sem administrador; criar outro administrador é impossível), cópia danificada, M2 (limite de ids e gerador de chaves), D2, D3, D5 |
| `tests/e2e/compat_versoes.test.js` | backups gerados pelo código real de **10.1.0, 11.0.0, 11.1.0, 11.2.0, 11.3.0 e 11.3.1** (com pagamentos dos três pontos que os gravam) restauram na versão atual com dados idênticos e login |
| `tests/e2e/recuperacao.test.js` | tela de recuperação do boot sem loop e sem downgrade do banco |
| `tests/e2e/valores.test.js` | 11.3.1: valores digitados nas telas de atendimento (valor e já recebido), recebimento, estorno, serviço e despesa |
| `tests/e2e/tamanho_real.test.js` | 11.3.2: tamanho informado = arquivo baixado (bytes) e = `data/backup.salaobackup` do ZIP; cópias novas com `bytes`; listas, painéis e Diagnóstico em bytes; cópia antiga pelo `tamanho`; alerta com < 24 MB em caracteres e ≥ 24 MB em bytes |
| `tests/e2e/leitura.test.js` | 11.3.2: cópia apagada (Dados e Manutenção), arquivo ilegível (Importar backup, Restaurar dados, Verificar arquivo) e telas sem login: mensagem clara, prévia anterior removida, campo limpo, nada gravado |
| `tests/e2e/mensagens.test.js` | 11.3.2: confirmações visíveis depois do redesenho (~5 s); erros não vão para a tela seguinte |
| `tests/e2e/corrida_previa.test.js` | 11.3.2: a última escolha vence (11 testes): A lento + B rápido, A rápido + B lento (dois casos), lentidão dentro de `mostrarPrevia()`, erro atrasado e os fluxos Dados, CSV, cópia, Restaurar dados e telas sem login; confirmar restaura a última escolha |
| `tests/e2e/feedback.test.js` | 11.3.1: falhas de Exportar backup, Baixar cópia e Importar CSV com mensagem e estado intacto; "Entrando… preparando a cópia do dia" (sem duplo envio) ao entrar e ao reabrir; aviso de tamanho (24 / ~28 / 30+ MB); "Gerado em" local; "próximo atendimento" depois das 21h |
| `tests/e2e/responsivo.test.js` | 12 telas e a prévia da restauração sem rolagem horizontal em 320, 375, 390, 430, 768, 1024, 1280, 1440 e 1920 px |

### Testes de integração

Usam um servidor local que imita o GitHub Pages: o app fica em `/salaoproject/` e o servidor envia `Cache-Control: max-age=600`.
Cada teste usa um **perfil de navegador novo e descartável**: nenhum dado real é lido ou alterado. Os testes de atualização e
de compatibilidade extraem versões publicadas do histórico do git (10.1.0, 11.0.0, 11.1.0 e 11.2.0); sem o histórico completo
eles aparecem como *ignorados*. Para trocar a referência da 11.1.0 ou da 11.2.0, defina `SALAO_REF_ANTERIOR` ou `SALAO_REF_11_2`.
Se o Playwright não estiver disponível, esses testes aparecem como *ignorados*, e não como aprovados.

Capturas de tela e medidas ficam em `tests/e2e/saida/`, que não vai para o git.

### Integração contínua

`.github/workflows/verificar.yml` roda o build em modo de verificação e os testes unitários em todo Pull Request e em todo
push na `main`. Os testes de navegador rodam localmente antes de abrir o PR (veja `docs/PWA_UPDATE_PROCESS.md`).
