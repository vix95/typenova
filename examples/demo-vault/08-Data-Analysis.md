# Data Analysis

Three small data files live in `data/`: orders of an imaginary shop, a history of model training runs and the readings of a building's sensors. Open any of them with **Data view…** in the file tree's menu (or the command palette) to see a table, the profile of every column and charts of the whole file. The charts below are drawn from those files by `chart` blocks, so they are always as current as the data.

## Orders

`data/orders.csv` has semicolons, decimal commas and some empty cells (a missing discount is normal, a missing amount is not).

```chart
file: data/orders.csv
type: bar
x: country
y: amount
agg: sum
top: 8
title: Revenue by country
```

Revenue over time, summed per month:

```chart
file: data/orders.csv
type: line
x: order_date
y: amount
agg: sum
by: month
title: Revenue per month
```

Most orders are small, a few are large, which is why the distribution has a long tail:

```chart
file: data/orders.csv
type: histogram
x: amount
bins: 30
title: Distribution of the order amount
```

Average order by plan:

```chart
file: data/orders.csv
type: bar
x: plan
y: amount
agg: mean
title: Average order amount by plan
```

## Model runs

`data/model-runs.csv` is a training history, see [[03-Model-Training.md#Model Training]]. The learning rate matters: validation loss is lowest around 4e-3 and grows on both sides.

```chart
file: data/model-runs.csv
type: scatter
x: learning_rate
y: val_loss
title: Validation loss against learning rate
```

```chart
file: data/model-runs.csv
type: bar
x: model
y: accuracy
agg: mean
title: Mean accuracy by model
```

## Sensor readings

`data/sensor-readings.txt` is a plain text file with a pipe as the delimiter, so it also opens as data. Faulty readings have an empty temperature, which the charts leave out and say so.

```chart
file: data/sensor-readings.txt
type: line
x: timestamp
y: temperature_c
agg: mean
by: day
title: Mean temperature per day
```

## Writing your own

A block names the file relative to this note and the columns by name (or `#3` for the third column):

````
```chart
file: data/orders.csv
type: bar          # bar, line, histogram or scatter
x: country
y: amount
agg: sum           # count, sum, mean, min or max
top: 8
```
````

In the data view, the **Charts** tab builds such a block for you: choose the columns and press **Insert into note**.

See also [[06-Monitoring.md#Monitoring]] for what to do when a chart like these starts to drift.
