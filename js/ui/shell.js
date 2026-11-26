import { esc, toast } from "./util.js";
import { ic, tile } from "./icones.js";
import { pode } from "../data/permissoes.js";
import { sessao, config, INFO } from "../data/database.js";
import * as Usuarios from "../data/usuarios.js";
export const ITENS = [ // [rota, ícone, rótulo, permissão, grupo]
  ["hoje", "sun", "Hoje", null, "Operação"], ["agenda", "calendar", "Agenda", "agenda.ler", "Operação"], ["clientes", "users", "Clientes", "clientes.ler", "Operação"], ["servicos", "scissors", "Serviços", "servicos.ler", "Operação"],
  ["painel", "chart", "Painel", "financeiro.ler", "Financeiro"], ["financeiro", "wallet", "Financeiro", "financeiro.ler", "Financeiro"], ["despesas", "receipt", "Despesas", "despesas.gravar", "Financeiro"],
  ["dados", "transfer", "Dados e backup", "dados.gerir", "Sistema"], ["privacidade", "shield", "Privacidade", "dados.gerir", "Sistema"], ["usuarios", "user", "Usuários", "usuarios.gerir", "Sistema"],
  ["config", "settings", "Configurações", "config.gerir", "Sistema"], ["manutencao", "wrench", "Manutenção", "dados.gerir", "Sistema"], ["auditoria", "list", "Auditoria", "config.gerir", "Sistema"], ["instalar", "download", "Instalar app", null, "Sistema"], ["sobre", "info", "Sobre", null, "Sistema"],
];
export const ACOES = [["cliente/novo", "user", "Novo cliente", "clientes.gravar", "rose"], ["atendimento/novo", "calendar", "Novo atendimento", "agenda.gravar", "wine"], ["despesas", "receipt", "Nova despesa", "despesas.gravar", "sand"], ["servico/novo", "scissors", "Novo serviço", "servicos.gravar", "blush"], ["financeiro", "wallet", "Registrar pagamento", "financeiro.ler", "rose"]];
export const acoesRapidas = () => ACOES.filter((a) => pode(a[3]));
export const qaHtml = (r) => `<a class="qa" href="#/${r[0]}">${tile(r[1], r[4], 20)}<span>${r[2]}</span></a>`;
const permitidos = () => ITENS.filter((i) => !i[3] || pode(i[3]));
const navLinks = (rota) => { let g = ""; return permitidos().map(([k, i, r, , grp]) => { const h = grp !== g ? `<div class="nav-group">${grp}</div>` : ""; g = grp; return `${h}<a class="nav-link${rota === k ? " active" : ""}" ${rota === k ? 'aria-current="page"' : ""} href="#/${k}"><span class="nav-icon" aria-hidden="true">${ic(i, 21)}</span><span class="nav-label">${r}</span></a>`; }).join(""); };
export async function montar(rota) {
  const cfg = await config(), u = sessao.usuario;
  const principais = ["hoje", "agenda", "clientes", "financeiro"].filter((k) => permitidos().some((i) => i[0] === k));
  const bn = principais.map((k) => { const i = ITENS.find((x) => x[0] === k); return `<a class="nav-link${rota === k ? " active" : ""}" href="#/${k}"><span class="nav-icon" aria-hidden="true">${ic(i[1], 22)}</span><span class="nav-label">${i[2]}</span></a>`; }).join("");
  const rapidas = acoesRapidas();
  document.documentElement.setAttribute("data-theme", cfg.tema === "escuro" ? "dark" : "light");
  document.documentElement.style.setProperty("--accent", cfg.cor_principal);
  document.documentElement.style.setProperty("--accent-dark", `color-mix(in srgb, ${cfg.cor_principal} 78%, #302925)`);
  document.documentElement.style.setProperty("--accent-soft", `color-mix(in srgb, ${cfg.cor_principal} 12%, white)`);
  document.documentElement.style.setProperty("--bg", cfg.cor_fundo);
  document.documentElement.setAttribute("data-bloqueio", cfg.bloqueio_minutos);
  document.title = cfg.nome_sistema;
  document.body.innerHTML = `
  <a class="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
  <div class="shell">
   <aside class="sidebar" id="sidebar" aria-label="Menu principal">
    <a class="brand" href="#/hoje"><span class="brand-mark">${esc(cfg.nome_sistema[0].toUpperCase())}</span><span class="brand-copy"><span class="brand-name">${esc(cfg.nome_sistema)}</span><span class="brand-caption">GESTÃO DO SALÃO</span></span></a>
    <nav class="side-nav" aria-label="Navegação principal">${navLinks(rota)}</nav>
    <div class="side-foot"><span class="who">${esc(u.nome)}</span>${u.perfil !== "admin" ? `<a class="nav-link" href="#/minha-senha"><span class="nav-icon">${ic("key", 21)}</span><span class="nav-label">Minha senha</span></a>` : ""}
     <button class="nav-link logout-button" type="button" data-sair><span class="nav-icon">${ic("logout", 21)}</span><span class="nav-label">Sair</span></button></div>
   </aside>
   <div class="sidebar-scrim" id="sidebar-scrim" hidden></div>
   <div class="main-col">
    <header class="appbar"><div class="appbar-row">
      <a class="mobile-brand" href="#/hoje"><span class="brand-mark">${esc(cfg.nome_sistema[0].toUpperCase())}</span><strong>${esc(cfg.nome_sistema)}</strong></a>
      <button class="icon-button" type="button" id="menu-toggle" aria-label="Abrir ou recolher menu">${ic("menu", 22)}</button>
      <form class="global-search" role="search" id="busca-form" autocomplete="off"><label class="sr-only" for="busca-global">Buscar</label><input id="busca-global" type="search" placeholder="Buscar cliente, telefone, serviço…  (Ctrl+K)" maxlength="60"><div class="search-results" id="busca-resultados" hidden></div></form>
      <div class="header-actions"><span class="net-pill" id="net-pill" data-estado="online" role="status"><span class="net-dot"></span><span id="net-texto">Online</span></span>
       <button class="icon-button" type="button" id="privacidade-btn" aria-pressed="false" aria-label="Ocultar valores" title="Ocultar valores">${ic("eye", 22)}</button>
       <a class="profile-chip" href="#/minha-senha" title="Minha conta"><span class="avatar">${esc((u.nome || "?")[0].toUpperCase())}</span><span class="nm">${esc(u.nome.split(" ")[0])}</span></a>
       ${pode("agenda.gravar") ? `<a class="button button-small header-new" href="#/atendimento/novo">${ic("plus", 18)}<span class="header-new-label"> Agendar</span></a>` : ""}</div></div>
     <div class="offline-banner" id="offline-banner" role="status" hidden>Modo offline. Seus dados estão sendo salvos neste dispositivo.</div>
     <div class="update-banner" id="update-banner" hidden>Nova versão do aplicativo pronta. <button class="text-link" type="button" id="botao-atualizar">Atualizar agora</button></div>
     <div class="update-banner" id="aviso-backup" hidden style="background:var(--warn-bg);color:var(--warn)"></div></header>
    <main class="container" id="conteudo-principal"><div class="alerts" id="alertas" role="status" aria-live="polite"></div><div id="vista"></div>
     <footer class="footer">${esc(cfg.nome_sistema)} · versão ${esc(INFO.versao)} · Seus dados são armazenados neste dispositivo</footer></main>
   </div></div>
  <nav class="bottom-nav" aria-label="Navegação rápida">${bn}<button class="nav-link" type="button" id="abrir-mais"><span class="nav-icon">${ic("dots", 22)}</span><span class="nav-label">Mais</span></button></nav>
  <div class="sheet" id="folha-mais" role="dialog" aria-modal="true" aria-label="Mais opções" hidden><div class="sheet-card"><div class="sheet-handle"></div><nav class="sheet-grid">${navLinks(rota)}</nav><button class="button button-light" type="button" data-sair style="width:100%">Sair</button><button class="button button-light" type="button" data-fechar-folha style="width:100%;margin-top:8px">Fechar</button></div></div>
  <div class="sheet" id="folha-acoes" role="dialog" aria-modal="true" aria-label="Ações rápidas" hidden><div class="sheet-card"><div class="sheet-handle"></div><h2 class="sheet-title">Ações rápidas</h2><div class="sheet-grid">${rapidas.map(qaHtml).join("")}</div><button class="button button-light" type="button" data-fechar-folha style="width:100%;margin-top:12px">Fechar</button></div></div>
  ${rapidas.length ? `<button class="fab" type="button" id="abrir-acoes" aria-label="Ações rápidas">${ic("plus", 28)}</button>` : ""}
  <div class="palette" id="paleta" role="dialog" aria-modal="true" aria-label="Comandos e busca" hidden><div class="palette-card"><input id="paleta-entrada" type="text" placeholder="Digite um comando ou busque…" autocomplete="off"><ul id="paleta-lista"></ul></div></div>`;
  window.__comandos = [...permitidos().map(([k, , r]) => ({ rotulo: "Abrir " + r, url: `#/${k}`, k: r })), ...rapidas.map((r) => ({ rotulo: r[2], url: `#/${r[0]}`, k: r[2] })), { rotulo: "Ocultar/mostrar valores", acao: "privacidade", k: "privacidade ocultar" }];
  ligar();
}
function ligar() {
  const $ = (s) => document.querySelector(s), root = document.documentElement;
  const mq = matchMedia("(min-width: 1100px)"); if (localStorage.getItem("sb") === "min" && mq.matches) root.classList.add("sb-min"); else root.classList.remove("sb-min");
  $("#menu-toggle").onclick = () => { if (mq.matches) { const m = root.classList.toggle("sb-min"); localStorage.setItem("sb", m ? "min" : "max"); } else { const a = !root.classList.contains("sb-open"); root.classList.toggle("sb-open", a); $("#sidebar-scrim").hidden = !a; } };
  $("#sidebar-scrim").onclick = () => { root.classList.remove("sb-open"); $("#sidebar-scrim").hidden = true; };
  const fecharFolhas = () => document.querySelectorAll(".sheet").forEach((f) => (f.hidden = true));
  $("#abrir-mais").onclick = () => ($("#folha-mais").hidden = false); const fa = $("#abrir-acoes"); if (fa) fa.onclick = () => ($("#folha-acoes").hidden = false);
  document.querySelectorAll(".sheet").forEach((s) => s.addEventListener("click", (e) => { if (e.target === s || e.target.closest("[data-fechar-folha]") || e.target.closest("a")) fecharFolhas(); }));
  document.querySelectorAll("[data-sair]").forEach((b) => (b.onclick = () => { Usuarios.sair(); location.hash = "#/entrar"; location.reload(); }));
  const mask = (on) => { document.querySelectorAll(".money").forEach((el) => { if (on) { if (!el.hasAttribute("data-v")) { el.setAttribute("data-v", el.textContent); el.textContent = "R$ ••••••"; } } else if (el.hasAttribute("data-v")) { el.textContent = el.getAttribute("data-v"); el.removeAttribute("data-v"); } }); };
  window.aplicarPrivacidade = () => mask(root.classList.contains("privacy"));
  const priv = (on, salvar) => { root.classList.toggle("privacy", on); $("#privacidade-btn").setAttribute("aria-pressed", on); mask(on); if (salvar) localStorage.setItem("salao_priv", on ? "1" : "0"); };
  window.alternarPrivacidade = () => priv(!root.classList.contains("privacy"), true);
  priv(localStorage.getItem("salao_priv") === "1", false); $("#privacidade-btn").onclick = window.alternarPrivacidade;
  rede(); // paleta e busca
  const ent = $("#paleta-entrada"), lista = $("#paleta-lista"), pal = $("#paleta"); let itens = [], sel = 0;
  const pintar = () => (lista.innerHTML = itens.map((i, n) => `<li role="option" aria-selected="${n === sel}" data-n="${n}"><span>${esc(i.rotulo)}</span>${i.detalhe ? `<small>${esc(i.detalhe)}</small>` : ""}</li>`).join("") || '<li class="vazio">Nada encontrado.</li>');
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const filtrar = async () => { const q = norm(ent.value.trim()); itens = window.__comandos.filter((c) => !q || q.split(" ").every((p) => norm(c.rotulo + " " + c.k).includes(p))).slice(0, 7); sel = 0; pintar();
    if (q.length >= 2) { const { buscaGlobal } = await import("./views.js"); const r = await buscaGlobal(ent.value.trim()); if (norm(ent.value.trim()) === q) { itens = itens.concat(r); pintar(); } } };
  const abrir = () => { pal.hidden = false; ent.value = ""; filtrar(); ent.focus(); }, fechar = () => (pal.hidden = true);
  const exec = (i) => { if (!i) return; fechar(); if (i.acao === "privacidade") window.alternarPrivacidade(); else location.hash = i.url; };
  ent.oninput = filtrar; ent.onkeydown = (e) => { if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, itens.length - 1); pintar(); } else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); pintar(); } else if (e.key === "Enter") { e.preventDefault(); exec(itens[sel]); } };
  lista.onclick = (e) => { const li = e.target.closest("li[data-n]"); if (li) exec(itens[+li.dataset.n]); }; pal.onclick = (e) => { if (e.target === pal) fechar(); };
  $("#busca-form").onsubmit = (e) => { e.preventDefault(); abrir(); ent.value = $("#busca-global").value; filtrar(); }; $("#busca-global").onfocus = (e) => { e.target.blur(); abrir(); };
  if (!window.__teclas) { window.__teclas = true; document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); const p = document.querySelector("#paleta"); if (p) (p.hidden ? document.querySelector("#busca-global").focus() : (p.hidden = true)); } else if (e.key === "Escape") { document.querySelectorAll(".sheet,.palette").forEach((x) => (x.hidden = true)); } }); }
}
export function rede() {
  const p = document.querySelector("#net-pill"), t = document.querySelector("#net-texto"), b = document.querySelector("#offline-banner"), on = navigator.onLine;
  if (p) { p.dataset.estado = on ? "online" : "offline"; t.textContent = on ? "Online" : "Offline"; b.hidden = on; }
}
addEventListener("online", rede); addEventListener("offline", rede);
