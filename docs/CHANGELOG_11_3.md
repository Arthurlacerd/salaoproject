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
- **Restaurar exige login de administrador** quando o aparelho já tem administradores. Sem login, só no primeiro acesso,
  quando os dados foram perdidos ou quando nenhum administrador consegue entrar.
- **Desfazer a última restauração**, em Dados e backup ou na tela de login. Sem login, só funciona enquanto ninguém entrou
  depois da restauração. Não mostra nem baixa dados.
- **Cópia do estado atual antes de restaurar** (recomendada, não obrigatória), oferecida na prévia a quem está logado.
- **Dados inconsistentes não travam mais o app.** Antes, eles bloqueavam exportar, "Atualizar agora" e até restaurar um
  backup bom. Agora a cópia é gerada e marcada como "apenas para recuperação/análise".

## Decisões aprovadas e como foram implementadas

| # | Decisão | Implementação |
|---|---|---|
| D1 | Com usuários no aparelho, restaurar exige um administrador autenticado | `restauracao.restaurar()` recusa (`NAO_AUTORIZADO`) se houver um administrador utilizável sem sessão de admin. A tela de login não tem mais o link de restauração. `#/restaurar` sem login só abre em aparelho sem administrador utilizável. |
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
4. **Cópia antes da restauração**, independente e verificada por releitura. Se ela falhar, nada é alterado.
5. **Uma única transação** do IndexedDB, que limpa e grava as tabelas e registra a auditoria.
6. **Conferência DENTRO da transação, antes do commit:** contagens, administrador ativo e configurações. Qualquer
   divergência ou erro **aborta** a transação e o IndexedDB mantém o estado anterior.
7. **Durabilidade `strict`** é pedida quando o navegador oferece. A correção **não depende dela**: as garantias acima
   valem do mesmo jeito.
8. **Recuperação:** "Desfazer a última restauração", pelo mesmo caminho atômico. O desfazer também pode ser desfeito.

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
- Um backup **sem** tabela de usuários mantém os do aparelho. Ele é recusado se o aparelho não tiver nenhum administrador
  utilizável, porque a restauração não devolveria o acesso.

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

## Testes

| Conjunto | Executados | Aprovados | Falhas | Ignorados |
|---|---|---|---|---|
| Build (`--verificar`) | 1 | 1 | 0 | 0 |
| Unitários | 93 | 92 | 0 | 1 (sem fixture 9.x real) |
| Integração em Chromium | 54 | 54 | 0 | 0 |

**Destaques da integração:**
- **Inválido → recusado → estado intacto:** 14 tipos de problema, com impressão digital do estado igual antes e depois,
  objeto forjado também revalidado e login preservado.
- **Requisito 11:** `pbkdf2$` com interior inválido é recusado pela tela e pela função antes de substituir os usuários.
- **Falha simulada** no meio da gravação e ao gravar a cópia.
- **Decisões:** D1 (3 cenários), D2, D3, D4 e D5.
- **Desfazer** com e sem login.
- **Compatibilidade obrigatória:** backups gerados pelo código real de **10.1.0, 11.0.0, 11.1.0 e 11.2.0** restauram com
  tabelas idênticas e login funcionando.
- **Atualização real:** **11.2.0 → 11.3.0** (produção) e 11.1.0 → 11.3.0.
- **Responsivo:** 9 larguras, 12 telas cada, mais a prévia da restauração.

## Medidas

Medidas em servidor local e Chromium desktop: servem para comparar versões.

| Medida | 11.2.0 | 11.3.0 |
|---|---|---|
| Arquivos do app (cache) | 30 | 35 (+5 módulos: `senha`, `formatos_backup`, `esquema_backup`, `validacao_backup`, `restauracao`) |
| Tamanho total do app | 470 KB | 509,6 KB (+39,6 KB) |
| Requisições da página na 1ª abertura | 24 | 29 |
| Atualização pela tela (11.2.0 → 11.3.0, com backup antes) | — | ~1,2 s |

## Riscos residuais

- **Backups da 10.0:** não estão no histórico do git e não foram testados. Os módulos que gravam dados são idênticos da
  10.1 à 11.2, mas a 10.0 não é evidência disponível.
- **Backups de 10.1–11.2 com dados fora das regras:** dados importados de arquivos estranhos na 11.2 ou antes passam a ser
  recusados pela restauração, com o motivo. O aparelho em si continua funcionando, e a cópia/exportação continua possível
  (marcada).
- **Restauração sem login em aparelho sem administrador utilizável** (primeiro acesso, dados perdidos, todos os admins
  inativos): continua possível por desenho (D1), para não impedir a recuperação.
- **Desfazer sem login:** permite reverter a última restauração enquanto ninguém entrou. É reversível e não expõe dados.
- **Durabilidade física:** depende do navegador. A correção não depende dela (veja "Garantias").
- **9.x:** não suportado nem comprovado. Exige fixture real (veja `tests/fixtures/LEIA-ME.md`).
