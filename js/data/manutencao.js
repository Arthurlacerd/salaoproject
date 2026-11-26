// Central de manutenção: versões, backups de dados/aplicação/completo, atualização segura e retorno de versão.
import { INFO, VERSAO_BANCO, VERSAO_SCHEMA, ler, agora, transacao, auditar, definirConfig, config } from "./database.js";
import * as Bkp from "./backup.js";
import { criarZip } from "./zip.js";
import { exigir } from "./permissoes.js";
import { AVISO_INCONSISTENTE } from "./validacao_backup.js";

export const cmp = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
export const VERSAO = INFO.versao;
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

export function lerVersaoTexto(txt) { const m = txt.match(/SALAO_VERSAO\s*=\s*(\{[\s\S]*\})\s*;?\s*$/); if (!m) throw new Error("versao.js ilegível"); return JSON.parse(m[1]); }

// ---------- SW ----------
export async function swMsg(msg) {
  const reg = await navigator.serviceWorker?.getRegistration(); const alvo = reg?.active; if (!alvo) throw new Error("O service worker ainda não está ativo.");
  return new Promise((ok, erro) => { const c = new MessageChannel(); const t = setTimeout(() => erro(new Error("O service worker não respondeu.")), 8000); c.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); }; alvo.postMessage(msg, [c.port2]); });
}
export async function versoesDisponiveis() { try { return await swMsg({ tipo: "listar-versoes" }); } catch { return []; } }

// ---------- estado ----------
export async function estado() {
  const cont = {}; for (const t of ["clientes", "atendimentos", "servicos", "pagamentos", "despesas", "usuarios", "auditoria"]) cont[t] = (await ler(t)).length;
  let uso = null, quota = null, persistente = null; try { const e = await navigator.storage.estimate(); uso = e.usage; quota = e.quota; persistente = await navigator.storage.persisted(); } catch (_) {}
  const reg = await navigator.serviceWorker?.getRegistration(), c = await config(), sn = await Bkp.snapshots();
  return { versao: INFO.versao, data: INFO.data, banco: VERSAO_BANCO, schema: VERSAO_SCHEMA, cont, uso, quota, persistente,
    pwa: { sw: !reg ? "não registrado" : reg.active ? "ativo" : reg.installing ? "instalando" : "aguardando", offlinePronto: !!reg?.active && !!navigator.serviceWorker.controller, instalado: matchMedia("(display-mode: standalone)").matches || !!navigator.standalone, online: navigator.onLine, aguardando: !!reg?.waiting },
    ultimoDownload: localStorage.getItem("salao_ultimo_download"), ultimoSnapshot: sn[0] || null, snapshots: sn, schemaGravado: c.schema_versao || "1", historico: JSON.parse(c.historico_versoes || "[]"), migracoes: JSON.parse(c.historico_migracoes || "[]") };
}
export async function registrarVersaoInstalada() { // histórico de versões já usadas neste aparelho
  const c = await config(), h = JSON.parse(c.historico_versoes || "[]");
  if (h[h.length - 1]?.versao !== INFO.versao) { h.push({ versao: INFO.versao, quando: agora() }); await definirConfig("historico_versoes", JSON.stringify(h.slice(-30))); }
}

// ---------- backup da aplicação / completo ----------
async function arquivosApp() {
  const lista = [...new Set(["index.html", "sw.js", ...INFO.arquivos])], out = [];
  for (const u of lista) { const r = await fetch(u); if (!r.ok) throw new Error(`Não foi possível ler ${u} (${r.status}).`); out.push({ nome: u, dados: new Uint8Array(await r.arrayBuffer()) }); }
  return out;
}
const LEIA_APP = (v) => `Salão.gestão ${v} — BACKUP DA APLICAÇÃO\n\nEste ZIP contém SOMENTE os arquivos do programa (HTML, CSS, JS, ícones, service worker).\nNÃO contém clientes, agenda, financeiro nem outros dados — para isso use o backup de dados (.salaobackup).\n\nPara publicar: envie o conteúdo desta pasta para qualquer hospedagem estática com HTTPS.\nOs dados dos usuários ficam nos aparelhos deles e não são afetados ao publicar uma nova versão.\n`;
export async function exportarAplicacao() {
  exigir("dados.gerir"); const arq = await arquivosApp(); arq.push({ nome: "LEIA-ME.txt", dados: LEIA_APP(INFO.versao) });
  const blob = criarZip(arq); Bkp.baixarBlob(blob, `salao-gestao-v${INFO.versao}.zip`); return { arquivos: arq.length, bytes: blob.size, nome: `salao-gestao-v${INFO.versao}.zip` };
}
export async function backupCompleto() {
  exigir("dados.gerir"); const arq = await arquivosApp(), { texto, rel, consistente } = await Bkp.criarValidado(); // 11.3: estado inconsistente é exportado marcado (D3)
  const todos = [...arq.map((a) => ({ nome: "app/" + a.nome, dados: a.dados })), { nome: "data/backup.salaobackup", dados: texto },
    { nome: "LEIA-ME.txt", dados: `Salão.gestão ${INFO.versao} — BACKUP COMPLETO (${agora()})\n\napp/  = arquivos do programa (backup da aplicação)\ndata/ = backup dos dados (.salaobackup; senhas só como hash, nunca em texto puro)\n\nPara restaurar os dados: Configurações → Manutenção → Importar backup, escolhendo data/backup.salaobackup.\nPara republicar o programa: hospede o conteúdo de app/ em um servidor HTTPS.\n${consistente ? "" : `\nATENÇÃO: ${AVISO_INCONSISTENTE}\n`}` }];
  const blob = criarZip(todos); Bkp.baixarBlob(blob, `salao-gestao-backup-completo-v${INFO.versao}.zip`); if (consistente) localStorage.setItem("salao_ultimo_download", agora()); // estado inconsistente não conta como backup saudável (D3)
  await transacao(["auditoria"], "readwrite", (t) => auditar(t, "exportacao", "sistema", null, "Backup completo (aplicação + dados) exportado")); return { arquivos: todos.length, contagens: rel.contagens, consistente };
}

// ---------- atualização segura ----------
export async function verificarAtualizacao() {
  if (!navigator.onLine) return { erro: "Sem conexão: não foi possível verificar agora. O aplicativo continua funcionando normalmente." };
  try {
    const r = await fetch("js/versao.js?v=" + Date.now(), { cache: "no-store" }); if (!r.ok) throw new Error("HTTP " + r.status);
    const nova = lerVersaoTexto(await r.text()); try { await definirConfig("ultima_verificacao_atualizacao", agora()); } catch (_) {}
    const reg = await navigator.serviceWorker?.getRegistration();
    return { atual: INFO.versao, nova: nova.versao, disponivel: cmp(nova.versao, INFO.versao) > 0, alteracoes: nova.alteracoes || [], data: nova.data, aguardando: !!reg?.waiting };
  } catch (e) { return { erro: "Não foi possível consultar a versão publicada (" + e.message + "). Seus dados não foram alterados." }; }
}
/** Passo obrigatório antes de atualizar/restaurar versão: verifica, cria e valida o backup. Lança erro se falhar. */
export async function prepararAtualizacao(motivo = "pre_atualizacao") {
  const antes = {}; for (const t of ["clientes", "atendimentos", "pagamentos", "despesas", "servicos"]) antes[t] = (await ler(t)).length;
  const reg = await Bkp.snapshot(motivo); // cria, valida (releitura + contagens) e confirma gravação
  const depois = {}; for (const t of Object.keys(antes)) depois[t] = (await ler(t)).length;
  if (JSON.stringify(antes) !== JSON.stringify(depois)) throw new Error("Os dados mudaram durante o backup. Tente de novo.");
  return { criado: true, validado: true, preservados: antes, backup: { id: reg.id, criado_em: reg.criado_em, tamanho: reg.tamanho } };
}
export async function aplicarAtualizacao(aoProgresso = () => {}) {
  exigir("dados.gerir"); aoProgresso("backup"); const b = await prepararAtualizacao(); aoProgresso("backup-ok", b);
  const reg = await navigator.serviceWorker.getRegistration(); if (!reg) throw new Error("Service worker não registrado.");
  aoProgresso("baixando"); if (!reg.waiting) { await reg.update(); await new Promise((ok, erro) => { const lim = setTimeout(() => erro(new Error("A nova versão não terminou de instalar. Seus dados e a versão atual continuam intactos.")), 90000);
    const ver = () => { if (reg.waiting) { clearTimeout(lim); ok(); } }; ver(); const w = reg.installing; if (w) w.addEventListener("statechange", () => { if (w.state === "redundant") { clearTimeout(lim); erro(new Error("A nova versão falhou na validação e não foi instalada. A versão atual continua funcionando e seus dados estão intactos.")); } ver(); }); reg.addEventListener("updatefound", () => { const x = reg.installing; x && x.addEventListener("statechange", () => { if (x.state === "redundant") { clearTimeout(lim); erro(new Error("A nova versão falhou na validação e não foi instalada. A versão atual continua funcionando e seus dados estão intactos.")); } ver(); }); }); const t = setInterval(() => { if (reg.waiting) clearInterval(t); ver(); }, 500); }); }
  aoProgresso("ativando"); window.__atualizacaoPedida = true; reg.waiting.postMessage("pular-espera"); return b; // app.js recarrega quando o novo SW assume
}

// ---------- retorno de versão (não destrutivo) ----------
/** Versão mínima segura para o retorno: as anteriores (11.1, 11.2…) restauram backups sem login, falha corrigida na 11.3.
 *  O mesmo valor está em sw.js (o service worker também recusa); tests/unit/sw.test.js confere que os dois são iguais. */
export const VERSAO_MINIMA_RETORNO = "11.3.0";
const FORMATO_VERSAO = /^\d+\.\d+\.\d+$/;
/** Compatibilidade de uma versão guardada com os dados ATUAIS deste aparelho (função pura, testada).
 *  Só é compatível a versão com a MESMA versão nativa do banco (IndexedDB) e schema lógico >= o atual:
 *  - banco menor: o IndexedDB recusaria a abertura (VersionError) e o app não abriria;
 *  - banco maior: ela tentaria mudar a estrutura (não é um retorno);
 *  - schema menor: o código antigo não conhece as migrations de dados já aplicadas;
 *  - versão anterior à VERSAO_MINIMA_RETORNO (comparação numérica X.Y.Z, não de texto): reabriria uma falha de segurança.
 *  O retorno nunca faz downgrade do IndexedDB: se não for compatível, é bloqueado. */
export function compatibilidade(v, atual = { banco: VERSAO_BANCO, schema: VERSAO_SCHEMA }) {
  const banco = Number(v?.banco), schema = Number(v?.schema ?? 0);
  if (!Number.isInteger(banco)) return { ok: false, motivo: `A versão ${v?.versao || "?"} não informa a versão do banco; o retorno foi bloqueado por segurança.` };
  if (banco < atual.banco) return { ok: false, motivo: `A versão ${v.versao} usa a estrutura de dados v${banco}, mais antiga que a atual (v${atual.banco}). Voltar para ela impediria o aplicativo de abrir, então o retorno foi bloqueado. Seus dados não foram alterados.` };
  if (banco > atual.banco) return { ok: false, motivo: `A versão ${v.versao} usa a estrutura de dados v${banco}, diferente da atual (v${atual.banco}). Use Atualizar em vez de voltar.` };
  if (schema < atual.schema) return { ok: false, motivo: `A versão ${v.versao} não conhece as atualizações de dados já aplicadas neste aparelho (dados v${schema} < v${atual.schema}). O retorno foi bloqueado.` };
  if (!FORMATO_VERSAO.test(String(v.versao ?? ""))) return { ok: false, motivo: "A versão guardada não informa um número de versão válido; o retorno foi bloqueado por segurança. Seus dados não foram alterados." };
  if (cmp(v.versao, VERSAO_MINIMA_RETORNO) < 0) return { ok: false, motivo: `A versão ${v.versao} é antiga demais para um retorno seguro: versões anteriores à ${VERSAO_MINIMA_RETORNO} permitem restaurar backups sem login. O retorno foi bloqueado. Seus dados não foram alterados.` };
  return { ok: true };
}
export async function podeVoltarPara(versao) {
  if (!(await caches.has("salao-static-v" + versao))) return { ok: false, motivo: "Essa versão não está mais guardada neste aparelho." };
  const c = await caches.open("salao-static-v" + versao), r = await c.match("js/versao.js"); if (!r) return { ok: false, motivo: "Essa versão não está mais guardada neste aparelho." };
  let v; try { v = lerVersaoTexto(await r.text()); } catch (_) { return { ok: false, motivo: "A cópia guardada dessa versão está ilegível." }; }
  const comp = compatibilidade(v); return comp.ok ? { ok: true, versao: v } : comp;
}
export async function voltarVersao(versao) {
  exigir("dados.gerir"); const p = await podeVoltarPara(versao); if (!p.ok) throw new Error(p.motivo);
  await prepararAtualizacao("pre_retorno_versao"); const r = await swMsg({ tipo: "fixar-versao", versao }); if (!r.ok) throw new Error(r.motivo || "Não foi possível fixar a versão."); return true;
}
/** Saída de emergência: desafixa qualquer versão e abre a atual. Funciona mesmo se o banco não abrir (não usa o IndexedDB). */
export async function recuperarVersaoAtual() {
  try { await swMsg({ tipo: "desafixar" }); } catch (_) { /* SW indisponível: a navegação com ?recuperar=1 também desafixa */ }
  location.replace(new URL("./?recuperar=1#/hoje", location.href).href);
}
export async function estadoSW() { try { return await swMsg({ tipo: "estado" }); } catch { return null; } }
export async function usarMaisRecente() { await swMsg({ tipo: "desafixar" }); return true; }
