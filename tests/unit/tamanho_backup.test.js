// 11.3.1: aviso de tamanho do backup. Só informa — o limite da restauração (30 MB) NÃO mudou e nada é bloqueado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarVersaoGlobal } from "./_app.js";
carregarVersaoGlobal();
const T = await import("../../js/data/tamanho_backup.js");
const { LIMITE_BYTES } = await import("../../js/data/validacao_backup.js");
const MB = 1048576;

test("o limite NÃO mudou: 30 MB, o mesmo da restauração; aviso a partir de 24 MB (80%) e forte a partir de 27 MB", () => {
  assert.equal(LIMITE_BYTES, 30 * MB); assert.equal(T.LIMITE_RESTAURACAO, LIMITE_BYTES);
  assert.equal(T.LIMIAR_AVISO, Math.round(30 * MB * 0.8)); assert.equal(T.LIMIAR_FORTE, Math.round(30 * MB * 0.9));
});
test("abaixo de 24 MB → sem alerta (backup normal: comportamento atual preservado)", () => {
  for (const b of [0, 1, 500 * 1024, 9 * MB, 23.99 * MB, T.LIMIAR_AVISO - 1, null, undefined, NaN, "x"]) {
    const r = T.avaliarTamanho(b); assert.equal(r.nivel, "ok", String(b)); assert.equal(r.mensagem, null, String(b));
  }
});
test("24 MB → alerta", () => {
  for (const b of [T.LIMIAR_AVISO, 24 * MB, 25.5 * MB, T.LIMIAR_FORTE - 1]) {
    const r = T.avaliarTamanho(b); assert.equal(r.nivel, "aviso", String(b));
    assert.match(r.mensagem, /perto do limite de 30 MB que a restauração aceita/); assert.match(r.mensagem, /não podem ser restaurados por este aplicativo/);
  }
  assert.match(T.avaliarTamanho(24.5 * MB).mensagem, /O backup tem 24,5 MB/);
});
test("próximo de 30 MB → alerta forte", () => {
  for (const b of [T.LIMIAR_FORTE, 28 * MB, 29.99 * MB, LIMITE_BYTES - 1]) {
    const r = T.avaliarTamanho(b); assert.equal(r.nivel, "forte", String(b)); assert.match(r.mensagem, /^Atenção: .*muito perto do limite de 30 MB/);
  }
});
test("30 MB ou mais → informa claramente que o backup ultrapassou o limite de restauração", () => {
  for (const b of [LIMITE_BYTES, 31.4 * MB, 80 * MB]) {
    const r = T.avaliarTamanho(b); assert.equal(r.nivel, "acima", String(b));
    assert.match(r.mensagem, /ultrapassou o limite de 30 MB da restauração/); assert.match(r.mensagem, /não pode ser restaurado por este aplicativo/);
  }
  assert.match(T.avaliarTamanho(31.4 * MB).mensagem, /O backup tem 31,4 MB/);
});
test("tamanho em MB no formato brasileiro; mensagens sem nenhum dado pessoal", () => {
  assert.equal(T.emMB(30 * MB), "30 MB"); assert.equal(T.emMB(31.4 * MB), "31,4 MB"); assert.equal(T.emMB(24.04 * MB), "24 MB");
  assert.equal(T.emMB(0.6 * MB), "0,6 MB"); assert.equal(T.emMB(20 * 1024), "menos de 0,1 MB", "backup pequeno não aparece como \"0 MB\"");
  for (const b of [24 * MB, 28 * MB, 31 * MB]) assert.match(T.avaliarTamanho(b).mensagem, /^[^@<>]*$/);
});
