# Salão.gestão

Gestão de salão como **PWA 100% local**: agenda, clientes, serviços, financeiro, despesas, usuários com perfis, backup e
auditoria. Os dados ficam **só no aparelho** (IndexedDB), funciona offline e se instala no Android como aplicativo.
Nenhum dado é enviado a servidores.

- **Versão atual:** veja `js/versao.js` (fonte única da versão). Novidades: `docs/CHANGELOG_11_2.md`.
- **Publicado em:** GitHub Pages, a partir da branch `main` (pasta raiz), em `https://<usuario>.github.io/salaoproject/`.

## Estrutura

```
index.html  manifest.webmanifest  sw.js       app publicado (tudo que está aqui e em css/ js/ icons/ fonts/)
css/ js/ icons/ fonts/
js/versao.js        versão, banco, schema, lista de cache e hashes (os dois últimos são GERADOS pelo build)
js/data/            IndexedDB (database, migracoes), backup, manutenção/atualização, diagnóstico, regras de negócio
js/ui/              telas
tools/construir_pwa.py   build + validação
tests/              unitários (node:test) e integração (Chromium/Playwright)
docs/               BUILD.md, PWA_UPDATE_PROCESS.md, CHANGELOG_*.md
```

## Guia rápido

| Quero… | Faça |
|---|---|
| **Desenvolver** | branch nova a partir da `main`; sirva a pasta com um servidor estático (`docs/BUILD.md › Desenvolver`) |
| **Testar** | `npm test` (build + unitários + navegador) ou `npm run test:unit` (sem navegador) |
| **Gerar o build** | `python3 tools/construir_pwa.py` depois de qualquer mudança no app (atualiza a lista de cache e os hashes) |
| **Publicar** | PR da branch para a `main`, com o workflow *Verificar PWA* verde e um merge único (`docs/PWA_UPDATE_PROCESS.md`) |
| **Atualizar (usuário)** | aviso "Nova versão" ou Manutenção › Verificar atualização › **Atualizar agora** (faz backup antes) |
| **Voltar de versão** | Manutenção › Versões disponíveis › Voltar para esta (só versões compatíveis com o banco atual e a partir da 11.3.0) |
| **Restaurar um backup** | Dados e backup › Importar › Verificar arquivo (com login de administrador; se o backup traz usuários, informe um administrador do backup) |
| **Conferir/corrigir dados com data inválida** | Dados e backup › aviso de inconsistência › Revisar registros (ou Diagnóstico › Integridade dos dados), como administrador; nada é corrigido sem confirmação |
| **Desfazer uma restauração** | Dados e backup › Desfazer a última restauração (ou o link na tela de login, enquanto ninguém entrou) |
| **Recuperar uma instalação quebrada** | Diagnóstico; ou o botão **Abrir a versão atual**; ou o endereço com `?recuperar=1` (`docs/PWA_UPDATE_PROCESS.md › 4`) |

## Regras que não se quebram

1. **Nunca** publicar por upload de arquivos no site do GitHub: só por Pull Request com merge único.
2. Código alterado exige **versão nova** em `js/versao.js` e o **build**.
3. **Não** adicionar `"id"` ao manifest nem mudar `start_url`/`scope`: a identidade do app instalado é a da 11.1.
4. O banco **nunca** é apagado nem recriado. Mudança de estrutura só por migration nova e não destrutiva em
   `js/data/migracoes.js`, com `banco`/`schema` atualizados. O build confere.
5. O service worker **nunca** acessa o IndexedDB. O build reprova.
6. O `.salaobackup` baixado é a proteção principal dos dados. As cópias locais não sobrevivem à limpeza dos dados do site.
   A restauração aceita backups de até **30 MB**. O app avisa a partir de 24 MB (veja `docs/PWA_UPDATE_PROCESS.md` › 6).
7. Restaurar nunca pode deixar o aparelho sem administrador: valide tudo antes de gravar, grave numa única transação e
   mantenha a cópia antes da restauração (`js/data/restauracao.js`; regras em `docs/PWA_UPDATE_PROCESS.md › 4b`).
