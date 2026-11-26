// Service worker do Salão.gestão — cache VERSIONADO (salao-static-v<versão>).
// Regras: (1) instala em cache novo e só ativa com tudo validado; (2) a versão atual continua funcionando até a nova estar pronta;
// (3) nunca atualiza sozinho — a página decide (após backup); (4) mantém a versão anterior para retorno; (5) NUNCA toca no IndexedDB.
// 11.1: caminhos sempre relativos a este arquivo (funciona em /REPOSITORIO/ no GitHub Pages); recusa arquivo redirecionado
// (ex.: servidor que manda para uma página de login) e nunca responde a uma navegação com resposta redirecionada
// (o Chrome recusa e o app não abre: net::ERR_FAILED); guarda o motivo de uma instalação que falhou para o Diagnóstico.
importScripts("js/versao.js");
const V = self.SALAO_VERSAO, PREFIXO = "salao-static-v", CACHE = PREFIXO + V.versao, META = "salao-meta";
const ARQUIVOS = [...new Set(["index.html", "sw.js", ...V.arquivos])]; // sw.js entra no cache só para o backup da aplicação
const RAIZ = new URL("./", self.location).pathname; // pasta do app, ex.: /REPOSITORIO/
const vnum = (v) => v.split(".").map(Number);
const maior = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
// cópia da resposta sem a marca de "redirecionada"
const limpa = async (r) => new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });

async function baixarValidado(u) {
  const r = await fetch(new Request(u, { cache: "reload" }));
  if (!r.ok) throw new Error(`Falha ao baixar ${u} (HTTP ${r.status})`);
  if (r.redirected) { // só aceita redirecionamento para o mesmo documento (ex.: index.html -> pasta do app)
    const destino = new URL(r.url).pathname, pedido = new URL(u, self.location).pathname;
    if (!(destino === pedido || (u === "index.html" && destino === RAIZ))) throw new Error(`O servidor redirecionou ${u} para ${destino} (ex.: página de login); o arquivo do aplicativo não foi entregue`);
  }
  const ok = r.redirected ? await limpa(r) : r;
  if (u === "index.html") {
    const t = await ok.clone().text(); if (!t.includes("js/app.js") || !t.includes("manifest.webmanifest")) throw new Error("index.html recebido não é o do aplicativo");
  } else if (u === "js/versao.js") {
    if (!(await ok.clone().text()).includes('"versao": "' + V.versao + '"')) throw new Error("versao.js não confere com o service worker");
  } else if (u === "manifest.webmanifest") {
    let m; try { m = JSON.parse(await ok.clone().text()); } catch (_) { throw new Error("manifest.webmanifest não é um JSON válido"); }
    if (!m.name || !m.start_url || !Array.isArray(m.icons) || !m.icons.length) throw new Error("manifest.webmanifest incompleto (name, start_url ou icons)");
  } else if (u.endsWith(".png")) {
    const b = new Uint8Array(await ok.clone().arrayBuffer()); if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) throw new Error(`${u} não é um PNG válido`);
  }
  return ok;
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE), meta = await caches.open(META);
    try {
      for (const u of ARQUIVOS) await c.put(u, await baixarValidado(u)); // baixa e valida cada arquivo antes de aceitar a versão
      if ((await c.keys()).length < ARQUIVOS.length) throw new Error("Cache incompleto");
      await meta.delete("erro-instalacao");
    } catch (err) { // a versão atual segue funcionando; o motivo fica para o Diagnóstico
      await caches.delete(CACHE);
      await meta.put("erro-instalacao", new Response(JSON.stringify({ versao: V.versao, quando: new Date().toISOString(), erro: String(err && err.message || err) }), { headers: { "Content-Type": "application/json" } }));
      throw err;
    }
  })());
});
async function fixada() { const r = await (await caches.open(META)).match("fixada"); return r ? (await r.text()) || null : null; }
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const fix = await fixada(), nomes = (await caches.keys()).filter((k) => k.startsWith(PREFIXO)).sort((a, b) => maior(b.slice(PREFIXO.length), a.slice(PREFIXO.length)));
    const manter = new Set([CACHE]); const anterior = nomes.find((n) => n !== CACHE && maior(n.slice(PREFIXO.length), V.versao) < 0); if (anterior) manter.add(anterior); if (fix) manter.add(PREFIXO + fix);
    if (fix && !nomes.includes(PREFIXO + fix)) await (await caches.open(META)).delete("fixada");
    for (const n of nomes) if (!manter.has(n)) await caches.delete(n); // só caches de arquivos do app; IndexedDB nunca é tocado
    await self.clients.claim();
  })());
});
self.addEventListener("message", (e) => {
  const d = e.data, resp = (x) => e.ports[0] && e.ports[0].postMessage(x);
  if (d === "pular-espera") { self.skipWaiting(); return; }
  e.waitUntil((async () => {
    if (d && d.tipo === "listar-versoes") { const fix = await fixada(); const ns = (await caches.keys()).filter((k) => k.startsWith(PREFIXO)); resp(ns.map((n) => ({ cache: n, versao: n.slice(PREFIXO.length), ativa: n === CACHE, fixada: fix === n.slice(PREFIXO.length) })).sort((a, b) => maior(b.versao, a.versao))); }
    else if (d && d.tipo === "fixar-versao") { if (!(await caches.has(PREFIXO + d.versao))) return resp({ ok: false }); await (await caches.open(META)).put("fixada", new Response(d.versao)); resp({ ok: true }); }
    else if (d && d.tipo === "desafixar") { await (await caches.open(META)).delete("fixada"); resp({ ok: true }); }
  })());
});
self.addEventListener("fetch", (e) => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.cache === "no-store") return; // verificação de atualização e diagnóstico: sempre vão à rede (nunca respondem com o cache)
  e.respondWith((async () => {
    const fix = await fixada(), nome = fix && (await caches.has(PREFIXO + fix)) ? PREFIXO + fix : CACHE;
    const c = (await caches.has(nome)) ? await caches.open(nome) : null; // nunca cria um cache vazio
    let hit = c && ((await c.match(r, { ignoreSearch: true })) || (r.mode === "navigate" ? await c.match("index.html") : null));
    if (hit && hit.redirected) hit = await limpa(hit); // caches antigos podem guardar resposta redirecionada
    return hit || fetch(r);
  })());
});
