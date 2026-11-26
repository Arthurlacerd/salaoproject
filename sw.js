// Service worker do Salão.gestão — cache VERSIONADO (salao-static-v<versão>).
// Regras: (1) instala em cache novo e só ativa com tudo validado; (2) a versão atual continua funcionando até a nova estar pronta;
// (3) nunca atualiza sozinho — a página decide (após backup); (4) mantém a versão anterior para retorno; (5) NUNCA toca no IndexedDB.
// 11.1: caminhos sempre relativos a este arquivo (funciona em /REPOSITORIO/ no GitHub Pages); recusa arquivo redirecionado
// (ex.: servidor que manda para uma página de login) e nunca responde a uma navegação com resposta redirecionada
// (o Chrome recusa e o app não abre: net::ERR_FAILED); guarda o motivo de uma instalação que falhou para o Diagnóstico.
// 11.2: (a) cada arquivo é conferido pelo SHA-256 gerado no build (js/versao.js › integridade): uma CDN que ainda entrega
// arquivos da versão anterior faz a instalação FALHAR inteira — nunca há versão parcialmente válida;
// (b) uma versão fixada só é usada se for compatível com o banco atual (mesmo "banco", "schema" >= atual); senão é ignorada e
// desafixada; (c) rota de emergência: abrir o app com ?recuperar=1 desafixa qualquer versão e abre a versão atual.
// 11.3: (d) retorno só para versões >= VERSAO_MINIMA_RETORNO: as anteriores restauram backups sem login. Um pino abaixo
// dela nunca é aceito nem servido (é desafixado); ?recuperar=1 continua igual.
importScripts("js/versao.js");
const V = self.SALAO_VERSAO, PREFIXO = "salao-static-v", CACHE = PREFIXO + V.versao, META = "salao-meta";
const ARQUIVOS = [...new Set(["index.html", "sw.js", ...V.arquivos])]; // sw.js entra no cache só para o backup da aplicação
const RAIZ = new URL("./", self.location).pathname; // pasta do app, ex.: /REPOSITORIO/
const vnum = (v) => v.split(".").map(Number);
const maior = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const VERSAO_MINIMA_RETORNO = "11.3.0"; // mesmo valor de js/data/manutencao.js (conferido em tests/unit/sw.test.js)
// cópia da resposta sem a marca de "redirecionada"
const limpa = async (r) => new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
// 11.2: resposta servida do cache com "Cache-Control: no-cache". Sem isso o cache de MEMÓRIA do navegador reaproveita, numa
// recarga, arquivos de outra versão (o servidor manda max-age=600) sem passar por este service worker: o retorno de versão
// não tinha efeito, ou misturava arquivos, por até 10 minutos.
const semReuso = (r) => { const h = new Headers(r.headers); h.set("Cache-Control", "no-cache"); return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h }); };
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (buf) => hex(await crypto.subtle.digest("SHA-256", buf));
/** Lê o objeto SALAO_VERSAO de um texto de versao.js (mesmo formato que a página usa). */
function lerVersao(txt) { const m = txt.match(/SALAO_VERSAO\s*=\s*(\{[\s\S]*\})\s*;?\s*$/); if (!m) throw new Error("versao.js ilegível"); return JSON.parse(m[1]); }

/** Confere o conteúdo de um arquivo contra a versão deste service worker (hash do build; versao.js por conteúdo). */
async function conferir(u, bytes) {
  if (u === "js/versao.js") { // não pode conter o próprio hash: tem de ser IDÊNTICO (conteúdo) ao que este service worker carregou
    let v; try { v = lerVersao(new TextDecoder().decode(bytes)); } catch (_) { throw new Error("versao.js recebido está ilegível"); }
    if (JSON.stringify(v) !== JSON.stringify(V)) throw new Error(`versao.js recebido (${v.versao}) não confere com o service worker (${V.versao}): publicação em andamento ou cache da CDN desatualizado`);
    return;
  }
  const esperado = V.integridade && V.integridade[u];
  if (!esperado) throw new Error(`Sem hash de integridade para ${u}: rode tools/construir_pwa.py antes de publicar`);
  if ((await sha256(bytes)) !== esperado) throw new Error(`${u} não confere com a versão ${V.versao} (hash diferente): publicação em andamento ou cache da CDN desatualizado`);
}

async function baixarValidado(u) {
  const r = await fetch(new Request(u, { cache: "reload" }));
  if (!r.ok) throw new Error(`Falha ao baixar ${u} (HTTP ${r.status})`);
  if (r.redirected) { // só aceita redirecionamento para o mesmo documento (ex.: index.html -> pasta do app)
    const destino = new URL(r.url).pathname, pedido = new URL(u, self.location).pathname;
    if (!(destino === pedido || (u === "index.html" && destino === RAIZ))) throw new Error(`O servidor redirecionou ${u} para ${destino} (ex.: página de login); o arquivo do aplicativo não foi entregue`);
  }
  const ok = r.redirected ? await limpa(r) : r;
  const bytes = await ok.clone().arrayBuffer();
  await conferir(u, bytes);
  if (u === "index.html") {
    const t = new TextDecoder().decode(bytes); if (!t.includes("js/app.js") || !t.includes("manifest.webmanifest")) throw new Error("index.html recebido não é o do aplicativo");
  } else if (u === "manifest.webmanifest") {
    let m; try { m = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw new Error("manifest.webmanifest não é um JSON válido"); }
    if (!m.name || !m.start_url || !Array.isArray(m.icons) || !m.icons.length) throw new Error("manifest.webmanifest incompleto (name, start_url ou icons)");
  } else if (u.endsWith(".png")) {
    const b = new Uint8Array(bytes); if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) throw new Error(`${u} não é um PNG válido`);
  }
  return ok;
}

const textoMeta = async (k) => { const r = await (await caches.open(META)).match(k); return r ? r.text() : null; };
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const meta = await caches.open(META);
    try {
      // 1º baixa e valida TUDO em memória; só então grava. Um arquivo inválido = nenhuma gravação = versão não aceita.
      const prontos = []; for (const u of ARQUIVOS) prontos.push([u, await baixarValidado(u)]);
      if ((await caches.has(CACHE)) && (await textoMeta("instalando")) !== V.versao) {
        // 11.2: esta versão JÁ está instalada (e pode estar em uso): nunca é apagada nem sobrescrita. Só é aceita se idêntica.
        const c = await caches.open(CACHE);
        for (const [u] of prontos) { const r = await c.match(u); if (!r) throw new Error(`A versão ${V.versao} já instalada está incompleta (${u}); publique com um número de versão novo`); await conferir(u, await r.arrayBuffer()).catch(() => { throw new Error(`A versão ${V.versao} já está instalada com conteúdo diferente (${u}): publique com um número de versão novo`); }); }
      } else {
        await meta.put("instalando", new Response(V.versao)); // marca: este cache é desta instalação (pode ser apagado se ela falhar)
        await caches.delete(CACHE); // resto de uma tentativa anterior interrompida desta mesma instalação
        const c = await caches.open(CACHE); for (const [u, r] of prontos) await c.put(u, r);
        if ((await c.keys()).length < ARQUIVOS.length) throw new Error("Cache incompleto");
        await meta.delete("instalando");
      }
      await meta.delete("erro-instalacao");
    } catch (err) { // a versão atual segue funcionando; o motivo fica para o Diagnóstico
      if ((await textoMeta("instalando")) === V.versao) { await caches.delete(CACHE); await meta.delete("instalando"); } // só apaga o que ESTA instalação criou
      await meta.put("erro-instalacao", new Response(JSON.stringify({ versao: V.versao, quando: new Date().toISOString(), erro: String(err && err.message || err) }), { headers: { "Content-Type": "application/json" } }));
      throw err;
    }
  })());
});

// ---------- versão fixada (retorno de versão) ----------
let memoFix; // { versao } | null — cache em memória; invalidado a cada mudança (e perdido quando o SW dorme, sem problema)
async function infoVersao(versao) { // lê o versao.js guardado no cache daquela versão
  if (!(await caches.has(PREFIXO + versao))) return null;
  const r = await (await caches.open(PREFIXO + versao)).match("js/versao.js"); if (!r) return null;
  try { return lerVersao(await r.text()); } catch (_) { return null; }
}
/** Versão X.Y.Z >= a mínima segura (comparação numérica: 11.10.0 > 11.3.0). */
function seguraParaRetorno(v) { return !!v && /^\d+\.\d+\.\d+$/.test(String(v.versao)) && maior(v.versao, VERSAO_MINIMA_RETORNO) >= 0; }
/** Compatível = mesma versão NATIVA do banco e schema lógico >= o desta versão (assim o retorno nunca faz o IndexedDB recusar
 *  a abertura) E versão segura para retorno. */
function compativel(v) { return !!v && Number(v.banco) === Number(V.banco) && Number(v.schema || 0) >= Number(V.schema || 0) && seguraParaRetorno(v); }
async function desafixar() { await (await caches.open(META)).delete("fixada"); memoFix = null; }
async function fixada() {
  if (memoFix !== undefined) return memoFix && memoFix.versao;
  const r = await (await caches.open(META)).match("fixada"), versao = r ? (await r.text()) || null : null;
  if (!versao || versao === V.versao) { if (versao) await desafixar(); memoFix = null; return null; }
  if (!compativel(await infoVersao(versao))) { await desafixar(); return null; } // incompatível ou ausente: nunca serve (evita app que não abre)
  memoFix = { versao }; return versao;
}

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    memoFix = undefined;
    const fix = await fixada(), nomes = (await caches.keys()).filter((k) => k.startsWith(PREFIXO)).sort((a, b) => maior(b.slice(PREFIXO.length), a.slice(PREFIXO.length)));
    const manter = new Set([CACHE]); const anterior = nomes.find((n) => n !== CACHE && maior(n.slice(PREFIXO.length), V.versao) < 0); if (anterior) manter.add(anterior); if (fix) manter.add(PREFIXO + fix);
    for (const n of nomes) if (!manter.has(n)) await caches.delete(n); // só caches de arquivos do app; IndexedDB nunca é tocado
    await self.clients.claim();
  })());
});
self.addEventListener("message", (e) => {
  const d = e.data, resp = (x) => e.ports[0] && e.ports[0].postMessage(x);
  if (d === "pular-espera") { self.skipWaiting(); return; }
  e.waitUntil((async () => {
    if (d && d.tipo === "listar-versoes") { const fix = await fixada(); const ns = (await caches.keys()).filter((k) => k.startsWith(PREFIXO)); resp(ns.map((n) => ({ cache: n, versao: n.slice(PREFIXO.length), ativa: n === CACHE, fixada: fix === n.slice(PREFIXO.length) })).sort((a, b) => maior(b.versao, a.versao))); }
    else if (d && d.tipo === "fixar-versao") {
      const v = await infoVersao(d.versao);
      if (!v) return resp({ ok: false, motivo: "Essa versão não está mais guardada neste aparelho." });
      if (!compativel(v)) return resp({ ok: false, motivo: !seguraParaRetorno(v) && Number(v.banco) === Number(V.banco) && Number(v.schema || 0) >= Number(V.schema || 0)
        ? `A versão ${d.versao} é antiga demais para um retorno seguro (mínimo ${VERSAO_MINIMA_RETORNO}).`
        : `A versão ${d.versao} não é compatível com os dados atuais (banco v${v.banco}/dados v${v.schema}; atual v${V.banco}/v${V.schema}).` });
      await (await caches.open(META)).put("fixada", new Response(d.versao)); memoFix = undefined; resp({ ok: true });
    }
    else if (d && d.tipo === "desafixar") { await desafixar(); resp({ ok: true }); }
    else if (d && d.tipo === "estado") { const fix = await fixada(), r = await (await caches.open(META)).match("erro-instalacao"); resp({ versao: V.versao, banco: V.banco, schema: V.schema, fixada: fix, erroInstalacao: r ? await r.json() : null }); }
  })());
});
self.addEventListener("fetch", (e) => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.cache === "no-store") return; // verificação de atualização e diagnóstico: sempre vão à rede (nunca respondem com o cache)
  e.respondWith((async () => {
    const emergencia = r.mode === "navigate" && u.searchParams.has("recuperar"); // ?recuperar=1: desafixa e abre a versão atual
    if (emergencia) await desafixar();
    const fix = emergencia ? null : await fixada(), nome = fix ? PREFIXO + fix : CACHE;
    const c = (await caches.has(nome)) ? await caches.open(nome) : null; // nunca cria um cache vazio
    let hit = c && ((await c.match(r, { ignoreSearch: true })) || (r.mode === "navigate" ? await c.match("index.html") : null));
    if (hit && hit.redirected) hit = await limpa(hit); // caches antigos podem guardar resposta redirecionada
    return hit ? semReuso(hit) : fetch(r);
  })());
});
