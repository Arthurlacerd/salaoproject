// Service worker do Salão.gestão — cache VERSIONADO (salao-static-v<versão>).
// Regras: (1) instala em cache novo e só ativa com tudo validado; (2) a versão atual continua funcionando até a nova estar pronta;
// (3) nunca atualiza sozinho — a página decide (após backup); (4) mantém a versão anterior para retorno; (5) NUNCA toca no IndexedDB.
importScripts("js/versao.js");
const V = self.SALAO_VERSAO, PREFIXO = "salao-static-v", CACHE = PREFIXO + V.versao, META = "salao-meta";
const ARQUIVOS = [...new Set(["index.html", "sw.js", ...V.arquivos])]; // sw.js entra no cache só para o backup da aplicação
const vnum = (v) => v.split(".").map(Number);
const maior = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try {
      for (const u of ARQUIVOS) { // baixa e valida cada arquivo antes de aceitar a versão
        const r = await fetch(new Request(u, { cache: "reload" }));
        if (!r.ok) throw new Error("Falha ao baixar " + u + " (" + r.status + ")");
        if (u === "js/versao.js" && !(await r.clone().text()).includes('"versao": "' + V.versao + '"')) throw new Error("versao.js não confere com o service worker");
        await c.put(u, r);
      }
      if ((await c.keys()).length < ARQUIVOS.length) throw new Error("Cache incompleto");
    } catch (err) { await caches.delete(CACHE); throw err; } // a versão atual segue funcionando
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
  if (r.cache === "no-store") return; // verificação de atualização: sempre vai à rede (nunca responde com o cache)
  e.respondWith((async () => {
    const fix = await fixada(), c = await caches.open(fix && (await caches.has(PREFIXO + fix)) ? PREFIXO + fix : CACHE);
    const hit = (await c.match(r, { ignoreSearch: true })) || (r.mode === "navigate" ? await c.match("index.html") : null);
    return hit || fetch(r);
  })());
});
