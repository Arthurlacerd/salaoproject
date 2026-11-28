import { transacao, ler, agora, norm, auditar, VERSAO_APP, VERSAO_BANCO, VERSAO_SCHEMA, INFO, TABELAS, config } from "./database.js";
import { exigir } from "./permissoes.js";
import { FORMATO, VERSAO_FORMATO, canonico, sha256 } from "./formatos_backup.js";
import { analisarTexto, analisarDoc, AVISO_INCONSISTENTE, LIMITE_BYTES } from "./validacao_backup.js";
import { bytesUtf8 } from "./tamanho_backup.js";
import { paraInterna, validarData } from "./datas.js";
// 11.3: formato e checksum em formatos_backup.js; análise em validacao_backup.js; restauração segura em restauracao.js.
export { FORMATO, VERSAO_FORMATO, canonico, sha256 };
export const LIMITE = LIMITE_BYTES;
// Chaves de configuração que nunca entram nem saem de um backup: senhas fora da tabela de usuários e preferências próprias
// de cada aparelho (estas evitam regredir migrations ao restaurar).
export const SENSIVEIS = ["senha_hash", "senha_versao"];
export const LOCAIS = ["schema_versao", "historico_migracoes", "historico_versoes"];
export async function montar({ incluirUsuarios = true } = {}) {
  const [cl, sv, at, pg, de, au, us, cfg] = await Promise.all(["clientes", "servicos", "atendimentos", "pagamentos", "despesas", "auditoria", "usuarios", "config"].map(ler));
  const tabelas = { clientes: cl, servicos: sv, atendimentos: at, pagamentos: pg, despesas: de, auditoria: au, configuracoes_sistema: cfg.filter((c) => !SENSIVEIS.includes(c.chave) && !LOCAIS.includes(c.chave)).map((c) => ({ chave: c.chave, valor: String(c.valor) })) };
  if (incluirUsuarios) tabelas.usuarios = us;
  const doc = { formato: FORMATO, sistema: INFO.sistema, versao_formato: VERSAO_FORMATO, versao_app: VERSAO_APP, versao_banco: VERSAO_BANCO, versao_schema: VERSAO_SCHEMA, origem: "pwa", criado_em: new Date().toISOString().slice(0, 19),
    estrutura: { tabelas: Object.keys(tabelas), senhas: "somente hash PBKDF2 (nunca texto puro)" }, migracoes: ["idb_001", "dados_002"], contagens: Object.fromEntries(Object.entries(tabelas).map(([k, v]) => [k, v.length])), sha256: await sha256(canonico(tabelas)), tabelas };
  return doc;
}
export async function exportarTexto(opts) { return JSON.stringify(await montar(opts)); }
export function nomeArquivo({ prefixo = "salao-gestao-backup", inconsistente = false } = {}) { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${prefixo}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${inconsistente ? "-INCONSISTENTE" : ""}.salaobackup`; }
/** 11.3: gera uma cópia FIEL do estado atual — relida, com checksum conferido e contagens iguais às dos dados vivos.
 *  A validação do conteúdo não bloqueia mais (D3): um estado inconsistente continua exportável para recuperação/análise,
 *  mas o arquivo é MARCADO (estado_dados/aviso no cabeçalho, fora do checksum) e a restauração normal o recusa.
 *  Devolve { texto, rel (análise do conteúdo), consistente }. */
/** 11.4: campos de data que a revisão de integridade sabe tratar (os demais problemas são só informados). */
export const CAMPOS_DATA = { clientes: "data_nascimento", atendimentos: "data", pagamentos: "data", despesas: "data" };
export const ehProblemaDeData = (p) => p.codigo === "CAMPO_INVALIDO" && CAMPOS_DATA[p.tabela] === p.campo;
const CHAVE_INTEGRIDADE = "salao_integridade";
/** Guarda neste aparelho o último resultado da conferência (só contagens e horário; nenhum dado pessoal). */
export function registrarIntegridade(rel) {
  try { const datas = rel.problemas.filter(ehProblemaDeData).length; localStorage.setItem(CHAVE_INTEGRIDADE, JSON.stringify({ quando: agora(), consistente: !!rel.ok, datas, outros: rel.problemas.length - datas })); } catch (_) {}
}
export function integridadeConhecida() { try { return JSON.parse(localStorage.getItem(CHAVE_INTEGRIDADE) || "null"); } catch (_) { return null; } }
/** Última cópia local restaurável (sem a marca de inconsistente), ou null. */
export async function ultimaCopiaRestauravel() { return (await snapshots()).find((s) => !s.inconsistente) || null; }
export async function criarValidado(opts) {
  const doc = await montar(opts), texto = JSON.stringify(doc), lido = JSON.parse(texto);
  if ((await sha256(canonico(lido.tabelas))) !== lido.sha256) throw new Error("A cópia gerada não confere (checksum). Nada foi gravado.");
  for (const [t, store] of [["clientes", "clientes"], ["atendimentos", "atendimentos"], ["pagamentos", "pagamentos"], ["despesas", "despesas"], ["servicos", "servicos"]])
    if ((lido.tabelas[t] || []).length !== (await ler(store)).length) throw new Error(`Os dados mudaram enquanto a cópia era gerada (${t}). Tente de novo.`);
  const rel = await analisarDoc(lido, { finalidade: "copia" }); registrarIntegridade(rel); // 11.4: o resultado fica visível em Dados e no Diagnóstico
  if (rel.ok) return { texto, rel, consistente: true };
  return { texto: JSON.stringify({ ...doc, estado_dados: "inconsistente", aviso: AVISO_INCONSISTENTE }), rel, consistente: false };
}
/** Exporta o backup. Um estado inconsistente é exportado mesmo assim (emergência), com nome e cabeçalho marcados,
 *  e não conta como "último backup baixado". */
export async function baixar() {
  exigir("dados.gerir"); const { texto, rel, consistente } = await criarValidado();
  baixarTexto(texto, nomeArquivo({ inconsistente: !consistente }));
  if (consistente) localStorage.setItem("salao_ultimo_download", agora());
  await transacao(["auditoria"], "readwrite", (t) => auditar(t, "exportacao", "sistema", null, consistente ? "Backup exportado" : "Backup de estado inconsistente exportado (apenas recuperação/análise)"));
  return { bytes: bytesUtf8(texto), consistente, problemas: consistente ? [] : rel.erros }; // 11.3.2: bytes reais do arquivo
}
export function baixarBlob(blob, nome) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
export function baixarTexto(texto, nome) { baixarBlob(new Blob([texto], { type: "application/octet-stream" }), nome); }
/** Análise completa do arquivo antes de qualquer gravação (11.3, validacao_backup.js). Nunca lança. */
export function validar(texto) { return analisarTexto(texto); }
export async function comparar(rel) { // conflitos/atenção antes de substituir
  const atual = {}; for (const t of ["clientes", "atendimentos", "despesas", "pagamentos"]) atual[t] = (await ler(t)).length;
  return { atual, novo: rel.contagens, substituiraDados: Object.values(atual).some((n) => n > 0) };
}
// ---- cópias locais (snapshots) — política de retenção 11.2 ----
// Ficam no próprio IndexedDB: protegem contra erro de operação/atualização, NÃO contra limpeza dos dados do site.
// A proteção principal continua sendo o arquivo .salaobackup baixado (nunca é afetado por esta política).
export const RETENCAO = { maximo: 8, minimo: 2, bytes: 40 * 1024 * 1024, protegidos: ["pre_atualizacao", "pre_migracao", "pre_importacao", "pre_retorno_versao"] };
/** Função pura: recebe [{id, motivo, tamanho, inconsistente?}] e devolve os ids a APAGAR.
 *  Mantém as `maximo` mais recentes + a mais recente de cada motivo protegido; depois, se o total passar de `bytes`,
 *  apaga as mais antigas (nunca a mais recente de todas e nunca abaixo de `minimo`).
 *  11.4: a ÚLTIMA cópia CONSISTENTE (sem "inconsistente") nunca é apagada — nem pela quantidade, nem pelo tamanho —,
 *  para que sempre reste uma cópia restaurável quando as cópias novas saem de um estado inconsistente. As cópias
 *  inconsistentes seguem a política de antes. Quando todas são consistentes, o resultado é idêntico ao da 11.3. */
export function politicaRetencao(lista, r = RETENCAO) {
  const ord = [...lista].sort((a, b) => b.id - a.id), manter = new Set(ord.slice(0, r.maximo).map((b) => b.id));
  for (const m of r.protegidos) { const b = ord.find((x) => x.motivo === m); if (b) manter.add(b.id); }
  const restauravel = ord.find((x) => !x.inconsistente); if (restauravel) manter.add(restauravel.id);
  let mantidos = ord.filter((b) => manter.has(b.id)), total = mantidos.reduce((s, b) => s + (b.tamanho || 0), 0);
  while (total > r.bytes && mantidos.length > r.minimo) {
    let i = mantidos.length - 1; while (i > 0 && restauravel && mantidos[i].id === restauravel.id) i--; // pula a última consistente
    if (i <= 0) break; // nunca a mais recente de todas
    const [b] = mantidos.splice(i, 1); manter.delete(b.id); total -= b.tamanho || 0;
  }
  return ord.filter((b) => !manter.has(b.id)).map((b) => b.id);
}
export async function snapshot(motivo, extra = {}) {
  const { texto, consistente } = await criarValidado(); const reg = { criado_em: agora(), motivo, tamanho: texto.length, bytes: bytesUtf8(texto), texto, ...(consistente ? {} : { inconsistente: true }), ...extra };
  const id = await transacao(["backups"], "readwrite", async (t) => { const id = await t.backups.adicionar(reg); const todos = await t.backups.todos(); for (const x of politicaRetencao(todos.map(({ id, motivo, tamanho, inconsistente }) => ({ id, motivo, tamanho: tamanho || 0, inconsistente: !!inconsistente })))) if (x !== id) await t.backups.apagar(x); return id; });
  const gravado = (await ler("backups")).find((b) => b.id === id); // confirma que foi gravado
  if (!gravado || gravado.texto !== texto) throw new Error("Não foi possível confirmar a gravação do backup automático.");
  return { ...reg, id };
}
export async function snapshots() { return (await ler("backups")).sort((a, b) => b.id - a.id).map(({ texto, ...r }) => r); }
export async function snapshotTexto(id) { return (await ler("backups")).find((b) => b.id === id)?.texto; }
export async function backupAutomatico({ aoPreparar } = {}) { // 11.3.1: aoPreparar avisa a tela que a cópia do dia vai começar
  const c = await config(); if (c.backup_automatico !== "1") return null; const hoje = agora().slice(0, 10);
  const ult = (await snapshots()).find((b) => b.motivo === "automatico"); if (ult && ult.criado_em.slice(0, 10) === hoje) return null;
  if (!(await ler("clientes")).length) return null; try { if (aoPreparar) aoPreparar(); } catch (_) {} return snapshot("automatico");
}
/** Restauração segura (11.3): validação completa, autorização, prova de acesso, cópia antes da restauração e gravação
 *  atômica conferida antes do commit — ver restauracao.js. Mantido por compatibilidade: devolve as contagens. */
export async function importar(rel, opcoes = {}) { const R = await import("./restauracao.js"); return (await R.restaurar(rel, opcoes)).contagens; }
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
    if (nasc && !motivo) { const interna = paraInterna(nasc); if (!interna || validarData(interna, "nascimento")) motivo = "data de nascimento inválida"; else it.data_nascimento = interna; } // 11.4: sem fuso (datas.js)
    if (motivo) { it.motivo = motivo; r.invalidos.push(it); return; }
    const d = dig(tel); if (existentes.has(d)) { it.motivo = "telefone já cadastrado"; r.duplicados.push(it); return; }
    if (vistos.has(d)) { it.motivo = "telefone repetido no arquivo"; r.duplicados.push(it); return; }
    vistos.add(d); r.validos.push(it);
  });
  return r;
}
export async function importarClientes(validos) {
  exigir("clientes.gravar");
  for (const v of validos) if (v.data_nascimento != null && validarData(v.data_nascimento, "nascimento")) throw new Error(`Data de nascimento inválida na linha ${v.linha}: nada foi importado.`); // 11.4: confere de novo antes de gravar
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
