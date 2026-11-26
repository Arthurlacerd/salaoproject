// PWA 11.2 em Chromium real: service worker, cache íntegro, offline, IndexedDB/migrations, Diagnóstico sem dados pessoais, medidas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, estadoDados, caches, limpar, DADOS, gravarSaida, VERSAO } from "./_ambiente.js";
const CACHE = "salao-static-v" + VERSAO;

let dir, srv, nav, ctx, page; const medidas = {};
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); ctx = await nav.newContext(); page = await ctx.newPage(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); gravarSaida("medidas-pwa.json", medidas); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);

T("primeira abertura: service worker instala, valida (hash) e controla a página", async () => {
  const reqs = []; page.on("request", (r) => reqs.push(r.url()));
  const t0 = Date.now(); await page.goto(srv.url); await page.waitForSelector("form#f"); medidas.primeira_abertura_ms = Date.now() - t0;
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 }); medidas.sw_pronto_ms = Date.now() - t0;
  medidas.requisicoes_primeira_abertura_pagina = reqs.filter((u) => !u.includes("cache=")).length; // pedidos da página (fora a instalação do SW)
  medidas.requisicoes_servidor_total_inclui_sw = srv.log.length;
  assert.deepEqual(await caches(page), ["salao-meta", CACHE]);
  const r = await page.evaluate(async (CACHE) => { const c = await caches.open(CACHE), V = globalThis.SALAO_VERSAO; return { n: (await c.keys()).length, esperado: new Set(["index.html", "sw.js", ...V.arquivos]).size, erro: !!(await (await caches.open("salao-meta")).match("erro-instalacao")) }; }, CACHE);
  assert.equal(r.n, r.esperado); assert.equal(r.erro, false);
});

T("IndexedDB: banco abre na versão nativa 1, schema 2; migration roda uma única vez", async () => {
  await configurarAdmin(page); await semear(page);
  const e1 = await estadoDados(page); assert.equal(e1.schema, "2"); assert.equal(e1.migracoes, 1);
  const nativa = await page.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === "salao_gestao").version); assert.equal(nativa, 1);
  for (let i = 0; i < 2; i++) { await page.reload(); await page.waitForSelector("#vista"); }
  const e2 = await estadoDados(page); assert.equal(e2.migracoes, 1, "nenhuma migration executada de novo"); assert.deepEqual(e2.cliente, e1.cliente);
});

T("abertura com cache (service worker) e offline completo", async () => {
  const t0 = Date.now(); await page.reload(); await page.waitForSelector("#vista"); medidas.abertura_com_cache_ms = Date.now() - t0;
  await ctx.setOffline(true);
  try {
    const t1 = Date.now(); await page.reload(); await page.waitForSelector("#vista"); medidas.abertura_offline_ms = Date.now() - t1;
    for (const r of ["#/clientes", "#/agenda", "#/financeiro"]) { await page.goto(srv.url + r); await page.waitForSelector("#vista .panel, #vista .empty-state, #vista table, #vista section", { timeout: 10000 }); }
    assert.equal(await page.evaluate(() => globalThis.SALAO_VERSAO.versao), VERSAO);
    assert.equal((await estadoDados(page)).cliente.nome, DADOS.nome);
    // navegação para um endereço do app não cacheado (ex.: atalho antigo) cai no index.html
    await page.goto(srv.url + "?origem=atalho#/hoje"); await page.waitForSelector("#vista");
  } finally { await ctx.setOffline(false); }
});

T("Diagnóstico: todos os itens exigidos, nenhuma falha e nenhum dado pessoal no relatório", async () => {
  await page.goto(srv.url + "#/diagnostico"); await page.waitForSelector("[data-diag]");
  const itens = await page.$$eval("[data-diag]", (els) => els.map((e) => [e.dataset.diag, e.dataset.estado]));
  const ids = itens.map((i) => i[0]);
  for (const id of ["versao", "https", "manifest", "icones", "sw", "cache", "offline", "indexeddb", "persistencia", "atualizacao", "falha", "instalacao"]) assert.ok(ids.includes(id), `falta item ${id}`);
  assert.deepEqual(itens.filter((i) => i[1] === "erro"), [], "nenhuma falha");
  const rel = await page.evaluate(async () => { const D = await import("./js/data/diagnostico.js"); return D.relatorio(await D.executar()); });
  const tela = await page.textContent("#vista");
  for (const proibido of [DADOS.nome, "Maria", "98888", "7777", "123,45", "12345", "Shampoo", "pbkdf2", "senha_hash", "Admin Teste", "Salão Teste"]) {
    assert.ok(!rel.includes(proibido), `relatório contém "${proibido}"`); assert.ok(!tela.includes(proibido), `tela contém "${proibido}"`);
  }
  for (const k of [VERSAO, "Banco nativo v1", "schema v2", "Identidade do app", "Origem"]) assert.ok(rel.includes(k), `relatório sem "${k}"`);
  assert.ok(rel.includes(`[OK] Cache: ${CACHE} íntegro`), "cache íntegro no relatório");
  gravarSaida("relatorio-diagnostico.txt", rel);
});

T("manifest servido: JSON válido, sem id, identidade = pasta do app", async () => {
  const m = await page.evaluate(async () => (await fetch("manifest.webmanifest", { cache: "no-store" })).json());
  assert.equal(m.id, undefined); assert.equal(new URL(m.start_url, srv.url).href.split("#")[0], srv.url);
});
