// P1: retorno de versão só para versões compatíveis com o banco atual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarVersaoGlobal } from "./_app.js";
carregarVersaoGlobal();
const { compatibilidade, cmp } = await import("../../js/data/manutencao.js");
const atual = { banco: 2, schema: 3 };

test("retorno: bloqueado quando versao.banco < VERSAO_BANCO (o IndexedDB recusaria abrir)", () => {
  const r = compatibilidade({ versao: "11.0.0", banco: 1, schema: 3 }, atual); assert.equal(r.ok, false); assert.match(r.motivo, /mais antiga/);
});
test("retorno: bloqueado quando versao.banco > VERSAO_BANCO", () => assert.equal(compatibilidade({ versao: "x", banco: 3, schema: 3 }, atual).ok, false));
test("retorno: bloqueado quando o schema da versão é anterior aos dados já migrados", () => assert.equal(compatibilidade({ versao: "x", banco: 2, schema: 2 }, atual).ok, false));
test("retorno: bloqueado quando a versão não informa o banco", () => assert.equal(compatibilidade({ versao: "x" }, atual).ok, false));
test("retorno: permitido quando banco igual e schema igual", () => assert.equal(compatibilidade({ versao: "x", banco: 2, schema: 3 }, atual).ok, true));
test("retorno: 11.2.0 → 11.1.0 é compatível (ambos banco 1 / schema 2)", () => assert.equal(compatibilidade({ versao: "11.1.0", banco: 1, schema: 2 }).ok, true));
test("comparação de versões", () => { assert.ok(cmp("11.2.0", "11.1.0") > 0); assert.ok(cmp("10.10.0", "10.9.9") > 0); assert.equal(cmp("11.2.0", "11.2.0"), 0); });
