# API catalog data

Everything the API RAG answers from. One directory per package, four files each:

| file | what it is | who decides |
|---|---|---|
| `baseline.json` | every symbol, member, signature, doc and alias, straight out of the installed package | what **exists** |
| `search.json` | one `verb + object + context` sentence per retrievable key | what is **recallable** |
| `search-vectors.f32` | the SearchDoc matrix, raw little-endian Float32, one row per `search.json` key in order | — |
| `search-vectors.index.json` | row order, vector width and the model digest the matrix was built with | — |

The Baseline is the only authority on existence. The Search Catalog may only change ranking, and
its keys are proven resolvable against the Baseline at startup.

## Regenerating

```sh
npm run build:search-vectors     # after any search.json change
```

`search.json` is hand-reviewed; `baseline.json`, `search-vectors.f32` and the index are generated
and never edited by hand. A generated file that disagrees with its input is a startup failure, not
a warning: the loader checks the row count, the row order, the width against the embedding model
and the model's SHA-256 against `data/models/all-MiniLM-L6-v2`.

Sentence rules for `search.json`: lowercase ASCII, one verb in the active voice, a noun-phrase
object, no `the` (except the fixed `the x axis` / `the y axis` / `the z axis` roles), four to
sixteen words, no punctuation, one purpose per sentence, and no parameter names, types or paths.
