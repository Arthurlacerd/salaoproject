// 11.4 em Chromium: as leituras otimizadas (índices "data" e "atendimento_id", busca direta por id, count()) devolvem
// EXATAMENTE o mesmo que as implementações da 11.3.2 (cópias congeladas abaixo, que leem a tabela inteira).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);

T("Ag.listar, Ag.obter, Ag.livres, Fin.pagamentosDe, lista de clientes e contagens: idênticos à 11.3.2", async () => {
  const ctx = await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }), page = await ctx.newPage();
  await abrir(page, srv.url); await configurarAdmin(page); await semear(page);
  const r = await page.evaluate(async () => {
    const D = await import("./js/data/database.js"), Ag = await import("./js/data/agenda.js"), Fin = await import("./js/data/financeiro.js"), Cli = await import("./js/data/clientes.js"), { norm, ler } = D;
    // dados variados gravados direto (inclui borda: cliente removida, cliente_id em texto, data inválida antiga, empates de horário)
    await D.transacao(["clientes", "atendimentos", "pagamentos"], "readwrite", async (t) => {
      const ids = []; for (let i = 0; i < 40; i++) ids.push(await t.clientes.adicionar({ nome: ["Ana", "Ângela", "bia", "Bia", "Érica", "Zélia"][i % 6] + " " + i, telefone: `(11) 9${1000 + i}-0000`, data_nascimento: null, criado_em: "2026-01-01 10:00:00" }));
      const ST = ["Agendado", "Confirmado", "Realizado", "Cancelado", "Falta", "Em atendimento", "A classificar"];
      for (let k = 0; k < 400; k++) { const dia = `2026-${String(10 + (k % 3)).padStart(2, "0")}-${String(1 + (k % 28)).padStart(2, "0")}`;
        const cid = k % 37 === 0 ? 9999 : k % 41 === 0 ? String(ids[3]) : ids[k % ids.length];
        const aid = await t.atendimentos.adicionar({ cliente_id: cid, data: k % 97 === 0 ? "ontem" : dia, horario_agendado: ["09:00", "10:00", "10:00", "14:30"][k % 4], duracao_min: 60, servico: "S" + k, valor_centavos: 1000 + k, valor_recebido_centavos: k % 3 ? 0 : 500, forma_pagamento: "Pix", status_atendimento: ST[k % ST.length], status_pagamento: "Pendente", criado_em: "2026-01-01 10:00:00" });
        if (k % 2) await t.pagamentos.adicionar({ atendimento_id: aid, tipo: "recebimento", valor_centavos: 100, forma_pagamento: "Pix", data: dia, observacao: "", criado_em: "x" });
        if (k % 5 === 0) await t.pagamentos.adicionar({ atendimento_id: aid, tipo: "estorno", valor_centavos: 50, forma_pagamento: "Pix", data: dia, observacao: "", criado_em: "x" }); }
    });
    // ---- oráculos: código da 11.3.2 ----
    const LIBERA = ["Cancelado", "Falta"];
    const listar1132 = async ({ de, ate, status } = {}) => { const [ats, cs] = await Promise.all([ler("atendimentos"), ler("clientes")]); const nomes = new Map(cs.map((c) => [c.id, c]));
      return ats.filter((a) => (!de || a.data >= de) && (!ate || a.data <= ate) && (!status || a.status_atendimento === status))
        .map((a) => ({ ...a, cliente_nome: nomes.get(a.cliente_id)?.nome || "(cliente removida)", telefone: nomes.get(a.cliente_id)?.telefone || "", fim: Ag.fim(a), saldo: Math.max(0, a.valor_centavos - (a.valor_recebido_centavos || 0)) }))
        .sort((x, y) => (x.data + x.horario_agendado).localeCompare(y.data + y.horario_agendado)); };
    const obter1132 = async (id) => (await listar1132()).find((a) => a.id === id) || null;
    const livres1132 = async (data, ini = "08:00", fimExp = "19:00") => { const dia = (await ler("atendimentos")).filter((a) => a.data === data && !LIBERA.includes(a.status_atendimento)).sort((a, b) => a.horario_agendado.localeCompare(b.horario_agendado));
      const res = []; let cur = Ag.min(ini); const f = Ag.min(fimExp); for (const a of dia) { const s = Ag.min(a.horario_agendado), e = s + (a.duracao_min || 60); if (s - cur >= 30) res.push([Ag.hhmm(cur), Ag.hhmm(s)]); cur = Math.max(cur, e); } if (f - cur >= 30) res.push([Ag.hhmm(cur), Ag.hhmm(f)]); return res; };
    const pagamentosDe1132 = async (aid) => (await ler("pagamentos")).filter((p) => p.atendimento_id === aid).sort((a, b) => a.id - b.id);
    const J = JSON.stringify, dif = [];
    const PER = [{}, { de: "2026-11-01", ate: "2026-11-30" }, { de: "2026-10-15" }, { ate: "2026-10-15" }, { de: "2026-11-20", ate: "2026-11-20" }, { de: "2026-12-01", ate: "2026-11-01" }, { de: "2026-11-01", ate: "2026-11-30", status: "Realizado" }, { status: "Agendado" }, { de: "a", ate: "z" }, { de: "2026-11-05", ate: "2026-11-05", status: "Cancelado" }];
    for (const p of PER) if (J(await Ag.listar(p)) !== J(await listar1132(p))) dif.push("listar " + J(p));
    const ats = await ler("atendimentos");
    for (const id of [...ats.map((a) => a.id), 0, 99999, -1]) if (J(await Ag.obter(id)) !== J(await obter1132(id))) dif.push("obter " + id);
    for (const d of ["2026-11-20", "2026-10-01", "2026-12-25", "ontem", ""]) for (const [i, f] of [["08:00", "19:00"], ["09:30", "18:00"]]) if (J(await Ag.livres(d, i, f)) !== J(await livres1132(d, i, f))) dif.push("livres " + d);
    for (const id of [...ats.map((a) => a.id), 0, 99999]) if (J(await Fin.pagamentosDe(id)) !== J(await pagamentosDe1132(id))) dif.push("pagamentosDe " + id);
    const nomes1132 = (await Cli.listar()).map((c) => [c.id, c.nome, c.telefone]), nomes = (await Cli.listarNomes()).map((c) => [c.id, c.nome, c.telefone]);
    if (J(nomes) !== J(nomes1132)) dif.push("lista de clientes do agendamento");
    for (const s of ["clientes", "atendimentos", "pagamentos"]) if ((await D.contar(s)) !== (await ler(s)).length) dif.push("contar " + s);
    // permissões iguais: sem sessão, as mesmas funções continuam recusando
    const u = D.sessao.usuario; D.sessao.usuario = null; const recusa = async (fn) => { try { await fn(); return "aceitou"; } catch (e) { return e.message; } };
    const perm = { obter: await recusa(() => Ag.obter(ats[0].id)), listar: await recusa(() => Ag.listar({ de: "2026-11-01", ate: "2026-11-02" })), nomes: await recusa(() => Cli.listarNomes()), pagamentos: await recusa(() => Fin.pagamentosDe(ats[0].id)) };
    D.sessao.usuario = u;
    return { dif, perm, n: ats.length };
  });
  assert.ok(r.n > 400); assert.deepEqual(r.dif, [], "nenhuma diferença");
  for (const [k, v] of Object.entries(r.perm)) assert.match(v, /permissão/, `${k}: mesma recusa sem permissão`);
  await ctx.close();
});
