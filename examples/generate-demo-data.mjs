// Writes the sample data of the demo vault (examples/demo-vault/data): three files for the data view and the chart blocks.
// Deterministic: the same command always gives the same files.   node examples/generate-demo-data.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "demo-vault", "data");
fs.mkdirSync(out, { recursive: true });

let state = 20261111;
const random = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
const pick = (items, weights) => { let r = random() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; } return items[items.length - 1]; };
const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const pad = n => String(n).padStart(2, "0");
const day = offset => { const d = new Date(Date.UTC(2024, 0, 1) + offset * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

// 1. orders.csv: semicolons, decimal commas, some empty cells, a trend and a yearly season.
{
  const countries = ["PL", "DE", "CZ", "FR", "GB", "US", "ES", "NL"], share = [34, 20, 9, 9, 8, 8, 6, 6];
  const channels = ["web", "mobile", "partner"], plans = ["basic", "pro", "team"];
  const lines = ["order_id;order_date;country;channel;plan;quantity;amount;discount_pct;paid"];
  for (let i = 1; i <= 8000; i++) {
    const offset = Math.floor(random() * 700), season = 1 + 0.25 * Math.sin((offset / 365) * 2 * Math.PI), trend = 1 + offset / 900;
    const plan = pick(plans, [55, 30, 15]), base = { basic: 29, pro: 79, team: 199 }[plan];
    const quantity = 1 + Math.floor(random() ** 3 * 6);
    const amount = Math.max(5, base * quantity * season * trend * (0.9 + random() * 0.2));
    const discount = random() < 0.7 ? "" : String(pick([5, 10, 15, 20], [40, 30, 20, 10]));
    lines.push([10000 + i, day(offset), pick(countries, share), pick(channels, [50, 35, 15]), plan, quantity, amount.toFixed(2).replace(".", ","), discount, random() < 0.93 ? "tak" : "nie"].join(";"));
  }
  lines.splice(1, 0, ...lines.splice(1).sort((a, b) => a.split(";")[1].localeCompare(b.split(";")[1])));
  fs.writeFileSync(path.join(out, "orders.csv"), lines.join("\n") + "\n");
}

// 2. model-runs.csv: commas, a training history with a clear relation between learning rate, loss and accuracy.
{
  const models = ["baseline-lr", "gbm", "mlp-small", "mlp-large", "transformer-tiny"];
  const lines = ["run_id,date,model,learning_rate,epochs,train_minutes,val_loss,accuracy"];
  for (let i = 1; i <= 400; i++) {
    const model = pick(models, [10, 25, 25, 25, 15]), index = models.indexOf(model);
    const rate = 10 ** (-4 + random() * 3), distance = Math.abs(Math.log10(rate) + 2.4);
    const loss = Math.max(0.05, 0.62 - index * 0.07 + distance * 0.18 + normal() * 0.03);
    const accuracy = Math.min(0.99, Math.max(0.5, 0.97 - loss * 0.45 + normal() * 0.01));
    const epochs = 5 + Math.floor(random() * 45);
    lines.push([`run-${String(i).padStart(4, "0")}`, day(Math.floor((i / 400) * 330)), model, rate.toExponential(2), epochs, (epochs * (0.4 + index * 0.9) * (0.8 + random() * 0.4)).toFixed(1), loss.toFixed(4), accuracy.toFixed(4)].join(","));
  }
  fs.writeFileSync(path.join(out, "model-runs.csv"), lines.join("\n") + "\n");
}

// 3. sensor-readings.txt: a plain text file with a pipe as the delimiter, one reading every 30 minutes for two weeks.
{
  const lines = ["# readings of the demo building; fields separated by |"];
  lines.splice(0, 1);
  lines.push("timestamp|sensor|temperature_c|humidity_pct|status");
  const sensors = ["hall", "office", "server-room"];
  for (let step = 0; step < 14 * 48; step++) {
    const hours = step / 2, daily = Math.sin(((hours % 24) - 9) / 24 * 2 * Math.PI);
    for (const sensor of sensors) {
      const base = sensor === "server-room" ? 24 : 20.5, temperature = base + daily * (sensor === "server-room" ? 0.8 : 2.2) + normal() * 0.3;
      const humidity = 45 - daily * 6 + normal() * 1.5;
      const status = random() < 0.01 ? "fault" : random() < 0.04 ? "stale" : "ok";
      const stamp = `${day(Math.floor(hours / 24))} ${pad(Math.floor(hours) % 24)}:${step % 2 ? "30" : "00"}:00`;
      lines.push([stamp, sensor, status === "fault" ? "" : temperature.toFixed(1), status === "fault" ? "" : humidity.toFixed(1), status].join("|"));
    }
  }
  fs.writeFileSync(path.join(out, "sensor-readings.txt"), lines.join("\n") + "\n");
}

console.log("written:", fs.readdirSync(out).map(name => `${name} (${Math.round(fs.statSync(path.join(out, name)).size / 1024)} KB)`).join(", "));
