# Feature Engineering

Features are where domain knowledge enters a model. They are computed from the Gold layer described in [[Storage layout]].

## Numeric features

Scale-sensitive models need standardised inputs: $z = \frac{x - \mu}{\sigma}$, with $\mu$ and $\sigma$ estimated on the training split only.

### Skewed distributions

For heavy-tailed values a logarithm often stabilises variance: $x' = \log(1 + x)$.

### Missing values

Impute with a documented rule and add an indicator column, so that the model can learn from the absence itself.

## Categorical features

Low-cardinality columns are one-hot encoded. High-cardinality columns use target statistics computed inside cross-validation folds to avoid leakage.

### Leakage

A feature is leaky when it contains information that is not available at prediction time. Leakage is the most common reason why offline metrics in [[Evaluation]] do not survive [[Deployment]].

## Time-based features

Rolling windows summarise recent behaviour: counts, means and the time since the last event.

```python
def rolling_mean(series, window="7D"):
    return series.rolling(window, closed="left").mean()
```

## Feature store

Shared definitions are served consistently to training and to online prediction, which removes training/serving skew. Freshness is monitored in [[Freshness checks]].
