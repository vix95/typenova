# ML Systems Handbook

A small, self-contained knowledge base used to demonstrate TypeNova. Every note is plain Markdown; the graph, the outline and the preview are all derived from these files.

## How to read this vault

Start with [[Data Pipelines]], continue through [[Feature Engineering]] and [[Model Training]], then see how a model reaches users in [[Deployment]] and stays healthy in [[Monitoring]].

### Notation

Vectors are written in bold, for example $\mathbf{x} \in \mathbb{R}^d$, and the loss of a model $f_\theta$ on a dataset $\mathcal{D}$ is $L(\theta) = \frac{1}{|\mathcal{D}|}\sum_{(x,y)\in\mathcal{D}} \ell(f_\theta(x), y)$.

### Conventions

- Notes link to **sections**, not only to files: `[[Drift Detection]]` points at one heading.
- Every figure lives in `assets/`.

## Map of the vault

| Note | Question it answers |
|---|---|
| Data Pipelines | Where does the data come from and how is it kept reliable? |
| Feature Engineering | How is raw data turned into signal? |
| Model Training | How are parameters fitted and tuned? |
| Evaluation | How do we know the model is good enough? |
| Deployment | How does the model reach production safely? |
| Monitoring | How do we notice when it stops working? |
| Retrieval and RAG | How does a model use external knowledge? |

## Further reading

Advanced topics live in the `advanced/` folder: [[Embedding Drift]] and [[Causal Overlap]].
