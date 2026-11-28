// 11.4 — Integridade dos dados: localiza os registros que tornam o backup "inconsistente", usando EXATAMENTE a validação
// do backup (montar + analisarDoc). Não existe uma segunda regra aqui. Nada é gravado nem corrigido por este módulo:
// a correção é sempre uma ação explícita do administrador (financeiro.corrigirDataLancamento, clientes.corrigirNascimento
// ou as telas de edição já existentes de atendimento e despesa).
import { obter } from "./database.js";
import { exigir } from "./permissoes.js";
import { montar, ehProblemaDeData, registrarIntegridade } from "./backup.js";
import { analisarDoc, mensagem } from "./validacao_backup.js";
import { sugestaoSemPerda } from "./datas.js";

/** Conferência completa (sob demanda). Devolve { consistente, datas: [registro com data inválida], outros: [mensagem] }. */
export async function verificar() {
  exigir("dados.gerir");
  const doc = await montar(), rel = await analisarDoc(doc, { finalidade: "copia" }); registrarIntegridade(rel);
  const datas = [], outros = rel.problemas.filter((p) => !ehProblemaDeData(p)).map(mensagem);
  for (const p of rel.problemas.filter(ehProblemaDeData)) {
    const r = Number.isSafeInteger(p.id) ? await obter(p.tabela, p.id) : null, valor = r ? r[p.campo] : undefined;
    const it = { tabela: p.tabela, id: p.id ?? null, n: p.n, campo: p.campo, valor: valor === undefined ? null : valor, sugestao: sugestaoSemPerda(valor), existe: !!r };
    if (r && p.tabela === "clientes") it.descricao = r.nome;
    if (r && p.tabela === "despesas") Object.assign(it, { descricao: r.descricao, valor_centavos: r.valor_centavos });
    if (r && p.tabela === "atendimentos") { const c = await obter("clientes", r.cliente_id); Object.assign(it, { descricao: `${r.servico} · ${r.horario_agendado}`, cliente: c?.nome || "(cliente removida)" }); }
    if (r && p.tabela === "pagamentos") { const a = await obter("atendimentos", r.atendimento_id), c = a ? await obter("clientes", a.cliente_id) : null;
      Object.assign(it, { tipo: r.tipo, valor_centavos: r.valor_centavos, criado_em: r.criado_em || null, atendimento_id: r.atendimento_id, data_atendimento: a?.data ?? null, cliente: c?.nome || null }); }
    datas.push(it);
  }
  return { consistente: rel.ok, datas, outros };
}
