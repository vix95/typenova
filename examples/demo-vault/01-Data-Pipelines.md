# Data Pipelines

Reliable models start with reliable data. This note describes the ingestion path and the checks that protect it.

## Ingestion

Raw events arrive from services, files and third-party APIs. They are validated at the edge so that bad records never reach storage.

### Batch ingestion

Nightly jobs load large files, deduplicate them and write partitioned tables.

### Streaming ingestion

Events are consumed continuously and written with an event-time watermark, which keeps late data from silently changing finished results.

## Validation

Every batch is checked against a schema and against simple statistical expectations.

```python
def validate(batch, schema):
    missing = [c for c in schema.required if c not in batch.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")
    if batch["user_id"].isna().mean() > 0.01:
        raise ValueError("too many null user_id values")
    return batch
```

### Freshness checks

A table is *fresh* when its newest partition is younger than the agreed limit. Stale inputs are the most common silent failure; see [[Drift Detection]] for the downstream symptom.

## Storage layout

| Layer | Content | Retention |
|---|---|---|
| Bronze | Raw, immutable events | 1 year |
| Silver | Cleaned and deduplicated | 2 years |
| Gold | Aggregates used by [[Feature Engineering]] | 3 years |

## Reproducibility

Pipelines are versioned together with their configuration, so that a training set can be rebuilt exactly as it was.
