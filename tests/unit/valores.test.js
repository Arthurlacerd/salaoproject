// 11.3.1: valores digitados nos formulários. Atendimento (valor e valor já recebido), recebimento/estorno, serviço e
// despesa passam todos por parseMoeda — os testes de navegador (tests/e2e/valores.test.js) conferem cada formulário.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arq } from "./_app.js";
const { parseMoeda, reais } = await import("../../js/ui/util.js");
const confere = (casos) => { for (const [t, c] of casos) assert.equal(parseMoeda(t), c, JSON.stringify(t)); };

test("ponto de milhar SEM vírgula: \"1.500\" é R$ 1.500,00 (antes era gravado como R$ 1,50)", () => {
  confere([["1.500", 150000], ["2.000", 200000], ["10.000", 1000000], ["100.000", 10000000], ["1.234", 123400], ["12.500", 1250000], ["1.234.567", 123456700], ["R$ 1.500", 150000], [" 1.500 ", 150000]]);
  assert.equal(reais(parseMoeda("1.500")), "R$ 1.500,00");
});
test("os formatos pedidos: 1.500,00 · 1500 · 1.500,50", () => {
  confere([["1.500,00", 150000], ["1500", 150000], ["1.500,50", 150050]]);
  assert.deepEqual(["1.500", "2.000", "10.000", "1.500,00", "1500", "1.500,50"].map((t) => reais(parseMoeda(t))), ["R$ 1.500,00", "R$ 2.000,00", "R$ 10.000,00", "R$ 1.500,00", "R$ 1.500,00", "R$ 1.500,50"]);
});
test("formatos que já funcionavam continuam iguais (vírgula decimal, ponto decimal com 1 ou 2 casas, inteiros)", () => {
  confere([["10", 1000], ["0", 0], ["0,5", 50], ["0,05", 5], ["12,5", 1250], ["150,00", 15000], ["90,00", 9000], ["1.234,56", 123456], ["1.234.567,89", 123456789],
    ["12.50", 1250], ["1.50", 150], ["1.5", 150], ["100.00", 10000], ["0.50", 50], ["0.500", 50], ["R$ 90,00", 9000], ["R$90", 9000]]);
});
test("entradas inválidas continuam recusadas (NaN), sem virar outro valor", () => {
  for (const t of ["", "  ", "abc", "1,234", "1.2345", "1..500", "1.500.00", "-10", "1 500", "R$", "1.500,", ",50", "1,5,0", null, undefined]) assert.ok(Number.isNaN(parseMoeda(t)), JSON.stringify(t));
});
test("o valor que os formulários já trazem preenchido (\"1500,00\") volta exatamente ao mesmo número de centavos", () => {
  const amostra = [0, 1, 5, 99, 100, 999, 1000, 9000, 15000, 99999, 100000, 150000, 150050, 1234567, 99999999, 123456789];
  for (let i = 0; i < 500; i++) amostra.push(Math.floor(Math.random() * 1e9));
  for (const c of amostra) { const t = (c / 100).toFixed(2).replace(".", ","); assert.equal(parseMoeda(t), c, t); }
});
test("todos os formulários de valor usam parseMoeda: atendimento (valor e já recebido), recebimento/estorno, serviço e despesa", () => {
  const v = readFileSync(arq("js/ui/views.js"), "utf8");
  for (const campo of ["parseMoeda(d.valor)", "parseMoeda(d.valor_recebido)", 'parseMoeda(d.preco || "0")', "parseMoeda(f.valor)"]) assert.ok(v.includes(campo), campo);
  assert.equal((v.match(/parseMoeda\(d\.valor\)/g) || []).length, 2, "atendimento e recebimento/estorno");
});
