// 11.4 em Chromium: nenhum parâmetro da URL (parte depois de "#/rota?") é interpretado como HTML/JS. Os 17 pares
// rota/parâmetro lidos pelo app recebem um payload inofensivo (só marca o <html> se executar). Links válidos continuam iguais.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
const P = (marca) => encodeURIComponent(`"><img src=x onerror="document.documentElement.dataset.xss='${marca}'"><svg onload="document.documentElement.dataset.xss='${marca}'">`);
const VETORES = [["painel", "p"], ["painel", "de"], ["painel", "ate"], ["agenda", "data"], ["agenda", "modo"], ["agenda", "situacao"], ["atendimento/novo", "cliente"], ["atendimento/novo", "data"], ["atendimento/novo", "inicio"],
  ["clientes", "q"], ["clientes", "seg"], ["financeiro", "p"], ["financeiro", "de"], ["financeiro", "ate"], ["financeiro", "aba"], ["despesas", "editar"], ["despesas", "cat"], ["auditoria", "pag"]];
async function aparelho() { const ctx = await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }), page = await ctx.newPage(); await abrir(page, srv.url); await configurarAdmin(page); const ids = await semear(page); return { ctx, page, ids }; }
async function abrirHash(page, hash) {
  await page.evaluate(() => { delete document.documentElement.dataset.xss; location.hash = "#/sobre"; }); await page.waitForFunction(() => location.hash === "#/sobre" && document.querySelector("#vista > *:not(.skeleton)"));
  await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForFunction(() => !location.hash.startsWith("#/sobre") && document.querySelector("#vista > *:not(.skeleton)"), null, { timeout: 15000 }); await page.waitForTimeout(400);
}

T("nenhum dos parâmetros de URL executa código (payload em cada um, inclusive em combinação com 'personalizado')", async () => {
  const { ctx, page } = await aparelho(), erros = []; page.on("pageerror", (e) => erros.push(e.message));
  for (const [rota, param] of VETORES) {
    const marca = `${rota}_${param}`.replace(/\W/g, "_"), extra = ["de", "ate"].includes(param) ? `p=personalizado&${param === "de" ? "ate=2026-12-31" : "de=2026-01-01"}&` : "";
    await abrirHash(page, `#/${rota}?${extra}${param}=${P(marca)}`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.xss || null), null, `${rota}?${param} executou código`);
    assert.equal(await page.$$eval('#vista img[src="x"], #vista svg[onload]', (l) => l.length), 0, `${rota}?${param}: elemento injetado`);
  }
  assert.deepEqual(erros, [], "nenhum erro de página");
  await ctx.close();
});

T("link malicioso aberto numa aba sem sessão: nada executa no login nem depois de entrar", async () => {
  const { ctx } = await aparelho(); const p2 = await ctx.newPage();
  await p2.goto(srv.url + "#/agenda?modo=" + P("apos_login")); await p2.waitForSelector('form#f input[name="senha"]');
  assert.equal(await p2.evaluate(() => document.documentElement.dataset.xss || null), null);
  await p2.fill('input[name="usuario"]', "admin"); await p2.fill('input[name="senha"]', "senha-de-teste-123"); await p2.click('form#f button[type="submit"]');
  await p2.waitForSelector("#vista > *:not(.skeleton)"); await p2.waitForTimeout(800);
  assert.equal(await p2.evaluate(() => document.documentElement.dataset.xss || null), null, "não executa depois do login");
  assert.match(await p2.textContent("h1"), /Agenda/, "a rota do link abre normalmente, com o modo padrão");
  await ctx.close();
});

T("links válidos continuam funcionando como antes", async () => {
  const { ctx, page, ids } = await aparelho();
  await abrirHash(page, "#/agenda?modo=semana&data=2026-11-20"); assert.equal(await page.$$eval(".week-col", (l) => l.length), 7, "semana");
  assert.equal(await page.$eval("#agenda-data", (i) => i.value), "2026-11-20");
  await abrirHash(page, "#/agenda?modo=lista&data=2026-11-01&situacao=Agendado"); assert.equal(await page.$eval("#agenda-sit", (s) => s.value), "Agendado");
  await abrirHash(page, "#/agenda?data=2027-02-31"); assert.equal(await page.$eval("#agenda-data", (i) => i.value), await page.evaluate(() => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }), "data impossível → hoje");
  await abrirHash(page, `#/atendimento/novo?cliente=${ids.cid}&data=2026-12-01&inicio=10:00`);
  assert.deepEqual(await page.$eval("#f-at", (f) => [f.cliente_id.value, f.data.value, f.horario_agendado.value]), [String(ids.cid), "2026-12-01", "10:00"]);
  await abrirHash(page, "#/atendimento/novo?cliente=999&inicio=25:00"); assert.deepEqual(await page.$eval("#f-at", (f) => [f.cliente_id.value, f.horario_agendado.value]), ["", ""], "cliente inexistente e hora inválida → vazio");
  await abrirHash(page, "#/financeiro?p=7dias&aba=pendencias"); assert.match(await page.textContent("nav.tabs a.active"), /Pendências/); assert.match(await page.textContent(".period-chips a.active"), /7 dias/);
  await abrirHash(page, "#/financeiro?p=personalizado&de=2026-11-01&ate=2026-11-30"); assert.match(await page.textContent(".page-heading"), /01\/11\/2026 a 30\/11\/2026/);
  await abrirHash(page, "#/painel?p=mes"); assert.match(await page.textContent(".period-chips a.active"), /Este mês/);
  await abrirHash(page, "#/clientes?q=Maria"); assert.equal(await page.$eval('#f-busca [name="q"]', (i) => i.value), "Maria"); assert.ok((await page.$$("#vista tbody tr")).length >= 1);
  await abrirHash(page, "#/clientes?seg=30"); assert.match(await page.textContent(".status-chips a.active"), /30\+/);
  const did = await page.evaluate(async () => (await (await import("./js/data/database.js")).ler("despesas"))[0].id);
  await abrirHash(page, `#/despesas?editar=${did}`); assert.match(await page.textContent("#f-desp"), /Editar despesa/);
  await abrirHash(page, "#/despesas?editar=999"); assert.match(await page.textContent("#f-desp"), /Nova despesa/, "id inexistente → formulário novo");
  await abrirHash(page, "#/auditoria?pag=999"); assert.ok((await page.$$(".audit-list li")).length >= 1, "página além do fim → última página");
  await ctx.close();
});
