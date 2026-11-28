// 11.3.2 em Chromium: mensagens de sucesso e avisos não críticos continuam visíveis quando a tela é redesenhada (rec() ou
// troca de rota), pelo mesmo tempo de antes (~5 s). Mensagens de erro NÃO são levadas para a tela seguinte.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
async function aparelho() { const ctx = await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }), page = await ctx.newPage(); await abrir(page, srv.url); await configurarAdmin(page); await semear(page); return { ctx, page }; }
const ir = async (page, rota, sel) => { await page.goto(srv.url + "#/sobre"); await page.waitForSelector("#vista > *:not(.skeleton)"); await page.goto(srv.url + "#/" + rota); await page.waitForSelector(sel); };
const marcarTela = (page) => page.evaluate(() => { document.querySelector("#vista").dataset.telaAntiga = "1"; }); // some quando a tela é redesenhada
const redesenhada = (page) => page.waitForSelector("#vista:not([data-tela-antiga]) > *:not(.skeleton)", { timeout: 30000 });
const naTela = (page, texto) => page.evaluate((t) => [...document.querySelectorAll("#alertas > .alert")].filter((e) => e.textContent.includes(t)).length, texto);
const sobrevive = async (page, texto) => { await redesenhada(page); await page.waitForTimeout(1200); assert.equal(await naTela(page, texto), 1, `"${texto}" visível depois do redesenho`); };

T("Exportar backup (Dados e Manutenção): a confirmação aparece depois que a tela é redesenhada", async () => {
  const { ctx, page } = await aparelho();
  for (const [rota, botao, msg] of [["dados", "#exportar", "Backup gerado. Guarde o arquivo em local seguro."], ["manutencao", "#m-exp", "Backup criado e validado. Guarde o arquivo em local seguro."]]) {
    await ir(page, rota, botao); await marcarTela(page);
    await Promise.all([page.waitForEvent("download"), page.click(botao)]); await sobrevive(page, msg);
  }
  await ctx.close();
});

T("Importar CSV, salvar despesa e salvar cliente: a confirmação aparece na tela seguinte", async () => {
  const { ctx, page } = await aparelho();
  await ir(page, "dados", "#analisar"); await page.setInputFiles("#arq", { name: "c.csv", mimeType: "text/csv", buffer: Buffer.from("nome;telefone\nNova Cliente CSV;(11) 95555-0009\n") });
  await page.click("#analisar"); await page.waitForSelector("#ok-csv"); await marcarTela(page); await page.click("#ok-csv"); await page.waitForURL(/#\/clientes$/); await sobrevive(page, "1 cliente(s) importado(s).");
  await ir(page, "despesas", "#f-desp"); await marcarTela(page);
  await page.fill('#f-desp [name="descricao"]', "Despesa da mensagem"); await page.fill('#f-desp [name="valor"]', "10"); await page.click('#f-desp [type="submit"]'); await sobrevive(page, "Despesa salva.");
  await ir(page, "cliente/novo", "#f-cli"); await marcarTela(page);
  await page.fill('#f-cli [name="nome"]', "Cliente da Mensagem"); await page.fill('#f-cli [name="telefone"]', "(11) 94444-0001"); await page.click('#f-cli [type="submit"]');
  await page.waitForURL(/#\/cliente\/\d+$/); await sobrevive(page, "Cliente salva.");
  await ctx.close();
});

T("erros NÃO vão para a tela seguinte; sucesso e aviso não crítico vão, no mesmo redesenho", async () => {
  const { ctx, page } = await aparelho(); await ir(page, "dados", "#analisar");
  await page.click("#analisar"); await page.waitForFunction(() => document.querySelector("#alertas").textContent.includes("Escolha um arquivo.")); // erro real da tela
  await page.evaluate(async () => { const U = await import("./js/ui/util.js"); U.toast("Aviso de teste (não crítico).", "aviso"); U.toast("Erro de teste.", "erro"); });
  await marcarTela(page); await Promise.all([page.waitForEvent("download"), page.click("#exportar")]); await redesenhada(page); await page.waitForTimeout(800);
  assert.equal(await naTela(page, "Backup gerado."), 1, "sucesso continua"); assert.equal(await naTela(page, "Aviso de teste (não crítico)."), 1, "aviso não crítico continua");
  assert.equal(await naTela(page, "Escolha um arquivo."), 0, "erro não vai para a tela redesenhada"); assert.equal(await naTela(page, "Erro de teste."), 0, "erro não vai para a tela redesenhada");
  await marcarTela(page); await page.goto(srv.url + "#/hoje"); await redesenhada(page); assert.equal(await naTela(page, "Backup gerado."), 1, "e continua ao trocar de tela");
  await ctx.close();
});

T("a mensagem continua durando ~5 s (some sozinha), mesmo depois do redesenho", async () => {
  const { ctx, page } = await aparelho(); await ir(page, "despesas", "#f-desp");
  await page.evaluate(() => { window.__vida = {}; new MutationObserver(() => { const a = [...document.querySelectorAll("#alertas > .alert")].find((e) => e.textContent.includes("Despesa salva."));
    if (a && !window.__vida.ini) window.__vida.ini = performance.now(); if (window.__vida.ini && !a && !window.__vida.fim) window.__vida.fim = performance.now(); }).observe(document.documentElement, { childList: true, subtree: true }); });
  await page.fill('#f-desp [name="descricao"]', "Despesa da duração"); await page.fill('#f-desp [name="valor"]', "10"); await page.click('#f-desp [type="submit"]');
  await page.waitForFunction(() => window.__vida.fim, null, { timeout: 15000 });
  const ms = await page.evaluate(() => window.__vida.fim - window.__vida.ini); assert.ok(ms >= 4500 && ms <= 6500, `visível por ${Math.round(ms)} ms`);
  await ctx.close();
});
