import { abrir, config, sessao, agora, migracoesPendentes, executarMigracoes } from "./data/database.js";
import * as Man from "./data/manutencao.js";
import { pode } from "./data/permissoes.js";
import * as Usr from "./data/usuarios.js";
import * as Bkp from "./data/backup.js";
import { ler } from "./data/database.js";
import { esc, toast, confirmar, esqueleto } from "./ui/util.js";
import { ic, tile } from "./ui/icones.js";
import { montar, rede } from "./ui/shell.js";
import { ROTAS } from "./ui/views.js";
import { marcarInstalacao } from "./data/diagnostico.js";

const raiz = () => document.body;
const PERM = { painel: "financeiro.ler", agenda: "agenda.ler", atendimento: "agenda.ler", clientes: "clientes.ler", cliente: "clientes.ler", servicos: "servicos.ler", servico: "servicos.gravar", financeiro: "financeiro.ler", despesas: "despesas.gravar", dados: "dados.gerir", privacidade: "dados.gerir", usuarios: "usuarios.gerir", config: "config.gerir", manutencao: "dados.gerir", auditoria: "config.gerir" };
let relogio = null;

function tela(titulo, corpo) {
  raiz().innerHTML = `<main class="login-wrap"><section class="login-card"><div class="login-hero"><span class="brand-mark">S</span><div><span class="eyebrow">SALÃO.GESTÃO</span></div></div><h1>${titulo}</h1>${corpo}</section></main>`;
  return raiz().querySelector(".login-card");
}
const erroBox = (el) => el.querySelector(".login-erro") || el.insertAdjacentElement("afterbegin", Object.assign(document.createElement("div"), { className: "alert erro login-erro", role: "alert" }));

async function recuperacao(m) {
  const el = tela("Seus dados não foram encontrados", `<p>Este aparelho já tinha ${m.clientes} cliente(s) cadastrada(s) (última marcação: ${esc(m.quando)}), mas o banco está vazio. Isso acontece quando os <strong>dados do site são limpos</strong> no navegador, o app é desinstalado ou o modo privado é usado.</p><p class="muted">Não é possível recuperar dados apagados sem um arquivo de backup. Se você tiver um <strong>.salaobackup</strong>, restaure-o abaixo.</p><label class="field">Arquivo de backup<input type="file" id="arq" accept=".salaobackup,.json"></label><div class="form-actions"><button class="button" id="rest">Restaurar backup</button><button class="button button-light" id="novo">Começar do zero</button></div><div id="msg"></div>`);
  el.querySelector("#novo").onclick = () => { localStorage.removeItem("salao_marca"); location.reload(); };
  el.querySelector("#rest").onclick = async () => { const f = el.querySelector("#arq").files[0]; if (!f) return toast("Escolha o arquivo.", "erro");
    const rel = await Bkp.validar(await f.text()); if (!rel.ok) return (el.querySelector("#msg").innerHTML = `<div class="alert erro">${rel.erros.map(esc).join("<br>")}</div>`);
    try { await Bkp.importar(rel, { permissao: false }); if (!(await Usr.existeAlgum())) throw new Error("O backup não contém usuários. Crie o acesso depois de importar a partir de um backup do 10.0, ou comece do zero."); location.hash = "#/hoje"; location.reload(); } catch (e) { el.querySelector("#msg").innerHTML = `<div class="alert erro">${esc(e.message)}</div>`; } };
}
function configuracaoInicial() {
  const el = tela("Bem-vinda ao Salão.gestão", `<p class="muted">Seus dados ficam <strong>somente neste dispositivo</strong>. Crie o acesso do administrador.</p><form id="f" class="form-grid"><label class="field field-full">Nome do salão<input name="salao" required maxlength="40"></label><label class="field">Seu nome<input name="nome" required maxlength="60"></label><label class="field">Usuário<input name="usuario" required maxlength="30" autocapitalize="none"></label><label class="field field-full">Senha (mín. 8)<input type="password" name="senha" required minlength="8" autocomplete="new-password"></label><div class="form-actions field-full"><button class="button" type="submit">Criar e entrar</button></div></form><hr><p class="muted">Já usa o Salão.gestão 9.0? Entre e importe seu <em>.salaobackup</em> em <strong>Dados e backup</strong> (ou <a href="#/restaurar" class="text-link">restaure agora</a>).</p>`);
  el.querySelector("#f").onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { await Usr.configurarPrimeiro(d); await Usr.entrar(d.usuario, d.senha); iniciarSessao(); } catch (err) { erroBox(el).textContent = err.message; } };
}
function login() {
  const el = tela("Entrar", `<form id="f" class="form-grid"><label class="field field-full">Usuário<input name="usuario" required autocapitalize="none" autocomplete="username"></label><label class="field field-full">Senha<input type="password" name="senha" required autocomplete="current-password"></label><div class="form-actions field-full"><button class="button" type="submit">Entrar</button></div></form><p class="muted"><a class="text-link" href="#/restaurar">Restaurar backup</a></p>`);
  el.querySelector("#f").onsubmit = async (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { await Usr.entrar(d.usuario, d.senha); iniciarSessao(); } catch (err) { erroBox(el).textContent = err.message; } };
}
function restaurarPublico() {
  const el = tela("Restaurar backup", `<p class="muted">Substitui os dados deste aparelho pelos do arquivo.</p><label class="field">Arquivo<input type="file" id="arq" accept=".salaobackup,.json"></label><div class="form-actions"><button class="button" id="rest">Restaurar</button><a class="button button-light" href="#/">Voltar</a></div><div id="msg"></div>`);
  el.querySelector("#rest").onclick = async () => { const f = el.querySelector("#arq").files[0]; if (!f) return; const rel = await Bkp.validar(await f.text());
    if (!rel.ok) return (el.querySelector("#msg").innerHTML = `<div class="alert erro">${rel.erros.map(esc).join("<br>")}</div>`);
    if (await Usr.existeAlgum() && !(await confirmar("Isto substituirá todos os dados atuais deste aparelho. Continuar?", { perigo: true, titulo: "Substituir dados" }))) return;
    try { await Bkp.importar(rel, { permissao: false }); location.hash = "#/"; location.reload(); } catch (e) { el.querySelector("#msg").innerHTML = `<div class="alert erro">${esc(e.message)}</div>`; } };
}
function parse() { const h = location.hash.replace(/^#\/?/, ""), [caminho, qs] = h.split("?"); return [caminho.replace(/\/$/, ""), new URLSearchParams(qs || "")]; }
let atual = 0;
async function rotear() {
  if (!sessao.usuario) { const [c] = parse(); if (c === "restaurar") return restaurarPublico(); return (await Usr.existeAlgum()) ? login() : configuracaoInicial(); }
  let [caminho, q] = parse(); if (!caminho || caminho === "entrar" || caminho === "restaurar") { location.hash = "#/hoje"; return; }
  const base = caminho.split("/")[0], p = PERM[base];
  const eu = ++atual;
  if (p && !pode(p)) { location.hash = "#/hoje"; return; }
  let ent = null; for (const [re, fn] of ROTAS) { const m = caminho.match(re); if (m) { ent = [m, fn]; break; } }
  await montar(base === "" ? "hoje" : base === "atendimento" || base === "cliente" || base === "servico" ? { atendimento: "agenda", cliente: "clientes", servico: "servicos" }[base] : base);
  const vista = document.getElementById("vista"), rec = () => rotear(); vista.innerHTML = esqueleto();
  try { const r = ent ? await ent[1](ent[0], q) : { html: `<div class="empty-state"><h3>Página não encontrada</h3><a class="button" href="#/hoje">Ir para Hoje</a></div>` };
    if (eu !== atual) return; if (r.redirecionar) { location.hash = r.redirecionar; return; }
    vista.innerHTML = r.html; r.depois && (await r.depois(vista, rec)); window.desenharGraficos && window.desenharGraficos(); }
  catch (e) { vista.innerHTML = `<div class="alert erro">${esc(e.message)}</div>`; console.error(e); }
  window.scrollTo(0, 0); rede(); avisos(); mostrarAvisoAtualizacao(); await marcarContagem();
}
async function marcarContagem() { try { Bkp.marcar((await ler("clientes")).length); } catch (_) {} }
async function avisos() {
  const b = document.getElementById("aviso-backup"); if (!b || !pode("dados.gerir")) return;
  const d = localStorage.getItem("salao_ultimo_download"), n = (await ler("clientes")).length + (await ler("atendimentos")).length;
  const dias = d ? (Date.now() - new Date(d.replace(" ", "T"))) / 864e5 : Infinity;
  if (n && dias > 7) { b.hidden = false; b.innerHTML = `${d ? `Último backup baixado há ${Math.floor(dias)} dias.` : "Você ainda não baixou nenhum backup."} <a class="text-link" href="#/dados">Fazer backup</a>`; } else b.hidden = true;
}
async function iniciarSessao() {
  const c = await config(); try { if (c.backup_automatico === "1") await Bkp.backupAutomatico(); } catch (e) { console.warn(e); }
  zelarInatividade(+c.bloqueio_minutos || 0); if (!location.hash || /entrar|restaurar/.test(location.hash)) location.hash = "#/hoje"; rotear();
}
function zelarInatividade(min) {
  clearInterval(relogio); if (!min) return; let ult = Date.now();
  ["click", "keydown", "touchstart", "pointermove"].forEach((e) => addEventListener(e, () => (ult = Date.now()), { passive: true }));
  relogio = setInterval(() => { if (sessao.usuario && Date.now() - ult > min * 60000) { Usr.sair(); location.hash = "#/entrar"; location.reload(); } }, 15000);
}
function mostrarAvisoAtualizacao() {
  const b = document.getElementById("update-banner"); if (!b || !window.__swAguardando) return;
  b.hidden = false; const bt = document.getElementById("botao-atualizar");
  if (!pode("dados.gerir")) { bt.hidden = true; b.firstChild.textContent = "Nova versão disponível. Peça ao administrador para atualizar. "; return; }
  bt.onclick = async () => { bt.disabled = true; bt.textContent = "Criando backup…";
    try { await Man.aplicarAtualizacao((f) => { if (f === "backup-ok") bt.textContent = "Backup validado — atualizando…"; }); }
    catch (e) { toast("Atualização cancelada: " + e.message + " Seus dados e a versão atual continuam intactos.", "erro"); bt.disabled = false; bt.textContent = "Atualizar agora"; } };
}
function registrarSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
    const aviso = (w) => { window.__swAguardando = w; mostrarAvisoAtualizacao(); }; // nunca atualiza sozinho
    if (reg.waiting && navigator.serviceWorker.controller) aviso(reg.waiting);
    reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) aviso(w); }); });
  }).catch((e) => console.warn("SW", e));
  let rec = false; const tinha = !!navigator.serviceWorker.controller; navigator.serviceWorker.addEventListener("controllerchange", () => { if (tinha && !rec) { rec = true; location.reload(); } });
}
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); window.__promptInstalar = e; marcarInstalacao("disponivel"); const s = document.getElementById("instalar-agora"); if (s) s.hidden = false; });
addEventListener("appinstalled", () => { window.__promptInstalar = null; marcarInstalacao("concluida"); const s = document.getElementById("instalar-agora"); if (s) s.hidden = true; toast("Salão.gestão instalado. Abra pelo ícone do aplicativo."); }); // o Android confirmou a instalação
addEventListener("online", rede); addEventListener("offline", rede); addEventListener("hashchange", rotear);

(async function boot() {
  try { await abrir(); } catch (e) { tela("Armazenamento indisponível", `<p>Este navegador não permitiu criar o banco local (modo privado ou armazenamento bloqueado). Abra em uma janela normal.</p><p class="muted">${esc(e.message)}</p>`); return; }
  try { navigator.storage?.persist?.(); } catch (_) {}
  try { // migrations de dados: backup validado antes (se houver dados), nunca apaga o banco
    if ((await migracoesPendentes()).length) { if ((await Usr.existeAlgum())) await Bkp.snapshot("pre_migracao"); await executarMigracoes(); }
    await Man.registrarVersaoInstalada();
  } catch (e) { tela("Não foi possível atualizar a estrutura dos dados", `<p>Seus dados <strong>não foram alterados</strong>. ${esc(e.message)}</p><p class="muted">Tente recarregar. Se persistir, restaure um backup.</p>`); return; }
  registrarSW();
  const m = Bkp.marca(); if (!(await Usr.existeAlgum()) && m && m.clientes > 0 && !/restaurar/.test(location.hash)) return recuperacao(m);
  if (await Usr.restaurarSessao()) return iniciarSessao();
  rotear();
})();
