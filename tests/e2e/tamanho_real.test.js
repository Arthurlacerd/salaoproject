// 11.3.2 em Chromium: tamanho do backup em bytes UTF-8 reais — exportação, backup completo, cópias locais (com fallback para
// as cópias antigas), listas de cópias, painéis e Diagnóstico. Limite (30 MB), formato e retenção sem mudança.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar } from "./_ambiente.js";

let dir, srv, nav;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
const MB = 1048576, kb = (n) => `${(n / 1024).toFixed(0)} KB`;
async function aparelho() { const ctx = await nav.newContext({ timezoneId: "America/Sao_Paulo", locale: "pt-BR" }), page = await ctx.newPage(); await abrir(page, srv.url); await configurarAdmin(page); await semear(page); return { ctx, page }; }
const ir = async (page, rota, sel) => { await page.goto(srv.url + "#/sobre"); await page.waitForSelector("#vista > *:not(.skeleton)"); await page.goto(srv.url + "#/" + rota); await page.waitForSelector(sel); };
/** Só para o teste: uma cliente com observação acentuada — n caracteres "ã" ocupam 2n bytes no arquivo. */
const acentuar = (page, n) => page.evaluate(async (n) => { const D = await import("./js/data/database.js");
  await D.transacao(["clientes"], "readwrite", (t) => t.clientes.salvar({ id: 999999, nome: "Conceição Acentuada", telefone: "(11) 90000-9999", observacoes: "ã".repeat(n), criado_em: "2026-11-01 10:00:00", atualizado_em: "2026-11-01 10:00:00" })); }, n);
const diagnostico = (page) => page.evaluate(async () => (await (await import("./js/data/diagnostico.js")).executar()).itens.find((i) => i.id === "backup"));
const emMB = (page, n) => page.evaluate(async (n) => (await import("./js/data/tamanho_backup.js")).emMB(n), n);
function entradaZip(buf, nome) { // ZIP sem compressão ("store"), como o app gera
  for (let o = 0; o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50;) {
    const tam = buf.readUInt32LE(o + 18), n = buf.readUInt16LE(o + 26), x = buf.readUInt16LE(o + 28), ini = o + 30 + n + x;
    if (buf.toString("utf8", o + 30, o + 30 + n) === nome) return buf.subarray(ini, ini + tam); o = ini + tam;
  }
  return null;
}

T("exportação: o tamanho informado é o do arquivo baixado, em bytes (maior que o número de caracteres quando há acentos)", async () => {
  const { ctx, page } = await aparelho(); await acentuar(page, 50000); await ir(page, "dados", "#exportar");
  const [dl, r] = await Promise.all([page.waitForEvent("download"), page.evaluate(async () => (await import("./js/data/backup.js")).baixar())]);
  const p = await dl.path(), texto = readFileSync(p, "utf8");
  assert.equal(r.bytes, statSync(p).size, "bytes informados = tamanho do arquivo no disco");
  assert.ok(r.bytes >= texto.length + 50000, `${r.bytes} bytes × ${texto.length} caracteres`);
  assert.equal(JSON.parse(texto).formato, "salao-gestao-backup", "o arquivo continua no mesmo formato");
  await ctx.close();
});

T("backup completo: o tamanho informado é o do data/backup.salaobackup dentro do ZIP, em bytes", async () => {
  const { ctx, page } = await aparelho(); await acentuar(page, 50000); await ir(page, "manutencao", "#m-comp");
  const [dl, r] = await Promise.all([page.waitForEvent("download"), page.evaluate(async () => (await import("./js/data/manutencao.js")).backupCompleto())]);
  const dados = entradaZip(readFileSync(await dl.path()), "data/backup.salaobackup");
  assert.ok(dados, "o ZIP tem data/backup.salaobackup"); assert.equal(r.bytes, dados.length, "bytes informados = tamanho do arquivo dentro do ZIP");
  assert.ok(dados.length >= dados.toString("utf8").length + 50000); assert.equal(JSON.parse(dados.toString("utf8")).formato, "salao-gestao-backup");
  await ctx.close();
});

T("cópias novas gravam \"bytes\" (reais) e continuam gravando \"tamanho\"; listas e Diagnóstico usam bytes; cópia antiga sem \"bytes\" usa \"tamanho\"", async () => {
  const { ctx, page } = await aparelho(); await acentuar(page, 300000);
  const c = await page.evaluate(async () => { const B = await import("./js/data/backup.js"), D = await import("./js/data/database.js"); const s = await B.snapshot("automatico");
    const g = (await D.ler("backups")).find((b) => b.id === s.id); return { id: s.id, tamanho: g.tamanho, bytes: g.bytes, chars: g.texto.length, real: new TextEncoder().encode(g.texto).length }; });
  assert.equal(c.tamanho, c.chars, "\"tamanho\" continua em caracteres (é o que a retenção usa)"); assert.equal(c.bytes, c.real, "\"bytes\" = UTF-8 real");
  assert.ok(c.bytes >= c.tamanho + 300000); assert.notEqual(kb(c.bytes), kb(c.tamanho));
  const linha = async (rota, sel) => { await ir(page, rota, sel); return page.$eval(`[data-snap="${c.id}"]`, (b) => b.closest("li").textContent); };
  assert.ok((await linha("dados", "#exportar")).includes(kb(c.bytes)), "Dados: KB em bytes reais");
  assert.ok((await linha("manutencao", "#m-exp")).includes(kb(c.bytes)), "Manutenção: KB em bytes reais");
  assert.ok((await diagnostico(page)).texto.startsWith(`Última cópia: ${await emMB(page, c.bytes)} de 30 MB`), "Diagnóstico em bytes reais");
  // a mesma cópia como se tivesse sido criada pela 11.3.1 (sem "bytes"): vale o "tamanho"
  await page.evaluate(async (id) => { const D = await import("./js/data/database.js"); await D.transacao(["backups"], "readwrite", async (t) => { const b = await t.backups.get(id); delete b.bytes; await t.backups.salvar(b); }); }, c.id);
  assert.ok((await linha("dados", "#exportar")).includes(kb(c.tamanho)), "Dados: cópia antiga pelo tamanho");
  assert.ok((await linha("manutencao", "#m-exp")).includes(kb(c.tamanho)), "Manutenção: cópia antiga pelo tamanho");
  assert.ok((await diagnostico(page)).texto.startsWith(`Última cópia: ${await emMB(page, c.tamanho)} de 30 MB`), "Diagnóstico: cópia antiga pelo tamanho");
  await ctx.close();
});

T("os avisos seguem os bytes reais: abaixo de 24 MB em caracteres e acima em bytes → alerta (Dados, Manutenção, Diagnóstico e ao exportar); 30 MB ou mais em bytes → \"ultrapassou o limite\"", async () => {
  const { ctx, page } = await aparelho();
  const copia = async (n) => { await acentuar(page, n); return page.evaluate(async () => { const s = await (await import("./js/data/backup.js")).snapshot("automatico"); return { tamanho: s.tamanho, bytes: s.bytes }; }); };
  const estado = async () => {
    await ir(page, "dados", "#exportar"); const dados = await page.$eval("[data-tamanho-backup]", (e) => e.dataset.tamanhoBackup).catch(() => null);
    await ir(page, "manutencao", "#m-exp"); const man = await page.$eval("[data-tamanho-backup]", (e) => e.dataset.tamanhoBackup).catch(() => null);
    const d = await diagnostico(page); return { dados, man, diag: d.estado, texto: d.texto };
  };
  let c = await copia(Math.round(12.2 * MB)); assert.ok(c.tamanho < 24 * MB && c.bytes >= 24 * MB && c.bytes < 27 * MB, JSON.stringify(c));
  let e = await estado(); assert.deepEqual([e.dados, e.man, e.diag], ["aviso", "aviso", "aviso"], JSON.stringify(e)); assert.match(e.texto, /^Última cópia: 24,\d MB de 30 MB/);
  await ir(page, "dados", "#exportar"); await Promise.all([page.waitForEvent("download"), page.click("#exportar")]);
  await page.waitForFunction(() => document.querySelector("#alertas").textContent.includes("perto do limite de 30 MB"), null, { timeout: 60000 });
  c = await copia(Math.round(15.3 * MB)); assert.ok(c.tamanho < 24 * MB && c.bytes >= 30 * MB, JSON.stringify(c));
  e = await estado(); assert.deepEqual([e.dados, e.man, e.diag], ["acima", "acima", "erro"], JSON.stringify(e)); assert.match(e.texto, /ultrapassou o limite de 30 MB da restauração/);
  await ctx.close();
});
