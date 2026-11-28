// Tamanho do backup × limite da restauração (11.3.1). SÓ INFORMA: não bloqueia a exportação e não muda o limite.
// A restauração recusa arquivos acima de LIMITE_BYTES (30 MB, validacao_backup.js). O backup cresce com o uso, e a maior
// parte do volume é o histórico de alterações (auditoria): cada atendimento gera em média ~6 registros.
// 11.3.2: o tamanho medido é o do ARQUIVO, em bytes UTF-8 reais (cada acento ocupa 2 bytes). É o critério mais rigoroso:
// a restauração de um arquivo confere os bytes, e a de uma cópia deste aparelho confere os caracteres, que nunca passam dos
// bytes. Cópias locais criadas antes da 11.3.2 não têm "bytes": para elas vale o "tamanho" gravado (caracteres).
// A retenção das cópias (backup.js) continua usando "tamanho", sem mudança.
import { LIMITE_BYTES } from "./validacao_backup.js";

export const LIMITE_RESTAURACAO = LIMITE_BYTES;
export const LIMIAR_AVISO = Math.round(LIMITE_BYTES * 0.8); // 24 MB
export const LIMIAR_FORTE = Math.round(LIMITE_BYTES * 0.9); // 27 MB: "próximo de 30 MB"
const MB = 1048576;
/** 11.3.2: bytes do texto gravado em UTF-8 (o tamanho do arquivo baixado), sem alocar memória. Dá o mesmo resultado que
 *  new TextEncoder().encode(texto).length (um substituto isolado conta 3 bytes, como no TextEncoder). */
export function bytesUtf8(texto) {
  const s = String(texto ?? ""); let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
/** 11.3.2: tamanho de uma cópia local para exibir e avisar: os bytes reais; nas cópias antigas (sem "bytes"), o "tamanho". */
export const tamanhoCopia = (c) => (c == null ? undefined : Number.isFinite(c.bytes) ? c.bytes : c.tamanho);
export const emMB = (bytes) => { const mb = Math.round((bytes / MB) * 10) / 10; return mb < 0.1 ? "menos de 0,1 MB" : mb.toLocaleString("pt-BR") + " MB"; }; // "30 MB", "31,4 MB"

/** nivel: "ok" (abaixo de 24 MB, sem aviso), "aviso" (a partir de 24 MB), "forte" (a partir de 27 MB) ou "acima"
 *  (30 MB ou mais: a restauração não aceita). mensagem: null quando "ok". */
export function avaliarTamanho(bytes) {
  const n = Number(bytes), limite = emMB(LIMITE_RESTAURACAO);
  if (!Number.isFinite(n) || n < LIMIAR_AVISO) return { nivel: "ok", bytes: Number.isFinite(n) ? n : null, mensagem: null };
  const tam = emMB(n);
  if (n >= LIMITE_RESTAURACAO) return { nivel: "acima", bytes: n, mensagem: `O backup tem ${tam} e ultrapassou o limite de ${limite} da restauração: ele não pode ser restaurado por este aplicativo. Guarde-o mesmo assim e procure o suporte.` };
  if (n >= LIMIAR_FORTE) return { nivel: "forte", bytes: n, mensagem: `Atenção: o backup tem ${tam}, muito perto do limite de ${limite} que a restauração aceita. Quando passar desse limite, ele não poderá ser restaurado por este aplicativo. Procure o suporte.` };
  return { nivel: "aviso", bytes: n, mensagem: `O backup tem ${tam}, perto do limite de ${limite} que a restauração aceita. Backups acima desse limite não podem ser restaurados por este aplicativo. Continue baixando e guardando seus backups.` };
}
