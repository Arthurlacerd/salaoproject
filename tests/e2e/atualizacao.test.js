// Atualização REAL a partir de versões publicadas (código extraído do git) até a versão em teste, em Chromium, com o
// mesmo perfil de navegador do começo ao fim: publicação parcial/CDN desatualizada recusada, backup antes de atualizar,
// dados preservados, troca do SW, retorno de versão seguro, bloqueio de versão incompatível e rota de emergência.
// 11.3: a versão em teste não é mais fixa no código; roda para 11.1.0 → atual e 11.2.0 → atual (caminho de produção).
// 11.3: retorno só para versões >= 11.3.0 (as anteriores restauram backups sem login): voltar para 11.1/11.2 é RECUSADO.
// 11.3.1: também 11.3.0 → atual (a versão em produção). A tela só oferece "Voltar para esta" a versões permitidas: as
// bloqueadas (11.1/11.2) aparecem com o motivo e sem botão; o retorno para a 11.3.0 é feito e desfeito PELA TELA.
// 11.3.2: também 11.3.1 → atual e o retorno atual → 11.3.1; a versão anterior lê as cópias com o campo novo "bytes".
// 11.4: também 11.3.2 → atual. O arquivo "ainda antigo" da publicação parcial precisa ser DIFERENTE entre as duas versões
// (antes era sempre manutencao.js, que a 11.4 não alterou): usa manutencao.js quando ele mudou, senão o primeiro que mudou.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { semNavegador, versaoAtual, versaoGit, refExiste, servidor, navegador, abrir, configurarAdmin, semear, estadoDados, caches, limpar, gravarSaida, VERSAO, RAIZ } from "./_ambiente.js";

const PARTIDAS = [["11.1.0", process.env.SALAO_REF_ANTERIOR || "b8061f2adda083ff76476e10196960105a4b6813"], ["11.2.0", process.env.SALAO_REF_11_2 || "20218e20e782e241ad96b7912cccf0ef6b831bc8"],
  ["11.3.0", process.env.SALAO_REF_11_3 || "1e7acea9166443238cfe6ddb31108c3661dcd35b"], ["11.3.1", process.env.SALAO_REF_11_3_1 || "f6fc328f7110ad23c450bff1270e7298bd3f3f5d"],
  ["11.3.2", process.env.SALAO_REF_11_3_2 || "b67c23d8bff9a68f48270280525a6cdf69fb7f74"]]; // 11.4: também 11.3.2 → atual e o retorno atual → 11.3.2
const CACHE = (v) => "salao-static-v" + v;
const cmpV = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const DADOS_PRESERVADOS = ["clientes", "atendimentos", "pagamentos", "despesas", "usuarios", "servicos", "cliente", "atendimento", "schema", "migracoes"];
const medidas = {};
/** Um arquivo do app (lista de cache da versão atual, menos versao.js) que difere entre as duas versões. */
function arquivoQueMudou(dAnt, dAtual) {
  const lista = Object.keys(JSON.parse(readFileSync(path.join(dAtual, "js/versao.js"), "utf8").match(/SALAO_VERSAO\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)[1]).integridade).filter((f) => f !== "js/versao.js");
  const muda = (f) => { try { return !readFileSync(path.join(dAnt, f)).equals(readFileSync(path.join(dAtual, f))); } catch (_) { return false; } };
  return muda("js/data/manutencao.js") ? "js/data/manutencao.js" : lista.find(muda);
}
after(() => gravarSaida("medidas-atualizacao.json", medidas));

for (const [ANTERIOR, REF] of PARTIDAS) describe(`atualização ${ANTERIOR} → ${VERSAO}`, () => {
  let dAnt, dAtual, srv, nav, ctx, page, e0, VELHO;
  before(async () => {
    if (semNavegador) return; dAnt = versaoGit(REF); if (!dAnt) return; dAtual = versaoAtual();
    srv = await servidor(dAnt); nav = await navegador(); ctx = await nav.newContext(); page = await ctx.newPage();
  });
  after(async () => { if (!nav) return; await nav.close(); await srv.fechar(); limpar(dAnt, dAtual); });
  const T = (nome, fn) => test(nome, { skip: semNavegador || (!refExiste(REF) && `referência ${REF} (${ANTERIOR}) ausente neste clone`) }, fn);
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
  const semCopias = ({ backups, ...e }) => e;

  T(`${ANTERIOR} instalada com dados reais de uso`, async () => {
    await abrir(page, srv.url); await configurarAdmin(page); await semear(page);
    assert.equal(await versao(), ANTERIOR); e0 = await estadoDados(page);
    assert.deepEqual(await caches(page), ["salao-meta", CACHE(ANTERIOR)]);
    assert.ok(e0.clientes === 1 && e0.atendimentos === 1 && e0.pagamentos === 1 && e0.despesas === 1);
  });

  T(`publicação parcial / CDN desatualizada: a ${VERSAO} é RECUSADA inteira e a ${ANTERIOR} continua funcionando`, async () => {
    VELHO = arquivoQueMudou(dAnt, dAtual);
    srv.publicar(dAtual); srv.sobrepor(VELHO, readFileSync(path.join(dAnt, VELHO))); // um arquivo ainda antigo
    assert.equal(await atualizarSW(), "redundant");
    const erro = JSON.parse(await meta("erro-instalacao")); assert.equal(erro.versao, VERSAO); assert.match(erro.erro, new RegExp(VELHO.split("/").pop().replace(/\./g, "\\.") + " não confere"));
    assert.deepEqual(await caches(page), ["salao-meta", CACHE(ANTERIOR)], `nenhum cache parcial da ${VERSAO}`);
    await recarregar(); assert.equal(await versao(), ANTERIOR); assert.deepEqual(semCopias(await estadoDados(page)), semCopias(e0));
  });

  T("versao.js de outra versão (publicação em andamento) nunca mistura versões", async () => {
    srv.sobrepor(VELHO, null); srv.sobrepor("js/versao.js", readFileSync(path.join(dAnt, "js/versao.js")));
    // o navegador não vê mudança (sw.js e versao.js iguais aos em uso) ou o SW recusa por integridade — nunca instala mistura
    assert.ok(["redundant", "nada"].includes(await atualizarSW()));
    assert.ok(!(await caches(page)).includes(CACHE(VERSAO)));
    srv.sobrepor("js/versao.js", null); await recarregar(); assert.equal(await versao(), ANTERIOR);
  });

  T(`atualização ${ANTERIOR} → ${VERSAO} pela interface: backup antes, troca do SW, dados preservados`, async () => {
    assert.equal(await atualizarSW(), "installed");
    await page.waitForSelector("#update-banner:not([hidden]) #botao-atualizar", { timeout: 10000 });
    const t0 = Date.now();
    await Promise.all([page.waitForEvent("framenavigated", { timeout: 60000 }), page.click("#botao-atualizar")]);
    await page.waitForFunction((v) => globalThis.SALAO_VERSAO?.versao === v, VERSAO, { timeout: 30000 }); await page.waitForSelector("#vista");
    medidas[`${ANTERIOR}->${VERSAO}_ms`] = Date.now() - t0;
    const e1 = await estadoDados(page);
    assert.equal(e1.versao, VERSAO);
    for (const k of ["clientes", "atendimentos", "pagamentos", "despesas", "usuarios", "servicos", "cliente", "atendimento", "schema", "migracoes"]) assert.deepEqual(e1[k], e0[k], `dado preservado: ${k}`);
    assert.ok(e1.backups.includes("pre_atualizacao"), "backup antes da atualização");
    assert.deepEqual(await caches(page), ["salao-meta", CACHE(ANTERIOR), CACHE(VERSAO)].sort(), "versão anterior guardada para retorno");
    assert.equal(await meta("erro-instalacao"), null, "falha antiga apagada após sucesso");
    const sw = await page.evaluate(async () => (await import("./js/data/manutencao.js")).estadoSW()); assert.equal(sw.versao, VERSAO); assert.equal(sw.fixada, null);
    const nativa = await page.evaluate(async () => (await indexedDB.databases()).find((d) => d.name === "salao_gestao").version); assert.equal(nativa, 1, "IndexedDB sem mudança de versão");
  });

  if (cmpV(ANTERIOR, "11.3.0") < 0) {
  T(`retorno ${VERSAO} → ${ANTERIOR} RECUSADO (abaixo da versão mínima segura 11.3.0): página e service worker; um pino antigo nunca é servido`, async () => {
    const r = await page.evaluate(async (v) => { const M = await import("./js/data/manutencao.js"); const p = await M.podeVoltarPara(v); let erro = ""; try { await M.voltarVersao(v); } catch (e) { erro = e.message; }
      return { minima: M.VERSAO_MINIMA_RETORNO, p, erro, sw: await M.swMsg({ tipo: "fixar-versao", versao: v }) }; }, ANTERIOR);
    assert.equal(r.minima, "11.3.0");
    assert.equal(r.p.ok, false); assert.match(r.p.motivo, /antiga demais para um retorno seguro/);
    assert.match(r.erro, /antiga demais para um retorno seguro/, "a função usada pela tela também recusa");
    assert.equal(r.sw.ok, false, "o service worker também recusa"); assert.match(r.sw.motivo, /antiga demais para um retorno seguro/);
    assert.equal(await meta("fixada"), null, "nada foi fixado");
    await page.evaluate(async (v) => (await caches.open("salao-meta")).put("fixada", new Response(v)), ANTERIOR); // pino abaixo do mínimo gravado por fora
    await pararSW(); await recarregar();
    assert.equal(await versao(), VERSAO, "o service worker não serve a versão antiga"); assert.equal(await meta("fixada"), null, "e desfaz o pino");
  });

  T(`${ANTERIOR} pela TELA: aparece como "não pode ser usada para retorno seguro", com o motivo e SEM o botão "Voltar para esta"; nada muda (versão, dados, cópias, caches)`, async () => {
    const antes = { versao: await versao(), dados: await estadoDados(page), caches: await caches(page) };
    await page.goto(srv.url + "#/manutencao"); await page.waitForSelector(`[data-retorno-bloqueado="${ANTERIOR}"]`);
    assert.match(await page.textContent(`[data-retorno-bloqueado="${ANTERIOR}"]`), new RegExp(`^Não pode ser usada para retorno seguro: a versão ${ANTERIOR.replace(/\./g, "\\.")} é antiga demais para um retorno seguro`));
    assert.equal(await page.$$eval(`[data-voltar="${ANTERIOR}"]`, (l) => l.length), 0, "sem botão de retorno para a versão bloqueada");
    assert.equal(await page.$$eval(`[data-voltar="${VERSAO}"]`, (l) => l.length), 0, "nem para a versão em uso");
    // a função que o botão chamava continua recusando (defesa em profundidade: a tela não é a única barreira)
    const erro = await page.evaluate(async (v) => { try { await (await import("./js/data/manutencao.js")).voltarVersao(v); return ""; } catch (e) { return e.message; } }, ANTERIOR);
    assert.match(erro, /antiga demais para um retorno seguro/);
    await recarregar();
    assert.equal(await versao(), antes.versao); assert.equal(await meta("fixada"), null);
    assert.deepEqual(await estadoDados(page), antes.dados, "dados e cópias idênticos (nem a cópia pre_retorno_versao foi criada)");
    assert.deepEqual(await caches(page), antes.caches);
  });
  } else {
  T(`retorno ${VERSAO} → ${ANTERIOR} PERMITIDO pela TELA ("Voltar para esta"): ${ANTERIOR} em uso, dados preservados e consistentes, cópia antes; "Usar a mais recente" e ?recuperar=1 voltam para a ${VERSAO}`, async () => {
    const e1 = await estadoDados(page);
    await page.goto(srv.url + "#/manutencao"); await page.waitForSelector(`[data-voltar="${ANTERIOR}"]`);
    assert.equal((await page.textContent(`[data-voltar="${ANTERIOR}"]`)).trim(), "Voltar para esta");
    assert.equal(await page.$$eval(`[data-retorno-bloqueado="${ANTERIOR}"]`, (l) => l.length), 0, "versão compatível: sem aviso de bloqueio");
    await page.click(`[data-voltar="${ANTERIOR}"]`);
    await Promise.all([page.waitForEvent("framenavigated", { timeout: 60000 }), page.click(".modal [data-ok]")]);
    await page.waitForFunction((v) => globalThis.SALAO_VERSAO?.versao === v, ANTERIOR, { timeout: 30000 }); await page.waitForSelector("#vista");
    assert.equal(await meta("fixada"), ANTERIOR, `${ANTERIOR} fixada e em uso`);
    const e2 = await estadoDados(page); assert.equal(e2.versao, ANTERIOR);
    for (const k of DADOS_PRESERVADOS) assert.deepEqual(e2[k], e1[k], `dado preservado: ${k}`);
    assert.ok(e2.backups.includes("pre_retorno_versao"), "cópia antes do retorno");
    const cp = await page.evaluate(async () => { const B = await import("./js/data/backup.js"); const s = (await B.snapshots()).find((x) => x.motivo === "pre_retorno_versao");
      return { bytes: s.bytes, tamanho: s.tamanho, ok: (await B.validar(await B.snapshotTexto(s.id))).ok }; });
    assert.ok(Number.isFinite(cp.bytes) && cp.bytes >= cp.tamanho, `a cópia gravada pela ${VERSAO} tem "bytes"`);
    assert.equal(cp.ok, true, `a ${ANTERIOR} lê e valida a cópia gravada pela ${VERSAO} (com o campo novo "bytes")`);
    const c = await page.evaluate(async () => { const r = await (await import("./js/data/backup.js")).criarValidado(); return { ok: r.consistente, erros: r.rel.erros }; });
    assert.equal(c.ok, true, `a ${ANTERIOR} lê os dados deixados pela ${VERSAO} sem inconsistência: ${c.erros.join(" | ")}`);
    // "Usar a mais recente" (tela da própria ${ANTERIOR})
    await page.goto(srv.url + "#/manutencao"); await page.waitForSelector(`[data-voltar="${ANTERIOR}"]`);
    assert.match(await page.textContent(`[data-voltar="${ANTERIOR}"]`), /Usar a mais recente/);
    await Promise.all([page.waitForEvent("framenavigated", { timeout: 60000 }), page.click(`[data-voltar="${ANTERIOR}"]`)]);
    await page.waitForFunction((v) => globalThis.SALAO_VERSAO?.versao === v, VERSAO, { timeout: 30000 }); await page.waitForSelector("#vista");
    assert.equal(await meta("fixada"), null);
    // rota de emergência: fixa de novo e sai com ?recuperar=1
    await page.evaluate(async (v) => (await import("./js/data/manutencao.js")).voltarVersao(v), ANTERIOR); await recarregar(); assert.equal(await versao(), ANTERIOR);
    await page.goto(srv.url + "?recuperar=1#/hoje"); await page.waitForSelector("#vista");
    assert.equal(await versao(), VERSAO); assert.equal(await meta("fixada"), null); assert.ok(!page.url().includes("recuperar"));
    const e3 = await estadoDados(page); for (const k of DADOS_PRESERVADOS) assert.deepEqual(e3[k], e1[k], `dado preservado após voltar: ${k}`);
  });
  }

  T("P1: versão com banco mais antigo é bloqueada (página e service worker) e um pino incompatível é ignorado", async () => {
    await page.evaluate(async (V) => { // simula versões antigas guardadas: banco 0 (estrutura anterior) e schema 1
      const atual = await caches.open("salao-static-v" + V), base = await (await atual.match("js/versao.js")).text();
      for (const [v, campo, valor] of [["9.9.9", "banco", 0], ["9.9.8", "schema", 1]]) {
        const txt = base.replace(`"versao": "${V}"`, `"versao": "${v}"`).replace(new RegExp(`"${campo}": \\d+`), `"${campo}": ${valor}`);
        const c = await caches.open("salao-static-v" + v); await c.put("js/versao.js", new Response(txt)); await c.put("index.html", await atual.match("index.html"));
      }
    }, VERSAO);
    const r = await page.evaluate(async () => { const M = await import("./js/data/manutencao.js"); const a = await M.podeVoltarPara("9.9.9"), b = await M.podeVoltarPara("9.9.8"); let erro = ""; try { await M.voltarVersao("9.9.9"); } catch (e) { erro = e.message; } return { a, b, erro, sw: await M.swMsg({ tipo: "fixar-versao", versao: "9.9.9" }) }; });
    assert.equal(r.a.ok, false); assert.match(r.a.motivo, /mais antiga/); assert.equal(r.b.ok, false); assert.match(r.erro, /bloqueado/);
    assert.equal(r.sw.ok, false, "o service worker também recusa"); assert.equal(await meta("fixada"), null);
    await page.evaluate(async () => (await caches.open("salao-meta")).put("fixada", new Response("9.9.9"))); // pino incompatível gravado por fora
    await pararSW(); await recarregar();
    assert.equal(await versao(), VERSAO); assert.equal(await meta("fixada"), null);
  });

  T("11.3.1: versões incompatíveis aparecem na TELA com o motivo e sem botão de retorno", async () => {
    await page.goto(srv.url + "#/manutencao"); await page.waitForSelector('[data-retorno-bloqueado="9.9.9"]');
    assert.match(await page.textContent('[data-retorno-bloqueado="9.9.9"]'), /^Não pode ser usada para retorno seguro: a versão 9\.9\.9 usa a estrutura de dados v0, mais antiga que a atual/);
    assert.match(await page.textContent('[data-retorno-bloqueado="9.9.8"]'), /^Não pode ser usada para retorno seguro: a versão 9\.9\.8 não conhece as atualizações de dados/);
    assert.equal(await page.$$eval('[data-voltar="9.9.9"], [data-voltar="9.9.8"]', (l) => l.length), 0, "sem botão para versões incompatíveis");
    assert.equal(await meta("fixada"), null);
  });

  T("emergência: ?recuperar=1 desafixa e abre a versão atual; a marca sai da barra de endereço", async () => {
    // só uma versão >= 11.3.0 pode ser fixada: uma cópia guardada sintética, compatível e segura, com todos os arquivos
    const SEGURA = await page.evaluate(async (V) => { const [a, b, c] = V.split(".").map(Number), s = `${a}.${b}.${c + 7}`;
      const atual = await caches.open("salao-static-v" + V), nova = await caches.open("salao-static-v" + s);
      for (const req of await atual.keys()) { const r = await atual.match(req); await nova.put(req, req.url.endsWith("/js/versao.js") ? new Response((await r.text()).replace(`"versao": "${V}"`, `"versao": "${s}"`), { headers: r.headers }) : r); }
      return s; }, VERSAO);
    await page.evaluate(async (v) => (await import("./js/data/manutencao.js")).voltarVersao(v), SEGURA);
    await recarregar(); assert.equal(await versao(), SEGURA, "a versão fixada está em uso");
    await page.goto(srv.url + "?recuperar=1#/hoje"); await page.waitForSelector("#vista");
    assert.equal(await versao(), VERSAO); assert.equal(await meta("fixada"), null); assert.ok(!page.url().includes("recuperar"));
    assert.equal((await estadoDados(page)).cliente.nome, e0.cliente.nome);
  });
});

// Retorno PERMITIDO para a versão mínima segura: a próxima versão (sintética, código atual) volta para a versão em teste.
test(`retorno para a versão mínima segura: próxima → ${VERSAO} é PERMITIDO (dados preservados); "Usar a mais recente" e ?recuperar=1 voltam`, { skip: semNavegador }, async () => {
  const [ma, mi, pa] = VERSAO.split(".").map(Number), PROXIMA = `${ma}.${mi}.${pa + 1}`;
  const a = versaoAtual(), b = versaoAtual(), s = await servidor(a), n = await navegador(), p = await (await n.newContext()).newPage();
  const ver = () => p.evaluate(() => globalThis.SALAO_VERSAO.versao), rec = async () => { await p.reload(); await p.waitForSelector("#vista"); };
  const voltar = (v) => p.evaluate(async (v) => (await import("./js/data/manutencao.js")).voltarVersao(v), v);
  try {
    const f = path.join(b, "js/versao.js"); writeFileSync(f, readFileSync(f, "utf8").replace(`"versao": "${VERSAO}"`, `"versao": "${PROXIMA}"`));
    execFileSync("python3", [path.join(RAIZ, "tools/construir_pwa.py"), "--raiz", b, "--quieto"]);
    await abrir(p, s.url); await configurarAdmin(p); await semear(p); const e0 = await estadoDados(p);
    s.publicar(b); await p.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await p.waitForSelector("#update-banner:not([hidden]) #botao-atualizar", { timeout: 15000 });
    await p.click("#botao-atualizar"); await p.waitForFunction((v) => globalThis.SALAO_VERSAO?.versao === v, PROXIMA, { timeout: 30000 }); await p.waitForSelector("#vista");
    const pode = await p.evaluate(async (v) => (await import("./js/data/manutencao.js")).podeVoltarPara(v), VERSAO); assert.equal(pode.ok, true, pode.motivo);
    await voltar(VERSAO); await rec(); assert.equal(await ver(), VERSAO, `${VERSAO} (a versão mínima segura) aceita e em uso`);
    const e1 = await estadoDados(p); assert.ok(e1.backups.includes("pre_retorno_versao"));
    for (const k of ["clientes", "atendimentos", "pagamentos", "despesas", "usuarios", "servicos", "cliente", "atendimento"]) assert.deepEqual(e1[k], e0[k], `dado preservado: ${k}`);
    await p.evaluate(async () => (await import("./js/data/manutencao.js")).usarMaisRecente()); await rec(); assert.equal(await ver(), PROXIMA, "Usar a mais recente (código da versão fixada)");
    await voltar(VERSAO); await rec(); assert.equal(await ver(), VERSAO);
    await p.goto(s.url + "?recuperar=1#/hoje"); await p.waitForSelector("#vista");
    assert.equal(await ver(), PROXIMA, "?recuperar=1 desafixa e abre a mais recente");
    assert.equal(await p.evaluate(async () => (await (await caches.open("salao-meta")).match("fixada")) ?? null), null);
    assert.equal((await estadoDados(p)).cliente.nome, e0.cliente.nome);
  } finally { await n.close(); await s.fechar(); limpar(a, b); }
});

// Atualização feita pelo CÓDIGO da versão em teste (as próximas versões): atual → próxima (sintética), na mesma sessão da instalação.
test(`atualização ${VERSAO} → próxima versão pelo código atual, na mesma sessão da instalação (recarrega uma vez)`, { skip: semNavegador }, async () => {
  const [ma, mi, pa] = VERSAO.split(".").map(Number), PROXIMA = `${ma}.${mi}.${pa + 1}`;
  const a = versaoAtual(), b = versaoAtual(), s = await servidor(a), n = await navegador(), p = await (await n.newContext()).newPage();
  try {
    const f = path.join(b, "js/versao.js"); writeFileSync(f, readFileSync(f, "utf8").replace(`"versao": "${VERSAO}"`, `"versao": "${PROXIMA}"`));
    execFileSync("python3", [path.join(RAIZ, "tools/construir_pwa.py"), "--raiz", b, "--quieto"]); // build da versão sintética
    await abrir(p, s.url); await configurarAdmin(p); await semear(p); // 1ª sessão: a página começou SEM controlador
    s.publicar(b); await p.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await p.waitForSelector("#update-banner:not([hidden]) #botao-atualizar", { timeout: 15000 });
    let navs = 0; p.on("framenavigated", (fr) => fr === p.mainFrame() && navs++);
    await p.click("#botao-atualizar"); await p.waitForFunction((v) => globalThis.SALAO_VERSAO?.versao === v, PROXIMA, { timeout: 30000 }); await p.waitForSelector("#vista");
    await p.waitForTimeout(1500); assert.equal(navs, 1, "exatamente uma recarga");
    const e = await estadoDados(p); assert.equal(e.clientes, 1); assert.ok(e.backups.includes("pre_atualizacao"));
    assert.deepEqual(await p.evaluate(async () => (await caches.keys()).sort()), ["salao-meta", CACHE(VERSAO), CACHE(PROXIMA)].sort());
  } finally { await n.close(); await s.fechar(); limpar(a, b); }
});
