# ML Systems Handbook

A small, self-contained knowledge base used to demonstrate TypeNova. Every note is plain Markdown; the graph, the outline and the preview are all derived from these files.

## How to read this vault

Start with [[01-Data-Pipelines.md#Data Pipelines]], continue through [[02-Feature-Engineering.md#Feature Engineering]] and [[03-Model-Training.md#Model Training]], then see how a model reaches users in [[05-Deployment.md#Deployment]] and stays healthy in [[06-Monitoring.md#Monitoring]].

### Notation

Vectors are written in bold, for example $\mathbf{x} \in \mathbb{R}^d$, and the loss of a model $f_\theta$ on a dataset $\mathcal{D}$ is $L(\theta) = \frac{1}{|\mathcal{D}|}\sum_{(x,y)\in\mathcal{D}} \ell(f_\theta(x), y)$.

### Conventions

- Notes link to **sections**, not only to files: `[[06-Monitoring.md#Drift Detection]]` names the file and the header it points at. Type `[[` to pick the file, then the section. Rename a header and every such link follows it.
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

Advanced topics live in the `advanced/` folder: [[Embedding-Drift.md#Embedding Drift]] and [[Causal-Overlap.md#Causal Overlap]].
