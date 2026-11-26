# Salão.gestão 11.2.0 — hardening do PWA e pipeline de atualização segura

**Tipo:** estabilização e infraestrutura. Não há redesign, a identidade visual 11.1 não mudou, não há funcionalidade
grande nova e nenhuma funcionalidade foi removida.
**Banco:** IndexedDB `salao_gestao` com versão nativa **1** e schema **2**. **Nenhuma** mudança de estrutura e nenhuma
migration nova.
**Formato de backup:** `.salaobackup` v1, sem alteração.
**Identidade do PWA:** sem mudança. Continua sem `"id"`, com identidade igual à pasta do app.

## Correções

### P1: retorno de versão (estava invertido)
- **Antes:** `podeVoltarPara` bloqueava quando `versao.banco > VERSAO_BANCO`, o que nunca acontece numa versão mais antiga.
  Na primeira mudança de estrutura do banco, voltar de versão faria o IndexedDB recusar a abertura (VersionError). O app
  passaria a abrir só numa tela de erro, sem acesso à Manutenção para desafixar.
- **Agora:** `compatibilidade()` (`js/data/manutencao.js`) só permite voltar para uma versão com **o mesmo `banco`** e
  **`schema` maior ou igual** ao atual. `banco` menor, `banco` maior, `schema` menor ou `banco` ausente: bloqueado, com
  o motivo. O **service worker** aplica a mesma regra ao fixar (`fixar-versao`) e ao servir: um pino incompatível é
  ignorado e desafixado sozinho.
- **Emergência:**
  - tela "O aplicativo precisa voltar para a versão atual" quando o banco não abre por versão (código `VERSAO_BANCO`),
    com o botão **Abrir a versão atual**;
  - endereço `?recuperar=1`, que o SW trata desafixando qualquer versão e servindo a atual. Funciona mesmo quando a versão
    fixada é antiga e não tem essa tela;
  - a marca sai da barra de endereço e não há recarga automática, então não há loop de boot.
- Os dados nunca sofrem *downgrade*.

### Encontradas pelos testes desta versão (também existiam na 11.1)
1. **Uma falha de instalação podia apagar o cache da versão em uso.** O `catch` da instalação apagava
   `salao-static-v<versão do versao.js recebido>`. Se o `versao.js` recebido tivesse o número da versão já instalada
   (publicação em andamento, CDN), o cache em uso era apagado: o app perdia o modo offline e o retorno de versão. Agora a
   instalação só apaga o que ela mesma criou (marca `instalando` em `salao-meta`), e uma versão já instalada nunca é
   sobrescrita: só é aceita se for idêntica.
2. **O retorno de versão não tinha efeito (ou misturava arquivos) por até 10 minutos.** Numa recarga com o mesmo service
   worker, o cache de memória do Chromium reaproveitava os arquivos da versão anterior sem passar pelo SW, porque o
   GitHub Pages envia `max-age=600`. O teste mostrou: com o pino em 11.1.0, a recarga ainda abria a 11.2.0. Agora o SW
   entrega o que está em cache com `Cache-Control: no-cache`.
3. **"Atualizar agora" não recarregava na mesma sessão em que o app foi instalado pela primeira vez.** O SW novo assumia,
   mas a página ficava na versão antiga até uma recarga manual. Agora recarrega uma vez sempre que a atualização é pedida
   pela interface, com uma trava de 10 s na sessão contra loop de recarga.

## Pipeline de atualização segura
- **Integridade por arquivo:** o build grava o SHA-256 de cada arquivo em `js/versao.js › integridade`. O SW baixa e
  confere **todos** os arquivos antes de gravar qualquer um. O `versao.js` precisa ser idêntico ao que o SW carregou.
  Arquivos de versões diferentes, seja por CDN desatualizada, deploy em andamento ou upload parcial, fazem a versão
  inteira ser recusada. Nunca há atualização parcialmente válida. O motivo fica registrado para o Diagnóstico.
- **Build restaurado:** `tools/construir_pwa.py` gera a lista de cache automaticamente e valida manifest, ícones, service
  worker, referências e consistência de versão/banco/schema. Termina com código ≠ 0 se houver problema.
  Veja `docs/BUILD.md`.
- **Testes automáticos:** unitários (`node:test`, sem dependências) e de integração em Chromium real, incluindo a
  atualização **11.1.0 → 11.2.0** a partir do commit publicado.
- **CI:** `.github/workflows/verificar.yml` roda o build em modo de verificação e os testes unitários em todo PR.
- **Processo oficial:** branch → build → testes → relatório → PR → revisão → merge único → Pages.
  Veja `docs/PWA_UPDATE_PROCESS.md`.
- `.gitattributes` fixa LF, para que os hashes calculados sejam os bytes publicados.

## Diagnóstico
Itens: **Versão** (app, banco nativo, schema), HTTPS, Manifest (com aviso se aparecer um `id`), Ícones, Service Worker,
**Cache** (cada arquivo conferido por SHA-256; versões guardadas), Offline, **IndexedDB**, **Persistência** (com uso de
espaço), **Atualização** (versão fixada, nova versão aguardando, última verificação), **Última falha de atualização** e
Instalação. O relatório copiado traz também origem, endereço, identidade, banco e schema.

**Sem dados pessoais:** a contagem de clientes e atendimentos saiu do Diagnóstico. Um teste confirma que nome, telefone,
valores, despesas, nome do salão, usuário e hashes de senha não aparecem na tela nem no relatório.

## Backup 9.x
- **Mantido:** o formato `.salaobackup` v1, a tabela `configuracoes_sistema` e o checksum canônico. Um teste confirma
  que o checksum é idêntico ao `json.dumps(sort_keys=True, separators=(',',':'), ensure_ascii=False)` do Python. Também
  se mantém a origem padrão "servidor 9.x".
- **Corrigido (texto):** a interface dizia que a estrutura de um backup 9.x "é convertida automaticamente ao importar".
  **Não existe conversão**: os registros são importados como estão, depois de validados. O aviso agora diz isso. Nenhuma
  conversão foi inventada.
- **Ponto em aberto: `senha_hash`.** A validação exige o formato `pbkdf2$<iterações>$<sal>$<hash>` (base64), que é o do
  PWA. **Não há backup 9.x real no repositório** para confirmar o formato do Flask. Se o 9.x usava o formato do Werkzeug
  (`pbkdf2:sha256:…` ou `scrypt:…`), um backup 9.x **com a tabela `usuarios`** será recusado, com a mensagem "registro(s)
  de usuarios inválido(s)". Isso não acontece com um backup sem usuários. O teste `9.x real` é ativado ao colocar uma
  fixture em `tests/fixtures/` (veja o LEIA-ME de lá).

## Cópias locais (snapshots)
Avaliação: cada cópia guarda o banco inteiro, inclusive a `auditoria`, que só cresce. São até 8 cópias no mesmo IndexedDB.

Política nova, sem mudar a estrutura do banco:
- mantém as **8 mais recentes**;
- mantém **a mais recente de cada tipo de segurança** (`pre_atualizacao`, `pre_migracao`, `pre_importacao`,
  `pre_retorno_versao`), para que as cópias automáticas diárias não as empurrem para fora;
- se o total passar de **40 MB**, apaga as mais antigas, nunca ficando com menos de 2 e nunca apagando a mais recente.

O `.salaobackup` baixado não é afetado e continua sendo a proteção principal.

## Testes executados

| Conjunto | Executados | Aprovados | Falhas | Ignorados |
|---|---|---|---|---|
| Build (`--verificar`) | 1 | 1 | 0 | 0 |
| Unitários (`tests/unit`) | 49 | 48 | 0 | 1 (fixture 9.x real inexistente) |
| Integração em Chromium (`tests/e2e`) | 29 | 29 | 0 | 0 |

A integração inclui: offline, atualização 11.1.0 → 11.2.0 e 11.2.0 → próxima versão (pelo código 11.2, na mesma sessão da instalação), rollback, P1, emergência, backup/restauração, rollback de
restauração e responsivo em 320, 375, 390, 430, 768, 1024, 1280, 1440 e 1920 px (11 telas cada, sem rolagem horizontal).

## Medidas
Os tempos foram medidos em servidor local (loopback) e Chromium desktop. Servem para comparar versões, não representam a
rede de um celular.

| Medida | 11.1.0 | 11.2.0 |
|---|---|---|
| Arquivos do app (cache) | 30 | 30 |
| Tamanho total do app | 452 KB | 470 KB (+18 KB: SW, hashes em `versao.js`, Diagnóstico) |
| Requisições da página na 1ª abertura | — | 24 (CSS, JS, fonte e ícone) |
| Requisições totais na 1ª abertura (página + instalação do SW) | — | 56 |
| Abertura sem cache (até a tela de entrada) | — | ~100–180 ms |
| SW instalado e controlando | — | ~180–300 ms |
| Abertura com cache (SW) / offline | — | ~60–140 ms / ~75–110 ms |
| Atualização 11.1 → 11.2 (clique → nova versão aberta, com backup) | — | ~1,2 s |

Na primeira visita, os arquivos são baixados duas vezes: pela página e pela instalação do SW, que usa `cache: "reload"`
para nunca aceitar uma cópia antiga. Isso já acontecia na 11.1 e foi mantido de propósito.

## Limitações conhecidas (não alteradas)
- **Restauração com o estado atual inconsistente:** se o banco atual tiver registros órfãos, a cópia de segurança
  `pre_importacao` não valida e a restauração é recusada **antes** de tocar nos dados. Isso é seguro, mas impede restaurar
  nesse estado. Coberto por teste; fica para avaliação numa versão futura.
- **Usuários que instalaram na 10.1 ou na 11.0** (com `"id": "./"`) podem ter um ícone com a identidade antiga. A 11.2
  não muda a identidade da 11.1. Se houver ícone duplicado, basta remover o antigo; os dados são os mesmos (mesma origem).

## Arquivos
- **Alterados:** `sw.js`, `js/versao.js`, `js/app.js`, `js/data/manutencao.js`, `js/data/diagnostico.js`,
  `js/data/backup.js`, `js/data/migracoes.js` (só a mensagem de erro com código).
- **Novos:** `tools/construir_pwa.py`, `package.json`, `.gitignore`, `.gitattributes`, `.github/workflows/verificar.yml`,
  `tests/unit/*`, `tests/e2e/*`, `tests/fixtures/LEIA-ME.md`, `docs/BUILD.md`, `docs/PWA_UPDATE_PROCESS.md`,
  `docs/CHANGELOG_11_2.md`, `README.md`.
- **Removidos:** nenhum.
