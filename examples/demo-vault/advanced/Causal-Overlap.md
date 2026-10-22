# Causal Overlap

Before estimating a treatment effect, check that treated and untreated units are comparable. Overlap (positivity) is the condition that makes that comparison possible.

## The overlap condition

For every covariate profile $x$, the probability of receiving treatment must be strictly between 0 and 1: $0 < e(x) = P(T=1 \mid X=x) < 1$.

### Propensity scores

Estimate $e(x)$ with a well-calibrated classifier; a poorly calibrated score hides violations. Calibration is discussed in [[Calibration]].

### Diagnosing violations

Plot the score distribution of both groups. Regions where only one group appears have no usable comparison.

## Trimming

Drop units with extreme scores, but remember that this changes the population you are describing: the estimate now refers to the *overlap population*, not to everyone.

### Choosing the cut-off

A common rule keeps $0.1 \le e(x) \le 0.9$. Report how many units were removed.

## Estimands

State the estimand explicitly: the average effect for everyone, for the treated, or for the overlap population. Each answers a different question.

## Relation to modelling

Uplift models inherit the same assumption. Evaluate them with the care described in [[Slice analysis]].
