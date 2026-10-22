# Model Training

Training fits parameters $\theta$ so that the loss $L(\theta)$ defined in [[Notation]] becomes small on unseen data.

## Optimisation

Gradient descent updates the parameters in the direction that reduces the loss:

$$\theta_{t+1} = \theta_t - \eta \, \nabla_\theta L(\theta_t)$$

where $\eta$ is the learning rate.

### Learning-rate schedules

A short warm-up followed by cosine decay is a robust default.

### Mini-batches

Gradients are estimated on small batches, which makes each step cheap and adds helpful noise.

## Regularisation

Regularisation limits model capacity. L2 regularisation adds $\lambda \lVert\theta\rVert_2^2$ to the loss, early stopping ends training when validation loss stops improving.

### Cross-validation

Split the data into $k$ folds, train on $k-1$ and validate on the remaining one; the average score estimates generalisation. Metrics are defined in [[Evaluation]].

## Hyperparameter search

Random search beats a coarse grid when only a few hyperparameters matter. Record every trial so that results can be compared later.

```python
best = None
for trial in range(50):
    params = sample_params()
    score = cross_validate(model(**params), X, y, cv=5).mean()
    if best is None or score > best[0]:
        best = (score, params)
```

## Experiment tracking

Each run stores code version, data version, parameters, metrics and artefacts. A run that cannot be reproduced is not evidence.

- [x] Fix the random seed
- [x] Log the dataset hash
- [ ] Compare against a simple baseline
