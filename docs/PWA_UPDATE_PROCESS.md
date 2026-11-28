# Processo oficial de publicação e atualização — Salão.gestão

> **Regra:** a `main` é o que está publicado. Nada chega à `main` sem passar por branch, build, testes e Pull Request.
> **Não publique por "Add files via upload"** no site do GitHub: cada upload vira um commit e um deploy separado, e o
> GitHub Pages chega a publicar estados intermediários (já aconteceu: houve um período sem `index.html`, `sw.js` e manifest).

## 1. Publicar uma versão nova

| Passo | O que fazer | Como conferir |
|---|---|---|
| 1. Branch | `git checkout main && git pull && git checkout -b versao-X.Y.Z` | nunca trabalhe direto na `main` |
| 2. Versão | em `js/versao.js`, atualize `versao`, `data` e `alteracoes`; crie `docs/CHANGELOG_X_Y.md` | **todo** código alterado exige versão nova |
| 3. Build | `python3 tools/construir_pwa.py` | sai com código 0 |
| 4. Testes | `npm test` (build + unitários + navegador) | 0 falhas |
| 5. Validação | `python3 tools/construir_pwa.py --verificar --relatorio /tmp/relatorio.md` | relatório "APROVADO" |
| 6. Relatório | cole o relatório e o resultado dos testes na descrição do PR | — |
| 7. Pull Request | `main` ← `versao-X.Y.Z` | o workflow **Verificar PWA** fica verde |
| 8. Revisão | revise o diff e, se possível, teste num celular Android pelo endereço local | — |
| 9. Merge | **um único** merge na `main` | um deploy só |
| 10. Pages | o GitHub Pages publica em ~1 minuto | no celular: Configurações › Sistema › Diagnóstico › Atualização |

Sempre faça o merge de uma vez só (merge commit ou squash). Nunca envie arquivos um por um na `main`.

## 2. O que garante que uma publicação nunca quebra quem já usa

1. **Versão por cache:** cada versão vive no seu próprio cache (`salao-static-vX.Y.Z`). A versão em uso não é tocada
   enquanto a nova se instala.
2. **Integridade por hash:** o service worker novo baixa **todos** os arquivos e confere o SHA-256 de cada um contra
   `js/versao.js › integridade`, gerado pelo build. O `versao.js` precisa ser idêntico ao que o próprio SW carregou. Basta
   um arquivo divergente para que a versão inteira seja recusada e nada seja gravado. A causa pode ser um deploy em
   andamento, a CDN do Pages ainda entregando um arquivo antigo, um upload parcial ou alguém que esqueceu o build. O motivo
   aparece no Diagnóstico › Última falha de atualização, e o navegador tenta de novo na próxima abertura ou em
   **Verificar atualização**.
3. **Versão já instalada nunca é sobrescrita:** se chegar um `versao.js` com o número de uma versão já instalada, o SW só o
   aceita com conteúdo idêntico. Se falhar, só apaga o cache que ele mesmo criou. Na 11.1, esse caso podia apagar o cache
   da versão em uso.
4. **Nunca atualiza sozinho:** a nova versão fica *aguardando*. Quem tem permissão `dados.gerir` toca em **Atualizar agora**.
   Primeiro é criado e validado um backup local (`pre_atualizacao`); se ele falhar, a atualização não continua. Depois
   o SW novo assume e o app recarrega uma vez.
5. **O IndexedDB nunca é tocado pelo service worker** (o build reprova qualquer acesso). Mudanças de estrutura só por
   migration nova, não destrutiva, com backup `pre_migracao` antes.
6. **O cache de memória do navegador não mistura versões:** o SW entrega o que está em cache com `Cache-Control: no-cache`.

## 3. Retorno de versão (rollback)

**Para o usuário:** Configurações › Manutenção › Versões disponíveis › **Voltar para esta**. Isso cria um backup
`pre_retorno_versao` e fixa a versão. Para desfazer, use **Usar a mais recente**.

- O aparelho guarda a versão atual e a anterior (mais uma eventualmente fixada).
- **Só é permitido voltar para versões compatíveis:** com a mesma versão nativa do banco (`banco`) e um `schema` igual ou
  maior que o atual. Versões incompatíveis são bloqueadas na página **e** no service worker, porque o IndexedDB recusaria
  abrir e o app não abriria. Os dados nunca sofrem *downgrade*.
- **Versão mínima segura: 11.3.0.** As versões anteriores (11.2, 11.1…) restauravam backups sem login e são bloqueadas
  na página **e** no service worker. A comparação é numérica (`11.10.0` > `11.3.0`). Na 11.3.0 não havia, por isso, versão
  para onde voltar. A partir da 11.3.1, a 11.3.0 é uma versão de retorno permitida (11.3.1 → 11.3.0 é testado).
- **Na tela (11.3.1):** só as versões permitidas mostram **Voltar para esta**. As bloqueadas aparecem com "Não pode ser
  usada para retorno seguro" e o motivo, sem botão. A tela usa a mesma regra da página (`podeVoltarPara`). O service worker
  continua recusando por conta própria, e `?recuperar=1` continua desafixando.
- Se um pino incompatível ou abaixo do mínimo existir por qualquer motivo, o service worker o ignora e desafixa sozinho.
- **Atenção à segurança:** enquanto uma versão anterior estiver fixada, valem as regras dela. Ao subir a versão mínima no
  futuro, altere `VERSAO_MINIMA_RETORNO` em `js/data/manutencao.js` **e** em `sw.js` (o teste unitário confere que são iguais).

**Para quem publica:** para reverter uma publicação ruim para todos, **não** reverta a `main` para a versão anterior
(o mesmo número de versão com outro conteúdo seria recusado). Publique uma versão **nova** (ex.: 11.2.1) com o código
bom, pelo processo normal.

## 4. Recuperar uma instalação quebrada

Do mais simples ao mais drástico. **Nenhum destes passos apaga dados**, exceto o último, que só se aplica com backup em mãos.

1. **Diagnóstico:** Configurações › Sistema › Diagnóstico › **Copiar relatório** e envie a quem dá suporte. O relatório
   não contém clientes, telefones, valores, senhas nem conteúdo de backups.
2. **Tela "O aplicativo precisa voltar para a versão atual":** toque em **Abrir a versão atual**.
2a. **Uma restauração deu errado ou deixou você sem acesso:** use **Desfazer a última restauração** (Dados e backup, ou o
   link na tela de login). Sem login, ele só funciona enquanto ninguém entrou depois da restauração; não mostra nem baixa
   dados e também pode ser desfeito. Ele nunca volta para um estado sem administrador que consiga entrar: a restauração
   feita no primeiro acesso não pode ser desfeita (entre com o administrador do backup e restaure outro).
3. **Endereço de emergência:** com internet, abra o endereço do app terminando em `?recuperar=1`
   (ex.: `https://USUARIO.github.io/salaoproject/?recuperar=1`). O service worker desafixa qualquer versão e abre a atual.
   Funciona mesmo que a versão fixada não consiga abrir.
4. **Versão aguardando que não instala:** veja Diagnóstico › Última falha de atualização. Se o motivo for "publicação em
   andamento / CDN", espere alguns minutos e use Manutenção › Verificar atualização. Se persistir, a publicação está
   quebrada: publique uma correção com versão nova.
5. **Último recurso (com backup):** baixe um `.salaobackup` (Manutenção › Exportar backup), limpe os dados do site no
   Chrome, abra o app de novo e restaure em **Restaurar backup** (no primeiro acesso a restauração funciona sem login, com
   um backup que contenha usuários).

## 4b. Regras da restauração (11.3)

- **Quem pode restaurar:** com qualquer usuário no aparelho, só um administrador autenticado (Dados e backup ou
  Manutenção), mesmo que nenhum administrador consiga entrar. Sem login, só em aparelho sem nenhum usuário (primeiro
  acesso, dados perdidos) e com um backup que contenha usuários.
- **Nunca sem administrador:** nem restaurar nem desfazer deixam o aparelho sem um administrador que consiga entrar.
- **Aparelho com usuários e sem administrador que consiga entrar** (ex.: senha esquecida): não há recuperação sem login.
  É uma decisão de produto pendente (veja `docs/CHANGELOG_11_3.md`).
- **Prova de acesso:** se o backup traz usuários, informe o usuário e a senha de um administrador **do backup**; a senha é
  conferida no arquivo antes de qualquer alteração. Depois da restauração, entre com esse usuário.
- **Nada muda se algo falhar:** o arquivo é validado por completo antes; a gravação é uma única transação conferida antes
  de confirmar; antes de gravar, uma cópia do estado atual é guardada ("Cópia antes da restauração").
- **Cópia de emergência:** na prévia, com login, "Baixar cópia do estado atual" (recomendado).
- **Estado inconsistente:** exportar continua possível, mas o arquivo vem marcado "apenas para recuperação/análise"
  (nome terminado em `-INCONSISTENTE`) e não é aceito como backup normal.
- **Backups 9.x:** compatibilidade não verificada; um arquivo só é restaurado se passar em todas as validações.
- **Regras dos dados:** datas que existem no calendário, ids de 1 a 2.147.483.647 e forma de pagamento em todo pagamento.

## 5. Identidade do aplicativo

A identidade do PWA instalado é a definida na 11.1: **sem `"id"` no manifest**. Nesse caso, a identidade é o `start_url`
sem o `#`, ou seja, a pasta do app (`/salaoproject/`). **Não adicione `"id"`** nem mude `start_url` ou `scope`: o Android
passaria a tratar como outro aplicativo (ícone duplicado ou sem atualizações). O build e os testes reprovam um `id`.

## 6. Backup é a proteção principal

As cópias automáticas (até 8, mais a última de cada tipo de segurança, até 40 MB) ficam **no próprio aparelho, dentro do
mesmo banco**. Elas protegem contra erro de operação e de atualização, mas **não** contra a limpeza dos dados do site ou a
desinstalação. O arquivo `.salaobackup` baixado, guardado fora do aparelho, continua sendo a proteção principal; o app
avisa quando o último download tem mais de 7 dias.

**Limite de tamanho da restauração: 30 MB** (`LIMITE_BYTES` em `js/data/validacao_backup.js`; sem mudança na 11.3.1).
Um backup acima desse limite **não pode ser restaurado por este aplicativo**, nem a partir do arquivo nem a partir de uma
cópia do aparelho. O backup cresce com o uso, e a maior causa é o **histórico de alterações (auditoria)**: na auditoria da
11.3.0, com uso simulado, ela foi ~72% do backup, ~1,9 KB por atendimento, ~9 MB por ano de uso típico, e o limite foi
alcançado em ~3,5 anos. São estimativas: o uso real pode ser diferente.

Desde a 11.3.1, o app avisa antes de chegar lá. O aviso só informa e **nunca bloqueia a exportação**:

| Tamanho do backup | O que aparece |
|---|---|
| abaixo de 24 MB (80%) | nada (comportamento de sempre) |
| a partir de 24 MB | alerta: perto do limite de 30 MB que a restauração aceita |
| a partir de 27 MB (90%) | alerta forte: muito perto do limite, procure o suporte |
| 30 MB ou mais | o backup **ultrapassou o limite** da restauração e não pode ser restaurado por este aplicativo |

O aviso aparece em **Dados e backup** e em **Manutenção** (pela última cópia do aparelho, e de novo depois de exportar),
além de **Diagnóstico › Tamanho do backup**. Desde a 11.3.2, o tamanho medido é o do **arquivo, em bytes UTF-8 reais**
(cada acento ocupa 2 bytes): o tamanho informado ao exportar é o do arquivo baixado, e o do backup completo é o do
`data/backup.salaobackup` dentro do ZIP. Cada cópia nova do aparelho grava `bytes` junto de `tamanho`; as cópias criadas
antes da 11.3.2 não têm `bytes` e usam o `tamanho` (caracteres) até serem substituídas. As listas de cópias mostram o
tamanho em KB pelo mesmo critério. Bytes nunca são menos que caracteres, então o aviso cobre os dois caminhos da
restauração (arquivo: bytes; cópia do aparelho: caracteres). **A retenção das cópias continua por `tamanho`**, sem mudança.
