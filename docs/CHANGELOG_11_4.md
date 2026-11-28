# Salão.gestão 11.4.0 — Segurança e integridade

**Tipo:** correções de segurança, integridade de dados e desempenho, com escopo aprovado a partir da auditoria pós-11.3.2.
Não há redesign nem CSS novo.
**Banco:** IndexedDB `salao_gestao`, versão nativa **1**, schema **2**. Sem mudança, sem migration e sem índice novo.
**Formato `.salaobackup`:** v1, sem mudança (mesmos campos, mesmo checksum). **Limite da restauração (30 MB):** sem mudança.
**`restauracao.js`, `validacao_backup.js`, service worker e manifest:** sem mudança. Só a lista de cache e os hashes mudam,
via build.
**Retorno de versão:** a versão mínima segura continua **11.3.0**. Voltar para 11.3.2, 11.3.1 e 11.3.0 é permitido e testado.

## O que mudou para quem usa

1. **Links adulterados não executam código.** Os parâmetros dos endereços do app (por exemplo `#/agenda?modo=…`) são
   conferidos pelo tipo esperado e, se não servirem, viram o valor padrão. Antes, um link montado de propósito podia
   executar código no aplicativo (inclusive depois do login).
2. **Datas: uma única regra antes de gravar.** Agendamento, pagamento, estorno, "receber saldo", despesa, aniversário e a
   importação de clientes por CSV usam a mesma regra do backup: dia, mês e ano com 4 dígitos, dia que existe no
   calendário. Datas como 31/02, 31/04, 29/02 fora de ano bissexto ou com ano de 5 dígitos (um erro de digitação no campo
   de data do navegador) são recusadas com uma mensagem clara. Os campos de data têm limites: 2000 a 2100 para agenda,
   lançamentos e despesas; 1900 até hoje para aniversário. A faixa só vale para datas informadas ou alteradas: um valor
   antigo válido não impede editar o resto do registro.
3. **CSV sem depender do fuso.** O mesmo arquivo dá o mesmo resultado em qualquer fuso horário. Antes, a leste de UTC
   (ex.: Lisboa no verão, Tóquio) aniversários válidos eram recusados.
4. **Integridade dos dados.** Registros antigos com data inválida são localizados com a mesma validação do backup e
   listados para o administrador (Dados e backup › aviso › Revisar registros, ou Diagnóstico). **Nada é corrigido
   automaticamente**: atendimento e despesa abrem a edição já existente; aniversário e lançamento (recebimento ou estorno)
   têm a ação **Corrigir data**, com confirmação e registro na auditoria (valor anterior e novo). As referências mostradas
   (data em que o lançamento foi registrado, data do atendimento) nunca são aplicadas sozinhas. Valor e tipo de um
   lançamento não mudam, e lançamentos com data válida continuam sem edição.
5. **Backup inconsistente nunca fica escondido.** A exportação continua possível (marcada como `-INCONSISTENTE`), mas a
   tela Dados mostra um aviso fixo — que não some quando a tela é redesenhada — com o motivo, a quantidade, o caminho para
   a revisão e a data da última cópia restaurável. O Diagnóstico ganhou o item **Integridade dos dados** (só contagens,
   nenhum dado pessoal).
6. **A última cópia restaurável é preservada.** A limpeza automática das cópias do aparelho nunca apaga a última cópia
   consistente. Antes, com os dados inconsistentes, ela sumia em 5 dias (8 MB por cópia) ou 2 dias (24 MB). Sem cópias
   inconsistentes, a limpeza é idêntica à anterior; o limite de 40 MB não mudou.
7. **Mais rápido com muitos dados**, sem mudar o que é mostrado: Hoje, Clientes, a busca de clientes e o formulário de
   agendamento não comparam mais cada cliente com cada atendimento; contagens e leituras por período/atendimento usam os
   índices que já existiam.

## Detalhes técnicos

- `js/data/datas.js` (novo): `dataValida`, `validarData` (faixas), `paraInterna` (CSV), `sugestaoSemPerda`. Sem
  `Date.parse`/`toISOString`; nada é normalizado. `esquema_backup.js` passa a usar `dataValida` (mesma regra da 11.3.2,
  comprovada por teste de equivalência sobre todas as combinações de mês e dia de vários anos).
- Gravação: `Ag.validar`/`Ag.salvar`, `Fin.registrar` (todos os caminhos de pagamento), `Fin.salvarDespesa`,
  `Cli.validar`/`Cli.salvar`, `analisarCSV`/`importarClientes`.
- URL: `PARAM`, `lerParametros` e `parametrosPeriodo` (`util.js`) nas rotas painel, agenda, novo agendamento, clientes,
  financeiro, despesas e auditoria; valores também escapados onde entram no HTML (inclusive no subtítulo de `cab()`, cujo
  comportamento global não mudou).
- Integridade: `js/data/integridade.js` (novo, só leitura), `Fin.corrigirDataLancamento`, `Cli.corrigirNascimento`,
  `registrarIntegridade`/`integridadeConhecida`/`ultimaCopiaRestauravel` (`backup.js`), rota `#/integridade`.
- Retenção: `politicaRetencao` recebe também `inconsistente` e protege a última cópia consistente.
- Leituras: `Cli.montarLista`/`agruparPorCliente` (O(C+A)), `Cli.listarNomes`, `contar` e `lerPorIndice`
  (`database.js`, só leitura), `Ag.obter` por id, `Ag.listar`/`Ag.livres` pelo índice `data`, `Fin.pagamentosDe` pelo
  índice `atendimento_id`.

## Fora desta versão (backlog 11.5+)

Perda de texto não salvo quando a atualização é aplicada em outra aba; cliente gravada quando o agendamento com "nova
cliente" é recusado por conflito; guarda contra envio programático repetido; testes de navegador no CI; operações
compostas não atômicas; custo da cópia diária com muitos dados; CSP (depois de remover os handlers inline); leitura
completa da auditoria no detalhe do atendimento (exigiria índice novo); sessão aberta de usuário desativado; alvos de toque
menores que 24 px; mensagem técnica em inglês em falhas de leitura.
