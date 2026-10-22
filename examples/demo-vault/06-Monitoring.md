# Monitoring

Models degrade silently. Monitoring turns that silence into signals somebody can act on.

## What to monitor

Three layers matter: system health, data quality and model quality.

### System health

Latency, error rate and throughput, exactly as for any other service.

### Data quality

Null rates, ranges and category frequencies of the inputs. A change here usually appears first.

### Model quality

Outcome labels often arrive late. Track proxy metrics immediately and the real metrics when labels are available.

## Drift Detection

Drift means that the data seen in production differs from the data seen in training.

### Covariate drift

The input distribution changes. A simple score is the population stability index:

$$\text{PSI} = \sum_i (p_i - q_i)\,\ln\frac{p_i}{q_i}$$

where $p_i$ and $q_i$ are the shares of bin $i$ in production and in training.

### Concept drift

The relationship between inputs and the target changes. It can only be confirmed with fresh labels; see [[Offline versus online]].

### Embedding-based drift

For text and images, monitor the distribution of embeddings as described in [[Embedding Drift]].

## Alerting

Alert on symptoms users feel, and keep every alert actionable.

| Severity | Condition | Action |
|---|---|---|
| Page | Error rate above 2% for 5 minutes | Roll back |
| Ticket | PSI above 0.2 | Investigate data |
| Info | Input volume changed by 30% | Review at stand-up |

## Retraining

Retrain on a schedule or when a trigger fires, and always compare the new model with the current one through the process in [[Evaluation workflow]].
