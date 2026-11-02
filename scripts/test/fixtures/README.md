# Test fixtures

`repo/` is a tiny copy of the repository layout (`src/content/…`, `src/data/sito.json`) in the exact
format the admin writes. `admin-store.test.mjs` seeds the mock GitHub API with it and
`admin-model.test.mjs` round-trips its files.

It is deliberately **not** the live `src/content`: Tiziana's admin changes that every day and Deploy runs
`npm test` before every build, so a test that depended on it would block publishing after her first save.
The tests derive their expected values from these files; the photos are 9-byte stand-ins (never decoded).

`repo/src/content/opere/guardami/opera.json` deliberately has **no `colore` key**: it stands for a file saved by an older
admin, before the field existed (CONTRACTS.md §4.1). The admin must read it as `colore: null` and write the
key on the next save. Keep one such work when you edit the fixture.
