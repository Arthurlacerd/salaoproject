// Restauração segura (11.3).
// Garantias, nesta ordem:
//  1. tudo é validado ANTES de gravar (validacao_backup.js), inclusive de novo aqui dentro (defesa em profundidade);
//  2. com QUALQUER usuário no aparelho, só um administrador autenticado restaura — mesmo que nenhum administrador consiga
//     entrar. Sem login, só em aparelho SEM NENHUM usuário (primeiro acesso / dados perdidos);
//  3. se o backup traz usuários, é preciso provar o acesso: usuário e senha de um administrador DO BACKUP, conferidos no
//     próprio arquivo, antes de qualquer gravação;
//  4. nem a restauração nem o desfazer deixam o aparelho sem um administrador que consiga entrar: sem ele, o app voltaria ao
//     "primeiro acesso" e qualquer pessoa criaria um administrador com acesso aos dados e às cópias guardadas;
//  5. uma cópia do estado atual ("cópia antes da restauração") é guardada de forma independente — exatamente como está,
//     mesmo se inconsistente; se ela falhar, nada é alterado;
//  6. a substituição acontece numa ÚNICA transação do IndexedDB e os dados são conferidos DENTRO dela, antes do commit;
//     qualquer falha aborta a transação e o estado anterior permanece;
//  7. "Desfazer a última restauração" devolve o estado anterior pelo mesmo caminho atômico.
// A durabilidade "strict" do IndexedDB é pedida quando o navegador oferece, mas nada aqui depende dela para ser correto.
import { transacao, ler, sessao, auditar } from "./database.js";
import * as Bkp from "./backup.js";
import { analisarDoc, analisarArquivo, analisarTexto } from "./validacao_backup.js";
import { canonico, sha256 } from "./formatos_backup.js";
import { TABELAS_PERMITIDAS, usuarioValido } from "./esquema_backup.js";
import { analisarHash, hashLegivel } from "./senha.js";
import { conferir, sair } from "./usuarios.js";
import { exigir } from "./permissoes.js";

export { analisarArquivo, analisarTexto };
const DADOS = ["clientes", "servicos", "atendimentos", "pagamentos", "despesas", "auditoria"];
const INDICIO = "salao_ultima_restauracao"; // só uma dica para a tela de login; a decisão é sempre tomada com o banco

export const MENSAGENS = {
  NAO_AUTORIZADO: "Este aparelho já tem usuários: para restaurar um backup, entre como administrador. Nada foi alterado.",
  PROVA_NECESSARIA: "Este backup contém usuários: informe o usuário e a senha de um administrador DO BACKUP. Nada foi alterado.",
  PROVA_FALHOU: "Usuário ou senha de administrador do backup incorretos. Nada foi alterado.",
  SEM_ACESSO_RESULTANTE: "Este backup não traz usuários e este aparelho não tem nenhum administrador que consiga entrar: restaurá-lo deixaria os dados sem acesso de administrador. Use um backup que contenha usuários, ou crie primeiro o administrador e restaure já conectado. Nada foi alterado.",
  BACKUP_INVALIDO: "O backup não passou na validação. Nada foi alterado.",
  COPIA_FALHOU: "Não foi possível guardar a cópia do estado atual antes da restauração; por segurança, nada foi alterado.",
  GRAVACAO_FALHOU: "A restauração falhou durante a gravação e foi totalmente desfeita: os dados deste aparelho continuam como estavam.",
  SEM_COPIA: "Não há cópia de antes de uma restauração para desfazer.",
  COPIA_DANIFICADA: "A cópia de antes da restauração está danificada (o checksum não confere); por segurança, nada foi alterado.",
  DESFAZER_BLOQUEADO: "Os dados mudaram desde a última restauração (alguém entrou ou trabalhou neste aparelho). Para desfazê-la, entre como administrador.",
  DESFAZER_SEM_ADMIN: "Não é possível desfazer: o estado anterior à última restauração não tem nenhum administrador que consiga entrar, e desfazer deixaria este aparelho sem acesso de administrador. Nada foi alterado.",
};
export class ErroRestauracao extends Error { constructor(codigo, texto) { super(texto || MENSAGENS[codigo] || codigo); this.name = "ErroRestauracao"; this.codigo = codigo; } }
const tecnico = (e) => ` (detalhe técnico: ${String((e && (e.message || e.name)) || e).slice(0, 140)})`;

// ---------- autorização (D1) ----------
/** Administrador que o login consegue autenticar (mesmas regras do login; hash legível como na 11.2). */
export function adminUtilizavel(u) { return !!u && u.perfil === "admin" && !!u.ativo && usuarioValido(u.usuario) && !!hashLegivel(u.senha_hash); }
/** Administrador aceito num backup (regra da validação: ativo === 1 e senha no formato completo). */
const adminDoBackup = (u) => !!u && u.perfil === "admin" && u.ativo === 1 && usuarioValido(u.usuario) && analisarHash(u.senha_hash).ok;
/** Restauração sem login SOMENTE em aparelho sem nenhum usuário (primeiro acesso / dados perdidos). Havendo qualquer usuário,
 *  mesmo sem nenhum administrador que consiga entrar, só um administrador autenticado restaura (A2 da revisão final). */
export async function restauracaoSemLoginPermitida() { return (await ler("usuarios")).length === 0; }
async function sessaoAdmin() {
  const s = sessao.usuario; if (!s || s.perfil !== "admin") return false;
  const u = (await ler("usuarios")).find((x) => x.id === s.id); return !!u && u.perfil === "admin" && !!u.ativo;
}
/** Como a restauração foi autorizada: "admin" (sessão de administrador) ou "sem_usuarios" (aparelho sem nenhum usuário). */
async function autorizar() {
  if (await sessaoAdmin()) return "admin";
  if (await restauracaoSemLoginPermitida()) return "sem_usuarios";
  throw new ErroRestauracao("NAO_AUTORIZADO");
}

// ---------- prova de acesso (D4): conferida no hash do PRÓPRIO backup, sem gravar nada ----------
async function conferirProva(usuarios, prova) {
  if (!prova || !String(prova.usuario || "").trim() || !prova.senha) throw new ErroRestauracao("PROVA_NECESSARIA");
  const nome = String(prova.usuario).trim().toLowerCase();
  const u = usuarios.find((x) => x.usuario === nome && x.perfil === "admin" && x.ativo === 1);
  if (!u || !analisarHash(u.senha_hash).ok || !(await conferir(String(prova.senha), u.senha_hash))) throw new ErroRestauracao("PROVA_FALHOU");
}

// ---------- cópia antes da restauração (independente; política de retenção da 11.2) ----------
async function guardarCopia(extra) {
  try { return await Bkp.snapshot("pre_importacao", extra); } catch (e) { throw new ErroRestauracao("COPIA_FALHOU", MENSAGENS.COPIA_FALHOU + tecnico(e)); }
}
/** Depois do commit: guarda o checksum do estado resultante na cópia. "Desfazer" sem login só vale enquanto os dados
 *  continuarem exatamente assim (ninguém entrou nem trabalhou). Se isto falhar, o desfazer continua disponível com login.
 *  desfazivel = a cópia tem um administrador que consegue entrar; só então a tela de login oferece o link de desfazer. */
async function registrarEstadoApos(copiaId, { desfazivel }) {
  try {
    const h = (await Bkp.montar()).sha256;
    await transacao(["backups"], "readwrite", async (t) => { const b = await t.backups.get(copiaId); if (b) { b.estado_apos = h; await t.backups.salvar(b); } });
    if (!desfazivel) limparIndicioDesfazer(); else try { localStorage.setItem(INDICIO, JSON.stringify({ id: copiaId })); } catch (_) {}
  } catch (_) {}
}
export function indicioDesfazer() { try { return !!JSON.parse(localStorage.getItem(INDICIO) || "null"); } catch (_) { return false; } }
export function limparIndicioDesfazer() { try { localStorage.removeItem(INDICIO); } catch (_) {} }
/** Alguém entrou: a partir daqui, desfazer a última restauração exige login (Dados e backup). Chamado ao iniciar a sessão.
 *  Explícito de propósito: não depende de o login ter mudado algum dado (ex.: o mesmo segundo em "ultimo_acesso"). */
export async function encerrarDesfazerSemLogin() {
  if (!indicioDesfazer()) return; limparIndicioDesfazer();
  try {
    const c = await ultimaCopiaPreRestauracao();
    if (c && c.estado_apos) await transacao(["backups"], "readwrite", async (t) => { const b = await t.backups.get(c.id); if (b) { delete b.estado_apos; await t.backups.salvar(b); } });
  } catch (_) {}
}

// ---------- aplicação atômica ----------
/** Substitui os dados numa ÚNICA transação e confere tudo antes do commit. config: "mesclar" (restaurar arquivo: as chaves
 *  do backup sobrescrevem; as demais do aparelho ficam) ou "substituir" (desfazer: volta exatamente às do estado anterior).
 *  adminValido: regra do administrador que PRECISA existir nos usuários resultantes (substituídos ou mantidos).
 *  semUsuarios: a autorização foi "aparelho sem usuários" (sem login) — conferido de novo dentro da transação. */
async function aplicar(T, { substituirUsuarios, config, resumo, adminValido, semUsuarios = false }) {
  const stores = [...DADOS, "config", "usuarios"]; // "usuarios" sempre: a conferência do administrador é feita dentro da transação
  const cfg = new Map((T.configuracoes_sistema || []).filter((c) => !Bkp.SENSIVEIS.includes(c.chave) && !Bkp.LOCAIS.includes(c.chave)).map((c) => [c.chave, String(c.valor)]));
  try {
    await transacao(stores, "readwrite", async (t) => {
      if (semUsuarios && (await t.usuarios.contar()) > 0) throw new Error("autorização: o aparelho passou a ter usuários"); // nada gravado ainda
      for (const s of DADOS) await t[s].limpar();
      if (substituirUsuarios) await t.usuarios.limpar();
      if (config === "substituir") for (const c of await t.config.todos()) if (!Bkp.LOCAIS.includes(c.chave)) await t.config.apagar(c.chave);
      for (const s of DADOS) for (const r of T[s] || []) await t[s].salvar(r);
      if (substituirUsuarios) for (const r of T.usuarios) await t.usuarios.salvar(r);
      for (const [chave, valor] of cfg) await t.config.salvar({ chave, valor });
      await auditar(t, "importacao", "sistema", null, resumo);
      // ---- verificação DENTRO da transação: se algo não conferir, nada é gravado ----
      for (const s of DADOS) { const n = await t[s].contar(), e = (T[s] || []).length + (s === "auditoria" ? 1 : 0); if (n !== e) throw new Error(`conferência de ${s}: ${n} de ${e}`); }
      const us = await t.usuarios.todos();
      if (substituirUsuarios && us.length !== T.usuarios.length) throw new Error(`conferência de usuarios: ${us.length} de ${T.usuarios.length}`);
      if (!us.some(adminValido)) throw new Error("conferência de usuarios: nenhum administrador que consiga entrar");
      for (const [chave, valor] of cfg) { const c = await t.config.get(chave); if (!c || c.valor !== valor) throw new Error("conferência de configurações"); }
      if (config === "substituir" && (await t.config.todos()).filter((c) => !Bkp.LOCAIS.includes(c.chave)).length !== cfg.size) throw new Error("conferência de configurações");
    }, { durability: "strict" });
  } catch (e) { throw new ErroRestauracao("GRAVACAO_FALHOU", MENSAGENS.GRAVACAO_FALHOU + tecnico(e)); }
}

// ---------- restaurar um backup ----------
/** rel = resultado de analisarArquivo/analisarTexto. prova = { usuario, senha } de um admin do backup (se ele tiver usuários). */
export async function restaurar(rel, { prova } = {}) {
  if (!rel || !rel.ok || !rel.doc) throw new ErroRestauracao("BACKUP_INVALIDO", (rel && rel.erros && rel.erros.length ? rel.erros.join(" ") : MENSAGENS.BACKUP_INVALIDO));
  const v = await analisarDoc(rel.doc); // de novo: nunca confiar num objeto que veio de fora desta função
  if (!v.ok) throw new ErroRestauracao("BACKUP_INVALIDO", v.erros.join(" "));
  const semLogin = (await autorizar()) === "sem_usuarios";
  const T = v.doc.tabelas, temUsuarios = "usuarios" in T, atuais = await ler("usuarios");
  if (temUsuarios) await conferirProva(T.usuarios, prova);
  else if (!atuais.some(adminUtilizavel)) throw new ErroRestauracao("SEM_ACESSO_RESULTANTE"); // mantém os usuários do aparelho: precisa haver um administrador
  const copia = await guardarCopia({ restauracao: { sem_login: semLogin } });
  await aplicar(T, { substituirUsuarios: temUsuarios, config: "mesclar", adminValido: temUsuarios ? adminDoBackup : adminUtilizavel, semUsuarios: semLogin,
    resumo: `Backup restaurado (${v.criado_em || "data não informada"}, origem ${v.origem})${semLogin ? " sem login, em aparelho sem usuários" : ""}; cópia do estado anterior guardada` });
  await registrarEstadoApos(copia.id, { desfazivel: atuais.some(adminUtilizavel) });
  if (temUsuarios || semLogin) sair();
  return { contagens: v.contagens, usuariosSubstituidos: temUsuarios, copia: { id: copia.id, criado_em: copia.criado_em } };
}

// ---------- desfazer a última restauração ----------
export async function ultimaCopiaPreRestauracao() { return (await Bkp.snapshots()).find((s) => s.motivo === "pre_importacao") || null; }
/** Sem login: só enquanto os dados continuam exatamente como a última restauração os deixou. */
export async function podeDesfazerSemLogin() {
  const c = await ultimaCopiaPreRestauracao(); if (!c || !c.estado_apos) return false;
  return (await Bkp.montar()).sha256 === c.estado_apos;
}
/** Tudo o que o desfazer confere ANTES de gravar, nesta ordem. Não grava nada; lança ErroRestauracao. */
async function prepararDesfazer() {
  const c = await ultimaCopiaPreRestauracao(); if (!c) throw new ErroRestauracao("SEM_COPIA");
  const admin = await sessaoAdmin();
  if (!admin && !(await podeDesfazerSemLogin())) throw new ErroRestauracao("DESFAZER_BLOQUEADO");
  let doc; try { doc = JSON.parse(await Bkp.snapshotTexto(c.id)); } catch (_) { throw new ErroRestauracao("COPIA_DANIFICADA"); }
  const ok = doc && doc.tabelas && typeof doc.tabelas === "object" && !Array.isArray(doc.tabelas) && (await sha256(canonico(doc.tabelas))) === doc.sha256
    && Object.entries(doc.tabelas).every(([k, l]) => TABELAS_PERMITIDAS.includes(k) && Array.isArray(l) && l.every((r) => r && typeof r === "object" && !Array.isArray(r)));
  if (!ok) throw new ErroRestauracao("COPIA_DANIFICADA");
  // A1 da revisão final: com ou sem login, o estado recuperado precisa ter um administrador que consiga entrar. Sem ele, o
  // app voltaria ao "primeiro acesso" e qualquer pessoa criaria um administrador com acesso às cópias guardadas.
  const usuarios = "usuarios" in doc.tabelas ? doc.tabelas.usuarios : await ler("usuarios");
  if (!usuarios.some(adminUtilizavel)) throw new ErroRestauracao("DESFAZER_SEM_ADMIN");
  return { c, doc, admin };
}
/** Para a tela: o desfazer seria aceito agora? Não grava nada e não devolve dados, só o código e a mensagem. */
export async function avaliarDesfazer() {
  try { await prepararDesfazer(); return { ok: true }; }
  catch (e) { if (e instanceof ErroRestauracao) return { ok: false, codigo: e.codigo, mensagem: e.message }; throw e; }
}
/** Devolve o estado anterior à última restauração, COMO ESTAVA (mesmo se inconsistente). Não mostra nem baixa dados. */
export async function desfazerUltimaRestauracao() {
  const { c, doc, admin } = await prepararDesfazer();
  const desfazivel = (await ler("usuarios")).some(adminUtilizavel); // o estado substituído também poderá ser recuperado?
  const nova = await guardarCopia({ restauracao: { sem_login: !admin, desfazer: true } }); // o desfazer também pode ser desfeito
  await aplicar(doc.tabelas, { substituirUsuarios: "usuarios" in doc.tabelas, config: "substituir", adminValido: adminUtilizavel,
    resumo: `Restauração desfeita${admin ? "" : " sem login"}: estado de ${c.criado_em} recuperado; cópia do estado substituído guardada` });
  await registrarEstadoApos(nova.id, { desfazivel });
  sair();
  return { recuperado: c.criado_em, inconsistente: !!c.inconsistente };
}

// ---------- cópia de emergência (D5) e estado atual ----------
/** Baixa uma cópia do estado atual antes de restaurar. Não grava nada (nem auditoria). Exige administrador autenticado. */
export async function exportarCopiaEmergencia() {
  exigir("dados.gerir");
  const { texto, consistente } = await Bkp.criarValidado();
  const nome = Bkp.nomeArquivo({ prefixo: "salao-gestao-copia-antes-da-restauracao", inconsistente: !consistente });
  Bkp.baixarTexto(texto, nome);
  return { consistente, bytes: texto.length, nome };
}
/** O estado atual passa na validação? (só leitura; usado para avisar na prévia — D2) */
export async function estadoAtualConsistente() { try { return (await Bkp.criarValidado()).consistente; } catch (_) { return null; } }
