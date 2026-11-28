// 11.4: a retenção das cópias locais nunca apaga a ÚLTIMA cópia consistente (restaurável), nem pela quantidade nem pelo
// tamanho. As cópias inconsistentes seguem a política de antes; sem cópias inconsistentes o resultado é o mesmo da 11.3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { carregarVersaoGlobal } from "./_app.js";
carregarVersaoGlobal();
const B = await import("../../js/data/backup.js");
const MB = 1024 * 1024;

/** Simula N dias: começa com 1 cópia consistente e acrescenta uma inconsistente por dia, aplicando a retenção a cada vez. */
function simular(mb, dias, pol = B.politicaRetencao) {
  let lista = [{ id: 1, motivo: "automatico", tamanho: mb * MB }], perdeuNoDia = null;
  for (let dia = 1; dia <= dias; dia++) { lista.push({ id: dia + 1, motivo: "automatico", tamanho: mb * MB, inconsistente: true });
    const apagar = new Set(pol(lista)); lista = lista.filter((b) => !apagar.has(b.id)); if (perdeuNoDia === null && !lista.some((b) => !b.inconsistente)) perdeuNoDia = dia; }
  return { lista, perdeuNoDia };
}
// a política da 11.3.2 (cópia congelada), para mostrar o problema e comparar o comportamento sem cópias inconsistentes
function politica1132(lista, r = B.RETENCAO) {
  const ord = [...lista].sort((a, b) => b.id - a.id), manter = new Set(ord.slice(0, r.maximo).map((b) => b.id));
  for (const m of r.protegidos) { const b = ord.find((x) => x.motivo === m); if (b) manter.add(b.id); }
  let mantidos = ord.filter((b) => manter.has(b.id)), total = mantidos.reduce((s, b) => s + (b.tamanho || 0), 0);
  while (total > r.bytes && mantidos.length > r.minimo) { const b = mantidos.pop(); manter.delete(b.id); total -= b.tamanho || 0; }
  return ord.filter((b) => !manter.has(b.id)).map((b) => b.id);
}

test("o problema da 11.3.2: a última cópia consistente era apagada no 5º dia (8 MB) e no 2º dia (24 MB)", () => {
  assert.equal(simular(8, 30, politica1132).perdeuNoDia, 5); assert.equal(simular(24, 30, politica1132).perdeuNoDia, 2);
});
test("cenário A — 8 MB: a cópia consistente sobrevive a 30 dias de cópias inconsistentes", () => {
  const { lista, perdeuNoDia } = simular(8, 30); assert.equal(perdeuNoDia, null); assert.ok(lista.some((b) => b.id === 1));
  assert.equal(lista.reduce((s, b) => s + b.tamanho, 0) <= 40 * MB, true, "o limite de 40 MB continua respeitado");
});
test("cenário B — 24 MB: a cópia consistente sobrevive; fica junto com a mais recente (mínimo de 2, como antes)", () => {
  const { lista, perdeuNoDia } = simular(24, 30); assert.equal(perdeuNoDia, null);
  assert.deepEqual(lista.map((b) => b.id).sort((a, b) => a - b), [1, 31], "a consistente + a mais recente: mesmo espaço que a 11.3.2 já ocupava (2 cópias)");
});
test("cenário C — quantidade: com 20 cópias pequenas inconsistentes, a consistente é mantida além das 8 mais recentes", () => {
  const l = [{ id: 1, motivo: "automatico", tamanho: 10 }, ...Array.from({ length: 20 }, (_, i) => ({ id: i + 2, motivo: "automatico", tamanho: 10, inconsistente: true }))];
  const apagar = B.politicaRetencao(l); assert.equal(apagar.includes(1), false); assert.equal(l.length - apagar.length, 9, "8 mais recentes + a consistente");
});
test("cenário D — tamanho: o corte por tamanho pula a consistente e apaga a próxima mais antiga", () => {
  const l = [{ id: 1, motivo: "automatico", tamanho: 15 * MB }, ...[2, 3, 4, 5].map((id) => ({ id, motivo: "automatico", tamanho: 15 * MB, inconsistente: true }))];
  assert.deepEqual(B.politicaRetencao(l).sort((a, b) => a - b), [2, 3, 4], "fica a consistente (1) e a mais recente (5)");
});
test("a mais recente de todas nunca é apagada, mesmo com mínimo 1", () => {
  const l = [{ id: 1, motivo: "automatico", tamanho: 30 * MB }, { id: 2, motivo: "automatico", tamanho: 30 * MB, inconsistente: true }];
  assert.deepEqual(B.politicaRetencao(l, { ...B.RETENCAO, minimo: 1 }), [], "não há o que apagar sem tirar a mais recente ou a consistente");
});
test("as cópias inconsistentes não são todas removidas: seguem a política de antes", () => {
  const l = [{ id: 1, motivo: "automatico", tamanho: 1 }, ...[2, 3, 4].map((id) => ({ id, motivo: "automatico", tamanho: 1, inconsistente: true }))];
  assert.deepEqual(B.politicaRetencao(l), [], "poucas e pequenas: todas ficam");
});
test("sem cópias inconsistentes, o resultado é idêntico ao da 11.3.2 (quantidade, tamanho e motivos protegidos)", () => {
  const casos = [Array.from({ length: 13 }, (_, i) => ({ id: i + 1, motivo: i === 0 ? "pre_atualizacao" : "automatico", tamanho: 10 })),
    Array.from({ length: 6 }, (_, i) => ({ id: i + 1, motivo: "automatico", tamanho: 15 * MB })), [{ id: 1, motivo: "automatico", tamanho: 90 * MB }, { id: 2, motivo: "automatico", tamanho: 90 * MB }],
    [{ id: 1, motivo: "pre_importacao", tamanho: 10 * MB }, ...Array.from({ length: 10 }, (_, i) => ({ id: i + 2, motivo: "automatico", tamanho: 8 * MB }))]];
  for (const l of casos) assert.deepEqual(B.politicaRetencao(l).sort((a, b) => a - b), politica1132(l).sort((a, b) => a - b));
});
