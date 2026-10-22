# Embedding Drift

Embeddings turn text or images into vectors. When the encoder, the data or the preprocessing changes, the vectors move, and retrieval quality moves with them.

## Why centroid shift is not enough

The mean vector can stay put while the shape of the distribution changes: variance grows, clusters split, outliers appear. Comparing only centroids misses these cases.

### A better diagnostic

Compare distributions, not points. Project to a lower dimension, then apply a two-sample test per component, or compare the spectrum of the covariance matrices.

### Practical thresholds

Calibrate alert levels on historical windows, so that normal seasonality does not trigger pages. See [[Alerting]].

## Causes

- The embedding model was upgraded without re-indexing.
- Tokenisation or cleaning changed upstream; compare with [[Validation]].
- The user population shifted.

## Mitigation

Re-embed the corpus when the encoder changes, keep the old and new indexes side by side until quality is confirmed, and gate the switch on the checks in [[Retrieval]].
