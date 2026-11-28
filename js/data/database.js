// Camada de acesso ao IndexedDB. Nenhuma outra parte do app fala direto com o IndexedDB.
import { abrirBanco, versaoNativa, versaoLogica, TABELAS_BASE, pendentes, migrarDados } from "./migracoes.js";
export const NOME_BANCO = "salao_gestao";
export const INFO = globalThis.SALAO_VERSAO || { sistema: "Salão.gestão", versao: "0.0.0", data: "", banco: 1, schema: 1, alteracoes: [], arquivos: [] }; // fonte única: js/versao.js
export const VERSAO_APP = INFO.versao;
export const VERSAO_BANCO = versaoNativa(); // versão nativa do IndexedDB (migrations de estrutura)
export const VERSAO_SCHEMA = versaoLogica(); // versão lógica (migrations de dados)
export const TABELAS = TABELAS_BASE;
let _db = null;

export async function abrir() {
  if (_db) return _db;
  if (!("indexedDB" in self)) throw new Error("Este navegador não oferece IndexedDB.");
  const db = await abrirBanco(NOME_BANCO);
  db.onversionchange = () => { db.close(); _db = null; };
  return (_db = db);
}
export async function migracoesPendentes() { return pendentes(await abrir()); }
export async function executarMigracoes() { return migrarDados(await abrir()); }
export function fechar() { if (_db) { _db.close(); _db = null; } }
const req = (r) => new Promise((ok, erro) => { r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error); });

/** Executa `fn` em UMA transação (tudo ou nada). Dentro dela só use await nas operações recebidas.
 *  opcoes.durability ("strict"): pedida ao navegador quando ele oferece; a correção nunca depende dela. */
export async function transacao(stores, modo, fn, opcoes = {}) {
  const db = await abrir();
  let t; if (opcoes.durability) { try { t = db.transaction(stores, modo, { durability: opcoes.durability }); } catch (_) { t = db.transaction(stores, modo); } } else t = db.transaction(stores, modo);
  const api = {};
  for (const s of stores) {
    const o = t.objectStore(s);
    api[s] = {
      get: (id) => req(o.get(id)), todos: () => req(o.getAll()), contar: () => req(o.count()),
      adicionar: (v) => req(o.add(v)), salvar: (v) => req(o.put(v)), apagar: (id) => req(o.delete(id)), limpar: () => req(o.clear()),
      porIndice: (i, v) => req(o.index(i).getAll(v)),
    };
  }
  const fim = new Promise((ok, erro) => { t.oncomplete = ok; t.onerror = () => erro(t.error); t.onabort = () => erro(t.error || new Error("Operação cancelada.")); });
  let saida;
  try { saida = await fn(api); } catch (e) { try { t.abort(); } catch (_) {} await fim.catch(() => {}); throw e; }
  await fim;
  return saida;
}
export const ler = (store) => transacao([store], "readonly", (t) => t[store].todos());
export const obter = (store, id) => transacao([store], "readonly", (t) => t[store].get(id));
// 11.4 (só leitura, sem mudar a estrutura): contagem sem ler a tabela inteira e leitura pelos índices que já existem.
export const contar = (store) => transacao([store], "readonly", (t) => t[store].contar());
export const lerPorIndice = (store, indice, chave) => transacao([store], "readonly", (t) => t[store].porIndice(indice, chave));
/** Chave aceita pelo IndexedDB nas buscas por igualdade usadas aqui (número válido ou texto). */
export const chaveSimples = (k) => (typeof k === "number" && !Number.isNaN(k)) || typeof k === "string";

export function agora() { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
export function hoje() { return agora().slice(0, 10); }
export const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---- sessão (usuário atual) usada pela auditoria e permissões ----
export const sessao = { usuario: null }; // {id,usuario,nome,perfil}
export function auditar(t, acao, entidade, entidade_id, resumo = "", campo = null, anterior = null, novo = null) {
  return t.auditoria.adicionar({ quando: agora(), acao, entidade, entidade_id, campo, valor_anterior: anterior == null ? null : String(anterior), valor_novo: novo == null ? null : String(novo), resumo, usuario: sessao.usuario?.nome || "sistema" });
}
// ---- configurações (chave/valor) ----
export const CONFIG_PADRAO = { nome_sistema: "Salão.gestão", cor_principal: "#a85e70", cor_fundo: "#f7efe4", tema: "claro", bloqueio_minutos: "30", agenda_inicio: "08:00", agenda_fim: "19:00", backup_automatico: "1", backup_antes_atualizar: "1" };
export async function config() {
  const linhas = await ler("config"); const c = { ...CONFIG_PADRAO };
  for (const l of linhas) c[l.chave] = l.valor; return c;
}
export async function definirConfig(chave, valor) { return transacao(["config"], "readwrite", (t) => t.config.salvar({ chave, valor: String(valor) })); }
