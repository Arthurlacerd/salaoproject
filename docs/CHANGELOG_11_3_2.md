# Salão.gestão 11.3.2 — Tamanho real do backup, falhas de leitura e mensagens

**Tipo:** correções pontuais, com escopo aprovado. Não há redesign nem CSS novo.
**Banco:** IndexedDB `salao_gestao`, versão nativa **1**, schema **2**. Sem mudança e sem migration. As cópias locais
novas ganham um campo numérico informativo, `bytes`. Ele não tem índice, não entra no `.salaobackup` e as versões
anteriores o ignoram.
**Formato `.salaobackup`:** v1, sem mudança: mesmos campos, mesmo checksum, mesma estrutura.
**Limite da restauração (30 MB), regra de restauração e retenção (8 cópias, 40 MB, por `tamanho`):** sem mudança.
**`restauracao.js`, `validacao_backup.js` e `database.js`:** sem mudança. **Service worker, manifest, `index.html` e CSS:**
sem mudança. Só a lista de cache e os hashes mudam, via build.
**Retorno de versão:** a versão mínima segura continua **11.3.0**. Voltar para 11.3.1 e para 11.3.0 é permitido e testado.

## O que mudou para quem usa

1. **Tamanho real do backup.** Os avisos de limite, o Diagnóstico e o tamanho das cópias passam a usar o tamanho real do
   arquivo em bytes. Antes, mediam caracteres, e cada acento ocupa 2 bytes no arquivo. O aviso continua só informativo,
   a partir de 24 MB.
2. **Cópia que já não existe.** "Restaurar" uma cópia do aparelho que foi apagada (por exemplo, substituída por uma mais
   nova) mostra o motivo certo. Antes aparecia "O arquivo está vazio".
3. **Arquivo que não pode ser lido.** Em Manutenção (Importar backup e Restaurar dados), em Dados (Verificar arquivo) e
   nas telas sem login, a falha de leitura mostra uma mensagem clara. A prévia de um arquivo anterior sai da tela, para não
   ser confirmada por engano, e o campo é limpo para escolher o arquivo de novo. Nada é gravado. Arquivos inválidos
   continuam bloqueados como antes.
4. **Mensagens de confirmação.** "Backup gerado", "Cliente salva", "Despesa salva", "N cliente(s) importado(s)" e as
   demais confirmações não somem mais quando a tela é atualizada. Antes ficavam visíveis por 8 a 17 ms. Continuam
   sumindo sozinhas em ~5 s. Mensagens de erro não passam para a tela seguinte.

## Como foi implementado

| Item | Arquivos | O quê |
|---|---|---|
| 1 | `js/data/tamanho_backup.js` | `bytesUtf8()`: conta os bytes UTF-8 sem alocar memória, com o mesmo resultado do `TextEncoder`. `tamanhoCopia()`: usa `bytes` e, nas cópias antigas, `tamanho`. |
| 1 | `js/data/backup.js` (mínimo: 3 linhas) | `baixar()` informa os bytes reais. `snapshot()` grava `bytes` junto de `tamanho`. A retenção continua recebendo só `id`, `motivo` e `tamanho`. |
| 1 | `js/data/manutencao.js`, `js/data/diagnostico.js`, `js/ui/views.js` | O backup completo informa os bytes do `data/backup.salaobackup`. Diagnóstico, painéis e listas de cópias usam `tamanhoCopia()`. |
| 2 | `js/ui/views.js`, `js/app.js` | A prévia anterior sai da tela antes de cada leitura ("Verificando o arquivo…" / "Abrindo a cópia…"). Os erros são tratados localmente, com mensagem e `console.error`, e o campo de arquivo é limpo quando a leitura falha. Nas telas sem login, que não têm área de avisos, o erro aparece na própria prévia. |
| 3 | `js/ui/shell.js` | `montar()` guarda as mensagens que não são de erro antes de recriar a tela e as recoloca na área nova. A função de aviso e o CSS não mudaram. |

## Testes

- **Unitários:** `bytes.test.js` (novo).
- **Navegador (Chromium):** `tamanho_real.test.js`, `leitura.test.js` e `mensagens.test.js` (novos).
- **Compatibilidade de backups:** passa a incluir a **11.3.1** (10.1–11.3.1).
- **Atualização real e retorno:** `atualizacao.test.js` cobre **11.3.1 → 11.3.2** e o retorno **11.3.2 → 11.3.1** pela tela.
  Confere também que a versão anterior lê as cópias com `bytes`.

## Observações conhecidas (fora desta versão)

- **Arquivo de 30 MB ou mais:** quando ele passa de 30 MB em bytes, mas o texto não, a cópia do aparelho ainda seria
  aceita pela restauração. A mensagem "não pode ser restaurado" é conservadora nesse caso.
- **"Escolha o arquivo."** nas telas sem login continua invisível. Essas telas não têm área de avisos, e o caso "nenhum
  arquivo escolhido" não fazia parte do escopo.
- **Mensagens seguidas de recarga da página** não são preservadas: "Configurações salvas.", e "Restaurado…"/"Restauração
  desfeita…", que ficam visíveis só até a recarga de 0,9 s.
- **Duas verificações seguidas:** se dois arquivos são escolhidos muito rápido, a prévia do primeiro ainda pode terminar
  depois da do segundo. O nome do arquivo aparece no título da prévia. Isso já acontecia antes.
- **Conteúdo que desce e sobe:** a área de avisos fica no fluxo da página. O conteúdo desce enquanto uma confirmação está
  visível e sobe quando ela some, como já acontecia nas telas sem troca de rota.
