import { transacao, ler, agora, hoje, norm, auditar, sessao } from "./database.js";
import { exigir } from "./permissoes.js";
import { validarData, dataValida } from "./datas.js";
const dig = (t) => String(t || "").replace(/\D/g, "");
export async function listar({ q = "", inativasDias = 0 } = {}) {
  exigir("clientes.ler");
  const [cs, ats] = await Promise.all([ler("clientes"), ler("atendimentos")]);
  const perfis = cs.map((c) => perfil(c, ats.filter((a) => a.cliente_id === c.id)));
  const nq = norm(q), dq = dig(q);
  let r = perfis.filter((p) => !q || norm(p.nome).includes(nq) || (dq && dig(p.telefone).includes(dq)));
  if (inativasDias) r = r.filter((p) => p.dias_sem_visita != null && p.dias_sem_visita >= inativasDias && !p.proximo);
  return r.sort((a, b) => norm(a.nome).localeCompare(norm(b.nome)));
}
export function perfil(c, ats) {
  const hojeMs = new Date(new Date().toDateString()).getTime();
  const feitos = ats.filter((a) => a.status_atendimento === "Realizado");
  const ult = feitos.map((a) => a.data).sort().pop() || null;
  const prox = ats.filter((a) => ["Agendado", "Confirmado"].includes(a.status_atendimento) && a.data >= hoje()).map((a) => a.data).sort()[0] || null; // 11.3.1: data local (antes UTC: sumia depois das 21h)
  const gasto = ats.reduce((s, a) => s + (a.valor_recebido_centavos || 0), 0);
  const dias = ult ? Math.floor((hojeMs - new Date(ult + "T00:00:00").getTime()) / 864e5) : null;
  const tags = []; if (feitos.length >= 5 || gasto >= 100000) tags.push("VIP"); else if (feitos.length >= 2) tags.push("Recorrente");
  if (dias != null && dias > 60) tags.push("Inativa"); else if (dias != null && dias > 30) tags.push("Em risco");
  if (feitos.length <= 1 && c.criado_em && (hojeMs - new Date(c.criado_em.slice(0, 10) + "T00:00:00").getTime()) / 864e5 <= 30) tags.push("Nova");
  return { ...c, visitas: feitos.length, gasto, ticket_medio: feitos.length ? Math.round(gasto / feitos.length) : 0, ultima_visita: ult, dias_sem_visita: dias, proximo: prox, tags };
}
export async function detalhe(id) {
  exigir("clientes.ler");
  return transacao(["clientes", "atendimentos"], "readonly", async (t) => {
    const c = await t.clientes.get(id); if (!c) return null;
    const ats = (await t.atendimentos.porIndice("cliente_id", id)).sort((a, b) => (b.data + b.horario_agendado).localeCompare(a.data + a.horario_agendado));
    return { ...perfil(c, ats), atendimentos: ats };
  });
}
export function validar(d) {
  const nome = (d.nome || "").trim(), tel = (d.telefone || "").trim();
  if (nome.length < 3 || nome.length > 120) return "Informe o nome (3 a 120 letras).";
  if (dig(tel).length < 8) return "Informe um telefone válido com DDD.";
  if (d.data_nascimento) { const ed = validarData(d.data_nascimento, "nascimento", { comFaixa: false, nome: "data de nascimento" }); if (ed) return ed; } // 11.4: regra única (datas.js); vazio = sem data
  return null;
}
export async function salvar(d, { permitirDuplicada = false } = {}) {
  exigir("clientes.gravar");
  const erro = validar(d); if (erro) throw new Error(erro);
  return transacao(["clientes", "auditoria"], "readwrite", async (t) => {
    const todos = await t.clientes.todos();
    const nasc = d.data_nascimento || null, antes = d.id ? todos.find((c) => c.id === d.id) : null;
    if (nasc && (!antes || antes.data_nascimento !== nasc)) { const ef = validarData(nasc, "nascimento", { nome: "data de nascimento" }); if (ef) throw new Error(ef); } // faixa só quando informada/alterada
    const dup = todos.find((c) => c.id !== d.id && dig(c.telefone) === dig(d.telefone));
    if (dup && !permitirDuplicada) { const e = new Error(`Já existe uma cliente com este telefone: ${dup.nome}.`); e.duplicada = true; throw e; }
    const reg = { nome: d.nome.trim(), telefone: d.telefone.trim(), data_nascimento: d.data_nascimento || null, observacoes: (d.observacoes || "").slice(0, 2000), preferencias: (d.preferencias || "").slice(0, 500), atualizado_em: agora() };
    if (d.id) { const ant = await t.clientes.get(d.id); await t.clientes.salvar({ ...ant, ...reg }); await auditar(t, "edicao", "cliente", d.id, `Cliente editada: ${reg.nome}`); return d.id; }
    const id = await t.clientes.adicionar({ ...reg, criado_em: agora() }); await auditar(t, "criacao", "cliente", id, `Cliente cadastrada: ${reg.nome}`); return id;
  });
}
/** 11.4: corrige (nova data) ou remove (null) uma data de nascimento gravada INVÁLIDA. Ação do administrador, com
 *  auditoria. Só o campo data_nascimento muda; uma data já válida é recusada (use a edição normal da cliente). */
export async function corrigirNascimento(id, nova) {
  exigir("dados.gerir"); if (sessao.usuario?.perfil !== "admin") throw new Error("Só o administrador pode corrigir este dado.");
  if (nova != null) { const ef = validarData(nova, "nascimento", { nome: "data de nascimento" }); if (ef) throw new Error(ef); }
  return transacao(["clientes", "auditoria"], "readwrite", async (t) => {
    const c = await t.clientes.get(id); if (!c) throw new Error("Cliente não encontrada.");
    if (c.data_nascimento == null || dataValida(c.data_nascimento)) throw new Error("A data de nascimento desta cliente não é inválida: use a edição normal.");
    await t.clientes.salvar({ ...c, data_nascimento: nova ?? null });
    await auditar(t, "correcao", "cliente", id, `Data de nascimento inválida ${nova == null ? "removida" : "corrigida"} pelo administrador`, "data_nascimento", c.data_nascimento, nova);
  });
}
export async function excluir(id) {
  exigir("clientes.gravar");
  return transacao(["clientes", "atendimentos", "auditoria"], "readwrite", async (t) => {
    const c = await t.clientes.get(id); if (!c) return;
    if ((await t.atendimentos.porIndice("cliente_id", id)).length) throw new Error("Esta cliente tem atendimentos. Para não perder o histórico financeiro, ela não pode ser excluída.");
    await t.clientes.apagar(id); await auditar(t, "exclusao", "cliente", id, `Cliente excluída: ${c.nome}`);
  });
}
