// Backup/restauração em Chromium com IndexedDB real: exportação, validação, checksum, restauração e rollback automático.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, estadoDados, limpar, DADOS } from "./_ambiente.js";

let dir, srv, nav, page, e0;
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); page = await (await nav.newContext()).newPage(); await abrir(page, srv.url); await configurarAdmin(page); await semear(page); e0 = await estadoDados(page); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
const B = (fn, arg) => page.evaluate(async ([src, a]) => { const B = await import("./js/data/backup.js"); return (0, eval)(src)(B, a); }, [fn.toString(), arg]);

T("exportação: backup validado, checksum confere e contagens batem com o banco", async () => {
  const r = await B(async (B) => { const t = await B.exportarTexto(), d = JSON.parse(t), rel = await B.validar(t); return { ok: rel.ok, cont: rel.contagens, sha: d.sha256 === (await B.sha256(B.canonico(d.tabelas))), formato: d.formato, vf: d.versao_formato, app: d.versao_app, senhaClara: /"senha"\s*:/.test(t), hash: /pbkdf2\$/.test(t), cfgSens: d.tabelas.configuracoes_sistema.some((c) => ["schema_versao", "senha_hash"].includes(c.chave)) }; });
  assert.equal(r.ok, true); assert.equal(r.sha, true); assert.equal(r.formato, "salao-gestao-backup"); assert.equal(r.vf, 1); assert.equal(r.app, "11.2.0");
  assert.deepEqual([r.cont.clientes, r.cont.atendimentos, r.cont.pagamentos, r.cont.despesas, r.cont.usuarios], [1, 1, 1, 1, 1]);
  assert.equal(r.senhaClara, false); assert.equal(r.hash, true, "senhas só como hash PBKDF2"); assert.equal(r.cfgSens, false, "preferências locais não viajam");
});

T("restauração: dados apagados voltam a partir do backup; cópia de segurança criada antes", async () => {
  const r = await B(async (B) => {
    const texto = await B.exportarTexto(), { transacao } = await import("./js/data/database.js");
    const ts = ["clientes", "atendimentos", "pagamentos", "despesas"]; await transacao(ts, "readwrite", async (t) => { for (const x of ts) await t[x].limpar(); }); // "acidente": dados perdidos
    await B.importar(await B.validar(texto)); const sn = await B.snapshots(); return sn.map((s) => s.motivo);
  });
  assert.ok(r.includes("pre_importacao")); const e = await estadoDados(page); assert.deepEqual(e.cliente, e0.cliente); assert.equal(e.clientes, 1);
});

T("rollback: restauração que não confere é desfeita e os dados anteriores permanecem", async () => {
  const r = await B(async (B) => {
    const d = JSON.parse(await B.exportarTexto()); // backup íntegro (checksum válido), mas com ids repetidos: a gravação "perde" registros
    d.tabelas.clientes.push({ ...d.tabelas.clientes[0], nome: "Duplicada" }); d.sha256 = await B.sha256(B.canonico(d.tabelas));
    const rel = await B.validar(JSON.stringify(d)); let erro = ""; try { await B.importar(rel); } catch (e) { erro = e.message; } return { valida: rel.ok, erro };
  });
  assert.equal(r.valida, true); assert.match(r.erro, /não passou na validação; os dados anteriores foram mantidos/);
  const e = await estadoDados(page); assert.deepEqual(e.cliente, e0.cliente); assert.equal(e.clientes, 1); assert.equal(e.atendimentos, 1);
});

T("estado atual inconsistente: a restauração é recusada ANTES de tocar nos dados (cópia de segurança não valida)", async () => {
  const r = await B(async (B) => { const texto = await B.exportarTexto(), { transacao } = await import("./js/data/database.js");
    const cli = (await (await import("./js/data/database.js")).ler("clientes"))[0];
    await transacao(["clientes"], "readwrite", (t) => t.clientes.apagar(cli.id)); // atendimento órfão
    let erro = ""; try { await B.importar(await B.validar(texto)); } catch (e) { erro = e.message; }
    await transacao(["clientes"], "readwrite", (t) => t.clientes.salvar(cli)); return erro; }); // devolve o estado
  assert.match(r, /backup gerado não passou na validação/); assert.equal((await estadoDados(page)).cliente.nome, DADOS.nome);
});

T("arquivo adulterado é recusado e nada é importado", async () => {
  const r = await B(async (B) => { const d = JSON.parse(await B.exportarTexto()); d.tabelas.clientes[0].nome = "Adulterada"; return (await B.validar(JSON.stringify(d))).erros; });
  assert.match(r.join(), /integridade/); assert.equal((await estadoDados(page)).cliente.nome, DADOS.nome);
});

T("snapshots: retenção aplicada no banco real (máximo 8 + protegidos)", async () => {
  const r = await B(async (B) => { for (let i = 0; i < 10; i++) await B.snapshot("automatico"); return (await B.snapshots()).map((s) => s.motivo); });
  assert.ok(r.length <= 8 + 4, `${r.length} cópias`); assert.ok(r.includes("pre_importacao"), "a última cópia de segurança pré-importação é mantida");
});
