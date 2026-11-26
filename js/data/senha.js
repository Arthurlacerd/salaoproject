// Formato do senha_hash do Salão.gestão — o MESMO da 10.1 à 11.3 (não muda nesta versão; nenhum hash é migrado):
//   pbkdf2$<iterações>$<sal em base64>$<hash em base64>
//   PBKDF2-HMAC-SHA-256 (WebCrypto), sal aleatório de 16 bytes, derivação de 256 bits (32 bytes), 150.000 iterações.
// analisarHash(): validação ESTRUTURAL COMPLETA, usada para aceitar usuários vindos de um backup (11.3). Não calcula o PBKDF2.
// hashLegivel(): o que o login consegue processar — tolerante de propósito (igual ao que a 11.2 aceitava), para que nenhum
//   usuário já existente no aparelho perca o acesso por causa desta versão.
export const FORMATO_SENHA = Object.freeze({ algoritmo: "pbkdf2", iteracoesMin: 100000, iteracoesMax: 1000000, salBytes: 16, hashBytes: 32 });
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Bytes de um texto em base64 padrão e CANÔNICO (alfabeto, preenchimento e bits finais corretos); null se não for. */
export function bytesBase64(s) {
  if (typeof s !== "string" || !s || s.length % 4 !== 0 || !B64.test(s)) return null;
  let bin; try { bin = atob(s); } catch (_) { return null; }
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return btoa(String.fromCharCode(...b)) === s ? b : null;
}

/** Valida o senha_hash por completo. Nunca lança. { ok: true, iteracoes, sal, hash } | { ok: false, motivo }.
 *  motivo ∈ ausente | algoritmo | campos | iteracoes | sal | hash — nunca contém o conteúdo do hash. */
export function analisarHash(h) {
  if (typeof h !== "string" || !h) return { ok: false, motivo: "ausente" };
  const p = h.split("$");
  if (p[0] !== FORMATO_SENHA.algoritmo) return { ok: false, motivo: "algoritmo" }; // ex.: pbkdf2:sha256:… (Werkzeug), scrypt:…
  if (p.length !== 4) return { ok: false, motivo: "campos" };
  if (!/^[1-9]\d{0,8}$/.test(p[1])) return { ok: false, motivo: "iteracoes" };
  const it = Number(p[1]);
  if (it < FORMATO_SENHA.iteracoesMin || it > FORMATO_SENHA.iteracoesMax) return { ok: false, motivo: "iteracoes" };
  const sal = bytesBase64(p[2]); if (!sal || sal.length !== FORMATO_SENHA.salBytes) return { ok: false, motivo: "sal" };
  const hash = bytesBase64(p[3]); if (!hash || hash.length !== FORMATO_SENHA.hashBytes) return { ok: false, motivo: "hash" };
  return { ok: true, iteracoes: it, sal, hash };
}

/** Tolerante (login): 4 campos separados por "$", iterações inteiras positivas e sal/hash decodificáveis em base64 —
 *  exatamente o que o login da 11.2 conseguia processar. null = ilegível (o login responde "senha incorreta"). */
export function hashLegivel(h) {
  if (typeof h !== "string") return null;
  const p = h.split("$");
  if (p.length !== 4 || !/^\d+$/.test(p[1]) || !(Number(p[1]) > 0)) return null;
  try { const sal = Uint8Array.from(atob(p[2]), (c) => c.charCodeAt(0)); atob(p[3]); return { iteracoes: Number(p[1]), sal, hashB64: p[3] }; }
  catch (_) { return null; }
}
