// 11.4 em Chromium: nenhuma gravação normal persiste data inválida. Mesma regra em agendamento, pagamento, estorno,
// despesa, aniversário e CSV (sem depender do fuso). A faixa de negócio só vale para datas informadas/alteradas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
async function aparelho(tz = "America/Sao_Paulo") { const ctx = await nav.newContext({ timezoneId: tz, locale: "pt-BR" }), page = await ctx.newPage(); await abrir(page, srv.url); await configurarAdmin(page); const ids = await semear(page); return { ctx, page, ids }; }
const ir = async (page, rota, sel) => { await page.goto(srv.url + "#/sobre"); await page.waitForSelector("#vista > *:not(.skeleton)"); await page.goto(srv.url + "#/" + rota); await page.waitForSelector(sel); };
const INVALIDAS = ["2027-02-31", "2027-04-31", "2027-02-29", "2027-13-45", "ontem", "20277-11-28", "112026-11-28", "1990/05/17", "31/02/2027"];

T("funções de gravação recusam toda data inválida e aceitam as válidas (agendamento, pagamento, estorno, despesa, aniversário)", async () => {
  const { ctx, page, ids } = await aparelho();
  const r = await page.evaluate(async ({ ids, INVALIDAS }) => {
    const Ag = await import("./js/data/agenda.js"), Fin = await import("./js/data/financeiro.js"), Cli = await import("./js/data/clientes.js"), D = await import("./js/data/database.js"), out = { aceitas: [] };
    const tenta = async (nome, fn) => { try { await fn(); out.aceitas.push(nome); } catch (_) {} };
    let h = 6; for (const v of INVALIDAS) {
      await tenta("agenda " + v, () => Ag.salvar({ cliente_id: ids.cid, data: v, horario_agendado: `${String(h++).padStart(2, "0")}:00`, servico: "Corte", valor_centavos: 100, forma_pagamento: Ag.FORMAS[0] }));
      await tenta("pagamento " + v, () => Fin.registrarPagamento(ids.aid, "recebimento", 1, "Pix", v));
      await tenta("estorno " + v, () => Fin.registrarPagamento(ids.aid, "estorno", 1, "Pix", v));
      await tenta("despesa " + v, () => Fin.salvarDespesa({ descricao: "D", categoria: "Outras despesas", data: v, valor_centavos: 100 }));
      await tenta("aniversário " + v, () => Cli.salvar({ nome: "Nasc " + v, telefone: `(11) 9${String(h).padStart(4, "0")}-0000`, data_nascimento: v }));
    }
    const fora = []; const conta = async (nome, fn) => { try { await fn(); fora.push(nome + ": aceita"); } catch (e) { fora.push(nome + ": " + e.message); } };
    await conta("agenda 1999-12-31", () => Ag.salvar({ cliente_id: ids.cid, data: "1999-12-31", horario_agendado: "10:00", servico: "Corte", valor_centavos: 100, forma_pagamento: Ag.FORMAS[0] }));
    await conta("pagamento 2101-01-01", () => Fin.registrarPagamento(ids.aid, "recebimento", 1, "Pix", "2101-01-01"));
    await conta("aniversário 1899-12-31", () => Cli.salvar({ nome: "Muito Antiga", telefone: "(11) 98888-0001", data_nascimento: "1899-12-31" }));
    await conta("aniversário amanhã", () => Cli.salvar({ nome: "Futura Teste", telefone: "(11) 98888-0002", data_nascimento: "2999-01-01" }));
    // valores válidos continuam aceitos
    await conta("agenda válida", () => Ag.salvar({ cliente_id: ids.cid, data: "2026-12-15", horario_agendado: "10:00", servico: "Corte", valor_centavos: 100, forma_pagamento: Ag.FORMAS[0] }));
    await conta("pagamento válido", () => Fin.registrarPagamento(ids.aid, "recebimento", 1, "Pix", "2026-11-21"));
    await conta("despesa válida", () => Fin.salvarDespesa({ descricao: "D ok", categoria: "Outras despesas", data: "2024-02-29", valor_centavos: 100 }));
    await conta("aniversário válido", () => Cli.salvar({ nome: "Nasc Ok", telefone: "(11) 98888-0003", data_nascimento: "1990-05-17" }));
    await conta("receber saldo (hoje)", () => Fin.receberSaldo(ids.aid));
    // valor histórico VÁLIDO fora da faixa, já gravado: editar outros campos não é bloqueado pela faixa
    const cid = await D.transacao(["clientes"], "readwrite", (t) => t.clientes.adicionar({ nome: "Bisavó Teste", telefone: "(11) 97777-0001", data_nascimento: "1850-03-10", criado_em: D.agora() }));
    await conta("edição de cliente com aniversário histórico 1850 (inalterado)", () => Cli.salvar({ id: cid, nome: "Bisavó Teste", telefone: "(11) 97777-0002", data_nascimento: "1850-03-10" }));
    await conta("mesma cliente mudando para 1851 (alterado: faixa vale)", () => Cli.salvar({ id: cid, nome: "Bisavó Teste", telefone: "(11) 97777-0002", data_nascimento: "1851-03-10" }));
    out.fora = fora; out.backup = (await (await import("./js/data/backup.js")).criarValidado()).consistente; return out;
  }, { ids, INVALIDAS });
  assert.deepEqual(r.aceitas, [], "nenhuma data inválida gravada");
  assert.match(r.fora[0], /entre 01\/01\/2000 e 31\/12\/2100/); assert.match(r.fora[1], /entre 01\/01\/2000/); assert.match(r.fora[2], /entre 01\/01\/1900 e hoje/); assert.match(r.fora[3], /entre 01\/01\/1900 e hoje/);
  assert.deepEqual(r.fora.slice(4, 9).map((x) => x.split(": ")[1]), ["aceita", "aceita", "aceita", "aceita", "aceita"]);
  assert.equal(r.fora[9].split(": ")[1], "aceita"); assert.match(r.fora[10], /entre 01\/01\/1900 e hoje/);
  assert.equal(r.backup, true, "o backup continua consistente");
  await ctx.close();
});

T("pela tela: ano de 5 dígitos é barrado (campo com min/max) e nada é gravado", async () => {
  const { ctx, page, ids } = await aparelho();
  const seg = async (sel, n) => { await page.$eval(sel, (i) => i.focus()); for (let k = 0; k < n; k++) await page.keyboard.press("ArrowRight"); };
  const casos = [[`atendimento/${ids.aid}/pagamento`, '#f-pg [name="data"]', "#f-pg", "pagamentos", async () => page.fill('#f-pg [name="valor"]', "1,00")],
    ["cliente/novo", '#f-cli [name="data_nascimento"]', "#f-cli", "clientes", async () => { await page.fill('#f-cli [name="nome"]', "Ano Longo"); await page.fill('#f-cli [name="telefone"]', "(11) 97777-3030"); }],
    ["despesas", '#f-desp [name="data"]', "#f-desp", "despesas", async () => { await page.fill('#f-desp [name="descricao"]', "Ano longo"); await page.fill('#f-desp [name="valor"]', "2,00"); }],
    ["atendimento/novo", "#data", "#f-at", "atendimentos", async () => { await page.selectOption("#cliente-existente", String(ids.cid)); await page.fill("#servico", "Corte"); await page.fill("#valor", "50,00"); await page.fill("#inicio", "15:00"); await page.selectOption("#forma", { index: 1 }); }]];
  for (const [rota, campo, form, store, prep] of casos) {
    await ir(page, rota, form); await prep();
    const lim = await page.$eval(campo, (i) => [i.min, i.max]); assert.ok(lim[0] && lim[1], `${campo}: min/max presentes`);
    await page.$eval(campo, (i) => { i.value = "2026-11-28"; }); await seg(campo, 2); await page.keyboard.type("20277", { delay: 30 });
    assert.equal(await page.$eval(campo, (i) => i.checkValidity()), false, `${campo}: o navegador já recusa`);
    const antes = await page.evaluate(async (s) => (await (await import("./js/data/database.js")).ler(s)).length, store);
    await page.click(`${form} button[type="submit"]`); await page.waitForTimeout(800);
    await page.$eval(form, (f) => f.requestSubmit && f.noValidate !== undefined && (f.noValidate = true)); await page.click(`${form} button[type="submit"]`).catch(() => {}); await page.waitForTimeout(800); // mesmo sem a checagem do navegador
    assert.equal(await page.evaluate(async (s) => (await (await import("./js/data/database.js")).ler(s)).length, store), antes, `${store}: nada gravado`);
  }
  assert.equal(await page.evaluate(async () => (await (await import("./js/data/backup.js")).criarValidado()).consistente), true);
  await ctx.close();
});

T("CSV de clientes: mesmo resultado em São Paulo, Lisboa e Tóquio; datas inválidas não importadas", async () => {
  const CSV = "nome;telefone;nascimento\nAna Valida;(11) 91111-0001;17/05/1990\nBia Fev31;(11) 91111-0002;31/02/1990\nCris Abr31;(11) 91111-0003;31/04/1990\nDuda Fev29;(11) 91111-0004;29/02/2023\nEva Bissexto;(11) 91111-0005;29/02/2024\nFabi Iso;(11) 91111-0006;1990-02-31\nGabi Barra;(11) 91111-0007;1990/05/17\nHana Julho;(11) 91111-0008;15/07/1990\nIris Janeiro;(11) 91111-0009;17/01/1990\nJu Antiga;(11) 91111-0010;31/12/1899\n";
  const res = {};
  for (const tz of ["America/Sao_Paulo", "Europe/Lisbon", "Asia/Tokyo"]) {
    const { ctx, page } = await aparelho(tz); await ir(page, "dados", "#arq");
    await page.setInputFiles("#arq", { name: "c.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) }); await page.click("#analisar"); await page.waitForSelector("#ok-csv");
    await page.click("#ok-csv"); await page.waitForFunction(() => location.hash.startsWith("#/clientes"));
    res[tz] = await page.evaluate(async () => (await (await import("./js/data/database.js")).ler("clientes")).filter((c) => c.telefone.startsWith("(11) 91111")).map((c) => `${c.nome}=${c.data_nascimento}`).sort());
    await ctx.close();
  }
  assert.deepEqual(res["America/Sao_Paulo"], ["Ana Valida=1990-05-17", "Eva Bissexto=2024-02-29", "Hana Julho=1990-07-15", "Iris Janeiro=1990-01-17"]);
  assert.deepEqual(res["Europe/Lisbon"], res["America/Sao_Paulo"]); assert.deepEqual(res["Asia/Tokyo"], res["America/Sao_Paulo"]);
});
