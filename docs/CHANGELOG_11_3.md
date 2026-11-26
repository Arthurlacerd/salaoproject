# Salão.gestão 11.3.0 — Restauração Segura

**Tipo:** evolução do backup e da restauração. Não há redesign nem CSS novo.
**Banco:** IndexedDB `salao_gestao`, versão nativa **1**, schema **2**. Sem mudança e sem migration nova.
**Formato `.salaobackup`:** v1, sem mudança. Os backups normais continuam com exatamente os mesmos campos e são legíveis
pela 11.2. Um backup de **estado inconsistente** recebe dois campos informativos no cabeçalho, fora do checksum e ignorados
pela 11.2 (veja D3).
**Service worker e identidade do PWA:** sem mudança. Só a lista de cache e os hashes mudam, via build.
**9.x:** nada foi implementado. A compatibilidade **não foi verificada**, e as telas agora dizem isso.

## O que mudou para quem usa

- **Restaurar é seguro.** O arquivo é verificado por completo antes de qualquer gravação. Todos os problemas aparecem de
  uma vez, com mensagens claras. A troca dos dados acontece de uma só vez e, se algo falhar, nada muda.
- **Um backup não deixa mais ninguém trancado do lado de fora.** Se o backup traz usuários, é preciso informar o usuário e
  a senha de um administrador **do próprio backup**. A senha é conferida no arquivo, antes de qualquer alteração. Backups
  sem administrador ativo, com usuários inválidos ou com senha em formato não suportado são recusados.
- **Restaurar exige login de administrador** sempre que o aparelho tem usuários, mesmo que nenhum administrador consiga
  entrar. Sem login, só em aparelho sem nenhum usuário (primeiro acesso ou dados perdidos), e o backup precisa trazer
  usuários.
- **Desfazer a última restauração**, em Dados e backup ou na tela de login. Sem login, só funciona enquanto ninguém entrou
  depois da restauração. Não mostra nem baixa dados. Com ou sem login, **nunca volta para um estado sem administrador** que
  consiga entrar: por isso, a restauração feita no primeiro acesso não pode ser desfeita.
- **Validação mais rigorosa:** datas precisam existir no calendário, ids vão até 2.147.483.647 e todo pagamento precisa ter
  a forma de pagamento. Os backups gerados pelo app (10.1 a 11.3) já seguem essas regras.
- **Cópia do estado atual antes de restaurar** (recomendada, não obrigatória), oferecida na prévia a quem está logado.
- **Dados inconsistentes não travam mais o app.** Antes, eles bloqueavam exportar, "Atualizar agora" e até restaurar um
  backup bom. Agora a cópia é gerada e marcada como "apenas para recuperação/análise".

## Decisões aprovadas e como foram implementadas

| # | Decisão | Implementação |
|---|---|---|
| D1 | Com usuários no aparelho, restaurar exige um administrador autenticado | `restauracao.restaurar()` recusa (`NAO_AUTORIZADO`) sempre que o aparelho tem algum usuário e não há sessão de administrador, **mesmo que nenhum administrador consiga entrar** (correção A2). Sem login, só em aparelho sem nenhum usuário. A tela de login não tem link de restauração nem o aviso "sem-admin". `#/restaurar` sem login só abre em aparelho sem usuários. |
| D2 | Estado atual inconsistente não impede restaurar um backup válido | A cópia antes da restauração guarda o estado **como está**, marcada `inconsistente`. "Desfazer" o devolve exatamente assim. |
| D3 | Exportar estado inconsistente continua possível, mas marcado | O arquivo recebe `estado_dados: "inconsistente"` e `aviso: "Este backup representa um estado atualmente inconsistente e deve ser utilizado apenas para recuperação/análise."` no cabeçalho, o nome termina em `-INCONSISTENTE`, o checksum continua verificável, o arquivo não conta como "último backup baixado" e a restauração normal o recusa. |
| D4 | Prova de acesso antes de substituir usuários | O usuário e a senha de um admin ativo **do backup** são conferidos contra o hash do próprio arquivo antes de qualquer gravação (`PROVA_NECESSARIA` / `PROVA_FALHOU`). |
| D5 | Cópia de emergência recomendada, não obrigatória | Botão "Baixar cópia do estado atual" na prévia, só com login. Não grava nada, nem auditoria. Sem login não há download. |
| D6 | Política de retenção da 11.2 mantida | A cópia recém-criada e a última de cada tipo de segurança nunca são removidas. Não há política paralela. |
| D7 | Versão 11.3.0 | O comportamento do PWA muda (regras de aceitação, autorização, desfazer, cópia de emergência), sem mudar formato nem banco. |

## Garantias da restauração (em ordem)

1. **Validar tudo antes de gravar** (`validacao_backup.js`):
   - tamanho, antes de ler o arquivo;
   - JSON;
   - formato detectado;
   - cabeçalho: `formato`, `versao_formato`, `sistema`, versões de banco e schema não futuras, `sha256`;
   - integridade (SHA-256 canônico);
   - tabelas permitidas e obrigatórias;
   - campos obrigatórios e tipos de **todas** as tabelas, além das listas fechadas;
   - ids únicos;
   - relacionamentos (atendimento → cliente, pagamento → atendimento, atendimento → serviço);
   - usuários;
   - regras de acesso.
2. **Validar de novo dentro da restauração.** Um objeto "aprovado" vindo de fora nunca é aceito sem nova análise.
3. **Autorização (D1) e prova de acesso (D4).**
4. **Nunca sem administrador:** nem a restauração nem o desfazer deixam o aparelho sem um administrador que consiga entrar.
   Sem ele, o app voltaria ao "primeiro acesso" e qualquer pessoa criaria um administrador com acesso aos dados e às cópias.
5. **Cópia antes da restauração**, independente e verificada por releitura. Se ela falhar, nada é alterado.
6. **Uma única transação** do IndexedDB, que limpa e grava as tabelas e registra a auditoria.
7. **Conferência DENTRO da transação, antes do commit:**
   - contagens;
   - administrador que consiga entrar, também quando os usuários do aparelho são mantidos;
   - configurações;
   - na restauração sem login, que o aparelho continua sem usuários.

   Qualquer divergência ou erro **aborta** a transação e o IndexedDB mantém o estado anterior.
8. **Durabilidade `strict`** é pedida quando o navegador oferece. A correção **não depende dela**: as garantias acima
   valem do mesmo jeito.
9. **Recuperação:** "Desfazer a última restauração", pelo mesmo caminho atômico. O desfazer também pode ser desfeito.

## `senha_hash`

- O formato não mudou: `pbkdf2$<iterações>$<sal base64>$<hash base64>`, com PBKDF2-HMAC-SHA-256, sal de 16 bytes e hash
  de 32 bytes.
- **A validação de backups agora é completa:**
  - 4 campos;
  - algoritmo literal `pbkdf2`;
  - iterações em inteiro decimal entre **100.000 e 1.000.000** (o app usa 150.000);
  - sal e hash em base64 canônico com 16 e 32 bytes.
- Hexadecimal, SHA-512, Werkzeug (`pbkdf2:sha256:…`), scrypt, campos a mais ou a menos e base64 inválido são recusados,
  com "o backup contém um formato de senha não suportado por esta versão".
- **O login não mudou para quem já está no aparelho:** aceita exatamente os hashes que a 11.2 aceitava. Só deixou de
  lançar erro técnico com hash ilegível (agora responde "senha incorreta"). Nenhum hash foi migrado.

## Usuários

- `usuario` precisa estar exatamente como o login o encontra: sem espaços nas pontas e em minúsculas. **Nada é
  convertido**; um nome fora dessa regra é recusado.
- `nome` precisa estar preenchido, `perfil` ∈ {`admin`, `recepcao`, `funcionario`} e `ativo` ∈ {0, 1}.
- Ids e nomes de usuário não podem se repetir, e o campo `senha` é proibido.
- Precisa haver pelo menos 1 admin ativo com senha válida. `usuarios: []` é recusado.
- Um backup **sem** tabela de usuários mantém os do aparelho e só é aceito com um administrador conectado. No primeiro
  acesso (aparelho sem usuários) ele é recusado, porque deixaria os dados sem nenhum administrador: crie primeiro o
  administrador e restaure já conectado.

## Mensagens

Cada problema tem um código e um texto próprio. As mensagens citam tabela, posição, id numérico e nome do campo,
**nunca o conteúdo** (nomes, telefones, senhas, valores). Exemplos:
- "O campo “versao_formato” do arquivo está ausente ou inválido…": antes, dizia "versão mais nova";
- "O arquivo não tem checksum (sha256)…";
- "O arquivo foi alterado ou está corrompido: o checksum SHA-256 não confere.";
- "O backup contém dados de usuário incompatíveis com esta versão…";
- "O backup contém um formato de senha não suportado por esta versão…".

## Preparação para a 9.x (sem implementar)

`formatos_backup.js` tem um registro de adaptadores. Cada um traz detecção, cabeçalho, integridade e normalização
próprios, seguidos da validação comum e da restauração. Hoje existe só o adaptador `salaobackup-v1`. Um futuro
`adaptador_9x` entra no registro **somente com evidência real** (código-fonte ou backup 9.x), sem mexer no importador
moderno. Os textos "Compatível com 9.0/9.x" foram substituídos por "compatibilidade não verificada".

## Correções encontradas durante a implementação

- **Desfazer sem login depois de um login.** O desfazer sem login continuava valendo depois de alguém entrar, quando o
  login acontecia no mesmo segundo registrado no backup. Agora, entrar encerra explicitamente o desfazer sem login, e a
  conferência por checksum continua como segunda barreira.
- **Tabela desconhecida escondia problemas.** Ela interrompia a análise; agora todos os problemas são listados.
- **Avisos quebrados em colunas.** Os avisos com texto e negrito misturados se dividiam em colunas no celular, e na prévia
  o botão da cópia ficava fora do aviso. O conteúdo agora vai num único bloco, só na marcação e sem CSS novo. O aviso de
  "restauração bloqueada" já tinha esse defeito na 11.2.

## Correções da revisão final do PR #3 (antes do merge)

A revisão final do commit `414bb7a` encontrou duas falhas de segurança e três problemas médios. Todos foram confirmados e
corrigidos. Cada teste novo **falha no código anterior** e passa no corrigido.

| # | Problema | Correção |
|---|---|---|
| A1 | **Desfazer podia devolver o aparelho a um estado sem administrador.** Exemplo: uma restauração feita no primeiro acesso, desfeita sem login, deixava zero usuários. Aí qualquer pessoa criava o "primeiro" administrador e baixava, em Dados e backup, as cópias guardadas com os dados e os hashes de senha. | O desfazer confere, **com e sem login**, se o estado recuperado tem um administrador que consiga entrar. Senão, recusa com `DESFAZER_SEM_ADMIN` e nada muda. A transação confere isso de novo antes do commit. A tela mostra o motivo e não exibe o formulário. A tela de login só oferece "Desfazer" quando ele é possível. |
| A2 | **Restauração sem login em aparelho com usuários.** Bastava que nenhum administrador conseguisse entrar (todos inativos, senha ilegível) para restaurar sem login um backup qualquer, virar administrador e ler, na cópia, os dados anteriores. | Sem login, só com **zero usuários**. Com qualquer usuário, restaurar exige um administrador autenticado (`NAO_AUTORIZADO`). O aviso "sem-admin" e o link da tela de login foram removidos, sem rota equivalente. Um backup sem usuários no primeiro acesso também é recusado (`SEM_ACESSO_RESULTANTE`), pela mesma razão do A1. |
| M1 | Pagamento sem `forma_pagamento` era aceito e aparecia como "undefined" no painel e no financeiro. | O campo passou a ser obrigatório e não pode ficar vazio. Evidência: os três pontos que gravam pagamentos sempre gravam a forma (formulário de lançamento, agendamento com valor recebido e "receber saldo"). `financeiro.js`, `agenda.js` e o formulário são idênticos da 10.1 à 11.2, e o teste de compatibilidade gera pagamentos pelos três caminhos com o código real de cada versão. |
| M2 | Um id `9007199254740991` era aceito. Depois, o segundo registro novo falhava com "Maximum key generator value reached". | Ids aceitos vão de 1 a **2.147.483.647** (2^31 − 1). Ids acima disso são recusados antes de gravar. O app gera ids a partir de 1, de 1 em 1. O teste restaura o maior id aceito e cria registros novos em seguida. |
| M3 | Datas impossíveis como "2026-02-31" e "0000-00-00" eram aceitas. | A data precisa existir no calendário, com ano bissexto pela regra gregoriana. Todas as telas gravam datas por campos `type="date"`, e a importação de CSV já conferia o calendário, então o app não produz datas impossíveis. |

Nenhuma garantia anterior foi alterada:
- validação completa antes da primeira gravação;
- checksum;
- prova de acesso antes de substituir os usuários;
- transação única com conferência e reversão;
- preservação do estado anterior;
- cópia antes da restauração;
- retenção da 11.2.

Nenhum teste existente foi removido ou enfraquecido. Dois testes mudaram de expectativa, e os dois ficaram **mais
rígidos**:
- "aparelho sem administrador que consiga entrar": antes restaurava sem login; agora é recusado;
- "backup sem usuários": agora também é recusado no primeiro acesso, e há o caso com administrador conectado.

## Decisão de produto pendente: aparelho com usuários e sem administrador que consiga entrar

Exemplos: a senha do único administrador foi esquecida, ou os administradores ficaram inativos ou com senha ilegível em
versões anteriores.

**Na 11.3 não há recuperação sem login para esse aparelho, de propósito.** Qualquer caminho sem autenticação que
substitua os dados permitiria a quem pegasse o aparelho virar administrador e ler as cópias guardadas (A2).

Caminhos que continuam disponíveis:
- **"Desfazer a última restauração":** quando uma restauração causou o problema, nada mudou desde então e o estado
  anterior tem um administrador;
- **último recurso, com backup externo:** limpar os dados do site e restaurar um `.salaobackup` com usuários no primeiro
  acesso. Os dados locais que não estiverem num backup se perdem.

Pelos fluxos da 11.3, o aparelho não chega a esse estado sozinho:
- um administrador não pode desativar a si mesmo;
- restaurar e desfazer sempre mantêm um administrador.

O caso realista é a senha esquecida. Uma recuperação controlada (por exemplo, um código de recuperação gerado no primeiro
acesso e mostrado uma única vez) é uma **decisão de produto ainda não tomada**: não foi implementada.

## Testes

| Conjunto | Executados | Aprovados | Falhas | Ignorados |
|---|---|---|---|---|
| Build (`--verificar`) | 1 | 1 | 0 | 0 |
| Unitários | 96 | 95 | 0 | 1 (sem fixture 9.x real) |
| Integração em Chromium | 58 | 58 | 0 | 0 |

**Destaques da integração:**
- **Inválido → recusado → estado intacto:** 18 tipos de problema (incluindo M1, M2 e M3), com impressão digital do
  estado igual antes e depois, objeto forjado também revalidado e login preservado.
- **Requisito 11:** `pbkdf2$` com interior inválido é recusado pela tela e pela função antes de substituir os usuários.
- **Falha simulada** no meio da gravação e ao gravar a cópia.
- **Decisões:** D2, D3, D4 e D5.
- **D1/A2:**
  - com administrador, sem login e com uma recepcionista conectada: recusado;
  - com usuários e sem administrador que consiga entrar (inativos ou senha ilegível): recusado;
  - no primeiro acesso: permitido;
  - backup sem usuários: recusado no primeiro acesso e aceito com administrador conectado.
- **Desfazer** com e sem login.
- **A1:** o desfazer da restauração de primeiro acesso é recusado, sem e com login, e criar outro administrador é
  impossível. Uma cópia sem administrador utilizável (inativo, senha ilegível, sem usuários) também é recusada, assim como
  uma cópia danificada; a tela mostra o motivo e não exibe o formulário.
- **M2:** um id acima do limite é recusado antes de gravar; o maior id aceito restaura e o aparelho continua criando
  registros.
- **Compatibilidade obrigatória:** backups gerados pelo código real de **10.1.0, 11.0.0, 11.1.0 e 11.2.0** restauram com
  tabelas idênticas e login funcionando. Os pagamentos desses backups saem dos três pontos que gravam pagamentos.
- **Atualização real:** **11.2.0 → 11.3.0** (produção) e 11.1.0 → 11.3.0.
- **Responsivo:** 9 larguras, 12 telas cada, mais a prévia da restauração.

## Medidas

Medidas em servidor local e Chromium desktop: servem para comparar versões.

| Medida | 11.2.0 | 11.3.0 |
|---|---|---|
| Arquivos do app (cache) | 30 | 35 (+5 módulos: `senha`, `formatos_backup`, `esquema_backup`, `validacao_backup`, `restauracao`) |
| Tamanho total do app | 470 KB | 513,8 KB (+43,8 KB) |
| Requisições da página na 1ª abertura | 24 | 29 |
| Atualização pela tela (11.2.0 → 11.3.0, com backup antes) | — | ~1,2 s |

## Riscos residuais

- **Backups da 10.0:** não estão no histórico do git e não foram testados. Os módulos que gravam dados são idênticos da
  10.1 à 11.2, mas a 10.0 não é evidência disponível.
- **Backups de 10.1–11.2 com dados fora das regras:** dados importados de arquivos estranhos na 11.2 ou antes passam a ser
  recusados pela restauração, com o motivo. O aparelho em si continua funcionando, e a cópia/exportação continua possível
  (marcada).
- **Aparelho com usuários e sem administrador que consiga entrar** (ex.: senha esquecida): sem recuperação dentro do app
  (veja "Decisão de produto pendente").
- **A restauração feita no primeiro acesso não pode ser desfeita** (o estado anterior não tem administrador). Para trocar
  o backup, entre com o administrador do backup e restaure outro.
- **Desfazer sem login:** permite reverter a última restauração enquanto ninguém entrou. É reversível, não expõe dados e
  nunca deixa o aparelho sem administrador.
- **Aparelho que já está com dados e sem nenhum usuário:** a 11.2 podia deixar esse estado ao importar um backup com
  `usuarios: []`. Ele continua aberto a quem criar o primeiro administrador, como em todas as versões. A 11.3 não produz
  mais esse estado.
- **Voltar para a 11.2 reabre a restauração sem login.** Depois de atualizar, a 11.2 continua guardada e é compatível
  (mesmo banco e schema). Enquanto um administrador a mantiver fixada em "Voltar para esta versão", roda o código da 11.2,
  que restaurava sem login mesmo com usuários no aparelho. Só um administrador fixa a versão, e `?recuperar=1` desfaz.
  Impedir o retorno para versões anteriores à 11.3 mudaria o retorno de versão da 11.2: é uma decisão de produto pendente.
- **Desfazer sem login devolve o acesso ao administrador anterior à restauração.** Esse administrador passa a ver as
  cópias, inclusive a do estado restaurado. É assim desde o desenho aprovado (D1). Só afeta quem sabe a senha daquele
  administrador, e a restauração foi feita com essa mesma conta. Exigir login para desfazer quando os usuários foram
  substituídos seria decisão de produto.
- **Gerador de chaves já alto:** um aparelho que recebeu um id enorme na 11.2 (só com backup forjado) mantém o gerador do
  IndexedDB alto mesmo depois de restaurar ids normais. Só recriar a tabela resolveria, o que exige migration (fora do
  escopo).
- **Durabilidade física:** depende do navegador. A correção não depende dela (veja "Garantias").
- **9.x:** não suportado nem comprovado. Exige fixture real (veja `tests/fixtures/LEIA-ME.md`).
