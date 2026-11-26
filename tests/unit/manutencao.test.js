// P1: retorno de versão só para versões compatíveis com o banco atual.
// 11.3: e nunca abaixo da versão mínima segura (11.3.0): as anteriores restauram backups sem login.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarVersaoGlobal } from "./_app.js";
carregarVersaoGlobal();
const { compatibilidade, cmp, VERSAO_MINIMA_RETORNO } = await import("../../js/data/manutencao.js");
const atual = { banco: 2, schema: 3 };

test("retorno: bloqueado quando versao.banco < VERSAO_BANCO (o IndexedDB recusaria abrir)", () => {
  const r = compatibilidade({ versao: "11.0.0", banco: 1, schema: 3 }, atual); assert.equal(r.ok, false); assert.match(r.motivo, /mais antiga/);
});
test("retorno: bloqueado quando versao.banco > VERSAO_BANCO", () => assert.equal(compatibilidade({ versao: "x", banco: 3, schema: 3 }, atual).ok, false));
test("retorno: bloqueado quando o schema da versão é anterior aos dados já migrados", () => assert.equal(compatibilidade({ versao: "x", banco: 2, schema: 2 }, atual).ok, false));
test("retorno: bloqueado quando a versão não informa o banco", () => assert.equal(compatibilidade({ versao: "x" }, atual).ok, false));
test("retorno: permitido quando banco igual e schema igual (versão segura)", () => assert.equal(compatibilidade({ versao: "11.3.0", banco: 2, schema: 3 }, atual).ok, true));
test("retorno: 11.1.0 e 11.2.0 são RECUSADOS — banco/schema compatíveis (banco 1 / schema 2), mas abaixo da versão mínima segura", () => {
  assert.equal(VERSAO_MINIMA_RETORNO, "11.3.0");
  for (const versao of ["11.1.0", "11.2.0"]) {
    const r = compatibilidade({ versao, banco: 1, schema: 2 }); assert.equal(r.ok, false, versao);
    assert.match(r.motivo, /antiga demais para um retorno seguro/, `${versao}: o motivo é a versão mínima, não o banco`); assert.match(r.motivo, /11\.3\.0/);
  }
  assert.equal(compatibilidade({ versao: "11.3.0", banco: 1, schema: 2 }).ok, true, "a própria versão mínima continua aceita");
});
test("retorno: versão mínima por comparação NUMÉRICA (não de texto); formato inválido é recusado", () => {
  for (const versao of ["11.3.0", "11.3.1", "11.10.0", "12.0.0", "100.0.0"]) assert.equal(compatibilidade({ versao, banco: 1, schema: 2 }).ok, true, versao);
  for (const versao of ["11.2.99", "10.99.99", "9.9.9", "2.0.0", "11.1.0"]) assert.equal(compatibilidade({ versao, banco: 1, schema: 2 }).ok, false, versao);
  assert.ok("11.10.0" < "11.3.0", "por texto, 11.10.0 seria menor — e mesmo assim é aceita acima");
  for (const versao of ["11.3", "11.3.0-beta", " 11.3.0", "v11.3.0", "11.3.0.1", "x", "", null, undefined, 1130]) {
    const r = compatibilidade({ versao, banco: 1, schema: 2 }); assert.equal(r.ok, false, String(versao)); assert.match(r.motivo, /bloqueado/);
  }
});
test("comparação de versões", () => { assert.ok(cmp("11.2.0", "11.1.0") > 0); assert.ok(cmp("10.10.0", "10.9.9") > 0); assert.equal(cmp("11.2.0", "11.2.0"), 0); });
