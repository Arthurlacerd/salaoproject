// Ambiente dos testes de integração: servidor estático que imita o GitHub Pages (app em /salaoproject/, Cache-Control
// max-age=600) + Chromium via Playwright. Cada teste usa um perfil de navegador NOVO e descartável: nenhum dado real é tocado.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SAIDA = path.join(RAIZ, "tests/e2e/saida"); // capturas e medidas (ignorado pelo git)
export const PASTA = "/salaoproject/";
// 11.1.0 publicada (commit b8061f2). Pode ser trocada por outra referência git com SALAO_REF_ANTERIOR.
export const REF_ANTERIOR = process.env.SALAO_REF_ANTERIOR || "b8061f2adda083ff76476e10196960105a4b6813";

let pw = null; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) {}
/** Motivo para pular os testes de navegador (Playwright/Chromium ausente), ou false. */
export const semNavegador = pw ? false : "Playwright não disponível (veja docs/BUILD.md › Testes de integração)";

const TIPOS = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", webmanifest: "application/manifest+json", png: "image/png", woff: "font/woff", json: "application/json", txt: "text/plain; charset=utf-8" };
const ARQ_APP = ["index.html", "manifest.webmanifest", "sw.js", ".nojekyll", "css", "js", "icons", "fonts"];

/** Cópia dos arquivos do app da árvore de trabalho atual (a versão em teste). */
export function versaoAtual() {
  const d = mkdtempSync(path.join(tmpdir(), "salao-atual-"));
  for (const f of ARQ_APP) if (existsSync(path.join(RAIZ, f))) cpSync(path.join(RAIZ, f), path.join(d, f), { recursive: true });
  return d;
}
/** A referência git existe neste clone? (síncrono: usado para decidir, ao registrar o teste, se ele roda ou é pulado) */
export function refExiste(ref) { try { execSync(`git cat-file -e ${ref}^{commit}`, { cwd: RAIZ, stdio: "ignore" }); return true; } catch (_) { return false; } }
/** Arquivos do app numa referência git (ex.: a 11.1.0 publicada). Devolve null se a referência não existir neste clone. */
export function versaoGit(ref = REF_ANTERIOR) {
  try { execSync(`git cat-file -e ${ref}^{commit}`, { cwd: RAIZ, stdio: "ignore" }); } catch (_) { return null; }
  const d = mkdtempSync(path.join(tmpdir(), "salao-ref-"));
  execSync(`git archive ${ref} | tar -x -C "${d}"`, { cwd: RAIZ, shell: "/bin/bash" });
  return d;
}
export const limpar = (...ds) => ds.forEach((d) => d && rmSync(d, { recursive: true, force: true }));

/** Servidor estático: troca de pasta servida (simula publicação) e sobreposição de arquivos (simula CDN desatualizada). */
export function servidor(raizInicial) {
  let raiz = raizInicial; const sobre = new Map(), log = [];
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x"); log.push(u.pathname);
    if (!u.pathname.startsWith(PASTA)) { res.writeHead(404).end("fora do app"); return; }
    let rel = decodeURIComponent(u.pathname.slice(PASTA.length)) || "index.html"; if (rel.endsWith("/")) rel += "index.html";
    const corpo = sobre.has(rel) ? sobre.get(rel) : (() => { const f = path.join(raiz, rel); return f.startsWith(raiz) && existsSync(f) && !f.endsWith("/") ? (() => { try { return readFileSync(f); } catch { return null; } })() : null; })();
    if (corpo == null) { res.writeHead(404, { "Content-Type": "text/html" }).end("<h1>404</h1>"); return; }
    res.writeHead(200, { "Content-Type": TIPOS[rel.split(".").pop()] || "application/octet-stream", "Cache-Control": "max-age=600" }).end(corpo);
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok({
    url: `http://127.0.0.1:${srv.address().port}${PASTA}`, log,
    publicar(d) { raiz = d; }, sobrepor(rel, bytes) { if (bytes == null) sobre.delete(rel); else sobre.set(rel, bytes); },
    fechar: () => new Promise((f) => srv.close(f)),
  })));
}

export async function navegador() { return pw.chromium.launch(); }

/** Abre o app e espera o service worker controlar a página. */
export async function abrir(page, url) {
  await page.goto(url); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
}
/** Primeiro acesso pela interface: cria a administradora e entra (credenciais configuráveis: "outro aparelho"). */
export async function configurarAdmin(page, { usuario = "admin", senha = "senha-de-teste-123", nome = "Admin Teste", salao = "Salão Teste" } = {}) {
  await page.waitForSelector('form#f input[name="senha"]');
  if (await page.$('input[name="salao"]')) await page.fill('input[name="salao"]', salao);
  if (await page.$('input[name="nome"]')) await page.fill('input[name="nome"]', nome);
  await page.fill('input[name="usuario"]', usuario); await page.fill('input[name="senha"]', senha);
  await page.click('form#f button[type="submit"]'); await page.waitForSelector("#vista");
}
export async function entrar(page) {
  if (await page.$("#vista")) return; await page.waitForSelector('form#f input[name="senha"]');
  await page.fill('input[name="usuario"]', "admin"); await page.fill('input[name="senha"]', "senha-de-teste-123"); await page.click('form#f button[type="submit"]'); await page.waitForSelector("#vista");
}
/** Dados de teste realistas, gravados pelas funções do próprio app (mesmas regras de validação). */
export const DADOS = { nome: "Maria Teste da Silva", telefone: "(11) 98888-7777", valor: 12345, despesa: "Shampoo profissional" };
export async function semear(page) {
  return page.evaluate(async (D) => {
    const Cli = await import("./js/data/clientes.js"), Agd = await import("./js/data/agenda.js"), Fin = await import("./js/data/financeiro.js");
    const cid = await Cli.salvar({ nome: D.nome, telefone: D.telefone });
    const aid = await Agd.salvar({ cliente_id: cid, data: "2026-11-20", horario_agendado: "10:00", servico: "Corte e escova", valor_centavos: D.valor, forma_pagamento: Agd.FORMAS[0] });
    await Fin.registrarPagamento(aid, "recebimento", 5000, "Pix", "2026-11-20");
    await Fin.salvarDespesa({ descricao: D.despesa, categoria: "Outras despesas", data: "2026-11-10", valor_centavos: 4321 });
    return { cid, aid };
  }, DADOS);
}
/** Estado dos dados (contagens + um registro conhecido) — usado para provar que nada se perdeu. */
export async function estadoDados(page) {
  return page.evaluate(async () => {
    const { ler } = await import("./js/data/database.js"), out = {};
    for (const t of ["clientes", "atendimentos", "pagamentos", "despesas", "usuarios", "servicos"]) out[t] = (await ler(t)).length;
    const c = (await ler("clientes"))[0], a = (await ler("atendimentos"))[0];
    out.cliente = c && { nome: c.nome, telefone: c.telefone }; out.atendimento = a && { valor: a.valor_centavos, recebido: a.valor_recebido_centavos };
    out.backups = (await ler("backups")).map((b) => b.motivo); out.versao = globalThis.SALAO_VERSAO.versao;
    out.schema = (await ler("config")).find((x) => x.chave === "schema_versao")?.valor; out.migracoes = JSON.parse((await ler("config")).find((x) => x.chave === "historico_migracoes")?.valor || "[]").length;
    return out;
  });
}
export const caches = (page) => page.evaluate(async () => (await caches.keys()).sort());
/** Versão em teste (js/versao.js da árvore atual) — os testes não fixam mais o número da versão. */
export const VERSAO = JSON.parse(readFileSync(path.join(RAIZ, "js/versao.js"), "utf8").match(/SALAO_VERSAO\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)[1]).versao;
/** Login pela tela (o mesmo caminho do usuário: passa por iniciarSessao). */
export async function entrarUI(page, usuario = "admin", senha = "senha-de-teste-123") {
  await page.goto(page.url().split("#")[0] + "#/"); await page.waitForSelector('form#f input[name="senha"]');
  await page.fill('input[name="usuario"]', usuario); await page.fill('input[name="senha"]', senha); await page.click('form#f button[type="submit"]'); await page.waitForSelector("#vista");
}
/** "Impressão digital" do estado: checksum de TODAS as tabelas do backup + cópias locais + usuários. Para provar que nada mudou. */
export async function impressao(page) {
  return page.evaluate(async () => {
    const B = await import("./js/data/backup.js"), D = await import("./js/data/database.js");
    return { sha: (await B.montar()).sha256, copias: (await D.ler("backups")).map((b) => b.id), usuarios: (await D.ler("usuarios")).map((u) => u.usuario).sort() };
  });
}
export function gravarSaida(nome, dados) { mkdirSync(SAIDA, { recursive: true }); writeFileSync(path.join(SAIDA, nome), typeof dados === "string" ? dados : JSON.stringify(dados, null, 2)); }
