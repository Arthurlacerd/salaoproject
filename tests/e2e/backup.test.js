// Backup/restauração em Chromium com IndexedDB real: exportação, validação, checksum, restauração e garantias de segurança.
// 11.3: restaurar um backup com usuários exige a prova de acesso (D4); ids repetidos são recusados ANTES de gravar;
// estado atual inconsistente não bloqueia mais a restauração de um backup válido (D2). Ver também restauracao.test.js.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, estadoDados, limpar, DADOS, VERSAO, impressao } from "./_ambiente.js";

let dir, srv, nav, page, e0;
const PROVA = { usuario: "admin", senha: "senha-de-teste-123" };
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); page = await (await nav.newContext()).newPage(); await abrir(page, srv.url); await configurarAdmin(page); await semear(page); e0 = await estadoDados(page); });
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
/** Executa fn(B, R, arg) na página, com a administradora autenticada (restaurar exige um administrador — D1).
 *  Só entra se não houver sessão: o login muda "ultimo_acesso" e alteraria a impressão digital do estado. */
const B = (fn, arg) => page.evaluate(async ([src, a, prova]) => {
  const B = await import("./js/data/backup.js"), R = await import("./js/data/restauracao.js"), U = await import("./js/data/usuarios.js"), D = await import("./js/data/database.js");
  if (!D.sessao.usuario) await U.entrar(prova.usuario, prova.senha); return (0, eval)(src)(B, R, a, prova);
}, [fn.toString(), arg, PROVA]);

T("exportação: backup validado, checksum confere e contagens batem com o banco", async () => {
  const r = await B(async (B) => { const t = await B.exportarTexto(), d = JSON.parse(t), rel = await B.validar(t); return { ok: rel.ok, cont: rel.contagens, sha: d.sha256 === (await B.sha256(B.canonico(d.tabelas))), formato: d.formato, vf: d.versao_formato, app: d.versao_app, senhaClara: /"senha"\s*:/.test(t), hash: /pbkdf2\$/.test(t), cfgSens: d.tabelas.configuracoes_sistema.some((c) => ["schema_versao", "senha_hash"].includes(c.chave)), marcado: "estado_dados" in d }; });
  assert.equal(r.ok, true); assert.equal(r.sha, true); assert.equal(r.formato, "salao-gestao-backup"); assert.equal(r.vf, 1); assert.equal(r.app, VERSAO);
  assert.deepEqual([r.cont.clientes, r.cont.atendimentos, r.cont.pagamentos, r.cont.despesas, r.cont.usuarios], [1, 1, 1, 1, 1]);
  assert.equal(r.senhaClara, false); assert.equal(r.hash, true, "senhas só como hash PBKDF2"); assert.equal(r.cfgSens, false, "preferências locais não viajam");
  assert.equal(r.marcado, false, "backup saudável: formato v1 sem nenhum campo novo no cabeçalho");
});

T("restauração: dados apagados voltam a partir do backup (com prova de acesso); cópia antes da restauração criada", async () => {
  const r = await B(async (B, R, _a, prova) => {
    const texto = await B.exportarTexto(), { transacao } = await import("./js/data/database.js");
    const ts = ["clientes", "atendimentos", "pagamentos", "despesas"]; await transacao(ts, "readwrite", async (t) => { for (const x of ts) await t[x].limpar(); }); // "acidente": dados perdidos
    await R.restaurar(await R.analisarTexto(texto), { prova }); return (await B.snapshots()).map((s) => s.motivo);
  });
  assert.ok(r.includes("pre_importacao")); const e = await estadoDados(page); assert.deepEqual(e.cliente, e0.cliente); assert.equal(e.clientes, 1);
});

T("ids repetidos: recusado ANTES de gravar (antes, na 11.2, só depois do commit, com reimportação)", async () => {
  await B(async () => null); const antes = await impressao(page); // já autenticada: a análise e a tentativa não mudam nada
  const r = await B(async (B, R, _a, prova) => {
    const d = JSON.parse(await B.exportarTexto()); d.tabelas.clientes.push({ ...d.tabelas.clientes[0], nome: "Duplicada" }); d.sha256 = await B.sha256(B.canonico(d.tabelas));
    const rel = await R.analisarTexto(JSON.stringify(d)); let erro = ""; try { await R.restaurar(rel, { prova }); } catch (e) { erro = e.codigo; } return { valida: rel.ok, codigos: rel.codigos, erro };
  });
  assert.equal(r.valida, false); assert.ok(r.codigos.includes("CHAVE_REPETIDA")); assert.equal(r.erro, "BACKUP_INVALIDO");
  const depois = await impressao(page); assert.equal(depois.sha, antes.sha); assert.deepEqual(depois.copias, antes.copias, "nem a cópia foi criada: recusado antes de tudo");
});

T("estado atual inconsistente NÃO impede restaurar um backup válido (D2); a cópia fica marcada", async () => {
  const r = await B(async (B, R, _a, prova) => {
    const texto = await B.exportarTexto(), D = await import("./js/data/database.js"), cli = (await D.ler("clientes"))[0];
    await D.transacao(["clientes"], "readwrite", (t) => t.clientes.apagar(cli.id)); // atendimento órfão
    const rel = await R.analisarTexto(texto), res = await R.restaurar(rel, { prova }); const c = await R.ultimaCopiaPreRestauracao(); return { ok: !!res.contagens, inconsistente: c.inconsistente };
  });
  assert.equal(r.ok, true); assert.equal(r.inconsistente, true); assert.equal((await estadoDados(page)).cliente.nome, DADOS.nome);
});

T("arquivo adulterado é recusado e nada é importado", async () => {
  const r = await B(async (B) => { const d = JSON.parse(await B.exportarTexto()); d.tabelas.clientes[0].nome = "Adulterada"; return (await B.validar(JSON.stringify(d))).erros; });
  assert.match(r.join(), /alterado ou está corrompido/); assert.equal((await estadoDados(page)).cliente.nome, DADOS.nome);
});

T("snapshots: retenção aplicada no banco real (máximo 8 + protegidos)", async () => {
  const r = await B(async (B) => { for (let i = 0; i < 10; i++) await B.snapshot("automatico"); return (await B.snapshots()).map((s) => s.motivo); });
  assert.ok(r.length <= 8 + 4, `${r.length} cópias`); assert.ok(r.includes("pre_importacao"), "a última cópia antes da restauração é mantida");
});
