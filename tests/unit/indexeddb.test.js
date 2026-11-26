// Migrations (lógica pura; a abertura real do IndexedDB é testada no navegador em tests/e2e/pwa.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarVersaoGlobal, ler } from "./_app.js";
const V = carregarVersaoGlobal();
const { MIGRACOES, versaoNativa, versaoLogica, TABELAS_BASE } = await import("../../js/data/migracoes.js");

test("migrations: numeradas 1..N, sem repetição", () => assert.deepEqual(MIGRACOES.map((m) => m.versao), MIGRACOES.map((_, i) => i + 1)));
test("migrations: versão nativa e lógica conferem com js/versao.js (banco 1 / schema 2 — sem mudança na 11.2)", () => {
  assert.equal(versaoNativa(), V.banco); assert.equal(versaoLogica(), V.schema);
  assert.equal(V.banco, 1); assert.equal(V.schema, 2);
});
test("migrations: só a 1 mexe na estrutura; nenhuma apaga store ou banco", () => {
  assert.deepEqual(MIGRACOES.filter((m) => m.estrutura).map((m) => m.versao), [1]);
  const src = ler("js/data/migracoes.js"); assert.doesNotMatch(src, /deleteObjectStore|deleteDatabase|\.clear\(/);
  assert.ok(TABELAS_BASE.includes("clientes") && TABELAS_BASE.includes("atendimentos"));
});
test("migration 2: idempotente e reversível sem tocar em outras chaves", async () => {
  const mem = new Map([["outra", { chave: "outra", valor: "x" }], ["backup_antes_atualizar", { chave: "backup_antes_atualizar", valor: "0" }]]);
  const t = { config: { get: async (k) => mem.get(k), salvar: async (v) => mem.set(v.chave, v), apagar: async (k) => mem.delete(k) } };
  const m2 = MIGRACOES[1]; await m2.dados(t); await m2.dados(t);
  assert.equal(mem.get("historico_versoes").valor, "[]"); assert.equal(mem.get("backup_antes_atualizar").valor, "0", "não sobrescreve preferência existente");
  await m2.reverter(t); assert.equal(mem.get("outra").valor, "x"); assert.equal(mem.has("historico_versoes"), false);
});
test("nenhum código do app apaga o banco ou recria do zero", () => {
  for (const f of ["js/app.js", "js/data/database.js", "js/data/backup.js", "js/data/manutencao.js", "js/data/diagnostico.js", "sw.js"]) assert.doesNotMatch(ler(f), /deleteDatabase/, f);
});
