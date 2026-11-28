// 11.3.2: tamanho do backup em bytes UTF-8 reais (o tamanho do arquivo), sem mudar limite, formato nem retenção.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arq, carregarVersaoGlobal } from "./_app.js";
carregarVersaoGlobal();
const T = await import("../../js/data/tamanho_backup.js");
const B = await import("../../js/data/backup.js");
const enc = new TextEncoder(), MB = 1048576;
const real = (s) => enc.encode(s).length; // referência: o que o navegador grava no arquivo (Blob/TextEncoder)

test("bytesUtf8 = bytes do arquivo: ASCII, acentos (2 bytes), ideogramas (3), emoji (4) e substitutos isolados (3)", () => {
  const casos = ["", "abc", "ação", "São Paulo — R$ 1.500,00", "Conceição Araújo", "日本語", "😀", "x😀y", "👩‍👩‍👧", "\ud800", "\udc00", "a\ud800b", "\ud800𐀀", "􏿿", "ç".repeat(1000)];
  for (const s of casos) assert.equal(T.bytesUtf8(s), real(s), JSON.stringify(s));
  assert.equal(T.bytesUtf8("ação"), 6); assert.equal("ação".length, 4, "4 caracteres, 6 bytes");
  for (const v of [null, undefined]) assert.equal(T.bytesUtf8(v), 0);
});

test("bytesUtf8 confere com o TextEncoder em 3.000 textos aleatórios (inclusive pares e substitutos soltos) e nunca é menor que o número de caracteres", () => {
  let semente = 20261128; const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 3000; k++) {
    let s = ""; const n = Math.floor(rnd() * 60);
    for (let i = 0; i < n; i++) { const r = rnd(); s += r < 0.5 ? String.fromCharCode(32 + Math.floor(rnd() * 95)) : r < 0.75 ? String.fromCharCode(0x80 + Math.floor(rnd() * 0x780)) : r < 0.9 ? String.fromCharCode(Math.floor(rnd() * 0x10000)) : String.fromCodePoint(0x10000 + Math.floor(rnd() * 0xfffff)); }
    assert.equal(T.bytesUtf8(s), real(s), JSON.stringify(s)); assert.ok(T.bytesUtf8(s) >= s.length);
  }
});

test("bytesUtf8 num texto de backup realista (JSON com acentos) é igual ao tamanho do arquivo e maior que o número de caracteres", () => {
  const doc = { formato: "salao-gestao-backup", tabelas: { clientes: Array.from({ length: 300 }, (_, i) => ({ id: i + 1, nome: `Ana Lúcia Conceição ${i}`, observacoes: "Prefere atendimento à tarde; coloração" })) } };
  const texto = JSON.stringify(doc); assert.equal(T.bytesUtf8(texto), real(texto)); assert.ok(T.bytesUtf8(texto) > texto.length);
});

test("cópias locais: usa os bytes reais (11.3.2+); nas cópias antigas, sem \"bytes\", usa o \"tamanho\" gravado", () => {
  assert.equal(T.tamanhoCopia({ tamanho: 800, bytes: 1000 }), 1000);
  assert.equal(T.tamanhoCopia({ tamanho: 800 }), 800, "cópia criada antes da 11.3.2");
  assert.equal(T.tamanhoCopia({ tamanho: 5, bytes: 0 }), 0);
  assert.equal(T.tamanhoCopia({ tamanho: 7, bytes: NaN }), 7); assert.equal(T.tamanhoCopia({ tamanho: 7, bytes: "x" }), 7);
  for (const c of [null, undefined]) assert.equal(T.tamanhoCopia(c), undefined);
  assert.equal(T.avaliarTamanho(T.tamanhoCopia({ tamanho: 12 * MB, bytes: 25 * MB })).nivel, "aviso", "o aviso segue os bytes reais");
});

test("retenção SEM mudança: continua por \"tamanho\" (8 cópias, mínimo 2, 40 MB); \"bytes\" não influencia", () => {
  assert.deepEqual(B.RETENCAO, { maximo: 8, minimo: 2, bytes: 40 * MB, protegidos: ["pre_atualizacao", "pre_migracao", "pre_importacao", "pre_retorno_versao"] });
  const tres = (tamanho, bytes) => [1, 2, 3].map((id) => ({ id, motivo: "automatico", tamanho, bytes }));
  assert.deepEqual(B.politicaRetencao(tres(12 * MB, 24 * MB)), [], "36 MB em tamanho: nada é apagado, mesmo com 72 MB em bytes");
  assert.deepEqual(B.politicaRetencao(tres(15 * MB, 15 * MB)), [1], "45 MB em tamanho: apaga a mais antiga, como antes");
  const src = readFileSync(arq("js/data/backup.js"), "utf8");
  // 11.4 (mudança prevista na especificação): a retenção também recebe "inconsistente", para nunca apagar a última cópia
  // consistente. O que este teste protege continua igual: o tamanho medido é "tamanho" (caracteres), não "bytes".
  assert.ok(src.includes("politicaRetencao(todos.map(({ id, motivo, tamanho, inconsistente }) => ({ id, motivo, tamanho: tamanho || 0, inconsistente: !!inconsistente })))"), "a retenção recebe id, motivo, tamanho e inconsistente — nunca bytes");
  assert.ok(src.includes("tamanho: texto.length, bytes: bytesUtf8(texto)"), "a cópia nova grava os dois: tamanho (retenção) e bytes (avisos)");
});

test("nada muda no limite nem no formato: 30 MB, mesmo formato e versão do formato", async () => {
  const V = await import("../../js/data/validacao_backup.js"), F = await import("../../js/data/formatos_backup.js");
  assert.equal(V.LIMITE_BYTES, 30 * MB); assert.equal(T.LIMITE_RESTAURACAO, 30 * MB);
  assert.equal(F.FORMATO, "salao-gestao-backup"); assert.equal(F.VERSAO_FORMATO, 1);
});
