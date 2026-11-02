# Test fixtures

`repo/` is a tiny copy of the repository layout (`src/content/…`, `src/data/sito.json`) in the exact
format the admin writes. `admin-store.test.mjs` seeds the mock GitHub API with it and
`admin-model.test.mjs` round-trips its files.

It is deliberately **not** the live `src/content`: Tiziana's admin changes that every day and Deploy runs
`npm test` before every build, so a test that depended on it would block publishing after her first save.
The tests derive their expected values from these files; the photos are 9-byte stand-ins (never decoded).
