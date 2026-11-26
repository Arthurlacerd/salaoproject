# Fixtures de teste

`backup-9x.salaobackup` (opcional) — um backup **real** exportado pelo Salão.gestão 9.x (servidor Flask).

Não há nenhum no repositório: o teste `tests/unit/backup.test.js › 9.x real` fica marcado como *ignorado* até que um seja
adicionado. Para ativá-lo:

1. exporte um backup no 9.x de uma base de **teste** (ou anonimize: troque nomes, telefones e observações);
2. **não altere** o arquivo à mão depois de exportado (o checksum SHA-256 deixaria de conferir);
3. salve como `tests/fixtures/backup-9x.salaobackup` e rode `npm run test:unit`.

Nunca coloque aqui um backup com dados reais de clientes: este repositório é publicado no GitHub Pages.
