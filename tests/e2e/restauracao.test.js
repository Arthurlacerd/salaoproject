// Restauração segura (11.3) em Chromium real, perfis descartáveis. Requisito central:
//   "backup inválido → rejeição → estado anterior intacto"   e   "backup válido → restauração concluída → login funcionando".
// O backup de teste vem de OUTRO aparelho (outros usuários e dados), gerado pelo próprio app.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { carregarVersaoGlobal } from "../unit/_app.js";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar, entrarUI, impressao } from "./_ambiente.js";
carregarVersaoGlobal();
const F = await import("../../js/data/formatos_backup.js");

const ADMIN = { usuario: "admin", senha: "senha-de-teste-123" }, DONA = { usuario: "dona", senha: "senha-da-dona-456" };
let dir, srv, nav, X; // X = texto do backup do "outro aparelho"
const T = (nome, fn) => test(nome, { skip: semNavegador }, fn);
const resselar = async (d) => ({ ...d, sha256: await F.sha256(F.canonico(d.tabelas)) });
const variante = async (muda, { selar = true } = {}) => { const d = JSON.parse(X); muda(d.tabelas, d); return JSON.stringify(selar ? await resselar(d) : d); };

async function aparelho({ semDados = false } = {}) { // aparelho com admin próprio e dados (ou em primeiro acesso)
  const ctx = await nav.newContext(), page = await ctx.newPage(); await abrir(page, srv.url);
  if (!semDados) { await configurarAdmin(page); await semear(page); }
  return { ctx, page };
}
const naPagina = (page, fn, arg) => page.evaluate(fn, arg);
/** O elemento existe? Booleano de propósito: uma falha com o objeto do Playwright no assert estoura a memória ao ser relatada. */
const existe = async (page, sel) => (await page.$(sel)) !== null;
/** Analisa e tenta restaurar dentro da página; devolve o resultado ou { codigo, mensagem } do erro. */
const restaurar = (page, texto, prova) => naPagina(page, async ([texto, prova]) => {
  const R = await import("./js/data/restauracao.js"), rel = await R.analisarTexto(texto);
  try { const r = await R.restaurar(rel, { prova }); return { ok: true, ...r }; } catch (e) { return { codigo: e.codigo, mensagem: e.message, codigos: rel.codigos }; }
}, [texto, prova]);
const analisar = (page, texto) => naPagina(page, async (t) => { const r = await (await import("./js/data/restauracao.js")).analisarTexto(t); return { ok: r.ok, codigos: r.codigos, erros: r.erros }; }, texto);
const entrar = (page, c) => naPagina(page, async (c) => { try { await (await import("./js/data/usuarios.js")).entrar(c.usuario, c.senha); return true; } catch (_) { return false; } }, c);
const sair = async (page) => { await naPagina(page, async () => (await import("./js/data/usuarios.js")).sair()); await page.reload(); };
const tabelas = (page) => naPagina(page, async () => (await (await import("./js/data/backup.js")).montar()).tabelas);
const desfazer = (page) => naPagina(page, async () => { try { await (await import("./js/data/restauracao.js")).desfazerUltimaRestauracao(); return "desfez"; } catch (e) { return e.codigo; } });
/** Troca o id da 1ª cliente (e as referências a ela) — limite de ids (M2). Roda no Node, sobre as tabelas do backup. */
const trocarIdCliente = (T, novo) => { const c = T.clientes[0]; for (const a of T.atendimentos) if (a.cliente_id === c.id) a.cliente_id = novo; c.id = novo; };
const semAuditoria = ({ auditoria, ...t }) => t;
const semVolateis = ({ auditoria, usuarios, ...t }) => t; // o login muda ultimo_acesso: usuários são conferidos pelos nomes

before(async () => {
  if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador();
  const { ctx, page } = await aparelho({ semDados: true }); // "outro aparelho": a dona, com dados próprios e uma recepcionista
  await configurarAdmin(page, { ...DONA, nome: "Dona do Salão", salao: "Salão da Dona" }); await semear(page);
  X = await naPagina(page, async () => {
    const Cli = await import("./js/data/clientes.js"), U = await import("./js/data/usuarios.js"), B = await import("./js/data/backup.js");
    await Cli.salvar({ nome: "Cliente da Dona", telefone: "(31) 97777-6666" }); await U.criar({ nome: "Recepção", usuario: "recep", perfil: "recepcao", senha: "senha-recep-789" });
    return B.exportarTexto();
  });
  await ctx.close();
});
after(async () => { if (semNavegador) return; await nav.close(); await srv.fechar(); limpar(dir); });

T("backup válido de outro aparelho, pela TELA: prova de acesso, sessão encerrada, login com usuário do backup e dados íntegros", async () => {
  const { ctx, page } = await aparelho();
  await page.goto(srv.url + "#/dados"); await page.waitForSelector("#arq");
  await page.setInputFiles("#arq", { name: "outro.salaobackup", mimeType: "application/octet-stream", buffer: Buffer.from(X) });
  await page.click("#analisar"); await page.waitForSelector('[data-restauracao="previa"]');
  assert.ok(await existe(page, "#copia-emergencia"), "cópia de emergência oferecida (com login)");
  await page.fill('input[name="prova_usuario"]', DONA.usuario); await page.fill('input[name="prova_senha"]', DONA.senha); await page.fill('#f-imp input[name="c"]', "SUBSTITUIR");
  await Promise.all([page.waitForEvent("load", { timeout: 20000 }), page.click('#f-imp button[type="submit"]')]);
  await page.waitForSelector('form#f input[name="senha"]'); // sessão encerrada: volta ao login
  const t = await tabelas(page), x = JSON.parse(X).tabelas; // estado logo após a restauração (antes de alguém entrar)
  assert.equal(await entrar(page, ADMIN), false, "o admin antigo foi substituído pelos usuários do backup");
  await entrarUI(page, DONA.usuario, DONA.senha);
  assert.deepEqual(semAuditoria(t), semAuditoria(x), "dados idênticos aos do backup"); assert.equal(t.auditoria.length, x.auditoria.length + 1, "+1 registro: a própria restauração");
  assert.deepEqual(t.usuarios.map((u) => u.usuario).sort(), ["dona", "recep"]);
  await ctx.close();
});

T("backup INVÁLIDO → recusado → estado anterior INTACTO (dados, usuários, cópias e login), para cada tipo de problema", async () => {
  const { ctx, page } = await aparelho(); const antes = await impressao(page);
  const casos = [
    ["senha pbkdf2$ com interior inválido (caso da investigação)", (T) => (T.usuarios.find((u) => u.usuario === "dona").senha_hash = "pbkdf2$150000$" + "ab".repeat(16) + "$" + "cd".repeat(32)), "SENHA_NAO_SUPORTADA"],
    ["nenhum administrador", (T) => (T.usuarios = T.usuarios.filter((u) => u.perfil !== "admin")), "SEM_ADMIN_ATIVO"],
    ["administrador inativo", (T) => (T.usuarios.find((u) => u.perfil === "admin").ativo = 0), "SEM_ADMIN_ATIVO"],
    ["usuário sem 'ativo'", (T) => delete T.usuarios[1].ativo, "USUARIO_INCOMPATIVEL"],
    ["usuário com maiúscula", (T) => (T.usuarios[0].usuario = "Dona"), "USUARIO_INCOMPATIVEL"],
    ["tabela de usuários vazia", (T) => (T.usuarios = []), "USUARIOS_VAZIO"],
    ["tabela extra", (T) => (T.comissoes = []), "TABELA_DESCONHECIDA"],
    ["tabela obrigatória ausente", (T) => delete T.despesas, "TABELA_AUSENTE"],
    ["campo obrigatório ausente", (T) => delete T.atendimentos[0].horario_agendado, "CAMPO_INVALIDO"],
    ["tipo inválido", (T) => (T.atendimentos[0].valor_centavos = "50"), "CAMPO_INVALIDO"],
    ["relacionamento inválido", (T) => (T.pagamentos[0].atendimento_id = 999), "RELACAO"],
    ["ids repetidos", (T) => T.clientes.push({ ...T.clientes[0] }), "CHAVE_REPETIDA"],
    ["pagamento sem forma de pagamento (M1)", (T) => delete T.pagamentos[0].forma_pagamento, "CAMPO_INVALIDO"],
    ["id acima de 2^31 − 1 (M2: o aparelho deixaria de criar registros)", (T) => trocarIdCliente(T, Number.MAX_SAFE_INTEGER), "CAMPO_INVALIDO"],
    ["data que não existe no calendário (M3)", (T) => (T.atendimentos[0].data = "2026-02-31"), "CAMPO_INVALIDO"],
    ["data 0000-00-00 (M3)", (T) => (T.despesas[0].data = "0000-00-00"), "CAMPO_INVALIDO"],
  ];
  for (const [nome, muda, codigo] of casos) {
    const txt = await variante(muda), a = await analisar(page, txt);
    assert.equal(a.ok, false, nome); assert.ok(a.codigos.includes(codigo), `${nome}: ${a.codigos}`);
    const r = await restaurar(page, txt, DONA); assert.equal(r.codigo, "BACKUP_INVALIDO", nome);
    const forjado = await naPagina(page, async (t) => { const R = await import("./js/data/restauracao.js"); try { await R.restaurar({ ok: true, doc: JSON.parse(t) }, { prova: { usuario: "dona", senha: "x" } }); return "restaurou"; } catch (e) { return e.codigo; } }, txt);
    assert.equal(forjado, "BACKUP_INVALIDO", `${nome}: objeto forjado também é revalidado`);
    assert.deepEqual(await impressao(page), antes, `${nome}: estado intacto`);
  }
  for (const [nome, txt, codigo] of [["checksum alterado", await variante((T) => (T.clientes[0].nome = "Alterada"), { selar: false }), "CHECKSUM_DIVERGENTE"], ["versao_formato ausente", await variante((T, d) => delete d.versao_formato), "VERSAO_FORMATO_INVALIDA"]]) {
    const r = await restaurar(page, txt, DONA); assert.equal(r.codigo, "BACKUP_INVALIDO", nome); assert.deepEqual(r.codigos, [codigo]);
    assert.deepEqual(await impressao(page), antes, `${nome}: estado intacto`);
  }
  assert.equal(await entrar(page, ADMIN), true, "o login do aparelho continua funcionando");
  await ctx.close();
});

T("REQUISITO 11: senha_hash com prefixo pbkdf2$ e formato interno inválido é recusado ANTES de substituir 'usuarios' (tela e função)", async () => {
  const { ctx, page } = await aparelho(); const antes = await impressao(page);
  const txt = await variante((T) => { for (const u of T.usuarios) u.senha_hash = "pbkdf2$150000$" + "ab".repeat(16) + "$" + "cd".repeat(32); });
  await page.goto(srv.url + "#/dados"); await page.waitForSelector("#arq");
  await page.setInputFiles("#arq", { name: "hash-invalido.salaobackup", mimeType: "application/octet-stream", buffer: Buffer.from(txt) });
  await page.click("#analisar"); await page.waitForSelector('[data-restauracao="bloqueada"]');
  const tela = await page.textContent('[data-restauracao="bloqueada"]');
  assert.match(tela, /nada foi alterado/i); assert.match(tela, /formato de senha não suportado por esta versão/); assert.ok(!(await page.$("#f-imp")), "sem botão de restaurar");
  assert.equal((await restaurar(page, txt, DONA)).codigo, "BACKUP_INVALIDO");
  assert.deepEqual(await impressao(page), antes); assert.deepEqual((await impressao(page)).usuarios, ["admin"]);
  await ctx.close();
});

T("D4 — prova de acesso: sem prova, senha errada, usuário não-admin do backup ou admin do APARELHO → recusado, nada alterado", async () => {
  const { ctx, page } = await aparelho(); const antes = await impressao(page);
  for (const [prova, codigo] of [[null, "PROVA_NECESSARIA"], [{ usuario: "dona", senha: "errada" }, "PROVA_FALHOU"], [{ usuario: "recep", senha: "senha-recep-789" }, "PROVA_FALHOU"], [ADMIN, "PROVA_FALHOU"], [{ usuario: "  DONA ", senha: "errada" }, "PROVA_FALHOU"]]) {
    assert.equal((await restaurar(page, X, prova)).codigo, codigo, JSON.stringify(prova)); assert.deepEqual(await impressao(page), antes);
  }
  const ok = await restaurar(page, X, { usuario: "  Dona ", senha: DONA.senha }); assert.equal(ok.ok, true, "o nome do administrador é comparado como no login (espaços nas pontas e maiúsculas)");
  await ctx.close();
});

T("falha simulada DURANTE a gravação: transação abortada, nada gravado, cópia anterior preservada, login antigo funciona", async () => {
  const { ctx, page } = await aparelho(); const antes = await impressao(page);
  await naPagina(page, () => { const put = IDBObjectStore.prototype.put; window.__putOriginal = put; IDBObjectStore.prototype.put = function (...a) { if (this.name === "atendimentos") throw new DOMException("falha simulada", "UnknownError"); return put.apply(this, a); }; });
  const r = await restaurar(page, X, DONA);
  await naPagina(page, () => { IDBObjectStore.prototype.put = window.__putOriginal; });
  assert.equal(r.codigo, "GRAVACAO_FALHOU"); assert.match(r.mensagem, /totalmente desfeita/);
  const depois = await impressao(page);
  assert.equal(depois.sha, antes.sha, "dados idênticos"); assert.deepEqual(depois.usuarios, antes.usuarios);
  assert.equal(depois.copias.length, antes.copias.length + 1, "a cópia antes da restauração ficou guardada (recuperável)");
  assert.equal(await entrar(page, ADMIN), true);
  await ctx.close();
});

T("falha simulada ao gravar a CÓPIA antes da restauração: a restauração nem começa", async () => {
  const { ctx, page } = await aparelho(); const antes = await impressao(page);
  await naPagina(page, () => { const add = IDBObjectStore.prototype.add; window.__addOriginal = add; IDBObjectStore.prototype.add = function (...a) { if (this.name === "backups") throw new DOMException("disco cheio (simulado)", "QuotaExceededError"); return add.apply(this, a); }; });
  const r = await restaurar(page, X, DONA);
  await naPagina(page, () => { IDBObjectStore.prototype.add = window.__addOriginal; });
  assert.equal(r.codigo, "COPIA_FALHOU"); assert.deepEqual(await impressao(page), antes);
  await ctx.close();
});

T("A2/D1 — aparelho com administrador que consegue entrar: sem login, ou conectada sem ser administradora, não há restauração (função, login e #/restaurar)", async () => {
  const { ctx, page } = await aparelho(), semUsuarios = await variante((T) => delete T.usuarios), RECEP = { usuario: "recep.local", senha: "senha-recep-local-1" };
  await naPagina(page, async (r) => (await import("./js/data/usuarios.js")).criar({ nome: "Recepção Local", perfil: "recepcao", ...r }), RECEP);
  await sair(page); await page.waitForSelector('form#f input[name="senha"]');
  assert.equal(await existe(page, 'a[href="#/restaurar"]'), false, "login sem link de restauração"); assert.equal(await existe(page, '[data-login="sem-admin"]'), false);
  let antes = await impressao(page);
  for (const txt of [X, semUsuarios]) assert.equal((await restaurar(page, txt, DONA)).codigo, "NAO_AUTORIZADO");
  assert.deepEqual(await impressao(page), antes);
  await page.goto(srv.url + "#/restaurar"); await page.waitForSelector('[data-restaurar="exige-login"]'); assert.equal(await existe(page, "#arq"), false, "sem campo de arquivo");
  assert.equal(await entrar(page, RECEP), true); antes = await impressao(page); // conectada, mas não administradora
  for (const txt of [X, semUsuarios]) assert.equal((await restaurar(page, txt, DONA)).codigo, "NAO_AUTORIZADO", "recepção conectada");
  assert.deepEqual(await impressao(page), antes);
  await ctx.close();
});

T("D1 — PRIMEIRO ACESSO (sem usuários): restauração sem login permitida pela tela, sem download de dados, com prova", async () => {
  const { ctx, page } = await aparelho({ semDados: true });
  await page.goto(srv.url + "#/restaurar"); await page.waitForSelector("#arq");
  await page.setInputFiles("#arq", { name: "outro.salaobackup", mimeType: "application/octet-stream", buffer: Buffer.from(X) });
  await page.click("#verif"); await page.waitForSelector('[data-restauracao="previa"]');
  assert.equal(await existe(page, "#copia-emergencia"), false, "sem login: nenhum download de dados");
  await page.fill('input[name="prova_usuario"]', DONA.usuario); await page.fill('input[name="prova_senha"]', DONA.senha); await page.fill('#f-imp input[name="c"]', "SUBSTITUIR");
  await Promise.all([page.waitForEvent("load", { timeout: 20000 }), page.click('#f-imp button[type="submit"]')]);
  await entrarUI(page, DONA.usuario, DONA.senha); assert.equal((await tabelas(page)).clientes.length, JSON.parse(X).tabelas.clientes.length);
  await ctx.close();
});

T("A2 — aparelho com usuários mas NENHUM administrador que consiga entrar: sem login, a restauração é RECUSADA (antes era permitida) — função, login e #/restaurar", async () => {
  const { ctx, page } = await aparelho(), semUsuarios = await variante((T) => delete T.usuarios);
  for (const [caso, trava] of [["todos os usuários inativos", (u) => { u.ativo = 0; }], ["administrador ativo com senha ilegível", (u) => { u.ativo = 1; u.senha_hash = "ilegivel"; }]]) {
    await page.goto(srv.url + "#/");
    await naPagina(page, async (src) => { const muda = (0, eval)(src), D = await import("./js/data/database.js"); await D.transacao(["usuarios"], "readwrite", async (t) => { for (const u of await t.usuarios.todos()) { muda(u); await t.usuarios.salvar(u); } }); }, trava.toString());
    await sair(page); await page.waitForSelector('form#f input[name="senha"]');
    assert.equal(await existe(page, '[data-login="sem-admin"]'), false, `${caso}: o aviso que levava à restauração sem login não existe mais`); assert.equal(await existe(page, 'a[href="#/restaurar"]'), false, caso);
    const antes = await impressao(page);
    for (const txt of [X, semUsuarios]) assert.equal((await restaurar(page, txt, DONA)).codigo, "NAO_AUTORIZADO", caso);
    assert.deepEqual(await impressao(page), antes, `${caso}: nada alterado`);
    await page.goto(srv.url + "#/restaurar"); await page.waitForSelector('[data-restaurar="exige-login"]'); assert.equal(await existe(page, "#arq"), false, `${caso}: sem campo de arquivo`);
  }
  await ctx.close();
});

T("backup SEM usuários: no primeiro acesso é RECUSADO (deixaria os dados sem administrador); com administrador conectado, mantém os usuários do aparelho", async () => {
  const semUsuarios = await variante((T) => delete T.usuarios);
  { const { ctx, page } = await aparelho({ semDados: true }); const antes = await impressao(page); assert.deepEqual(antes.usuarios, []);
    assert.equal((await restaurar(page, semUsuarios)).codigo, "SEM_ACESSO_RESULTANTE"); assert.deepEqual(await impressao(page), antes, "nada alterado");
    await page.goto(srv.url + "#/restaurar"); await page.waitForSelector("#arq");
    await page.setInputFiles("#arq", { name: "sem-usuarios.salaobackup", mimeType: "application/octet-stream", buffer: Buffer.from(semUsuarios) });
    await page.click("#verif"); await page.waitForSelector('[data-restauracao="bloqueada"]'); assert.equal(await existe(page, "#f-imp"), false, "a tela não oferece restaurar");
    assert.match(await page.textContent('[data-restauracao="bloqueada"]'), /não traz usuários/);
    await ctx.close(); }
  { const { ctx, page } = await aparelho(); // administrador conectado
    const r = await restaurar(page, semUsuarios); assert.equal(r.ok, true, r.mensagem); assert.equal(r.usuariosSubstituidos, false);
    assert.deepEqual((await impressao(page)).usuarios, ["admin"]); assert.equal(await entrar(page, ADMIN), true);
    assert.equal((await tabelas(page)).clientes.length, JSON.parse(X).tabelas.clientes.length);
    await ctx.close(); }
});

T("DESFAZER sem login logo após a restauração devolve o estado anterior; depois que alguém entra, só com login", async () => {
  const { ctx, page } = await aparelho(); const t0 = await tabelas(page);
  assert.equal((await restaurar(page, X, DONA)).ok, true); await page.reload();
  await page.waitForSelector('a[href="#/desfazer"]'); await page.click('a[href="#/desfazer"]');
  await page.waitForSelector("#f-desfazer"); assert.doesNotMatch(await page.textContent("main"), /Cliente da Dona|Cliente Teste|98888/, "não mostra dados");
  await page.fill('#f-desfazer input[name="c"]', "DESFAZER");
  await Promise.all([page.waitForEvent("load", { timeout: 20000 }), page.click('#f-desfazer button[type="submit"]')]);
  const t1 = await tabelas(page); assert.deepEqual(semAuditoria(t1), semAuditoria(t0)); assert.equal(t1.auditoria.length, t0.auditoria.length + 1);
  await entrarUI(page, ADMIN.usuario, ADMIN.senha);
  // nova restauração; a dona entra (pela tela) e sai: o desfazer sem login deixa de valer
  assert.equal((await restaurar(page, X, DONA)).ok, true); await page.reload();
  await entrarUI(page, DONA.usuario, DONA.senha); await sair(page);
  await page.goto(srv.url + "#/desfazer"); await page.waitForSelector('[data-desfazer="bloqueado"]');
  assert.equal(await naPagina(page, async () => { try { await (await import("./js/data/restauracao.js")).desfazerUltimaRestauracao(); return "desfez"; } catch (e) { return e.codigo; } }), "DESFAZER_BLOQUEADO");
  await entrarUI(page, DONA.usuario, DONA.senha); await page.goto(srv.url + "#/desfazer"); await page.waitForSelector("#f-desfazer"); // com login: permitido
  await page.fill('#f-desfazer input[name="c"]', "DESFAZER");
  await Promise.all([page.waitForEvent("load", { timeout: 20000 }), page.click('#f-desfazer button[type="submit"]')]);
  const t2 = await tabelas(page); assert.deepEqual(semVolateis(t2), semVolateis(t0)); assert.deepEqual(t2.usuarios.map((u) => u.usuario), ["admin"]);
  await entrarUI(page, ADMIN.usuario, ADMIN.senha);
  await ctx.close();
});

T("A1 — desfazer a restauração feita no PRIMEIRO ACESSO é recusado, sem e com login: o aparelho nunca volta a ficar sem administrador e ninguém cria outro", async () => {
  const { ctx, page } = await aparelho({ semDados: true });
  assert.equal((await restaurar(page, X, DONA)).ok, true, "restauração sem login no primeiro acesso");
  await page.reload(); await page.waitForSelector('form#f input[name="senha"]');
  assert.equal(await existe(page, 'a[href="#/desfazer"]'), false, "o login não oferece um desfazer que seria recusado");
  let antes = await impressao(page);
  assert.equal(await desfazer(page), "DESFAZER_SEM_ADMIN", "sem login"); assert.deepEqual(await impressao(page), antes, "nada alterado");
  await page.goto(srv.url + "#/desfazer"); await page.waitForSelector('[data-desfazer="sem-admin"]'); assert.equal(await existe(page, "#f-desfazer"), false, "sem formulário");
  await entrarUI(page, DONA.usuario, DONA.senha); antes = await impressao(page); // administradora conectada: também recusado
  assert.equal(await desfazer(page), "DESFAZER_SEM_ADMIN", "com login"); assert.deepEqual(await impressao(page), antes, "nada alterado");
  await page.goto(srv.url + "#/desfazer"); await page.waitForSelector('[data-desfazer="sem-admin"]'); assert.equal(await existe(page, "#f-desfazer"), false);
  // a cadeia da revisão final: sem usuários, qualquer pessoa criaria o "primeiro" administrador e baixaria as cópias. Impossível:
  const intrusa = { nome: "Intrusa", usuario: "intrusa", senha: "senha-da-intrusa-1", salao: "Outro" };
  assert.equal(await naPagina(page, async (d) => { const U = await import("./js/data/usuarios.js"); U.sair(); try { await U.configurarPrimeiro(d); return "criou"; } catch (e) { return e.message; } }, intrusa), "O aplicativo já foi configurado.");
  await page.goto(srv.url + "#/"); await page.reload(); await page.waitForSelector('form#f input[name="senha"]');
  assert.equal(await existe(page, 'input[name="salao"]'), false, "a tela de primeiro acesso não aparece");
  assert.deepEqual((await impressao(page)).usuarios, ["dona", "recep"]); assert.equal(await entrar(page, intrusa), false);
  await ctx.close();
});

T("A1 — cópia sem administrador que consiga entrar (inativo, senha ilegível, sem usuários): desfazer recusado sem e com login, nada alterado", async () => {
  const { ctx, page } = await aparelho();
  assert.equal((await restaurar(page, X, DONA)).ok, true); await page.reload(); await page.waitForSelector('form#f input[name="senha"]');
  const adulterarCopia = (caso) => naPagina(page, async (caso) => { // checksum refeito: a cópia passa na conferência de integridade
    const D = await import("./js/data/database.js"), B = await import("./js/data/backup.js"), R = await import("./js/data/restauracao.js");
    const c = await R.ultimaCopiaPreRestauracao(), doc = JSON.parse(await B.snapshotTexto(c.id));
    if (caso === "sem usuários") doc.tabelas.usuarios = []; else for (const u of doc.tabelas.usuarios) if (caso === "inativo") u.ativo = 0; else { u.ativo = 1; u.senha_hash = "ilegivel"; }
    doc.sha256 = await B.sha256(B.canonico(doc.tabelas)); const texto = JSON.stringify(doc);
    await D.transacao(["backups"], "readwrite", async (t) => { const b = await t.backups.get(c.id); b.texto = texto; await t.backups.salvar(b); });
  }, caso);
  for (const caso of ["inativo", "senha ilegível", "sem usuários"]) {
    await adulterarCopia(caso); const antes = await impressao(page);
    assert.equal(await desfazer(page), "DESFAZER_SEM_ADMIN", `${caso}, sem login`); assert.deepEqual(await impressao(page), antes, `${caso}: nada alterado`);
    await page.goto(srv.url + "#/desfazer"); await page.waitForSelector('[data-desfazer="sem-admin"]'); assert.equal(await existe(page, "#f-desfazer"), false, caso);
  }
  await entrarUI(page, DONA.usuario, DONA.senha); const antes = await impressao(page);
  assert.equal(await desfazer(page), "DESFAZER_SEM_ADMIN", "com login"); assert.deepEqual(await impressao(page), antes, "nada alterado");
  await ctx.close();
});

T("cópia de antes da restauração DANIFICADA: desfazer recusado sem e com login, a tela mostra o motivo sem formulário, nada alterado", async () => {
  const { ctx, page } = await aparelho();
  assert.equal((await restaurar(page, X, DONA)).ok, true); await page.reload(); await page.waitForSelector('form#f input[name="senha"]');
  await naPagina(page, async () => { // conteúdo alterado SEM refazer o checksum
    const D = await import("./js/data/database.js"), R = await import("./js/data/restauracao.js"), c = await R.ultimaCopiaPreRestauracao();
    await D.transacao(["backups"], "readwrite", async (t) => { const b = await t.backups.get(c.id), d = JSON.parse(b.texto); d.tabelas.clientes[0].nome = "Adulterada"; b.texto = JSON.stringify(d); await t.backups.salvar(b); });
  });
  const antes = await impressao(page);
  assert.equal(await desfazer(page), "COPIA_DANIFICADA", "sem login"); assert.deepEqual(await impressao(page), antes, "nada alterado");
  await page.goto(srv.url + "#/desfazer"); await page.waitForSelector('[data-desfazer="erro"]'); assert.equal(await existe(page, "#f-desfazer"), false, "sem formulário");
  assert.match(await page.textContent('[data-desfazer="erro"]'), /danificada/);
  await entrarUI(page, DONA.usuario, DONA.senha); const comLogin = await impressao(page);
  assert.equal(await desfazer(page), "COPIA_DANIFICADA", "com login"); assert.deepEqual(await impressao(page), comLogin, "nada alterado");
  await ctx.close();
});

T("M2 — o maior id aceito (2^31 − 1) restaura e o aparelho continua criando registros; um id acima dele é recusado ANTES de gravar", async () => {
  const { ctx, page } = await aparelho(); const antes = await impressao(page), comId = (novo) => variante((T) => trocarIdCliente(T, novo));
  const acima = await restaurar(page, await comId(2147483648), DONA);
  assert.equal(acima.codigo, "BACKUP_INVALIDO"); assert.ok(acima.codigos.includes("CAMPO_INVALIDO"), String(acima.codigos)); assert.deepEqual(await impressao(page), antes, "nada gravado, nem a cópia");
  assert.equal((await restaurar(page, await comId(2147483647), DONA)).ok, true);
  assert.equal(await entrar(page, DONA), true);
  const ids = await naPagina(page, async () => { const Cli = await import("./js/data/clientes.js"); return [await Cli.salvar({ nome: "Nova Um", telefone: "(11) 91111-1111" }), await Cli.salvar({ nome: "Nova Dois", telefone: "(11) 92222-2222" })]; });
  assert.deepEqual(ids, [2147483648, 2147483649], "o gerador de chaves do IndexedDB continua funcionando");
  await ctx.close();
});

T("D2 — estado atual INCONSISTENTE não impede restaurar um backup válido; a cópia guarda o estado exatamente como estava", async () => {
  const { ctx, page } = await aparelho();
  await naPagina(page, async () => { const D = await import("./js/data/database.js"), c = (await D.ler("clientes"))[0]; await D.transacao(["clientes"], "readwrite", (t) => t.clientes.apagar(c.id)); }); // atendimento órfão
  const inconsistente = await tabelas(page);
  await page.goto(srv.url + "#/dados"); await page.waitForSelector("#arq");
  await page.setInputFiles("#arq", { name: "outro.salaobackup", mimeType: "application/octet-stream", buffer: Buffer.from(X) });
  await page.click("#analisar"); await page.waitForSelector('[data-restauracao="estado-inconsistente"]');
  assert.equal((await restaurar(page, X, DONA)).ok, true);
  const copia = await naPagina(page, async () => (await (await import("./js/data/restauracao.js")).ultimaCopiaPreRestauracao()));
  assert.equal(copia.inconsistente, true, "cópia marcada como estado inconsistente");
  assert.equal(await entrar(page, DONA), true);
  assert.equal((await naPagina(page, async () => (await (await import("./js/data/restauracao.js")).desfazerUltimaRestauracao()).inconsistente)), true);
  assert.deepEqual(semAuditoria(await tabelas(page)), semAuditoria(inconsistente), "o desfazer devolve o estado inconsistente exatamente como estava");
  await ctx.close();
});

T("D3 — exportar estado inconsistente: arquivo marcado e nomeado, não conta como backup saudável e a restauração normal o recusa", async () => {
  const { ctx, page } = await aparelho();
  await naPagina(page, async () => { const D = await import("./js/data/database.js"), c = (await D.ler("clientes"))[0]; await D.transacao(["clientes"], "readwrite", (t) => t.clientes.apagar(c.id)); });
  await page.goto(srv.url + "#/dados"); await page.waitForSelector("#exportar");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportar")]);
  const nome = dl.suggestedFilename(), txt = readFileSync(await dl.path(), "utf8"), doc = JSON.parse(txt);
  assert.match(nome, /-INCONSISTENTE\.salaobackup$/); assert.equal(doc.estado_dados, "inconsistente"); assert.match(doc.aviso, /apenas para recuperação\/análise/);
  assert.equal(await F.sha256(F.canonico(doc.tabelas)), doc.sha256, "checksum continua verificável");
  assert.equal(await naPagina(page, () => localStorage.getItem("salao_ultimo_download")), null, "não conta como último backup baixado");
  const a = await analisar(page, txt); assert.equal(a.ok, false); assert.equal(a.codigos[0], "ESTADO_INCONSISTENTE");
  assert.equal(await naPagina(page, async () => { try { await (await import("./js/data/manutencao.js")).prepararAtualizacao(); return "ok"; } catch (e) { return e.message; } }), "ok", "atualização não fica bloqueada");
  await page.goto(srv.url + "#/manutencao"); await page.waitForSelector("#m-comp"); // backup completo (ZIP): mesmo tratamento
  const [zip] = await Promise.all([page.waitForEvent("download"), page.click("#m-comp")]);
  assert.ok(readFileSync(await zip.path()).includes(Buffer.from("deve ser utilizado apenas para recuperação/análise")), "LEIA-ME do ZIP avisa o estado inconsistente");
  await page.waitForSelector("#m-res .alert"); assert.match(await page.textContent("#m-res"), /apenas para recuperação\/análise/);
  assert.equal(await naPagina(page, () => localStorage.getItem("salao_ultimo_download")), null, "o ZIP também não conta como backup saudável");
  await ctx.close();
});

T("D5 — cópia de emergência antes de restaurar: baixa o estado atual SEM gravar nada (nem auditoria)", async () => {
  const { ctx, page } = await aparelho(); const antes = await impressao(page), ls = await naPagina(page, () => localStorage.getItem("salao_ultimo_download"));
  await page.goto(srv.url + "#/dados"); await page.waitForSelector("#arq");
  await page.setInputFiles("#arq", { name: "outro.salaobackup", mimeType: "application/octet-stream", buffer: Buffer.from(X) });
  await page.click("#analisar"); await page.waitForSelector("#copia-emergencia");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#copia-emergencia")]);
  const txt = readFileSync(await dl.path(), "utf8"); assert.match(dl.suggestedFilename(), /^salao-gestao-copia-antes-da-restauracao-/);
  assert.equal((await analisar(page, txt)).ok, true, "a cópia é um backup válido e restaurável");
  assert.deepEqual(await impressao(page), antes, "nada foi gravado"); assert.equal(await naPagina(page, () => localStorage.getItem("salao_ultimo_download")), ls);
  await ctx.close();
});
