// Utilitários dos testes unitários: caminhos e carga de js/versao.js (script clássico) no escopo global.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const arq = (f) => path.join(RAIZ, f);
export const ler = (f) => readFileSync(arq(f), "utf8");
/** Avalia js/versao.js (de qualquer texto) e devolve o objeto SALAO_VERSAO. */
export function versaoDe(texto = ler("js/versao.js")) { const g = {}; vm.runInNewContext(texto, { globalThis: g }); return g.SALAO_VERSAO; }
export function carregarVersaoGlobal() { globalThis.SALAO_VERSAO = versaoDe(); return globalThis.SALAO_VERSAO; }
export function pngDims(f) { const b = readFileSync(arq(f)); return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; }
