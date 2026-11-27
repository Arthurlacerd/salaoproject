// Tamanho do backup × limite da restauração (11.3.1). SÓ INFORMA: não bloqueia a exportação e não muda o limite.
// A restauração recusa arquivos acima de LIMITE_BYTES (30 MB, validacao_backup.js). O backup cresce com o uso, e a maior
// parte do volume é o histórico de alterações (auditoria): cada atendimento gera em média ~6 registros.
// O tamanho medido é o do texto do backup (caracteres), o mesmo que a restauração de uma cópia deste aparelho confere;
// o arquivo baixado, em bytes, fica um pouco maior por causa dos acentos (~0,7% num backup típico). Por isso o aviso
// começa em 80% e fica forte em 90%: há margem antes do limite.
import { LIMITE_BYTES } from "./validacao_backup.js";

export const LIMITE_RESTAURACAO = LIMITE_BYTES;
export const LIMIAR_AVISO = Math.round(LIMITE_BYTES * 0.8); // 24 MB
export const LIMIAR_FORTE = Math.round(LIMITE_BYTES * 0.9); // 27 MB: "próximo de 30 MB"
const MB = 1048576;
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
