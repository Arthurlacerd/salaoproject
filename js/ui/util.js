export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const reais = (c) => "R$ " + ((c || 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const moeda = (c) => `<span class="money">${reais(c)}</span>`;
export function parseMoeda(t) { // "1.234,56" | "10" | "0,5" -> centavos (NaN se inválido)
  t = String(t ?? "").trim().replace(/^R\$\s*/, ""); if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+\.\d{1,2}$/.test(t)) return NaN;
  const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t; return Math.round(parseFloat(n) * 100);
}
export const dataBR = (d) => (d ? d.split("-").reverse().join("/") : "");
const DIAS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
export const diaSemana = (d) => DIAS[new Date(d + "T12:00:00").getDay()];
export const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
export const somarDias = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
export const hojeISO = () => iso(new Date());
export const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
export function toast(msg, tipo = "sucesso") {
  let a = document.getElementById("alertas"); if (!a) return; const d = document.createElement("div"); d.className = "alert " + tipo; d.textContent = msg; a.appendChild(d);
  if (tipo !== "erro") setTimeout(() => d.remove(), 5000); else d.addEventListener("click", () => d.remove());
}
export function dadosForm(f) { return Object.fromEntries(new FormData(f).entries()); }
export function ligarForm(sel, fn, raiz = document) {
  const f = raiz.querySelector(sel); if (!f) return;
  f.addEventListener("submit", async (e) => { e.preventDefault(); const b = f.querySelector("[type=submit]"); if (b) b.disabled = true;
    try { await fn(dadosForm(f), f); } catch (err) { toast(err.message || String(err), "erro"); window.scrollTo({ top: 0, behavior: "smooth" }); } finally { if (b) b.disabled = false; } });
}
export function confirmar(msg) { return window.confirm(msg); }
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
