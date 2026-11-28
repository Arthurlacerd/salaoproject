import { dataValida } from "../data/datas.js";
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const reais = (c) => "R$ " + ((c || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const moeda = (c) => `<span class="money">${reais(c)}</span>`;
export function parseMoeda(t) { // "1.234,56" | "1.500" | "1500" | "10" | "0,5" | "12.50" -> centavos (NaN se inválido)
  t = String(t ?? "").trim().replace(/^R\$\s*/, ""); if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+\.\d{1,2}$/.test(t)) return NaN;
  // 11.3.1: ponto seguido de grupos de 3 dígitos é separador de milhar ("1.500", "1.234.567"), com ou sem vírgula.
  // Sem ambiguidade: o ponto decimal só é aceito com 1 ou 2 casas ("12.50", "1.5").
  const milhar = t.includes(",") || /^[1-9]\d{0,2}(\.\d{3})+$/.test(t);
  const n = milhar ? t.replace(/\./g, "").replace(",", ".") : t; return Math.round(parseFloat(n) * 100);
}
/** "Gerado em" de um backup, para exibir (11.3.1). O app (origem "pwa", 10.1–11.3) grava a hora em UTC sem o "Z"
 *  (toISOString): ela é mostrada na hora local. Outras origens (ex.: 9.x) aparecem como estão. O arquivo não muda. */
export function dataHoraBackup(criado, origem) {
  const s = String(criado ?? "").trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/), p = (n) => String(n).padStart(2, "0");
  if (!m) return s || "não informado";
  if (origem === "pwa" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    const d = new Date(s + "Z"); if (!Number.isNaN(d.getTime())) return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}
export const dataBR = (d) => (d ? d.split("-").reverse().join("/") : "");
const DIAS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
export const diaSemana = (d) => DIAS[new Date(d + "T12:00:00").getDay()];
export const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
export const somarDias = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
export const hojeISO = () => iso(new Date());
export const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
export function toast(msg, tipo = "sucesso") { // eslint-disable-line
  let a = document.getElementById("alertas"); if (!a) return; const d = document.createElement("div"); d.className = "alert " + tipo; d.textContent = msg; a.appendChild(d);
  if (tipo !== "erro") setTimeout(() => d.remove(), 5000); else d.addEventListener("click", () => d.remove());
}
export function dadosForm(f) { return Object.fromEntries(new FormData(f).entries()); }
export function ligarForm(sel, fn, raiz = document) {
  const f = raiz.querySelector(sel); if (!f) return;
  f.addEventListener("submit", async (e) => { e.preventDefault(); const b = f.querySelector("[type=submit]"); if (b) b.disabled = true;
    try { await fn(dadosForm(f), f); } catch (err) { toast(err.message || String(err), "erro"); window.scrollTo({ top: 0, behavior: "smooth" }); } finally { if (b) b.disabled = false; } });
}
import { ic, tile } from "./icones.js";
/** Modal do design system (substitui confirm/prompt nativos). Retorna Promise. */
function modal({ titulo, corpo = "", ok = "Confirmar", cancelar = "Cancelar", perigo = false, icone, campo = null }) {
  return new Promise((res) => {
    const antes = document.activeElement, scrim = document.createElement("div"); scrim.className = "modal-scrim";
    scrim.innerHTML = `<div class="modal${perigo ? " perigo" : ""}" role="alertdialog" aria-modal="true" aria-labelledby="md-t"><div class="modal-head">${tile(icone || (perigo ? "alert" : "info"), perigo ? "rose" : "wine")}<h2 id="md-t">${esc(titulo)}</h2></div>${corpo ? `<p>${esc(corpo)}</p>` : ""}${campo ? `<label class="field">${esc(campo.rotulo)}<input id="md-campo" type="${campo.tipo || "text"}" autocomplete="off" ${campo.minlength ? `minlength="${campo.minlength}"` : ""}${campo.valor != null ? ` value="${esc(campo.valor)}"` : ""}${campo.min ? ` min="${esc(campo.min)}"` : ""}${campo.max ? ` max="${esc(campo.max)}"` : ""}></label>` : ""}<div class="modal-actions"><button type="button" class="button button-light" data-no>${esc(cancelar)}</button><button type="button" class="button${perigo ? " button-dark" : ""}" data-ok>${esc(ok)}</button></div></div>`;
    const fim = (v) => { scrim.remove(); document.removeEventListener("keydown", tecla, true); antes && antes.focus && antes.focus(); res(v); };
    const valor = () => (campo ? scrim.querySelector("#md-campo").value : true);
    const tecla = (e) => { if (e.key === "Escape") { e.preventDefault(); fim(campo ? null : false); } else if (e.key === "Enter" && !e.target.closest("[data-no]")) { e.preventDefault(); fim(valor()); } else if (e.key === "Tab") { const f = [...scrim.querySelectorAll("input,button")]; const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); } };
    scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.closest("[data-no]")) fim(campo ? null : false); else if (e.target.closest("[data-ok]")) fim(valor()); });
    document.addEventListener("keydown", tecla, true); document.body.appendChild(scrim); (scrim.querySelector("#md-campo") || scrim.querySelector("[data-ok]")).focus();
  });
}
/** Confirmação (Promise<boolean>). Ações destrutivas ganham destaque. */
export function confirmar(msg, o = {}) { const perigo = o.perigo ?? /excluir|cancelar este|apagar|substituir|remover/i.test(msg); return modal({ titulo: o.titulo || (perigo ? "Atenção" : "Confirmar"), corpo: msg, perigo, ok: o.ok || (perigo ? "Sim, continuar" : "Confirmar"), icone: o.icone }); }
/** Pergunta com campo (Promise<string|null>). */
export function pedir(titulo, o = {}) { return modal({ titulo, corpo: o.corpo || "", ok: o.ok || "Salvar", icone: o.icone || "key", campo: { rotulo: o.rotulo || "Valor", tipo: o.tipo || "text", minlength: o.minlength, valor: o.valor, min: o.min, max: o.max } }); } // 11.4: valor inicial e limites opcionais
export const esqueleto = () => '<div class="skeleton" aria-busy="true" aria-label="Carregando"><i></i><i></i><i></i></div>';
export function chartAttr(o) { return esc(JSON.stringify(o)); }
export function periodo(chave, de, ate) {
  const h = hojeISO(), d = new Date(); let i = h, f = h;
  if (chave === "7dias") i = somarDias(h, -6); else if (chave === "30dias") i = somarDias(h, -29);
  else if (chave === "mes") i = iso(new Date(d.getFullYear(), d.getMonth(), 1));
  else if (chave === "mes_anterior") { i = iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)); f = iso(new Date(d.getFullYear(), d.getMonth(), 0)); }
  else if (chave === "personalizado" && de && ate) { i = de; f = ate; }
  return [i, f];
}
export const PERIODOS = [["hoje", "Hoje"], ["7dias", "7 dias"], ["30dias", "30 dias"], ["mes", "Este mês"], ["mes_anterior", "Mês anterior"]];

// 11.4: leitura TIPADA dos parâmetros da URL (a parte depois de "#/rota?"). Cada rota lê seus parâmetros uma vez, por
// estas regras; valor fora do tipo vira o padrão. Os valores continuam sendo escapados onde entram no HTML.
export const PARAM = {
  enumerado: (lista, padrao = "") => (v) => (lista.includes(v) ? v : padrao),
  numeroEm: (lista, padrao = 0) => (v) => (/^\d{1,6}$/.test(v || "") && lista.includes(+v) ? +v : padrao),
  data: (padrao = "") => (v) => (dataValida(v) ? v : typeof padrao === "function" ? padrao() : padrao), // regra única de datas.js
  hora: (padrao = "") => (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v || "") ? v : padrao),
  id: () => (v) => (/^[1-9]\d{0,9}$/.test(v || "") && +v <= 2147483647 ? +v : 0), // 0 = nenhum
  inteiro: (min, max, padrao = min) => (v) => (/^\d{1,9}$/.test(v || "") && +v >= min && +v <= max ? +v : padrao),
  texto: (max) => (v) => String(v ?? "").trim().slice(0, max),
};
export function lerParametros(q, regras) { const o = {}; for (const [k, ler] of Object.entries(regras)) o[k] = ler(q.get(k)); return o; }
/** Período do painel/financeiro: p ∈ PERIODOS ou "personalizado" (só com de ≤ ate, datas válidas); senão, o padrão. */
export function parametrosPeriodo(q, padrao) {
  const r = lerParametros(q, { p: PARAM.enumerado([...PERIODOS.map(([k]) => k), "personalizado"], padrao), de: PARAM.data(), ate: PARAM.data() });
  if (r.p === "personalizado" && (!r.de || !r.ate || r.de > r.ate)) r.p = padrao;
  if (r.p !== "personalizado") { r.de = ""; r.ate = ""; }
  return r;
}
