# Salão.gestão 11.3.1 — Correções de dados, backup, feedback e datas

**Tipo:** correções pontuais. Não há funcionalidade estrutural nova, redesign nem CSS novo.
**Banco:** IndexedDB `salao_gestao`, versão nativa **1**, schema **2**. Sem mudança e sem migration.
**Formato `.salaobackup`:** v1, sem mudança: mesmos campos, mesmo checksum, mesma estrutura. As datas gravadas também não
mudam, nem no banco nem no backup.
**Service worker:** `sw.js` idêntico ao da 11.3.0. Só a lista de cache e os hashes mudam, via build (entra o arquivo novo
`js/data/tamanho_backup.js`). **Manifest e identidade do PWA:** sem mudança.
**Restauração segura (`restauracao.js`) e limite de 30 MB:** sem mudança.
**Retorno de versão:** a versão mínima segura continua **11.3.0**. Voltar da 11.3.1 para a 11.3.0 é permitido (e testado).

## O que mudou para quem usa

1. **Valores com ponto de milhar.** Antes, "1.500" era gravado como R$ 1,50. Agora é R$ 1.500,00, nos formulários de
   atendimento (valor e valor já recebido), recebimento, estorno, serviço e despesa.

   | Digitado | Antes | Agora |
   |---|---|---|
   | `1.500` | R$ 1,50 | **R$ 1.500,00** |
   | `2.000` | R$ 2,00 | **R$ 2.000,00** |
   | `10.000` | R$ 10,00 | **R$ 10.000,00** |
   | `1.500,00` | R$ 1.500,00 | R$ 1.500,00 |
   | `1500` | R$ 1.500,00 | R$ 1.500,00 |
   | `1.500,50` | R$ 1.500,50 | R$ 1.500,50 |
   | `12.50` / `1.5` (ponto com 1 ou 2 casas) | R$ 12,50 / R$ 1,50 | sem mudança |
   | `1,234`, `1.2345`, `-10` (inválidos) | recusado | recusado |

   Os valores **já gravados não são alterados**. Se algum foi gravado errado antes (ex.: R$ 1,50 no lugar de
   R$ 1.500,00), corrija editando o registro.
2. **Aviso de tamanho do backup.** A restauração aceita backups de até **30 MB**. O app avisa a partir de 24 MB (80%),
   com um alerta forte a partir de 27 MB. A partir de 30 MB, diz claramente que o backup ultrapassou o limite e não pode
   ser restaurado por este aplicativo. O aviso aparece em Dados e backup, em Manutenção (também logo depois de exportar)
   e em Diagnóstico › Tamanho do backup. **Só informa:** a exportação nunca é bloqueada. Abaixo de 24 MB, nada muda. A
   maior causa do crescimento é o histórico de alterações (auditoria). Veja `docs/PWA_UPDATE_PROCESS.md` › 6.
3. **Falhas que eram silenciosas.** Exportar backup, Baixar cópia (Dados e Manutenção) e Importar CSV agora mostram uma
   mensagem clara quando algo falha, e a falha é registrada no console. Nada é alterado e o botão volta a funcionar.
   Uma cópia que não existe mais não gera um arquivo "undefined": aparece a mensagem.
4. **Entrar mostra o andamento.** O botão fica desabilitado e mostra "Entrando… preparando a cópia do dia". Um segundo
   toque ou Enter não faz nada. Em caso de erro (ex.: senha errada), o botão volta com a mensagem. Ao reabrir o app com a
   sessão ativa, aparece "Entrando…" com a mesma mensagem, em vez de uma tela em branco. A cópia do dia continua sendo
   criada **antes** de abrir os dados, na mesma ordem e sem atraso.
5. **Versões em Manutenção.** Só as versões permitidas mostram **Voltar para esta**. As que não podem ser usadas para
   retorno seguro (anteriores à 11.3.0 ou incompatíveis com o banco) aparecem com o motivo e sem botão. O retorno para a
   11.3.0 continua disponível, e `?recuperar=1` continua funcionando.
6. **"Gerado em" na hora local.** A prévia da restauração mostrava o horário em UTC (3 horas adiantado em São Paulo).
   Agora mostra a hora local, ex.: `27/11/2026 17:58`. O arquivo continua igual.
7. **"Próximo atendimento" depois das 21h.** O próximo atendimento de hoje sumia do perfil das clientes depois das 21h,
   quando a data UTC já é o dia seguinte. Com isso, a cliente também aparecia como "sem visita" na tela Hoje. Agora a
   comparação usa a data local.

## Como foi implementado

| Item | Arquivos | O quê |
|---|---|---|
| 1 | `js/ui/util.js` | `parseMoeda`: ponto seguido de grupos de 3 dígitos é separador de milhar (com ou sem vírgula). O ponto decimal só vale com 1 ou 2 casas, então não há ambiguidade. As 5 telas já usavam `parseMoeda`. |
| 2 | `js/data/tamanho_backup.js` (novo), `js/data/diagnostico.js`, `js/data/manutencao.js`, `js/ui/views.js` | Limiares derivados de `LIMITE_BYTES` (não duplicados). Item `backup` no Diagnóstico, que só lê o tamanho e nenhum conteúdo. `backupCompleto()` também devolve `bytes`. O aviso depois de exportar aparece depois de redesenhar a tela, porque redesenhar limpa os avisos. |
| 3 | `js/ui/views.js` | `try/catch` local em cada ação, com mensagem, `console.error` e o botão reabilitado. Não há tratador global. |
| 4 | `js/app.js`, `js/data/backup.js` | `emAndamento()` nos formulários de entrar e de primeiro acesso. `backupAutomatico({ aoPreparar })` avisa a tela logo antes da cópia. É a única mudança em `backup.js`: parâmetro opcional, e uma falha da tela não impede a cópia. |
| 5 | `js/ui/views.js` | A lista usa `Man.podeVoltarPara()`, a mesma regra da página. O service worker não mudou e continua recusando por conta própria. |
| 6 | `js/ui/util.js`, `js/ui/views.js` | `dataHoraBackup()`: o `criado_em` das versões 10.1–11.3 (origem `pwa`, UTC sem "Z") é mostrado na hora local. Outras origens aparecem como estão. |
| 7 | `js/data/clientes.js` | `perfil()` compara com `hoje()` (data local), o mesmo formato em que as datas são gravadas. |

## O que não mudou

IndexedDB, schema, migrations, formato `.salaobackup`, checksum, `restauracao.js`, `validacao_backup.js`,
`esquema_backup.js`, `formatos_backup.js`, `database.js`, `migracoes.js`, `usuarios.js`, `senha.js`, `sw.js`, manifest,
limite de 30 MB, CSS, mecanismos de recuperação de administrador e a ordem de segurança ao entrar. Continuam a ordem
"encerrar desfazer sem login → configuração → cópia do dia → inatividade → abrir", a política de retenção e o formato das
datas gravadas.

## Testes

- **Unitários novos:** `valores.test.js`, `tamanho_backup.test.js` e `datas.test.js`. Este último roda no fuso
  America/Sao_Paulo.
- **Navegador (Chromium) novos:** `valores.test.js` (valores digitados nas 5 telas) e `feedback.test.js` (falhas,
  andamento ao entrar e ao reabrir, aviso de tamanho em 24 / ~28 / 31 MB, "Gerado em" e próximo atendimento às 21:10).
- **Atualização e retorno:** `atualizacao.test.js` agora também cobre a **11.3.0 real** (commit `1e7acea`). Cobre a
  atualização 11.3.0 → 11.3.1 pela interface e o retorno 11.3.1 → 11.3.0 **pela tela**, com dados preservados e
  consistentes na 11.3.0, depois "Usar a mais recente" e `?recuperar=1`. Para 11.1 e 11.2, o teste da tela confere que
  não há botão, que o motivo aparece e que a função de retorno continua recusando. Esse teste substitui o que clicava no
  botão, que deixou de existir para essas versões.
- **Compatibilidade de backups:** `compat_versoes.test.js` agora inclui backups gerados pela **11.3.0** (10.1, 11.0, 11.1,
  11.2 e 11.3.0).
- **Diagnóstico:** `pwa.test.js` exige o item novo `backup`, sem dados pessoais.

## Observações conhecidas (não corrigidas nesta versão)

- **Bytes × caracteres:** o aviso mede o texto do backup, como a restauração de uma cópia do aparelho. O arquivo baixado
  é ~0,7% maior em bytes, por causa dos acentos. Numa faixa estreita logo abaixo de 30 MB, o aviso pode dizer "muito
  perto do limite" quando o arquivo já passou. Nessa faixa o alerta já é o forte e recomenda o suporte. Medir os bytes
  exigiria mudar `backup.js` além do aprovado.
- **Mensagens de sucesso apagadas pelo redesenho:** "Backup gerado…" (Dados), "Backup criado e validado…" (Manutenção) e
  "N cliente(s) importado(s)" aparecem por um instante e somem, porque a tela é redesenhada logo em seguida. Isso já
  acontecia antes da 11.3.1 e não foi alterado. Só o aviso de tamanho passou a ser mostrado depois do redesenho.
- **Alerta pela última cópia do aparelho:** em Dados e Manutenção, o alerta fixo usa a última cópia do aparelho, criada
  uma vez por dia. O aviso logo depois de exportar usa o tamanho do arquivo exportado.
