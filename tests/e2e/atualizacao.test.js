// Atualização REAL 11.1.0 (commit publicado) → 11.2.0 em Chromium, com o mesmo perfil de navegador do começo ao fim:
// publicação parcial/CDN desatualizada recusada, backup antes de atualizar, dados preservados, troca do SW, retorno de versão
// seguro, bloqueio de versão incompatível e rota de emergência (?recuperar=1).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { semNavegador, versaoAtual, versaoGit, servidor, navegador, abrir, configurarAdmin, semear, estadoDados, caches, limpar, gravarSaida, REF_ANTERIOR } from "./_ambiente.js";

let d11, d12, srv, nav, ctx, page, e0; const medidas = {};
before(async () => {
  if (semNavegador) return; d11 = versaoGit(); if (!d11) return; d12 = versaoAtual();
  srv = await servidor(d11); nav = await navegador(); ctx = await nav.newContext(); page = await ctx.newPage();
});
after(async () => { if (!nav) return; await nav.close(); await srv.fechar(); limpar(d11, d12); gravarSaida("medidas-atualizacao.json", medidas); });
const T = (nome, fn) => test(nome, { skip: semNavegador || (!d11 && `referência ${REF_ANTERIOR} (11.1.0) ausente neste clone`) }, fn);
const versao = () => page.evaluate(() => globalThis.SALAO_VERSAO.versao);
const meta = (chave) => page.evaluate(async (k) => { const r = await (await caches.open("salao-meta")).match(k); return r ? r.text() : null; }, chave);
async function pararSW() { const cdp = await ctx.newCDPSession(page); await cdp.send("ServiceWorker.enable"); await cdp.send("ServiceWorker.stopAllWorkers"); await cdp.detach(); } // simula o SW "dormindo"
async function atualizarSW() { // pede ao navegador para procurar a nova versão e espera o resultado da instalação
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); const w = reg.installing || reg.waiting; if (!w) return "nada";
    return new Promise((ok) => { const f = () => (w.state === "redundant" || w.state === "installed") && ok(w.state); w.addEventListener("statechange", f); f(); });
  });
}
const recarregar = async () => { await page.reload(); await page.waitForSelector("#vista"); };

T("11.1.0 instalada com dados reais de uso", async () => {
  await abrir(page, srv.url); await configurarAdmin(page); await semear(page);
  assert.equal(await versao(), "11.1.0"); e0 = await estadoDados(page);
  assert.deepEqual(await caches(page), ["salao-meta", "salao-static-v11.1.0"]);
  assert.ok(e0.clientes === 1 && e0.atendimentos === 1 && e0.pagamentos === 1 && e0.despesas === 1);
});

T("publicação parcial / CDN desatualizada: a 11.2.0 é RECUSADA inteira e a 11.1.0 continua funcionando", async () => {
  srv.publicar(d12); srv.sobrepor("js/data/manutencao.js", readFileSync(path.join(d11, "js/data/manutencao.js"))); // um arquivo ainda antigo
  assert.equal(await atualizarSW(), "redundant");
  const erro = JSON.parse(await meta("erro-instalacao")); assert.equal(erro.versao, "11.2.0"); assert.match(erro.erro, /manutencao\.js não confere/);
  assert.deepEqual(await caches(page), ["salao-meta", "salao-static-v11.1.0"], "nenhum cache parcial da 11.2.0");
  await recarregar(); assert.equal(await versao(), "11.1.0"); const { backups: _b, ...e } = await estadoDados(page), { backups: _c, ...esperado } = e0; assert.deepEqual(e, esperado);
});

T("versao.js de outra versão (publicação em andamento) também é recusado", async () => {
  srv.sobrepor("js/data/manutencao.js", null); srv.sobrepor("js/versao.js", readFileSync(path.join(d11, "js/versao.js")));
  // sw.js novo + versao.js antigo (sem hashes): o SW não consegue provar a integridade de nenhum arquivo => recusa
  assert.equal(await atualizarSW(), "redundant");
  assert.ok(!(await caches(page)).includes("salao-static-v11.2.0"));
  srv.sobrepor("js/versao.js", null); await recarregar(); assert.equal(await versao(), "11.1.0");
});

T("atualização 11.1.0 → 11.2.0 pela interface: backup antes, troca do SW, dados preservados", async () => {
  assert.equal(await atualizarSW(), "installed");
  await page.waitForSelector("#update-banner:not([hidden]) #botao-atualizar", { timeout: 10000 });
  const t0 = Date.now();
  await Promise.all([page.waitForEvent("framenavigated", { timeout: 60000 }), page.click("#botao-atualizar")]);
  await page.waitForFunction(() => globalThis.SALAO_VERSAO?.versao === "11.2.0", null, { timeout: 30000 }); await page.waitForSelector("#vista");
  medidas.atualizacao_ms = Date.now() - t0;
  const e1 = await estadoDados(page);
  assert.equal(e1.versao, "11.2.0");
  for (const k of ["clientes", "atendimentos", "pagamentos", "despesas", "usuarios", "servicos", "cliente", "atendimento", "schema", "migracoes"]) assert.deepEqual(e1[k], e0[k], `dado preservado: ${k}`);
  assert.ok(e1.backups.includes("pre_atualizacao"), "backup antes da atualização");
  assert.deepEqual(await caches(page), ["salao-meta", "salao-static-v11.1.0", "salao-static-v11.2.0"], "versão anterior guardada para retorno");
  assert.equal(await meta("erro-instalacao"), null, "falha antiga apagada após sucesso");
  const sw = await page.evaluate(async () => (await import("./js/data/manutencao.js")).estadoSW()); assert.equal(sw.versao, "11.2.0"); assert.equal(sw.fixada, null);
  const nativa = await page.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === "salao_gestao").version); assert.equal(nativa, 1, "IndexedDB sem mudança de versão");
});

T("retorno seguro 11.2.0 → 11.1.0 e volta para a mais recente, sem perda de dados", async () => {
  await page.evaluate(async () => (await import("./js/data/manutencao.js")).voltarVersao("11.1.0"));
  await recarregar(); assert.equal(await versao(), "11.1.0"); assert.equal((await estadoDados(page)).cliente.nome, e0.cliente.nome);
  assert.ok((await estadoDados(page)).backups.includes("pre_retorno_versao"));
  await page.evaluate(async () => (await import("./js/data/manutencao.js")).usarMaisRecente()); // código da própria 11.1.0
  await recarregar(); assert.equal(await versao(), "11.2.0");
});

T("P1: versão com banco mais antigo é bloqueada (página e service worker) e um pino incompatível é ignorado", async () => {
  await page.evaluate(async () => { // simula versões antigas guardadas: banco 0 (estrutura anterior) e schema 1
    const base = await (await (await caches.open("salao-static-v11.2.0")).match("js/versao.js")).text();
    for (const [v, campo, valor] of [["11.0.9", "banco", 0], ["11.0.8", "schema", 1]]) {
      const txt = base.replace('"versao": "11.2.0"', `"versao": "${v}"`).replace(new RegExp(`"${campo}": \\d+`), `"${campo}": ${valor}`);
      const c = await caches.open("salao-static-v" + v); await c.put("js/versao.js", new Response(txt)); await c.put("index.html", await (await caches.open("salao-static-v11.2.0")).match("index.html"));
    }
  });
  const r = await page.evaluate(async () => { const M = await import("./js/data/manutencao.js"); const a = await M.podeVoltarPara("11.0.9"), b = await M.podeVoltarPara("11.0.8"); let erro = ""; try { await M.voltarVersao("11.0.9"); } catch (e) { erro = e.message; } return { a, b, erro, sw: await M.swMsg({ tipo: "fixar-versao", versao: "11.0.9" }) }; });
  assert.equal(r.a.ok, false); assert.match(r.a.motivo, /mais antiga/); assert.equal(r.b.ok, false); assert.match(r.erro, /bloqueado/);
  assert.equal(r.sw.ok, false, "o service worker também recusa"); assert.equal(await meta("fixada"), null);
  // pino incompatível gravado por fora (ex.: pela lógica invertida da 11.1): o SW 11.2 não serve essa versão e desafixa
  await page.evaluate(async () => (await caches.open("salao-meta")).put("fixada", new Response("11.0.9")));
  await pararSW(); await recarregar();
  assert.equal(await versao(), "11.2.0"); assert.equal(await meta("fixada"), null);
});

T("emergência: ?recuperar=1 desafixa e abre a versão atual; a marca sai da barra de endereço", async () => {
  await page.evaluate(async () => (await import("./js/data/manutencao.js")).voltarVersao("11.1.0"));
  await recarregar(); assert.equal(await versao(), "11.1.0");
  await page.goto(srv.url + "?recuperar=1#/hoje"); await page.waitForSelector("#vista");
  assert.equal(await versao(), "11.2.0"); assert.equal(await meta("fixada"), null); assert.ok(!page.url().includes("recuperar"));
  assert.equal((await estadoDados(page)).cliente.nome, e0.cliente.nome);
});

// Atualização feita pelo CÓDIGO 11.2 (as próximas versões): 11.2.0 → 11.2.1 sintética, na mesma sessão da instalação.
test("atualização 11.2.0 → próxima versão pelo código 11.2, na mesma sessão da instalação (recarrega uma vez)", { skip: semNavegador }, async () => {
  const { execFileSync } = await import("node:child_process"), { writeFileSync } = await import("node:fs"), { RAIZ } = await import("./_ambiente.js");
  const a = versaoAtual(), b = versaoAtual(), s = await servidor(a), n = await navegador(), p = await (await n.newContext()).newPage();
  try {
    const f = path.join(b, "js/versao.js"); writeFileSync(f, readFileSync(f, "utf8").replace('"versao": "11.2.0"', '"versao": "11.2.1"'));
    execFileSync("python3", [path.join(RAIZ, "tools/construir_pwa.py"), "--raiz", b, "--quieto"]); // build da versão sintética
    await abrir(p, s.url); await configurarAdmin(p); await semear(p); // 1ª sessão: a página começou SEM controlador
    s.publicar(b); await p.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await p.waitForSelector("#update-banner:not([hidden]) #botao-atualizar", { timeout: 15000 });
    let navs = 0; p.on("framenavigated", (fr) => fr === p.mainFrame() && navs++);
    await p.click("#botao-atualizar"); await p.waitForFunction(() => globalThis.SALAO_VERSAO?.versao === "11.2.1", null, { timeout: 30000 }); await p.waitForSelector("#vista");
    await p.waitForTimeout(1500); assert.equal(navs, 1, "exatamente uma recarga");
    const e = await estadoDados(p); assert.equal(e.clientes, 1); assert.ok(e.backups.includes("pre_atualizacao"));
    assert.deepEqual(await p.evaluate(async () => (await caches.keys()).sort()), ["salao-meta", "salao-static-v11.2.0", "salao-static-v11.2.1"]);
  } finally { await n.close(); await s.fechar(); limpar(a, b); }
});
