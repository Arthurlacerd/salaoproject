// 11.4 — FONTE ÚNICA da regra de datas do Salão.gestão. Usada pela gravação (agenda, financeiro, clientes, CSV), pelos
// parâmetros da URL e pelo esquema do backup (esquema_backup.js), para que formulário, banco e backup aceitem exatamente
// as mesmas datas. Formato interno: "AAAA-MM-DD" (ano com 4 dígitos, sem hora e sem fuso).
// Nada aqui usa Date.parse, new Date(texto) ou toISOString para decidir se uma data é válida: uma data impossível é
// RECUSADA, nunca "normalizada" ("2027-02-31" não vira "2027-03-03"), e o resultado não depende do fuso do aparelho.
// Este módulo não importa nada (pode ser usado por qualquer outro sem criar ciclos).

const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIAS_NO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const bissexto = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/** Regra ESTRUTURAL (a mesma do backup desde a 11.3): "AAAA-MM-DD", mês 01–12, dia existente no mês, 29/02 só em ano bissexto. */
export function dataValida(v) {
  const m = typeof v === "string" && DATA_RE.exec(v); if (!m) return false;
  const mes = +m[2], dia = +m[3];
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= (mes === 2 && bissexto(+m[1]) ? 29 : DIAS_NO_MES[mes - 1]);
}

/** Hoje no relógio do aparelho, em "AAAA-MM-DD" (só para o limite da faixa; não valida nada). */
export function hojeLocal() { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

/** Faixas de NEGÓCIO: valem só quando a data é informada ou alterada. O backup continua aceitando qualquer data
 *  estruturalmente válida (precisa restaurar o que versões antigas gravaram). */
export const FAIXAS = {
  operacao: { min: "2000-01-01", max: () => "2100-12-31", rotulo: "entre 01/01/2000 e 31/12/2100" }, // agendamento, pagamento, estorno, despesa
  nascimento: { min: "1900-01-01", max: hojeLocal, rotulo: "entre 01/01/1900 e hoje" },
};
export const faixa = (tipo) => { const f = FAIXAS[tipo]; return { min: f.min, max: f.max() }; };
const br = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Valida uma data ANTES de gravar. Devolve null (ok) ou a mensagem de erro.
 *  tipo: "operacao" | "nascimento". comFaixa=false: só a regra estrutural (valor já gravado e não alterado). */
export function validarData(v, tipo, { comFaixa = true, nome = "data" } = {}) {
  if (!dataValida(v)) return `Informe uma ${nome} válida (dia, mês e ano com 4 dígitos).`;
  if (!comFaixa) return null;
  const { min, max } = faixa(tipo);
  if (v < min || v > max) return `A ${nome} precisa estar ${FAIXAS[tipo].rotulo} (informada: ${br(v)}).`;
  return null;
}

/** Converte uma data DIGITADA (CSV): "DD/MM/AAAA" ou "AAAA-MM-DD" → "AAAA-MM-DD", só por componentes de texto.
 *  Devolve null se o formato não for um desses dois (a validade é conferida depois, por dataValida/validarData). */
export function paraInterna(texto) {
  const s = String(texto ?? "").trim(); let m;
  if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) return `${m[3]}-${m[2]}-${m[1]}`;
  if (DATA_RE.test(s)) return s;
  return null;
}

/** Sugestão SEM PERDA para um valor inválido já gravado: só troca de separador ("1990/05/17", "1990.05.17") que resulte
 *  numa data válida. Qualquer outro caso é ambíguo e não tem sugestão. A sugestão nunca é aplicada sem confirmação. */
export function sugestaoSemPerda(v) {
  const m = /^(\d{4})[/.](\d{2})[/.](\d{2})$/.exec(String(v ?? "").trim()); if (!m) return null;
  const d = `${m[1]}-${m[2]}-${m[3]}`; return dataValida(d) ? d : null;
}
