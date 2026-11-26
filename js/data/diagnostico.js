// Diagnóstico do PWA (11.1): verifica NO PRÓPRIO APARELHO o que o Android precisa para instalar o app e funcionar offline.
// Só lê: não altera dados, caches nem o service worker. O relatório não contém dados pessoais (apenas contagens e técnica).
import { INFO, VERSAO_BANCO, VERSAO_SCHEMA, ler, config, agora } from "./database.js";

// ---------- instalação: o que o navegador informou (beforeinstallprompt / escolha / appinstalled) ----------
const CHAVE = "salao_instalacao";
export function lerInstalacao() { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}") || {}; } catch (_) { return {}; } }
export function marcarInstalacao(evento) { try { const d = lerInstalacao(); d[evento] = agora(); localStorage.setItem(CHAVE, JSON.stringify(d)); } catch (_) {} }
export function modoExibicao() {
  for (const m of ["fullscreen", "standalone", "minimal-ui", "window-controls-overlay"]) if (matchMedia(`(display-mode: ${m})`).matches) return m;
  return navigator.standalone ? "standalone" : "browser";
}

// ---------- utilitários ----------
const item = (id, titulo, estado, texto, detalhe = "") => ({ id, titulo, estado, texto, detalhe });
const CACHE_ATUAL = () => "salao-static-v" + INFO.versao;
async function cacheAtual() { return (await caches.has(CACHE_ATUAL())) ? caches.open(CACHE_ATUAL()) : null; } // nunca cria cache
/** Vai à rede (pedidos no-store não passam pelo cache do SW). Sem rede, usa o cache da versão atual. */
async function buscar(url) {
  if (navigator.onLine) { try { return { r: await fetch(url, { cache: "no-store" }), origem: "rede" }; } catch (_) { /* cai para o cache */ } }
  const c = await cacheAtual(); return { r: c ? await c.match(url, { ignoreSearch: true }) : null, origem: "cache" };
}
/** Tipo e dimensões reais lidos do cabeçalho do PNG (sem depender de <img>). */
async function cabecalhoPng(blob) {
  const b = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return { png: false };
  const dv = new DataView(b.buffer); return { png: true, w: dv.getUint32(16), h: dv.getUint32(20) };
}
export function navegador(ua = navigator.userAgent) {
  const v = (re) => (ua.match(re) || [])[1];
  const so = /Android/.test(ua) ? `Android ${v(/Android ([\d.]+)/) || ""}`.trim() : /iPhone|iPad|iPod/.test(ua) ? `iOS ${(v(/OS (\d+[_\d]*)/) || "").replace(/_/g, ".")}`.trim() : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "outro sistema";
  const embutido = /; wv\)|FBAN|FBAV|Instagram|WhatsApp|Line\//.test(ua);
  const nome = embutido ? "navegador interno de outro app" : /SamsungBrowser\//.test(ua) ? `Samsung Internet ${v(/SamsungBrowser\/(\d+)/)}` : /EdgA?\//.test(ua) ? `Edge ${v(/EdgA?\/(\d+)/)}` : /Firefox\/|FxiOS\//.test(ua) ? `Firefox ${v(/(?:Firefox|FxiOS)\/(\d+)/)}` : /OPR\/|OPT\//.test(ua) ? "Opera" : /CriOS\//.test(ua) ? `Chrome ${v(/CriOS\/(\d+)/)}` : /Chrome\//.test(ua) ? `Chrome ${v(/Chrome\/(\d+)/)}` : /Safari\//.test(ua) ? "Safari" : "desconhecido";
  return { so, nome, android: /Android/.test(ua), ios: /iPhone|iPad|iPod/.test(ua), chrome: /^Chrome/.test(nome), samsung: /^Samsung/.test(nome), embutido };
}

// ---------- verificações ----------
async function verificarHttps() {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (location.protocol === "https:") return item("https", "HTTPS", "ok", `Conexão segura (${location.host})`);
  if (local && window.isSecureContext) return item("https", "HTTPS", "aviso", "Endereço local (localhost): vale para testes neste computador. No celular, use o endereço publicado em HTTPS (ex.: GitHub Pages).");
  return item("https", "HTTPS", "erro", `Aberto por ${location.protocol.replace(":", "").toUpperCase()} (${location.host}). Sem HTTPS o Android não instala o app nem ativa o modo offline. Publique em HTTPS (ex.: GitHub Pages).`);
}

async function verificarManifest(ctx) {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return [item("manifest", "Manifest", "erro", "A página não aponta para o manifest (link rel=\"manifest\").")];
  const url = new URL(link.getAttribute("href"), document.baseURI).href; let m;
  try { const { r } = await buscar(url); if (!r) throw new Error("sem internet e fora do cache"); if (!r.ok) throw new Error("HTTP " + r.status); m = JSON.parse(await r.text()); }
  catch (e) { return [item("manifest", "Manifest", "erro", `Não foi possível ler o manifest (${e.message}).`), item("icones", "Ícones", "erro", "Sem manifest não há como verificar os ícones.")]; }
  const res = (x) => new URL(x, url), erros = [], avisos = [];
  const escopo = res(m.scope || "./").href, inicio = m.start_url ? res(m.start_url) : null;
  if (!m.name) erros.push("sem name"); if (!m.short_name) avisos.push("sem short_name");
  else if ([...m.short_name].length > 12) avisos.push(`short_name com ${[...m.short_name].length} caracteres (o Android corta acima de ~12)`);
  if (!inicio) erros.push("sem start_url"); else if (!inicio.href.startsWith(escopo)) erros.push("start_url fora do scope");
  if (!location.href.startsWith(escopo)) erros.push("esta página está fora do scope do app");
  if (!["standalone", "fullscreen", "minimal-ui"].includes(m.display)) erros.push(`display "${m.display || "—"}" não abre como aplicativo`);
  // identidade: o Chrome resolve o "id" a partir da RAIZ do domínio; sem "id", usa o start_url (sem o #)
  const id = m.id != null ? new URL(m.id, (inicio || location).origin) : inicio ? new URL(inicio.href.split("#")[0]) : null;
  ctx.identidade = id ? id.href : "—"; ctx.escopo = escopo;
  if (id && !id.href.startsWith(escopo)) erros.push(`a identidade do app (${id.pathname}) fica fora da pasta do app (${new URL(escopo).pathname}); outro app do mesmo domínio seria confundido com este`);
  const estado = erros.length ? "erro" : avisos.length ? "aviso" : "ok";
  const saida = [item("manifest", "Manifest", estado, [...erros, ...avisos].join("; ") || `${m.name} · ${m.display} · pasta ${new URL(escopo).pathname}`, `identidade: ${id ? id.pathname : "—"} · início: ${inicio ? inicio.pathname + inicio.hash : "—"}`)];
  // ícones: existência, HTTP, tipo, PNG real e tamanho igual ao declarado
  const lista = [], falhas = [];
  for (const ic of Array.isArray(m.icons) ? m.icons : []) {
    const decl = String(ic.sizes || "").split(/\s+/)[0] || "?", [dw, dh] = decl.split("x").map(Number), fin = String(ic.purpose || "any").split(/\s+/);
    try {
      const { r, origem } = await buscar(res(ic.src).href);
      if (!r) { falhas.push(`Ícone ${decl} não encontrado (sem internet e fora do cache)`); continue; }
      if (!r.ok) { falhas.push(`Ícone ${decl} não encontrado (HTTP ${r.status}: ${ic.src})`); continue; }
      const tipo = (r.headers.get("content-type") || "").split(";")[0].trim(), p = await cabecalhoPng(await r.blob());
      if (!p.png) { falhas.push(`Ícone ${decl} não é um PNG (${tipo || "tipo desconhecido"}: ${ic.src})`); continue; }
      if (p.w !== dw || p.h !== dh) { falhas.push(`Ícone ${ic.src} tem ${p.w}x${p.h}, mas o manifest declara ${decl}`); continue; }
      if (origem === "rede" && tipo && tipo !== "image/png") { falhas.push(`Ícone ${decl} servido como ${tipo} (esperado image/png)`); continue; }
      lista.push({ w: p.w, fin, origem });
    } catch (e) { falhas.push(`Ícone ${decl}: ${e.message}`); }
  }
  const tem = (n, f) => lista.some((x) => x.w >= n && x.fin.includes(f));
  if (!tem(192, "any")) falhas.push("Ícone 192x192 não encontrado");
  if (!tem(512, "any")) falhas.push("Ícone 512x512 não encontrado");
  const semAdapt = !lista.some((x) => x.fin.includes("maskable"));
  saida.push(item("icones", "Ícones", falhas.length ? "erro" : semAdapt ? "aviso" : "ok", falhas.length ? falhas.join("; ") : `${lista.length} ícone(s) PNG válidos (192x192, 512x512${semAdapt ? "" : " e adaptável 512x512"})` + (semAdapt ? "; falta o ícone adaptável (maskable)" : ""), lista.length ? `verificados na ${lista.every((x) => x.origem === "rede") ? "rede (endereço publicado)" : "cópia deste aparelho (sem internet)"}` : ""));
  return saida;
}

async function lerErroInstalacao() {
  try { if (!(await caches.has("salao-meta"))) return null; const r = await (await caches.open("salao-meta")).match("erro-instalacao"); return r ? await r.json() : null; } catch (_) { return null; }
}

async function verificarServiceWorker(ctx) {
  if (!("serviceWorker" in navigator)) return item("sw", "Service Worker", "erro", window.isSecureContext ? "Este navegador não oferece service worker." : "Indisponível sem HTTPS.");
  const reg = await navigator.serviceWorker.getRegistration(), falha = await lerErroInstalacao();
  const nota = falha ? ` Última tentativa de instalar a versão ${falha.versao} falhou: ${falha.erro}.` : "";
  if (!reg) return item("sw", "Service Worker", "erro", "Não registrado. Abra o app com internet e recarregue a página." + nota);
  if (!reg.active) return item("sw", "Service Worker", "aviso", "Instalando… recarregue em alguns segundos." + nota);
  if (!navigator.serviceWorker.controller) return item("sw", "Service Worker", "aviso", "Ativo, mas ainda não controla esta página: recarregue." + nota);
  const fora = ctx.escopo && reg.scope !== ctx.escopo;
  return item("sw", "Service Worker", falha || fora ? "aviso" : "ok", `Ativo · escopo ${new URL(reg.scope).pathname}` + (fora ? ` (o manifest usa ${new URL(ctx.escopo).pathname})` : "") + (reg.waiting ? " · nova versão aguardando: use Atualizar agora" : "") + (falha ? " ·" + nota : ""), reg.active.scriptURL ? `script: ${new URL(reg.active.scriptURL).pathname}` : "");
}

async function verificarOffline() {
  const lista = [...new Set(["index.html", "sw.js", ...INFO.arquivos])], c = await cacheAtual();
  if (!c) return item("offline", "Offline", "erro", `A cópia da versão ${INFO.versao} ainda não está neste aparelho: o app não abre sem internet. Abra uma vez com internet e recarregue.`);
  const faltam = []; for (const f of lista) if (!(await c.match(f, { ignoreSearch: true }))) faltam.push(f);
  if (faltam.length) return item("offline", "Offline", "erro", `Faltam ${faltam.length} arquivo(s) na cópia offline: ${faltam.slice(0, 4).join(", ")}${faltam.length > 4 ? "…" : ""}`);
  const ctrl = !!navigator.serviceWorker?.controller;
  return item("offline", "Offline", ctrl ? "ok" : "aviso", `${lista.length} arquivos da versão ${INFO.versao} guardados neste aparelho` + (ctrl ? "" : " (recarregue para ativar)"));
}

async function verificarBanco() {
  try {
    const cli = (await ler("clientes")).length, at = (await ler("atendimentos")).length, c = await config();
    let persist = null; try { persist = await navigator.storage?.persisted?.(); } catch (_) {}
    return item("indexeddb", "IndexedDB", persist === false ? "aviso" : "ok", `Banco local v${VERSAO_BANCO} · dados v${c.schema_versao || "1"}/${VERSAO_SCHEMA} · ${cli} cliente(s), ${at} atendimento(s)` +
      (persist === false ? " · armazenamento ainda não protegido: o navegador pode liberar espaço apagando dados. Instale o app e mantenha backups." : persist ? " · armazenamento protegido (persistente)" : ""));
  } catch (e) { return item("indexeddb", "IndexedDB", "erro", "Não foi possível ler o banco local: " + e.message); }
}

function verificarInstalacao(nav) {
  const modo = modoExibicao(), inst = lerInstalacao();
  if (modo !== "browser") return item("instalacao", "Instalação", "ok", `Aberto como aplicativo instalado (${modo})` + (inst.concluida ? ` · instalado em ${inst.concluida}` : ""));
  if (inst.concluida) return item("instalacao", "Instalação", "ok", `Instalação concluída em ${inst.concluida}. Você está no navegador: abra pelo ícone Salão.gestão.`);
  if (nav.embutido) return item("instalacao", "Instalação", "erro", "Aberto dentro de outro aplicativo (ex.: WhatsApp/Instagram). Abra o endereço no Chrome para instalar.");
  if (inst.aceita) return item("instalacao", "Instalação", "erro", `A instalação foi pedida em ${inst.aceita}, mas o Android não confirmou a conclusão. Veja abaixo "Se a instalação não concluir".`);
  if (window.__promptInstalar) return item("instalacao", "Instalação", "aviso", "Não instalado. Este navegador pode instalar agora: use Instalar app.");
  if (nav.android && !nav.chrome && !nav.samsung) return item("instalacao", "Instalação", "aviso", `Não instalado. ${nav.nome} no Android costuma criar só um atalho; para instalar como aplicativo use o Chrome.`);
  if (nav.ios) return item("instalacao", "Instalação", "aviso", "Não instalado. No iPhone/iPad: Safari, Compartilhar, Adicionar à Tela de Início.");
  return item("instalacao", "Instalação", "aviso", "Não instalado (aberto no navegador). No Android: Chrome, menu, Instalar app.");
}

export async function executar() {
  const ctx = {}, nav = navegador();
  const itens = [await verificarHttps(), ...(await verificarManifest(ctx)), await verificarServiceWorker(ctx), await verificarOffline(), await verificarBanco(), verificarInstalacao(nav)];
  return { itens, quando: agora(), versao: INFO.versao, nav, modo: modoExibicao(), online: navigator.onLine, identidade: ctx.identidade || "—", endereco: location.origin + location.pathname, instalacao: lerInstalacao() };
}

export function relatorio(d) { // texto para copiar e enviar a quem dá suporte — sem dados pessoais
  const rot = { ok: "OK", aviso: "ATENÇÃO", erro: "FALHA" };
  return [`${INFO.sistema} ${d.versao} — diagnóstico de ${d.quando}`, ...d.itens.map((i) => `[${rot[i.estado]}] ${i.titulo}: ${i.texto}${i.detalhe ? " (" + i.detalhe + ")" : ""}`),
    `Endereço: ${d.endereco}`, `Identidade do app: ${d.identidade}`, `Navegador: ${d.nav.nome} · ${d.nav.so} · modo ${d.modo} · ${d.online ? "online" : "offline"}`,
    `Instalação (eventos): ${Object.entries(d.instalacao).map(([k, v]) => `${k} ${v}`).join(", ") || "nenhum registrado"}`].join("\n");
}
