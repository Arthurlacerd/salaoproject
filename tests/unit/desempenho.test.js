// 11.4: Cli.listar sem O(C×A). A implementação ANTERIOR (cópia congelada da 11.3.2) é o oráculo: para os conjuntos
// "pequeno" e "1 ano", com buscas e filtros variados, o resultado novo é idêntico (conteúdo, campos, tags e ordem).
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { carregarVersaoGlobal } from "./_app.js";
process.env.TZ = "America/Sao_Paulo";
carregarVersaoGlobal();
const Cli = await import("../../js/data/clientes.js");
const { norm } = await import("../../js/data/database.js");
const dig = (t) => String(t || "").replace(/\D/g, "");

// ---- oráculo: Cli.listar da 11.3.2 (sem a leitura do banco), contando as comparações cliente × atendimento ----
function listar1132(cs, ats, { q = "", inativasDias = 0 } = {}, conta = { n: 0 }) {
  const perfis = cs.map((c) => Cli.perfil(c, ats.filter((a) => (conta.n++, a.cliente_id === c.id))));
  const nq = norm(q), dq = dig(q);
  let r = perfis.filter((p) => !q || norm(p.nome).includes(nq) || (dq && dig(p.telefone).includes(dq)));
  if (inativasDias) r = r.filter((p) => p.dias_sem_visita != null && p.dias_sem_visita >= inativasDias && !p.proximo);
  return r.sort((a, b) => norm(a.nome).localeCompare(norm(b.nome)));
}
/** Conjunto sintético determinístico, com casos de borda: atendimentos de cliente removida, cliente_id em texto,
 *  nomes repetidos/acentuados, aniversários, várias situações, datas passadas e futuras. */
function conjunto(nc, semanas) {
  let s = 11; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648), pega = (l) => l[Math.floor(rnd() * l.length)];
  const N = ["Ana", "Ângela", "Bia", "Carla", "Débora", "Érica", "Júlia", "Lívia", "Maria", "Ana Paula"], S = ["Silva", "Souza", "Araújo", "Conceição", "Lima"];
  const ST = ["Agendado", "Confirmado", "Em atendimento", "Realizado", "Realizado", "Realizado", "Cancelado", "Falta", "A classificar"];
  const cs = Array.from({ length: nc }, (_, i) => ({ id: i + 1, nome: `${pega(N)} ${pega(S)}`, telefone: `(11) 9${String(1000 + i).slice(-4)}-${String(i).padStart(4, "0")}`, data_nascimento: rnd() < 0.4 ? `19${70 + Math.floor(rnd() * 29)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-15` : null, criado_em: rnd() < 0.1 ? "2026-11-20 10:00:00" : "2025-01-01 09:00:00" }));
  const ats = []; let id = 1; const base = new Date("2026-11-28T12:00:00");
  for (let d = -semanas * 7; d <= 14; d++) { const dt = new Date(base.getTime() + d * 864e5), dia = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    for (let k = 0; k < 15; k++) { const r = rnd(), cid = r < 0.01 ? nc + 50 : r < 0.015 ? String(1 + Math.floor(rnd() * nc)) : 1 + Math.floor(rnd() * nc), st = d > 0 ? pega(["Agendado", "Confirmado"]) : pega(ST);
      ats.push({ id: id++, cliente_id: cid, data: dia, horario_agendado: `${String(8 + Math.floor(k * 40 / 60)).padStart(2, "0")}:${String((k * 40) % 60).padStart(2, "0")}`, status_atendimento: st, valor_centavos: 5000, valor_recebido_centavos: st === "Realizado" ? (rnd() < 0.9 ? 5000 : 2500) : 0 }); } }
  return { cs, ats };
}
const BUSCAS = [{}, { q: "ana" }, { q: "ÂNGELA" }, { q: "araujo" }, { q: "11 9" }, { q: "0007" }, { q: "conceição" }, { q: "zz-nada" }, { inativasDias: 30 }, { inativasDias: 60 }, { inativasDias: 90 }, { q: "lima", inativasDias: 30 }];
const congelado = (fn) => { mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-28T15:00:00-03:00") }); try { return fn(); } finally { mock.timers.reset(); } };

for (const [nome, nc, semanas] of [["pequeno", 100, 4], ["1 ano", 800, 52]]) test(`Cli.listar idêntico ao da 11.3.2 — conjunto ${nome}`, () => {
  const { cs, ats } = conjunto(nc, semanas);
  congelado(() => { for (const b of BUSCAS) assert.deepEqual(Cli.montarLista(cs, ats, b), listar1132(cs, ats, b), `${nome} ${JSON.stringify(b)}`); });
});
test("comparações: de C×A para C+A (conjunto de 1 ano)", () => {
  const { cs, ats } = conjunto(800, 52), conta = { n: 0 }; congelado(() => listar1132(cs, ats, {}, conta));
  assert.equal(conta.n, cs.length * ats.length, "11.3.2: um filtro completo por cliente");
  let n = 0; const proxy = ats.map((a) => new Proxy(a, { get: (o, k) => (k === "cliente_id" && n++, o[k]) }));
  Cli.agruparPorCliente(proxy); assert.equal(n, ats.length, "11.4: cada atendimento é lido uma vez para agrupar");
  console.log(`# comparações cliente×atendimento: 11.3.2 = ${conta.n.toLocaleString("pt-BR")}; 11.4 = ${n.toLocaleString("pt-BR")} leituras + ${cs.length} buscas no Map`);
});
test("agrupamento preserva a ordem da leitura dentro de cada cliente e trata chaves como o filtro (===)", () => {
  const ats = [{ id: 1, cliente_id: 2 }, { id: 2, cliente_id: "2" }, { id: 3, cliente_id: 2 }, { id: 4, cliente_id: null }, { id: 5, cliente_id: 1 }];
  const g = Cli.agruparPorCliente(ats); assert.deepEqual(g.get(2).map((a) => a.id), [1, 3]); assert.deepEqual(g.get("2").map((a) => a.id), [2]); assert.equal(g.get(3), undefined);
});
