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
| runtime | `@huggingface/transformers` 4.3.1, device `cpu` |

Fixed inference parameters, so the vectors stay reproducible:

```
pipeline('feature-extraction', 'all-MiniLM-L6-v2', { dtype: 'q8', device: 'cpu' })
extractor(texts, { pooling: 'mean', normalize: true })
```

| file | bytes |
|---|---|
| `config.json` | 650 |
| `tokenizer.json` | 711661 |
| `tokenizer_config.json` | 366 |
| `special_tokens_map.json` | 125 |
| `onnx/model_quantized.onnx` | 22972370 |

Files were fetched once with `curl` from the revision above; a runtime download path is
deliberately absent, so a missing file is a startup failure rather than a slow request.
