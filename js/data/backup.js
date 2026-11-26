import { transacao, ler, agora, norm, auditar, VERSAO_APP, VERSAO_BANCO, VERSAO_SCHEMA, INFO, TABELAS, config } from "./database.js";
import { exigir } from "./permissoes.js";
export const FORMATO = "salao-gestao-backup", VERSAO_FORMATO = 1, LIMITE = 30 * 1024 * 1024;
const SENSIVEIS = ["senha_hash", "senha_versao"];
// Preferências próprias de cada aparelho: não viajam no backup (evita regredir migrations ao restaurar).
const LOCAIS = ["schema_versao", "historico_migracoes", "historico_versoes"];
const TABELAS_PERMITIDAS = ["clientes", "servicos", "atendimentos", "pagamentos", "despesas", "auditoria", "configuracoes_sistema", "usuarios"];
// JSON canônico idêntico ao do Python (sort_keys, separators compactos, unicode cru) => checksum compatível com o 9.0.
export function canonico(v) {
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonico(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
export async function sha256(texto) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const completa = (c, v) => ({ ...c, ...v });
export async function montar({ incluirUsuarios = true } = {}) {
  const [cl, sv, at, pg, de, au, us, cfg] = await Promise.all(["clientes", "servicos", "atendimentos", "pagamentos", "despesas", "auditoria", "usuarios", "config"].map(ler));
  const tabelas = { clientes: cl, servicos: sv, atendimentos: at, pagamentos: pg, despesas: de, auditoria: au, configuracoes_sistema: cfg.filter((c) => !SENSIVEIS.includes(c.chave) && !LOCAIS.includes(c.chave)).map((c) => ({ chave: c.chave, valor: String(c.valor) })) };
  if (incluirUsuarios) tabelas.usuarios = us;
  const doc = { formato: FORMATO, sistema: INFO.sistema, versao_formato: VERSAO_FORMATO, versao_app: VERSAO_APP, versao_banco: VERSAO_BANCO, versao_schema: VERSAO_SCHEMA, origem: "pwa", criado_em: new Date().toISOString().slice(0, 19),
    estrutura: { tabelas: Object.keys(tabelas), senhas: "somente hash PBKDF2 (nunca texto puro)" }, migracoes: ["idb_001", "dados_002"], contagens: Object.fromEntries(Object.entries(tabelas).map(([k, v]) => [k, v.length])), sha256: await sha256(canonico(tabelas)), tabelas };
  return doc;
}
export async function exportarTexto(opts) { return JSON.stringify(await montar(opts)); }
export function nomeArquivo() { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `salao-gestao-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.salaobackup`; }
/** Gera o backup e o VALIDA (relendo o texto gerado e comparando com os dados vivos). Lança erro se algo não conferir. */
export async function criarValidado(opts) {
  const texto = await exportarTexto(opts), rel = await validar(texto);
  if (!rel.ok) throw new Error("O backup gerado não passou na validação: " + rel.erros.join(" "));
  for (const [t, store] of [["clientes", "clientes"], ["atendimentos", "atendimentos"], ["pagamentos", "pagamentos"], ["despesas", "despesas"], ["servicos", "servicos"]])
    if (rel.contagens[t] !== (await ler(store)).length) throw new Error(`O backup gerado não confere com os dados atuais (${t}).`);
  return { texto, rel };
}
export async function baixar() {
  exigir("dados.gerir"); const { texto } = await criarValidado();
  baixarTexto(texto, nomeArquivo());
  localStorage.setItem("salao_ultimo_download", agora()); await transacao(["auditoria"], "readwrite", (t) => auditar(t, "exportacao", "sistema", null, "Backup exportado")); return texto.length;
}
export function baixarBlob(blob, nome) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
export function baixarTexto(texto, nome) { baixarBlob(new Blob([texto], { type: "application/octet-stream" }), nome); }
export async function validar(texto) {
  const rel = { ok: false, erros: [], avisos: [], contagens: {}, criado_em: "", versao_app: "", origem: "" };
  if (!texto) { rel.erros.push("O arquivo está vazio."); return rel; }
  if (texto.length > LIMITE) { rel.erros.push("Arquivo grande demais (limite de 30 MB)."); return rel; }
  let doc; try { doc = JSON.parse(texto.replace(/^﻿/, "")); } catch { rel.erros.push("O arquivo não é um backup válido do Salão.gestão (conteúdo ilegível ou corrompido)."); return rel; }
  if (!doc || doc.formato !== FORMATO || typeof doc.tabelas !== "object" || !doc.tabelas) { rel.erros.push("Este arquivo não é um backup do Salão.gestão."); return rel; }
  if (!Number.isInteger(doc.versao_formato) || doc.versao_formato > VERSAO_FORMATO) { rel.erros.push("Este backup foi gerado por uma versão mais nova do sistema. Atualize o aplicativo antes de importar."); return rel; }
  if ((await sha256(canonico(doc.tabelas))) !== doc.sha256) { rel.erros.push("O arquivo foi alterado ou está corrompido (verificação de integridade falhou). Nada foi importado."); return rel; }
  const T = doc.tabelas; rel.criado_em = String(doc.criado_em || ""); rel.versao_app = String(doc.versao_app || ""); rel.origem = doc.origem || "servidor 9.x";
  if (doc.sistema && doc.sistema !== INFO.sistema) { rel.erros.push("Este backup pertence a outro sistema."); return rel; }
  const estranhas = Object.keys(T).filter((t) => !TABELAS_PERMITIDAS.includes(t)); if (estranhas.length) { rel.erros.push("Estrutura inesperada: tabela(s) desconhecida(s) — " + estranhas.join(", ") + "."); return rel; }
  for (const t of ["clientes", "atendimentos", "despesas", "configuracoes_sistema"]) if (!(t in T)) rel.erros.push(`Backup incompleto: falta a tabela “${t}”.`);
  for (const [t, l] of Object.entries(T)) { if (!Array.isArray(l) || l.some((x) => !x || typeof x !== "object")) rel.erros.push(`Tabela “${t}” malformada.`); else rel.contagens[t] = l.length; }
  if (rel.erros.length) return rel;
  if (["clientes", "atendimentos", "pagamentos", "despesas"].some((t) => (T[t] || []).some((x) => x.id == null))) rel.erros.push("Há registros sem identificador (id).");
  const ruim = (t, f) => (T[t] || []).filter((x) => !f(x)).length, dt = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v), cent = (v) => Number.isInteger(v) && v >= 0;
  for (const [t, f, m] of [["clientes", (x) => typeof x.nome === "string" && x.nome.trim(), "sem nome"], ["atendimentos", (x) => dt(x.data) && cent(x.valor_centavos), "com data ou valor inválido"], ["pagamentos", (x) => cent(x.valor_centavos) && dt(x.data), "com data ou valor inválido"], ["despesas", (x) => dt(x.data) && cent(x.valor_centavos), "com data ou valor inválido"],
    ["usuarios", (x) => typeof x.usuario === "string" && ["admin", "recepcao", "funcionario"].includes(x.perfil) && typeof x.senha_hash === "string" && x.senha_hash.startsWith("pbkdf2$") && !("senha" in x), "inválido ou com senha fora do formato protegido"]])
    { const n = ruim(t, f); if (n) rel.erros.push(`${n} registro(s) de “${t}” ${m}.`); }
  if (rel.erros.length) return rel;
  const cli = new Set(T.clientes.map((c) => c.id)), ats = new Set(T.atendimentos.map((a) => a.id));
  const o1 = T.atendimentos.filter((a) => !cli.has(a.cliente_id)).length; if (o1) rel.erros.push(`${o1} atendimento(s) apontam para clientes que não estão no backup.`);
  const o2 = (T.pagamentos || []).filter((p) => !ats.has(p.atendimento_id)).length; if (o2) rel.erros.push(`${o2} pagamento(s) apontam para atendimentos que não estão no backup.`);
  // 11.2: não existe conversão de estrutura — os registros são importados como estão (o formato .salaobackup v1 é o mesmo do 9.x).
  if (/^[0-9]\./.test(rel.versao_app) && +rel.versao_app.split(".")[0] < 10) rel.avisos.push(`Backup da versão ${rel.versao_app} (servidor) detectado: os registros são importados como estão no arquivo, depois de validados.`);
  if (!("usuarios" in T)) rel.avisos.push("Este backup não contém usuários: os usuários e senhas deste aparelho serão mantidos.");
  rel.ok = !rel.erros.length; rel.doc = rel.ok ? doc : null; return rel;
}
export async function comparar(rel) { // conflitos/atenção antes de substituir
  const atual = {}; for (const t of ["clientes", "atendimentos", "despesas", "pagamentos"]) atual[t] = (await ler(t)).length;
  return { atual, novo: rel.contagens, substituiraDados: Object.values(atual).some((n) => n > 0) };
}
// ---- cópias locais (snapshots) — política de retenção 11.2 ----
// Ficam no próprio IndexedDB: protegem contra erro de operação/atualização, NÃO contra limpeza dos dados do site.
// A proteção principal continua sendo o arquivo .salaobackup baixado (nunca é afetado por esta política).
export const RETENCAO = { maximo: 8, minimo: 2, bytes: 40 * 1024 * 1024, protegidos: ["pre_atualizacao", "pre_migracao", "pre_importacao", "pre_retorno_versao"] };
/** Função pura: recebe [{id, motivo, tamanho}] e devolve os ids a APAGAR.
 *  Mantém as `maximo` mais recentes + a mais recente de cada motivo protegido; depois, se o total passar de `bytes`,
 *  apaga as mais antigas (nunca a mais recente de todas e nunca abaixo de `minimo`). */
export function politicaRetencao(lista, r = RETENCAO) {
  const ord = [...lista].sort((a, b) => b.id - a.id), manter = new Set(ord.slice(0, r.maximo).map((b) => b.id));
  for (const m of r.protegidos) { const b = ord.find((x) => x.motivo === m); if (b) manter.add(b.id); }
  let mantidos = ord.filter((b) => manter.has(b.id)), total = mantidos.reduce((s, b) => s + (b.tamanho || 0), 0);
  while (total > r.bytes && mantidos.length > r.minimo) { const b = mantidos.pop(); manter.delete(b.id); total -= b.tamanho || 0; }
  return ord.filter((b) => !manter.has(b.id)).map((b) => b.id);
}
export async function snapshot(motivo) {
  const { texto } = await criarValidado(); const reg = { criado_em: agora(), motivo, tamanho: texto.length, texto };
  const id = await transacao(["backups"], "readwrite", async (t) => { const id = await t.backups.adicionar(reg); const todos = await t.backups.todos(); for (const x of politicaRetencao(todos.map(({ id, motivo, tamanho }) => ({ id, motivo, tamanho: tamanho || 0 })))) if (x !== id) await t.backups.apagar(x); return id; });
  const gravado = (await ler("backups")).find((b) => b.id === id); // confirma que foi gravado
  if (!gravado || gravado.texto !== texto) throw new Error("Não foi possível confirmar a gravação do backup automático.");
  return { ...reg, id };
}
export async function snapshots() { return (await ler("backups")).sort((a, b) => b.id - a.id).map(({ texto, ...r }) => r); }
export async function snapshotTexto(id) { return (await ler("backups")).find((b) => b.id === id)?.texto; }
export async function backupAutomatico() {
  const c = await config(); if (c.backup_automatico !== "1") return null; const hoje = agora().slice(0, 10);
  const ult = (await snapshots()).find((b) => b.motivo === "automatico"); if (ult && ult.criado_em.slice(0, 10) === hoje) return null;
  if (!(await ler("clientes")).length) return null; return snapshot("automatico");
}
export async function importar(rel, { permissao = true, semSnapshot = false } = {}) {
  if (permissao) exigir("dados.gerir");
  if (!rel.ok) throw new Error(rel.erros.join(" "));
  const seguranca = semSnapshot ? null : await snapshot("pre_importacao"); // sempre guarda (e valida) o estado atual antes de substituir
  const T = rel.doc.tabelas, mapa = ["clientes", "servicos", "atendimentos", "pagamentos", "despesas", "auditoria"];
  const stores = [...mapa, "config", ...("usuarios" in T ? ["usuarios"] : [])];
  await transacao(stores, "readwrite", async (t) => {
    for (const s of stores.filter((s) => s !== "config")) await t[s].limpar();
    for (const s of mapa) for (const r of T[s] || []) await t[s].salvar(r);
    if ("usuarios" in T) for (const r of T.usuarios) await t.usuarios.salvar(r);
    for (const c of T.configuracoes_sistema) if (!SENSIVEIS.includes(c.chave) && !LOCAIS.includes(c.chave)) await t.config.salvar({ chave: c.chave, valor: String(c.valor) });
  });
  for (const [t, store] of [["clientes", "clientes"], ["atendimentos", "atendimentos"], ["pagamentos", "pagamentos"], ["despesas", "despesas"], ["servicos", "servicos"]]) // valida o resultado
    if (seguranca && (T[t] || []).length !== (await ler(store)).length) { await importar({ ok: true, doc: JSON.parse(seguranca?.texto || "{}"), contagens: {}, criado_em: seguranca.criado_em, origem: "pwa" }, { permissao: false, semSnapshot: true }); throw new Error("A restauração não passou na validação; os dados anteriores foram mantidos."); }
  await transacao(["auditoria"], "readwrite", (t) => auditar(t, "importacao", "sistema", null, `Backup importado (${rel.criado_em}, origem ${rel.origem})`));
  return rel.contagens;
}
// ---- CSV de clientes ----
const dig = (t) => String(t || "").replace(/\D/g, "");
function linhasCSV(texto, delim) {
  const out = []; let l = [], c = "", q = false;
  for (let i = 0; i < texto.length; i++) { const ch = texto[i];
    if (q) { if (ch === '"') { if (texto[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === delim) { l.push(c); c = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && texto[i + 1] === "\n") i++; l.push(c); c = ""; if (l.some((x) => x !== "")) out.push(l); l = []; }
    else c += ch; }
  l.push(c); if (l.some((x) => x !== "")) out.push(l); return out;
}
export async function analisarCSV(texto) {
  const r = { linhas: 0, validos: [], invalidos: [], duplicados: [], erro: "" };
  texto = texto.replace(/^﻿/, ""); const amostra = texto.slice(0, 2000), delim = (amostra.match(/;/g) || []).length >= (amostra.match(/,/g) || []).length ? ";" : ",";
  const ls = linhasCSV(texto, delim); if (!ls.length) { r.erro = "O arquivo está vazio."; return r; }
  const cab = ls[0].map((h) => norm(h).trim()), ix = (nomes) => cab.findIndex((h) => nomes.includes(h));
  const iN = ix(["nome", "cliente", "name"]), iT = ix(["telefone", "celular", "whatsapp", "fone", "phone"]), iD = ix(["data_nascimento", "nascimento", "aniversario", "data de nascimento"]), iO = ix(["observacoes", "observacao", "obs"]);
  if (iN < 0 || iT < 0) { r.erro = "O CSV precisa ter as colunas “nome” e “telefone” na primeira linha."; return r; }
  const existentes = new Set((await ler("clientes")).map((c) => dig(c.telefone))), vistos = new Set();
  ls.slice(1).forEach((l, k) => {
    r.linhas++; const nome = (l[iN] || "").trim(), tel = (l[iT] || "").trim(); let nasc = iD >= 0 ? (l[iD] || "").trim() : ""; const obs = iO >= 0 ? (l[iO] || "").trim().slice(0, 2000) : "";
    const it = { linha: k + 2, nome, telefone: tel, data_nascimento: null, observacoes: obs }; let motivo = "";
    if (!nome || nome.length > 120) motivo = "nome ausente ou longo demais"; else if (dig(tel).length < 8) motivo = "telefone ausente ou inválido";
    if (nasc && !motivo) { const m = nasc.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) nasc = `${m[3]}-${m[2]}-${m[1]}`; const d = new Date(nasc + "T00:00:00"); if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc) || Number.isNaN(+d) || d.toISOString().slice(0, 10) !== nasc) motivo = "data de nascimento inválida"; else it.data_nascimento = nasc; }
    if (motivo) { it.motivo = motivo; r.invalidos.push(it); return; }
    const d = dig(tel); if (existentes.has(d)) { it.motivo = "telefone já cadastrado"; r.duplicados.push(it); return; }
    if (vistos.has(d)) { it.motivo = "telefone repetido no arquivo"; r.duplicados.push(it); return; }
    vistos.add(d); r.validos.push(it);
  });
  return r;
}
export async function importarClientes(validos) {
  exigir("clientes.gravar");
  return transacao(["clientes", "auditoria"], "readwrite", async (t) => { for (const v of validos) { const id = await t.clientes.adicionar({ ...v, preferencias: "", criado_em: agora(), atualizado_em: agora() }); await auditar(t, "criacao", "cliente", id, `Cliente importada de CSV: ${v.nome}`); } return validos.length; });
}
export async function diagnostico() {
  const cont = {}; for (const t of TABELAS) cont[t] = (await ler(t)).length;
  let uso = null, quota = null, persistente = null;
  try { const e = await navigator.storage.estimate(); uso = e.usage; quota = e.quota; persistente = await navigator.storage.persisted(); } catch (_) {}
  const sn = await snapshots(); return { cont, uso, quota, persistente, ultimoDownload: localStorage.getItem("salao_ultimo_download"), ultimoSnapshot: sn[0]?.criado_em || null, snapshots: sn };
}
export function marcar(contagem) { localStorage.setItem("salao_marca", JSON.stringify({ quando: agora(), clientes: contagem })); }
export function marca() { try { return JSON.parse(localStorage.getItem("salao_marca")); } catch { return null; } }
