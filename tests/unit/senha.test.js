// senha_hash (11.3): validação estrutural COMPLETA do formato do app; login tolerante e sem erro técnico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { arq } from "./_app.js";
import { HASH, SENHA } from "./_fixtures.js";
const S = await import("../../js/data/senha.js"), U = await import("../../js/data/usuarios.js");

// Formatos plausíveis gerados pelo Python real (ver gera_hashes.py) — NÃO são dados da 9.x.
const PY = JSON.parse(execFileSync("python3", ["-I", arq("tests/unit/gera_hashes.py"), SENHA]).toString());
const [, , SAL, DK] = HASH.split("$");
const motivo = (h) => S.analisarHash(h).motivo;

test("hash gerado pelo próprio app: válido (150.000 iterações, sal 16 bytes, hash 32 bytes) e confere", async () => {
  const a = S.analisarHash(HASH); assert.equal(a.ok, true); assert.equal(a.iteracoes, 150000); assert.equal(a.sal.length, 16); assert.equal(a.hash.length, 32);
  assert.equal(await U.conferir(SENHA, HASH), true); assert.equal(await U.conferir("outra-senha", HASH), false);
});
test("hash no formato do app gerado pelo Python (150 mil e 600 mil iterações): válido e confere", async () => {
  for (const h of [PY.app150k, PY.app600k]) { assert.equal(S.analisarHash(h).ok, true, h.slice(0, 14)); assert.equal(await U.conferir(SENHA, h), true); }
});
test("limites de iterações: 100.000 e 1.000.000 aceitos; 99.999 e 1.000.001 recusados", () => {
  for (const [it, ok] of [["100000", true], ["1000000", true], ["99999", false], ["1000001", false]]) assert.equal(S.analisarHash(`pbkdf2$${it}$${SAL}$${DK}`).ok, ok, it);
});
test("iterações malformadas: zero à esquerda, letras, negativo, vazio, decimal, notação científica, gigante", () => {
  for (const it of ["0150000", "abc", "-150000", "", "150000.5", "1e6", "99999999999"]) assert.equal(motivo(`pbkdf2$${it}$${SAL}$${DK}`), "iteracoes", it);
});
test("quantidade de campos: 3 ou 5 campos são recusados; vazio e não-texto também", () => {
  assert.equal(motivo(`pbkdf2$150000$${SAL}`), "campos"); assert.equal(motivo(`pbkdf2$150000$${SAL}$${DK}$extra`), "campos");
  for (const h of ["", null, undefined, 123, {}]) assert.equal(motivo(h), "ausente");
});
test("algoritmo: Werkzeug (pbkdf2:sha256:…) e scrypt são recusados — não suportados nesta versão", () => {
  assert.equal(motivo(PY.werkzeug), "algoritmo"); assert.equal(motivo(PY.scrypt), "algoritmo"); assert.equal(motivo(`sha256$150000$${SAL}$${DK}`), "algoritmo");
});
test("CASO DA INVESTIGAÇÃO: prefixo pbkdf2$ com interior inválido (hexadecimal) é recusado", () => {
  assert.ok(PY.hex.startsWith("pbkdf2$")); assert.equal(S.analisarHash(PY.hex).ok, false); assert.equal(motivo(PY.hex), "sal");
});
test("SHA-512 (hash de 64 bytes) é recusado", () => assert.equal(motivo(PY.sha512), "hash"));
test("sal inválido: fora do alfabeto base64, 15 e 17 bytes, base64 não canônico, sem preenchimento", () => {
  const b64 = (n) => Buffer.alloc(n, 7).toString("base64");
  for (const sal of ["!!!!!!!!!!!!!!!!!!!!!!==", b64(15), b64(17), "AAAAAAAAAAAAAAAAAAAAAB==", SAL.slice(0, -2)]) assert.equal(motivo(`pbkdf2$150000$${sal}$${DK}`), "sal", sal);
});
test("hash com 31 e 33 bytes é recusado", () => {
  for (const n of [31, 33]) assert.equal(motivo(`pbkdf2$150000$${SAL}$${Buffer.alloc(n, 1).toString("base64")}`), "hash");
});
test("o motivo da recusa nunca contém o conteúdo do hash", () => {
  for (const h of [PY.hex, PY.werkzeug, `pbkdf2$1$${SAL}$${DK}`]) { const r = S.analisarHash(h); assert.deepEqual(Object.keys(r).sort(), ["motivo", "ok"]); }
});
test("login (conferir) aceita os mesmos hashes de antes (ex.: 50 mil iterações) e nunca lança com hash ilegível", async () => {
  assert.equal(S.analisarHash(PY.app50k).ok, false, "fora do padrão estrutural atual…");
  assert.equal(await U.conferir(SENHA, PY.app50k), true, "…mas quem já tem esse hash no aparelho continua entrando");
  for (const h of [PY.werkzeug, PY.scrypt, "lixo", "", undefined, null, "pbkdf2$abc$$", `pbkdf2$0$${SAL}$${DK}`]) assert.equal(await U.conferir(SENHA, h), false, String(h));
});
