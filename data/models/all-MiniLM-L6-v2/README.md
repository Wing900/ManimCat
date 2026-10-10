# all-MiniLM-L6-v2 (INT8)

Local model files for the API RAG search layer. The product reads them from here and
never contacts the network: `loadMiniLmRuntime` sets `allowRemoteModels = false`.

| field | value |
|---|---|
| source | https://huggingface.co/Xenova/all-MiniLM-L6-v2 |
| revision | `751bff37182d3f1213fa05d7196b954e230abad9` |
| upstream | sentence-transformers/all-MiniLM-L6-v2 |
| graph | `onnx/model_quantized.onnx` (dtype `q8`, 22.97 MB) |
| dimensions | 384 |
| runtime | `onnxruntime-web` 1.30.0 (wasm backend) + `@huggingface/tokenizers` 0.2.0 |

Inference contract, so the vectors stay reproducible:

```
new Tokenizer(tokenizer.json, tokenizer_config.json)      # WordPiece, [CLS] text [SEP]
InferenceSession.create('onnx/model_quantized.onnx', { executionProviders: ['wasm'] })
one row per session.run                                    # see below
mean pooling over the attention mask, then L2 normalize
```

One row per `session.run` is required, not an optimisation: the INT8 graph quantizes its
activations per call, so a row's vector moves with the rows beside it. The same text scores
0.9948 against itself in a batch of 2, 0.9879 in a batch of 24, and 1.000000 alone.

## Documents are committed, queries are not

The 1352 SearchDoc sentences are encoded once, offline, and committed next to their catalogs:
`data/api-catalog/<package>/search-vectors.f32` plus the index that pins the row order, the
width and this model's SHA-256. Startup reads that matrix (105 ms instead of 7484 ms); the
runtime encodes only the one query, which is why the model files are still needed.

Rebuild it after any change to a `search.json`, to this model or to the inference path:

```
npm run build:search-vectors
```

The loader refuses to start on a row-count, row-order, width or model mismatch, so documents
and queries cannot quietly end up in different vector spaces.

| file | bytes |
|---|---|
| `config.json` | 650 |
| `tokenizer.json` | 711661 |
| `tokenizer_config.json` | 366 |
| `special_tokens_map.json` | 125 |
| `onnx/model_quantized.onnx` | 22972370 |

Files were fetched once with `curl` from the revision above; a runtime download path is
deliberately absent, so a missing file is a startup failure rather than a slow request.
