// Validação completa ANTES de qualquer gravação (11.3): cabeçalho, integridade, estrutura, registros, relacionamentos,
// usuários, regras de acesso e mensagens honestas (sem conteúdo dos registros).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tabelasValidas, docDe, analisar, com, HASH } from "./_fixtures.js";
const B = await import("../../js/data/backup.js");
const V = await import("../../js/data/validacao_backup.js");
const E = await import("../../js/data/esquema_backup.js");
const Fin = await import("../../js/data/financeiro.js");
const { MIGRACOES } = await import("../../js/data/migracoes.js");

const texto = async (doc) => B.validar(JSON.stringify(doc));
const tem = (r, codigo, filtro = {}) => r.problemas.some((p) => p.codigo === codigo && Object.entries(filtro).every(([k, v]) => p[k] === v));

test("backup válido (todos os campos que o app grava) é aceito, com contagens e sem avisos indevidos", async () => {
  const r = await analisar(tabelasValidas()); assert.equal(r.ok, true, r.erros.join(" | "));
  assert.deepEqual(r.contagens, { clientes: 1, servicos: 1, atendimentos: 1, pagamentos: 1, despesas: 1, auditoria: 1, configuracoes_sistema: 2, usuarios: 1 });
  assert.equal(r.temUsuarios, true); assert.deepEqual(r.avisos, []); assert.equal(r.formato, "salaobackup-v1");
});

// ---------- cabeçalho e integridade (interrompem a análise) ----------
test("formato: documento que não é backup do Salão.gestão", async () => {
  for (const doc of [[], "texto", 42, null, { tabelas: {} }, { ...(await docDe()), formato: "outro" }]) assert.deepEqual((await texto(doc)).codigos, ["FORMATO_DESCONHECIDO"]);
});
test("versao_formato ausente, texto ou 0: mensagem 'ausente ou inválido' — NÃO 'versão mais nova'", async () => {
  for (const v of [undefined, "1", 0, 1.5, null]) {
    const r = await texto(await docDe(undefined, { versao_formato: v })); assert.deepEqual(r.codigos, ["VERSAO_FORMATO_INVALIDA"], String(v));
    assert.match(r.erros[0], /ausente ou inválido/); assert.doesNotMatch(r.erros[0], /mais nov/);
  }
});
test("versao_formato 2: formato mais novo que o suportado", async () => {
  const r = await texto(await docDe(undefined, { versao_formato: 2 })); assert.deepEqual(r.codigos, ["VERSAO_FORMATO_FUTURA"]); assert.match(r.erros[0], /v2, mais novo/);
});
test("sistema diferente é recusado; ausente é aceito", async () => {
  assert.deepEqual((await texto(await docDe(undefined, { sistema: "Outro" }))).codigos, ["OUTRO_SISTEMA"]);
  assert.equal((await texto(await docDe(undefined, { sistema: undefined }))).ok, true);
});
test("backup de versão futura do aplicativo (banco ou dados mais novos) é recusado; campo inválido também", async () => {
  assert.deepEqual((await texto(await docDe(undefined, { versao_banco: 2 }))).codigos, ["DADOS_DE_VERSAO_FUTURA"]);
  assert.match((await texto(await docDe(undefined, { versao_schema: 3 }))).erros[0], /dados v3; esta versão usa v2/);
  assert.deepEqual((await texto(await docDe(undefined, { versao_banco: "1" }))).codigos, ["CABECALHO_INVALIDO"]);
  assert.equal((await texto(await docDe(undefined, { versao_banco: undefined, versao_schema: undefined }))).ok, true, "ausentes: aceito");
});
test("checksum: ausente, fora do formato (maiúsculas), divergente — cada um com sua mensagem", async () => {
  const d = await docDe();
  const r1 = await texto({ ...d, sha256: undefined }); assert.deepEqual(r1.codigos, ["SEM_CHECKSUM"]); assert.match(r1.erros[0], /não tem checksum/);
  assert.deepEqual((await texto({ ...d, sha256: d.sha256.toUpperCase() })).codigos, ["CHECKSUM_FORMATO"]);
  const T = tabelasValidas(); T.clientes[0].nome = "Alterada"; const r3 = await texto({ ...d, tabelas: T });
  assert.deepEqual(r3.codigos, ["CHECKSUM_DIVERGENTE"]); assert.match(r3.erros[0], /alterado ou está corrompido/);
});
test("arquivo vazio, JSON corrompido e sem tabelas", async () => {
  assert.deepEqual((await B.validar("")).codigos, ["ARQUIVO_VAZIO"]); assert.deepEqual((await B.validar("{quebrado")).codigos, ["JSON_INVALIDO"]);
  assert.deepEqual((await texto({ ...(await docDe()), tabelas: [] })).codigos, ["SEM_TABELAS"]);
});

// ---------- estrutura ----------
test("tabela extra, tabela obrigatória ausente e tabela malformada", async () => {
  assert.ok(tem(await com((T) => (T.comissoes = [])), "TABELA_DESCONHECIDA", { tabela: "comissoes" }));
  for (const t of E.TABELAS_OBRIGATORIAS) assert.ok(tem(await com((T) => delete T[t]), "TABELA_AUSENTE", { tabela: t }), t);
  assert.ok(tem(await com((T) => (T.clientes = {})), "TABELA_MALFORMADA", { tabela: "clientes" }));
  assert.ok(tem(await com((T) => T.despesas.push("x")), "TABELA_MALFORMADA", { tabela: "despesas" }));
  const r = await com((T) => { T.comissoes = []; T.clientes[0].nome = ""; }); // tabela extra não esconde os outros problemas
  assert.ok(tem(r, "TABELA_DESCONHECIDA") && tem(r, "CAMPO_INVALIDO", { tabela: "clientes", campo: "nome" }), r.codigos.join());
});
test("tabelas opcionais ausentes (serviços, pagamentos, auditoria, usuários) são aceitas", async () => {
  const r = await com((T) => { delete T.servicos; delete T.pagamentos; delete T.auditoria; delete T.usuarios; T.atendimentos[0].servico_id = null; });
  assert.equal(r.ok, true, r.erros.join(" | ")); assert.match(r.avisos.join(), /usuários deste aparelho serão mantidos/);
});
test("CADA campo obrigatório de CADA tabela: ausente ou com tipo errado → recusado, citando tabela, registro e campo", async () => {
  for (const [tabela, regras] of Object.entries(E.ESQUEMA)) for (const campo of Object.keys(regras.obrigatorios)) {
    for (const [como, muda] of [["ausente", (r) => delete r[campo]], ["tipo errado", (r) => (r[campo] = { invalido: true })]]) {
      const r = await com((T) => muda(T[tabela][0]));
      assert.equal(r.ok, false, `${tabela}.${campo} ${como}`);
      assert.ok(r.problemas.some((p) => p.tabela === tabela && p.campo === campo && p.n === 1), `${tabela}.${campo} ${como}: ${r.codigos}`);
    }
  }
});
test("campos opcionais presentes com tipo errado são recusados; extras desconhecidos são mantidos", async () => {
  assert.ok(tem(await com((T) => (T.clientes[0].data_nascimento = "26/11/1990")), "CAMPO_INVALIDO", { campo: "data_nascimento" }));
  assert.ok(tem(await com((T) => (T.atendimentos[0].servico_id = "1")), "CAMPO_INVALIDO", { campo: "servico_id" }));
  const r = await com((T) => (T.clientes[0].campo_futuro = "x")); assert.equal(r.ok, true); assert.equal(r.doc.tabelas.clientes[0].campo_futuro, "x");
});
test("valores fora das listas fechadas (status, formas, categorias, tipo) são recusados", async () => {
  for (const [t, c, v] of [["atendimentos", "status_atendimento", "Concluído"], ["atendimentos", "status_pagamento", "Quitado"], ["atendimentos", "forma_pagamento", "Cheque"], ["despesas", "categoria", "Diversos"], ["despesas", "forma_pagamento", "Cheque"], ["pagamentos", "tipo", "pagamento"], ["atendimentos", "horario_agendado", "25:00"], ["atendimentos", "data", "2026-11-20T10:00"]])
    assert.ok(tem(await com((T) => (T[t][0][c] = v)), "CAMPO_INVALIDO", { tabela: t, campo: c }), `${t}.${c}=${v}`);
});
test("valores numéricos: centavos não inteiros ou negativos, ids não positivos ou textuais", async () => {
  for (const [t, c, v] of [["atendimentos", "valor_centavos", 50.5], ["atendimentos", "valor_centavos", -1], ["pagamentos", "valor_centavos", 0], ["despesas", "valor_centavos", 0], ["clientes", "id", 0], ["clientes", "id", "1"], ["servicos", "ativo", true]])
    assert.ok(tem(await com((T) => (T[t][0][c] = v)), "CAMPO_INVALIDO", { tabela: t, campo: c }), `${t}.${c}=${v}`);
});
test("identificadores repetidos (registros e configurações) são recusados ANTES de gravar", async () => {
  assert.ok(tem(await com((T) => T.clientes.push({ ...T.clientes[0], nome: "Outra" })), "CHAVE_REPETIDA", { tabela: "clientes", n: 2, outro: 1 }));
  const r = await com((T) => T.configuracoes_sistema.push({ chave: "tema", valor: "escuro" })); assert.ok(tem(r, "CHAVE_REPETIDA", { tabela: "configuracoes_sistema" }));
  assert.match(r.erros.join(), /mesmo nome de configuração/);
});

// ---------- relacionamentos ----------
test("relacionamentos: atendimento → cliente, pagamento → atendimento, atendimento → serviço", async () => {
  assert.ok(tem(await com((T) => (T.atendimentos[0].cliente_id = 99)), "RELACAO", { tabela: "atendimentos", campo: "cliente_id" }));
  assert.ok(tem(await com((T) => (T.pagamentos[0].atendimento_id = 99)), "RELACAO", { tabela: "pagamentos", campo: "atendimento_id" }));
  assert.ok(tem(await com((T) => (T.atendimentos[0].servico_id = 99)), "RELACAO", { tabela: "atendimentos", campo: "servico_id" }));
  assert.equal((await com((T) => (T.atendimentos[0].servico_id = null))).ok, true, "serviço nulo é permitido");
});

// ---------- usuários e regras de acesso ----------
const usuario = (x) => ({ id: 1, usuario: "admin", nome: "Admin", perfil: "admin", senha_hash: HASH, ativo: 1, ...x });
test("vários usuários válidos (admin, recepção, funcionário, um admin inativo) são aceitos", async () => {
  const r = await com((T) => (T.usuarios = [usuario({}), usuario({ id: 2, usuario: "recepcao.1", perfil: "recepcao" }), usuario({ id: 3, usuario: "func_2", perfil: "funcionario" }), usuario({ id: 4, usuario: "antigo", ativo: 0 })]));
  assert.equal(r.ok, true, r.erros.join(" | "));
});
test("primeiro admin com espaço interno ou acento no usuário (permitido pela 10.1–11.2) é aceito", async () => {
  assert.equal((await com((T) => (T.usuarios[0].usuario = "maria joão"))).ok, true);
});
test("nenhum admin, admin inativo e tabela de usuários vazia: recusados (deixariam o aparelho sem acesso)", async () => {
  assert.deepEqual((await com((T) => (T.usuarios = [usuario({ perfil: "recepcao" })]))).codigos, ["SEM_ADMIN_ATIVO"]);
  assert.deepEqual((await com((T) => (T.usuarios = [usuario({ ativo: 0 })]))).codigos, ["SEM_ADMIN_ATIVO"]);
  const r = await com((T) => (T.usuarios = [])); assert.deepEqual(r.codigos, ["USUARIOS_VAZIO"]); assert.match(r.erros[0], /sem nenhum acesso/);
});
test("usuário sem 'ativo', com ativo true/'1', sem nome, com maiúscula, espaço nas pontas ou vazio: dados de usuário incompatíveis", async () => {
  for (const [campo, muda] of [["ativo", (u) => delete u.ativo], ["ativo", (u) => (u.ativo = true)], ["ativo", (u) => (u.ativo = "1")], ["nome", (u) => delete u.nome], ["nome", (u) => (u.nome = "  ")],
    ["usuario", (u) => (u.usuario = "Admin")], ["usuario", (u) => (u.usuario = " admin")], ["usuario", (u) => (u.usuario = "")], ["perfil", (u) => (u.perfil = "administrador")], ["id", (u) => delete u.id]]) {
    const r = await com((T) => muda(T.usuarios[0])); assert.ok(tem(r, "USUARIO_INCOMPATIVEL", { campo }), `${campo}: ${r.codigos}`);
    assert.match(r.erros.join(), /dados de usuário incompatíveis com esta versão/);
  }
});
test("campo 'senha' legado é recusado (nunca senha em texto)", async () => {
  assert.ok(tem(await com((T) => (T.usuarios[0].senha = "x")), "USUARIO_INCOMPATIVEL", { campo: "senha", proibido: true }));
});
test("nome de usuário e id repetidos entre usuários são recusados", async () => {
  assert.ok(tem(await com((T) => T.usuarios.push(usuario({ id: 2 }))), "USUARIO_REPETIDO"));
  assert.ok(tem(await com((T) => T.usuarios.push(usuario({ usuario: "outro" }))), "USUARIO_INCOMPATIVEL", { repetido: true }));
});
test("senha em formato não suportado (o caso da investigação: pbkdf2$ + hexadecimal) → mensagem específica", async () => {
  const r = await com((T) => (T.usuarios[0].senha_hash = "pbkdf2$150000$" + "ab".repeat(16) + "$" + "cd".repeat(32)));
  assert.deepEqual(r.codigos, ["SENHA_NAO_SUPORTADA", "SEM_ADMIN_ATIVO"]); assert.match(r.erros[0], /formato de senha não suportado por esta versão/);
});

// ---------- mensagens ----------
test("todas as mensagens existem, em português, e terminam explicando o efeito", () => {
  for (const c of ["ARQUIVO_VAZIO", "ARQUIVO_GRANDE", "JSON_INVALIDO", "FORMATO_DESCONHECIDO", "VERSAO_FORMATO_INVALIDA", "OUTRO_SISTEMA", "SEM_TABELAS", "SEM_CHECKSUM", "CHECKSUM_FORMATO", "CHECKSUM_DIVERGENTE"])
    assert.match(V.mensagem({ codigo: c }), /Nada foi alterado\.$/, c);
  assert.notEqual(V.mensagem({ codigo: "XYZ" }), "");
});
test("mensagens NUNCA contêm conteúdo dos registros (nomes, telefones, senhas, valores de configuração)", async () => {
  const T = tabelasValidas(); const sigilo = ["Maria Sigilosa", "(21) 98765-4321", "segredo-cfg"];
  T.clientes.push({ id: 1, nome: sigilo[0], telefone: sigilo[1] }); T.clientes.push({ id: "x", nome: sigilo[0], telefone: 5 });
  T.usuarios[0].senha_hash = "pbkdf2$150000$" + "ab".repeat(16) + "$" + "cd".repeat(32); T.usuarios[0].usuario = "Maria.Sigilosa";
  T.configuracoes_sistema.push({ chave: "tema", valor: sigilo[2] }); T.atendimentos[0].cliente_id = 4242; T.sigilo_extra = [];
  const r = await analisar(T); assert.equal(r.ok, false); assert.ok(r.erros.length >= 6, r.erros.join(" | "));
  const tudo = r.erros.join("\n"); for (const s of [...sigilo, "Maria.Sigilosa", "abab", "cdcd", "4242"]) assert.ok(!tudo.includes(s), `mensagem expõe "${s}"`);
});
test("todos os problemas são listados (não só o primeiro), até 25 mensagens + resumo", async () => {
  const r = await com((T) => { for (let i = 2; i <= 41; i++) T.clientes.push({ id: i, telefone: "x" }); });
  assert.equal(r.problemas.length, 40); assert.equal(r.erros.length, 26); assert.equal(r.erros[25], "… e mais 15 problema(s).");
});

// ---------- estado inconsistente (D3), cópia e 9.x ----------
test("arquivo marcado como estado inconsistente não é restaurado como backup normal", async () => {
  const r = await texto(await docDe(undefined, { estado_dados: "inconsistente", aviso: V.AVISO_INCONSISTENTE }));
  assert.equal(r.ok, false); assert.equal(r.codigos[0], "ESTADO_INCONSISTENTE"); assert.match(r.erros[0], /apenas para recuperação\/análise/);
});
test("cópia do próprio aparelho: regras de ACESSO não contam como inconsistência (ex.: aparelho sem usuários)", async () => {
  const d = await docDe({ ...tabelasValidas(), usuarios: [] });
  assert.equal((await V.analisarDoc(d, { finalidade: "copia" })).ok, true); assert.equal((await V.analisarDoc(d)).ok, false);
});
test("cabeçalho de versão 9 / origem ausente: só passa se tudo for válido, e o aviso não promete compatibilidade 9.x", async () => {
  const r = await texto(await docDe(undefined, { versao_app: "9.0.0", origem: undefined }));
  assert.equal(r.ok, true); assert.equal(r.origem, "não informada");
  assert.match(r.avisos.join(), /compatibilidade com backups da série 9\.x não foi verificada/); assert.doesNotMatch(r.avisos.join(), /convertid|compatível com/);
});

// ---------- alarmes para mudanças futuras ----------
test("ALARME: todo status de pagamento que o financeiro produz está na lista aceita pela restauração", () => {
  const vistos = new Set(); for (const total of [0, 100]) for (const rec of [0, 50, 100]) for (const est of [false, true]) for (const atual of E.STATUS_PAGAMENTO) vistos.add(Fin.statusPagamento(total, rec, est, atual));
  for (const s of vistos) assert.ok(E.STATUS_PAGAMENTO.includes(s), s);
});
test("ALARME: uma migration de DADOS nova exige rever a restauração de backups antigos (hoje só a nº 2, que só mexe em configurações)", () => {
  assert.deepEqual(MIGRACOES.filter((m) => m.dados).map((m) => m.versao), [2], "nova migration de dados: trate backups com versao_schema antiga na restauração (restauracao.js) e atualize este teste");
});
