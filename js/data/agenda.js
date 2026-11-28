import { transacao, ler, agora, auditar, hoje, obter as obterRegistro, lerPorIndice, chaveSimples } from "./database.js";
import { exigir, pode } from "./permissoes.js";
import { recalcular, registrar } from "./financeiro.js";
import { validarData } from "./datas.js";
export const STATUS = ["Agendado", "Confirmado", "Em atendimento", "Realizado", "Cancelado", "Falta", "A classificar"];
export const FLUXO = { Agendado: "Confirmado", Confirmado: "Em atendimento", "Em atendimento": "Realizado" };
const LIBERA = ["Cancelado", "Falta"];
export const FORMAS = ["Pix", "Dinheiro", "Débito", "Crédito", "Transferência", "A combinar"];
export const min = (h) => { const [a, b] = h.split(":"); return +a * 60 + +b; };
export const hhmm = (m) => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
export const fim = (a) => hhmm(min(a.horario_agendado) + (a.duracao_min || 60));
export function conflito(lista, data, inicio, dur, ignorar = null) {
  const i = min(inicio), f = i + (dur || 60);
  return lista.find((a) => a.id !== ignorar && a.data === data && !LIBERA.includes(a.status_atendimento) && i < min(a.horario_agendado) + (a.duracao_min || 60) && min(a.horario_agendado) < f) || null;
}
export async function checarConflito(data, inicio, dur, ignorar) { return conflito(await ler("atendimentos"), data, inicio, dur, ignorar); }
/** Campos derivados que as telas usam (iguais para listar e obter). c = a cliente do atendimento (ou undefined). */
const derivar = (a, c) => ({ ...a, cliente_nome: c?.nome || "(cliente removida)", telefone: c?.telefone || "", fim: fim(a), saldo: Math.max(0, a.valor_centavos - (a.valor_recebido_centavos || 0)) });
/** 11.4: com período, lê só esse intervalo pelo índice "data" (que já existe). O mesmo filtro de antes é aplicado
 *  em seguida, então o resultado é idêntico ao da leitura completa. */
async function atendimentosDoPeriodo(de, ate) {
  if (!de && !ate) return ler("atendimentos");
  if ((de && typeof de !== "string") || (ate && typeof ate !== "string")) return ler("atendimentos");
  if (de && ate && de > ate) return [];
  return lerPorIndice("atendimentos", "data", de && ate ? IDBKeyRange.bound(de, ate) : de ? IDBKeyRange.lowerBound(de) : IDBKeyRange.upperBound(ate));
}
export async function listar({ de, ate, status } = {}) {
  exigir("agenda.ler");
  const [ats, cs] = await Promise.all([atendimentosDoPeriodo(de, ate), ler("clientes")]); const nomes = new Map(cs.map((c) => [c.id, c]));
  return ats.filter((a) => (!de || a.data >= de) && (!ate || a.data <= ate) && (!status || a.status_atendimento === status))
    .map((a) => derivar(a, nomes.get(a.cliente_id)))
    .sort((x, y) => (x.data + x.horario_agendado).localeCompare(y.data + y.horario_agendado));
}
/** 11.4: busca direta pelo id (antes: listava todos para achar um). Mesmos campos derivados e mesma permissão. */
export async function obter(id) {
  exigir("agenda.ler"); if (!chaveSimples(id)) return null;
  const a = await obterRegistro("atendimentos", id); if (!a) return null;
  return derivar(a, chaveSimples(a.cliente_id) ? await obterRegistro("clientes", a.cliente_id) : undefined);
}
export async function livres(data, ini = "08:00", fimExp = "19:00") {
  const doDia = typeof data === "string" ? await lerPorIndice("atendimentos", "data", data) : await ler("atendimentos"); // 11.4: índice "data"
  const dia = doDia.filter((a) => a.data === data && !LIBERA.includes(a.status_atendimento)).sort((a, b) => a.horario_agendado.localeCompare(b.horario_agendado));
  const r = []; let cur = min(ini); const f = min(fimExp);
  for (const a of dia) { const s = min(a.horario_agendado), e = s + (a.duracao_min || 60); if (s - cur >= 30) r.push([hhmm(cur), hhmm(s)]); cur = Math.max(cur, e); }
  if (f - cur >= 30) r.push([hhmm(cur), hhmm(f)]); return r;
}
export function validar(d) {
  if (!d.cliente_id) return "Selecione uma cliente cadastrada ou preencha o cadastro rápido.";
  const ed = validarData(d.data, "operacao", { comFaixa: false }); if (ed) return ed; // 11.4: regra única (datas.js); a faixa é conferida em salvar()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.horario_agendado || "")) return "Informe um horário válido (00:00–23:59).";
  if ((d.servico || "").trim().length < 2) return "Informe o serviço.";
  if (!(d.valor_centavos >= 0)) return "Informe um valor válido.";
  if (!FORMAS.includes(d.forma_pagamento)) return "Selecione a forma de pagamento.";
  return null;
}
export async function salvar(d, recebidoInicial = 0) {
  exigir("agenda.gravar");
  const erro = validar(d); if (erro) throw new Error(erro);
  const dur = d.duracao_min || 60;
  return transacao(["atendimentos", "pagamentos", "servicos", "clientes", "auditoria"], "readwrite", async (t) => {
    const todos = await t.atendimentos.todos();
    const atual = d.id ? await t.atendimentos.get(d.id) : null;
    if (!atual || atual.data !== d.data) { const ef = validarData(d.data, "operacao"); if (ef) throw new Error(ef); } // faixa só quando a data é informada/alterada
    const st = atual ? atual.status_atendimento : "Agendado";
    if (!LIBERA.includes(st)) { const c = conflito(todos, d.data, d.horario_agendado, dur, d.id);
      if (c) { const cl = await t.clientes.get(c.cliente_id); throw new Error(`Conflito de horário: ${cl?.nome || "outra cliente"} já ocupa ${c.horario_agendado}–${fim(c)}. Atendimentos podem encostar, mas não se sobrepor.`); } }
    const sv = (await t.servicos.todos()).find((s) => s.nome.toLowerCase() === d.servico.trim().toLowerCase());
    const reg = { cliente_id: d.cliente_id, data: d.data, horario_agendado: d.horario_agendado, duracao_min: dur, servico: d.servico.trim(), servico_id: sv?.id ?? null, valor_centavos: d.valor_centavos, forma_pagamento: d.forma_pagamento, observacoes: (d.observacoes || "").slice(0, 2000), atualizado_em: agora() };
    if (atual) {
      if (reg.valor_centavos < (atual.valor_recebido_centavos || 0)) throw new Error("O valor não pode ser menor que o já recebido. Registre um estorno antes, se for o caso.");
      await t.atendimentos.salvar({ ...atual, ...reg }); await recalcular(t, atual.id);
      await auditar(t, "edicao", "atendimento", atual.id, `Atendimento editado: ${reg.servico} em ${reg.data} ${reg.horario_agendado}`); return atual.id;
    }
    const id = await t.atendimentos.adicionar({ ...reg, status_atendimento: "Agendado", status_pagamento: "Pendente", valor_recebido_centavos: 0, criado_em: agora() });
    await auditar(t, "criacao", "atendimento", id, `Agendamento criado: ${reg.servico} em ${reg.data} às ${reg.horario_agendado}`);
    if (recebidoInicial > 0) await registrar(t, id, "recebimento", Math.min(recebidoInicial, reg.valor_centavos), reg.forma_pagamento === "A combinar" ? "Outro" : reg.forma_pagamento, hoje(), "Registrado ao agendar");
    return id;
  });
}
export async function mudarStatus(id, novo) {
  if (!pode("agenda.gravar") && !pode("agenda.andamento")) throw new Error("Seu perfil não tem permissão para esta ação.");
  if (!STATUS.includes(novo)) throw new Error("Situação inválida.");
  return transacao(["atendimentos", "pagamentos", "auditoria"], "readwrite", async (t) => {
    const a = await t.atendimentos.get(id); if (!a || a.status_atendimento === novo) return a;
    if (!pode("agenda.gravar") && !["Em atendimento", "Realizado"].includes(novo)) throw new Error("Seu perfil só pode atualizar o andamento (iniciar/concluir).");
    if (!LIBERA.includes(novo) && LIBERA.includes(a.status_atendimento)) { const c = conflito(await t.atendimentos.todos(), a.data, a.horario_agendado, a.duracao_min, a.id); if (c) throw new Error("Este horário já foi ocupado por outro atendimento; remarque antes de reativar."); }
    const ant = a.status_atendimento; a.status_atendimento = novo; a.atualizado_em = agora();
    if (novo === "Cancelado" && (a.valor_recebido_centavos || 0) <= 0) a.status_pagamento = "Cancelado";
    await t.atendimentos.salvar(a); await recalcular(t, id);
    await auditar(t, "status", "atendimento", id, `Situação: ${ant} → ${novo}`, "status_atendimento", ant, novo);
    return a;
  });
}
