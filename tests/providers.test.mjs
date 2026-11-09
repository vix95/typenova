import test from "node:test";
import assert from "node:assert/strict";

const providers = () => import("../.test-build/ai/providers.js");

test("every provider has what the interface and the backend need", async () => {
  const p = await providers();
  const ids = p.AI_PROVIDERS.map(info => info.id);
  assert.deepEqual(ids, ["anthropic", "openai", "gemini", "ollama", "custom"]);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  assert.equal(p.AI_PROVIDERS.filter(info => info.isDefault).length, 1, "exactly one provider is the default");
  for (const info of p.AI_PROVIDERS) {
    assert.ok(["anthropic", "openai", "gemini", "ollama"].includes(info.adapter), `${info.id} has an adapter the backend knows`);
    assert.ok(info.name && info.taglinePl && info.taglineEn && info.tooltipPl && info.tooltipEn, `${info.id} has names and texts in both languages`);
    if (info.url === "required") assert.equal(info.defaultUrl, "", `${info.id} has no default address to fall back to`);
    if (info.key !== "none") assert.ok(p.keySecretName(info.id), `${info.id} has a place for its key`);
  }
  assert.equal(p.AI_PROVIDERS.find(info => info.id === "anthropic").models, "fixed");
});

test("a stored provider is parsed, the default one stands in for anything else", async () => {
  const p = await providers();
  assert.equal(p.parseProvider("gemini"), "gemini");
  assert.equal(p.parseProvider("custom"), "custom");
  assert.equal(p.parseProvider("anything"), "anthropic");
  assert.equal(p.parseProvider(null), "anthropic");
  assert.equal(p.providerName("ollama"), "Ollama");
  assert.equal(p.providerName("openai"), "OpenAI");
});

test("a key is kept under the name of its provider, and a provider without a key has none", async () => {
  const p = await providers();
  assert.equal(p.keySecretName("anthropic"), "anthropic-api-key");
  assert.equal(p.keySecretName("openai"), "openai-api-key");
  assert.equal(p.keySecretName("gemini"), "gemini-api-key");
  assert.equal(p.keySecretName("custom"), "custom-api-key");
  assert.equal(p.keySecretName("ollama"), null);
});

test("Claude starts with its default model and the others wait for their list", async () => {
  const p = await providers();
  assert.equal(p.defaultModel("anthropic"), "claude-opus-5-5");
  assert.equal(p.defaultModel("openai"), "");
  assert.ok(p.fixedModels("anthropic").length >= 3);
  assert.deepEqual(p.fixedModels("gemini"), []);
});

test("the model chosen from a list is a preferred one, else the first", async () => {
  const p = await providers();
  assert.equal(p.pickModel(["gpt-4o", "gpt-5", "o3"], ["gpt-5", "gpt-4.1"]), "gpt-5");
  assert.equal(p.pickModel(["a", "gpt-5-mini"], ["gpt-5"]), "gpt-5-mini", "a name that starts with the preferred one");
  assert.equal(p.pickModel(["b", "a"], ["zzz"]), "b", "the first one when none is preferred");
  assert.equal(p.pickModel(["gpt-4o", "gpt-5-mini", "gpt-5"], ["gpt-5", "gpt-4o"]), "gpt-5", "the first preference wins over a later one");
  assert.equal(p.pickModel(["gpt-4o", "gpt-5-mini", "gpt-5-nano"], ["gpt-5", "gpt-4o"]), "gpt-5-mini", "a family name gives its shortest model");
  assert.equal(p.pickModel([], ["gpt-5"]), "");
  assert.equal(p.pickModel(["x"], []), "x");
});

test("an address is normalised, empty gives the fallback, anything else that is not an address is refused", async () => {
  const p = await providers();
  assert.equal(p.normalizeUrl("  ", "http://localhost:11434"), "http://localhost:11434");
  assert.equal(p.normalizeUrl("", ""), "");
  assert.equal(p.normalizeUrl(" http://192.168.0.5:11434/ ", "x"), "http://192.168.0.5:11434");
  assert.equal(p.normalizeUrl("https://openrouter.ai/api/v1/", "x"), "https://openrouter.ai/api/v1");
  assert.equal(p.normalizeUrl("localhost:11434", "x"), null);
  assert.equal(p.normalizeUrl("ftp://host", "x"), null);
  assert.equal(p.normalizeUrl("http://a b", "x"), null);
});

test("a stored key is masked except for its last characters", async () => {
  const p = await providers();
  assert.equal(p.maskedKey("WXYZ"), "••••••••••••••••WXYZ");
  assert.equal(p.maskedKey(""), "••••••••••••••••");
});

test("a chosen model that the provider no longer lists stays in the list, flagged", async () => {
  const p = await providers();
  assert.deepEqual(p.modelChoices(["a", "b"], "b"), [{ name: "a", available: true }, { name: "b", available: true }]);
  assert.deepEqual(p.modelChoices(["a"], "gone"), [{ name: "gone", available: false }, { name: "a", available: true }]);
  assert.deepEqual(p.modelChoices([], ""), []);
});

test("readiness says what is missing first", async () => {
  const p = await providers();
  const info = id => p.providerInfo(id);
  assert.equal(p.readiness(info("anthropic"), { hasKey: false, url: "", model: "claude-opus-5-5" }), "no_key");
  assert.equal(p.readiness(info("anthropic"), { hasKey: true, url: "", model: "claude-opus-5-5" }), "ready");
  assert.equal(p.readiness(info("openai"), { hasKey: true, url: "", model: "" }), "no_model");
  assert.equal(p.readiness(info("ollama"), { hasKey: false, url: "http://localhost:11434", model: "" }), "no_model", "Ollama has no key to miss");
  assert.equal(p.readiness(info("ollama"), { hasKey: false, url: "http://localhost:11434", model: "llama3.2" }), "ready");
  assert.equal(p.readiness(info("custom"), { hasKey: false, url: "", model: "m" }), "no_url");
  assert.equal(p.readiness(info("custom"), { hasKey: false, url: "http://localhost:1234/v1", model: "m" }), "ready", "the key of a service of your own is optional");
});
