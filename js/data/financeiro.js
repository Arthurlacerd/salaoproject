import { transacao, ler, agora, auditar, hoje } from "./database.js";
import { exigir } from "./permissoes.js";
export const FORMAS_DESP = ["Dinheiro", "Pix", "Débito", "Crédito", "Transferência", "Boleto", "Não informado"];
export const CATEGORIAS_DESP = ["Produtos e materiais", "Aluguel", "Água e energia", "Internet e telefone", "Manutenção", "Marketing", "Taxas e tarifas", "Equipamentos", "Outras despesas"];
export function statusPagamento(total, recebido, estorno, atual) {
  if (atual === "Cancelado" && recebido <= 0 && !estorno) return "Cancelado";
  if (recebido <= 0) return estorno ? "Estornado" : atual === "Não informado" ? "Não informado" : "Pendente";
  return total > 0 && recebido >= total ? "Pago" : "Parcial";
}
export async function recalcular(t, aid) { // dentro de uma transação que inclua atendimentos e pagamentos
  const a = await t.atendimentos.get(aid); const ps = await t.pagamentos.porIndice("atendimento_id", aid);
  const liq = ps.reduce((s, p) => s + (p.tipo === "recebimento" ? p.valor_centavos : -p.valor_centavos), 0);
  a.valor_recebido_centavos = Math.max(0, liq); a.status_pagamento = statusPagamento(a.valor_centavos, a.valor_recebido_centavos, ps.some((p) => p.tipo === "estorno"), a.status_pagamento);
  await t.atendimentos.salvar(a);
}
export async function registrar(t, aid, tipo, valor, forma, data, obs = "") {
  if (!["recebimento", "estorno"].includes(tipo)) throw new Error("Tipo de lançamento inválido.");
  if (!(valor > 0)) throw new Error("Informe um valor maior que zero.");
  const a = await t.atendimentos.get(aid); if (!a) throw new Error("Atendimento não encontrado.");
  const rec = a.valor_recebido_centavos || 0;
  if (tipo === "recebimento" && rec + valor > a.valor_centavos) throw new Error("O valor ultrapassa o que falta receber.");
  if (tipo === "estorno" && valor > rec) throw new Error("O estorno não pode ser maior que o valor recebido.");
  await t.pagamentos.adicionar({ atendimento_id: aid, tipo, valor_centavos: valor, forma_pagamento: forma, data, observacao: obs, criado_em: agora() });
  await recalcular(t, aid);
  await auditar(t, tipo === "estorno" ? "estorno" : "pagamento", "atendimento", aid, `${tipo === "estorno" ? "Estorno" : "Recebimento"} de ${(valor / 100).toFixed(2)} (${forma})`);
}
export async function registrarPagamento(aid, tipo, valor, forma, data, obs) {
  exigir("pagamentos.gravar");
  return transacao(["atendimentos", "pagamentos", "auditoria"], "readwrite", (t) => registrar(t, aid, tipo, valor, forma, data || hoje(), obs));
}
export async function receberSaldo(aid) {
  exigir("pagamentos.gravar");
  return transacao(["atendimentos", "pagamentos", "auditoria"], "readwrite", async (t) => { const a = await t.atendimentos.get(aid); const s = a.valor_centavos - (a.valor_recebido_centavos || 0); if (s > 0) await registrar(t, aid, "recebimento", s, a.forma_pagamento === "A combinar" ? "Outro" : a.forma_pagamento, hoje(), "Saldo recebido"); });
}
export async function pagamentosDe(aid) { exigir("agenda.ler"); return (await ler("pagamentos")).filter((p) => p.atendimento_id === aid).sort((a, b) => a.id - b.id); }
// ---- despesas ----
export async function listarDespesas({ de, ate, categoria } = {}) { exigir("despesas.gravar"); return (await ler("despesas")).filter((d) => (!de || d.data >= de) && (!ate || d.data <= ate) && (!categoria || d.categoria === categoria)).sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id); }
export async function salvarDespesa(d) {
  exigir("despesas.gravar");
  const desc = (d.descricao || "").trim();
  if (!desc || desc.length > 120) throw new Error("Informe uma descrição com até 120 caracteres.");
  if (!(d.valor_centavos > 0)) throw new Error("Informe um valor maior que zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data || "")) throw new Error("Informe uma data válida.");
  if (!CATEGORIAS_DESP.includes(d.categoria)) throw new Error("Selecione uma categoria válida.");
  return transacao(["despesas", "auditoria"], "readwrite", async (t) => {
    const reg = { descricao: desc, categoria: d.categoria, data: d.data, valor_centavos: d.valor_centavos, forma_pagamento: FORMAS_DESP.includes(d.forma_pagamento) ? d.forma_pagamento : "Não informado", observacoes: (d.observacoes || "").slice(0, 500) };
    if (d.id) { const a = await t.despesas.get(d.id); await t.despesas.salvar({ ...a, ...reg }); await auditar(t, "edicao", "despesa", d.id, `Despesa editada: ${desc}`); return d.id; }
    const id = await t.despesas.adicionar({ ...reg, criado_em: agora() }); await auditar(t, "criacao", "despesa", id, `Despesa criada: ${desc}`); return id;
  });
}
export async function excluirDespesa(id) { exigir("despesas.gravar"); return transacao(["despesas", "auditoria"], "readwrite", async (t) => { const d = await t.despesas.get(id); await t.despesas.apagar(id); await auditar(t, "exclusao", "despesa", id, `Despesa excluída: ${d?.descricao}`); }); }
// ---- métricas ----
export async function resumo(de, ate) {
  exigir("financeiro.ler");
  const [ats, ps, ds] = await Promise.all([ler("atendimentos"), ler("pagamentos"), ler("despesas")]);
  const pp = ps.filter((p) => p.data >= de && p.data <= ate);
  const recebido = pp.reduce((s, p) => s + (p.tipo === "recebimento" ? p.valor_centavos : -p.valor_centavos), 0);
  const porDia = {}, porForma = {};
  for (const p of pp) { const v = p.tipo === "recebimento" ? p.valor_centavos : -p.valor_centavos; porDia[p.data] = (porDia[p.data] || 0) + v; porForma[p.forma_pagamento] = (porForma[p.forma_pagamento] || 0) + v; }
  const periodo = ats.filter((a) => a.data >= de && a.data <= ate);
  const feitos = periodo.filter((a) => a.status_atendimento === "Realizado");
  const despesas = ds.filter((d) => d.data >= de && d.data <= ate).reduce((s, d) => s + d.valor_centavos, 0);
  const pend = ats.filter((a) => ["Realizado", "A classificar"].includes(a.status_atendimento) && ["Pendente", "Parcial"].includes(a.status_pagamento) && a.valor_centavos > (a.valor_recebido_centavos || 0));
  return { recebido, despesas, lucro: recebido - despesas, atendimentos: periodo.length, realizados: feitos.length, cancelados: periodo.filter((a) => a.status_atendimento === "Cancelado").length, faltas: periodo.filter((a) => a.status_atendimento === "Falta").length,
    ticket: feitos.length ? Math.round(feitos.reduce((s, a) => s + a.valor_centavos, 0) / feitos.length) : 0, pendentes: pend.length, aReceber: pend.reduce((s, a) => s + a.valor_centavos - (a.valor_recebido_centavos || 0), 0), porDia, porForma, pagamentos: pp };
}
