// Responsivo: as telas principais (incluindo as alteradas na 11.2: Diagnóstico e Manutenção) sem rolagem horizontal,
// em 9 larguras. Capturas em tests/e2e/saida/ (fora do git) para revisão visual.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { semNavegador, versaoAtual, servidor, navegador, abrir, configurarAdmin, semear, limpar, gravarSaida, SAIDA } from "./_ambiente.js";

export const LARGURAS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const ROTAS = ["hoje", "agenda", "clientes", "financeiro", "despesas", "dados", "config", "manutencao", "diagnostico", "sobre", "instalar"];
let dir, srv, nav, ctx, page; const resultado = [];
before(async () => { if (semNavegador) return; dir = versaoAtual(); srv = await servidor(dir); nav = await navegador(); ctx = await nav.newContext({ viewport: { width: 390, height: 844 } }); page = await ctx.newPage(); await abrir(page, srv.url); await configurarAdmin(page); await semear(page); mkdirSync(path.join(SAIDA, "telas"), { recursive: true }); });
after(async () => { if (semNavegador) return; gravarSaida("responsivo.json", resultado); await nav.close(); await srv.fechar(); limpar(dir); });
const excesso = () => page.evaluate(() => { const w = document.documentElement.clientWidth, maiores = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== "fixed").slice(0, 3).map((e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "")); return { rolagem: document.documentElement.scrollWidth - w, maiores }; });

for (const w of LARGURAS) test(`responsivo ${w}px: sem rolagem horizontal nas ${ROTAS.length} telas`, { skip: semNavegador }, async () => {
  await page.setViewportSize({ width: w, height: w < 768 ? 844 : 900 }); const falhas = [];
  for (const r of ROTAS) {
    await page.goto(srv.url + "#/" + r); await page.waitForSelector("#vista > *:not(.skeleton)", { timeout: 15000 }); await page.waitForTimeout(150);
    const e = await excesso(); resultado.push({ largura: w, rota: r, ...e }); if (e.rolagem > 1) falhas.push(`${r}: +${e.rolagem}px (${e.maiores.join(", ")})`);
    if (["hoje", "diagnostico", "manutencao"].includes(r)) await page.screenshot({ path: path.join(SAIDA, "telas", `${w}-${r}.png`) });
  }
  assert.deepEqual(falhas, []);
});
