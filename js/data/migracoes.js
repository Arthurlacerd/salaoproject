// Migrations do IndexedDB — incrementais, identificadas por versão e NUNCA destrutivas.
// Duas camadas:
//  * estrutura(db, tx): cria/altera stores e índices (roda em onupgradeneeded). A versão NATIVA do IndexedDB é a
//    versão da migration mais alta que tem `estrutura`.
//  * dados(t) / reverter(t): transformam registros (rodam depois da abertura, com backup prévio). A versão lógica
//    fica em config.schema_versao.
// Nunca apague e recrie o banco: alterações de estrutura = nova migration.
export const TABELAS_BASE = ["clientes", "servicos", "atendimentos", "pagamentos", "despesas", "auditoria", "usuarios"];
export const MIGRACOES = [
  { versao: 1, descricao: "Esquema inicial (espelha as tabelas do SQLite 9.0)",
    estrutura(db, tx) {
      for (const t of TABELAS_BASE) db.createObjectStore(t, { keyPath: "id", autoIncrement: true });
      db.createObjectStore("config", { keyPath: "chave" });
      db.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
      tx.objectStore("atendimentos").createIndex("data", "data"); tx.objectStore("atendimentos").createIndex("cliente_id", "cliente_id");
      tx.objectStore("pagamentos").createIndex("atendimento_id", "atendimento_id"); tx.objectStore("despesas").createIndex("data", "data");
      tx.objectStore("usuarios").createIndex("usuario", "usuario", { unique: true });
    } },
  { versao: 2, descricao: "10.1 — controle de versões instaladas e preferências de atualização (somente dados; não altera a estrutura)",
    async dados(t) { // idempotente
      if (!(await t.config.get("historico_versoes"))) await t.config.salvar({ chave: "historico_versoes", valor: "[]" });
      if (!(await t.config.get("backup_antes_atualizar"))) await t.config.salvar({ chave: "backup_antes_atualizar", valor: "1" });
    },
    async reverter(t) { await t.config.apagar("historico_versoes"); await t.config.apagar("backup_antes_atualizar"); } },
];
export const versaoNativa = (lista = MIGRACOES) => Math.max(0, ...lista.filter((m) => m.estrutura).map((m) => m.versao));
export const versaoLogica = (lista = MIGRACOES) => Math.max(0, ...lista.map((m) => m.versao));

/** Abre (e migra a ESTRUTURA de) um banco. Nunca apaga nada. */
export function abrirBanco(nome, lista = MIGRACOES) {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(nome, versaoNativa(lista));
    r.onupgradeneeded = (e) => { for (const m of lista.filter((m) => m.estrutura && m.versao > e.oldVersion).sort((a, b) => a.versao - b.versao)) m.estrutura(r.result, r.transaction); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error && r.error.name === "VersionError" ? new Error("Os dados deste aparelho pertencem a uma versão mais nova do aplicativo. Atualize o aplicativo.") : r.error);
    r.onblocked = () => erro(new Error("Feche outras abas do Salão.gestão e tente de novo."));
  });
}
const req = (r) => new Promise((ok, erro) => { r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error); });
async function configGet(db, chave) { return (await req(db.transaction("config").objectStore("config").get(chave)))?.valor; }
/** Versão lógica atual: banco já existente sem marca = 1 (10.0). */
export async function schemaAtual(db) { const v = await configGet(db, "schema_versao"); return v ? +v : 1; }
export async function pendentes(db, lista = MIGRACOES) { const a = await schemaAtual(db); return lista.filter((m) => m.versao > a && m.dados); }
function apiTx(db, tx) { const api = {}; for (const n of db.objectStoreNames) { const o = tx.objectStore(n); api[n] = { get: (k) => req(o.get(k)), salvar: (v) => req(o.put(v)), apagar: (k) => req(o.delete(k)), todos: () => req(o.getAll()) }; } return api; }
async function passo(db, m, alvo, fn, direcao) { // cada passo é uma transação: tudo ou nada
  const tx = db.transaction([...db.objectStoreNames], "readwrite"), t = apiTx(db, tx);
  const fim = new Promise((ok, erro) => { tx.oncomplete = ok; tx.onabort = () => erro(tx.error || new Error("Migration cancelada.")); });
  try { await fn(t); await t.config.salvar({ chave: "schema_versao", valor: String(alvo) });
    const h = JSON.parse((await t.config.get("historico_migracoes"))?.valor || "[]"); h.push({ migration: m.versao, direcao, quando: new Date().toISOString().slice(0, 19) });
    await t.config.salvar({ chave: "historico_migracoes", valor: JSON.stringify(h.slice(-50)) }); } catch (e) { try { tx.abort(); } catch (_) {} await fim.catch(() => {}); throw e; }
  await fim;
}
export async function migrarDados(db, lista = MIGRACOES) { const aplicadas = []; for (const m of await pendentes(db, lista)) { await passo(db, m, m.versao, m.dados.bind(m), "aplicar"); aplicadas.push(m.versao); } return aplicadas; }
/** Reversão (quando a migration for reversível). Não destrutiva: só desfaz o que a migration criou. */
export async function reverterPara(db, alvo, lista = MIGRACOES) {
  let atual = await schemaAtual(db), feitas = [];
  for (const m of lista.filter((m) => m.versao <= atual && m.versao > alvo).sort((a, b) => b.versao - a.versao)) {
    if (!m.reverter) throw new Error(`A migration ${m.versao} não é reversível.`);
    await passo(db, m, m.versao - 1, m.reverter.bind(m), "reverter"); feitas.push(m.versao);
  }
  return feitas;
}
