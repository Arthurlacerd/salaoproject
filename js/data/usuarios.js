import { transacao, ler, agora, auditar, sessao, definirConfig } from "./database.js";
import { exigir } from "./permissoes.js";
const ITER = 150000, enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derivar(senha, sal, iter) {
  const k = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iter }, k, 256);
}
export async function hashSenha(senha) { const sal = crypto.getRandomValues(new Uint8Array(16)); return `pbkdf2$${ITER}$${b64(sal)}$${b64(await derivar(senha, sal, ITER))}`; }
export async function conferir(senha, h) { const [, it, sal, hash] = h.split("$"); return b64(await derivar(senha, deb64(sal), +it)) === hash; }
const publico = (u) => ({ id: u.id, usuario: u.usuario, nome: u.nome, perfil: u.perfil, ativo: u.ativo });
export async function existeAlgum() { return (await ler("usuarios")).length > 0; }
export function validarSenha(s) { return (s || "").length >= 8 ? null : "A senha precisa ter pelo menos 8 caracteres."; }
export async function configurarPrimeiro({ nome, usuario, senha, salao }) {
  const e = validarSenha(senha); if (e) throw new Error(e);
  if ((nome || "").trim().length < 2) throw new Error("Informe seu nome.");
  const h = await hashSenha(senha);
  const id = await transacao(["usuarios", "auditoria"], "readwrite", async (t) => {
    if ((await t.usuarios.contar()) > 0) throw new Error("O aplicativo já foi configurado.");
    const id = await t.usuarios.adicionar({ usuario: (usuario || "admin").trim().toLowerCase(), nome: nome.trim(), perfil: "admin", senha_hash: h, ativo: 1, criado_em: agora() });
    sessao.usuario = { id, nome: nome.trim(), perfil: "admin" }; await auditar(t, "criacao", "usuario", id, "Administrador criado (primeiro acesso)"); return id;
  });
  if (salao) await definirConfig("nome_sistema", salao.trim().slice(0, 40));
  return entrar((usuario || "admin"), senha);
}
const TENT = { n: 0, ate: 0 };
export async function entrar(usuario, senha) {
  if (Date.now() < TENT.ate) throw new Error("Muitas tentativas. Aguarde um minuto e tente de novo.");
  const u = (await ler("usuarios")).find((x) => x.usuario === (usuario || "").trim().toLowerCase());
  const ok = u && u.ativo && (await conferir(senha, u.senha_hash));
  if (!ok) { if (++TENT.n >= 5) { TENT.ate = Date.now() + 60000; TENT.n = 0; } throw new Error("Usuário ou senha incorretos."); }
  TENT.n = 0; sessao.usuario = publico(u); sessionStorage.setItem("salao_sessao", String(u.id));
  await transacao(["usuarios"], "readwrite", async (t) => { const x = await t.usuarios.get(u.id); x.ultimo_acesso = agora(); await t.usuarios.salvar(x); });
  return sessao.usuario;
}
export async function restaurarSessao() {
  const id = +sessionStorage.getItem("salao_sessao"); if (!id) return null;
  const u = (await ler("usuarios")).find((x) => x.id === id); if (!u || !u.ativo) { sessionStorage.removeItem("salao_sessao"); return null; }
  sessao.usuario = publico(u); return sessao.usuario;
}
export function sair() { sessao.usuario = null; sessionStorage.removeItem("salao_sessao"); }
export async function listar() { exigir("usuarios.gerir"); return (await ler("usuarios")).map(publico); }
export async function criar({ nome, usuario, perfil, senha }) {
  exigir("usuarios.gerir"); const e = validarSenha(senha); if (e) throw new Error(e);
  usuario = (usuario || "").trim().toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(usuario)) throw new Error("Usuário: 3 a 30 letras minúsculas, números, . ou _.");
  if (!["recepcao", "funcionario"].includes(perfil)) throw new Error("Escolha um perfil.");
  if ((nome || "").trim().length < 2) throw new Error("Informe o nome.");
  const h = await hashSenha(senha);
  return transacao(["usuarios", "auditoria"], "readwrite", async (t) => {
    if ((await t.usuarios.todos()).some((x) => x.usuario === usuario)) throw new Error("Já existe um usuário com esse nome.");
    const id = await t.usuarios.adicionar({ usuario, nome: nome.trim(), perfil, senha_hash: h, ativo: 1, criado_em: agora() }); await auditar(t, "criacao", "usuario", id, `Usuário criado: ${usuario} (${perfil})`);
  });
}
export async function alternar(id) {
  exigir("usuarios.gerir");
  return transacao(["usuarios", "auditoria"], "readwrite", async (t) => { const u = await t.usuarios.get(id); if (u.id === sessao.usuario.id) throw new Error("Você não pode desativar a si mesma."); u.ativo = u.ativo ? 0 : 1; await t.usuarios.salvar(u); await auditar(t, "edicao", "usuario", id, `Usuário ${u.usuario} ${u.ativo ? "ativado" : "desativado"}`); });
}
export async function redefinirSenha(id, senha) {
  exigir("usuarios.gerir"); const e = validarSenha(senha); if (e) throw new Error(e); const h = await hashSenha(senha);
  return transacao(["usuarios", "auditoria"], "readwrite", async (t) => { const u = await t.usuarios.get(id); u.senha_hash = h; await t.usuarios.salvar(u); await auditar(t, "edicao", "usuario", id, `Senha redefinida: ${u.usuario}`); });
}
export async function alterarMinhaSenha(atual, nova) {
  const e = validarSenha(nova); if (e) throw new Error(e);
  const u = (await ler("usuarios")).find((x) => x.id === sessao.usuario.id);
  if (!(await conferir(atual, u.senha_hash))) throw new Error("Senha atual incorreta.");
  const h = await hashSenha(nova);
  return transacao(["usuarios", "auditoria"], "readwrite", async (t) => { const x = await t.usuarios.get(u.id); x.senha_hash = h; await t.usuarios.salvar(x); await auditar(t, "edicao", "usuario", u.id, "Senha alterada pelo próprio usuário"); });
}
