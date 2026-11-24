import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { randomBytes } from "node:crypto";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const port = 3002;
const odooAutomationRequested =
  process.env.ODOO_AUTOMATION_ENABLED === "true";
const legacyGuardConfirmed =
  process.env.ODOO_LEGACY_GUARD_CONFIRMED === "true";
const children = new Set();
const lock = ".shopify/manual-launch.lock";
let locked = false;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  if (locked) rmSync(lock, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
const env = {
  ...process.env,
  ...parseEnv(readFileSync(".env", "utf8")),
  ...parseEnv(readFileSync(".env.shopify.local", "utf8")),
  SHOPIFY_APP_URL: "http://localhost:3002",
  APP_DEMO_MODE: "false",
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: String(port),
  ODOO_AUTOMATION_ENABLED: odooAutomationRequested ? "true" : "false",
  ODOO_LEGACY_GUARD_CONFIRMED: legacyGuardConfirmed ? "true" : "false",
  BILLING_WORKER_TOKEN:
    process.env.BILLING_WORKER_TOKEN || randomBytes(32).toString("hex"),
  BILLING_WORKER_INTERVAL_MS: "5000",
  SHOPIFY_CLI_AGENT_INFO: "n:Codex|v:1|p:OpenAI",
  SHOPIFY_CLI_AGENT_IDS: "r:mikado-install-local",
};
function start(command, args, options = {}) {
  const child = spawn(command, args, {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}
async function run(command, args, label) {
  console.log(label);
  const child = start(command, args);
  // Les commandes Shopify peuvent afficher des identifiants : ne pas recopier leurs sorties.
  child.stdout.resume();
  child.stderr.resume();
  await new Promise((ok, fail) => {
    child.once("error", () => fail(new Error(`${label} : outil introuvable.`)));
    child.once("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`${label} : échec (code ${code}).`)),
    );
  });
}
async function waitHealth() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error("Le serveur ne répond pas.");
}
try {
  if (!env.SHOPIFY_API_KEY || !env.SHOPIFY_API_SECRET)
    throw new Error("Identifiants Shopify manquants.");
  await new Promise((ok, fail) => {
    const probe = net.createServer();
    probe.once("error", () =>
      fail(new Error(`Le port ${port} est déjà utilisé.`)),
    );
    probe.listen(port, "127.0.0.1", () => probe.close(ok));
  });
  mkdirSync(".shopify", { recursive: true });
  try {
    mkdirSync(lock);
    locked = true;
  } catch {
    let stale = false;
    try {
      const previousPid = Number(readFileSync(`${lock}/pid`, "utf8"));
      if (Number.isSafeInteger(previousPid) && previousPid > 0) {
        try {
          process.kill(previousPid, 0);
        } catch (error) {
          stale = error.code === "ESRCH";
        }
      }
    } catch {}
    if (!stale)
      throw new Error(
        "Un lancement est déjà en cours. Fermez-le avant de recommencer.",
      );
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
    locked = true;
  }
  writeFileSync(`${lock}/pid`, String(process.pid));
  await run("npm", ["run", "setup"], "Préparation de la base de données…");
  await run("npm", ["run", "build"], "Préparation de l’application…");
  console.log("Connexion HTTPS temporaire via Cloudflare…");
  const tunnel = start("cloudflared", [
    "tunnel",
    "--url",
    `http://127.0.0.1:${port}`,
    "--no-autoupdate",
  ]);
  const publicUrl = await new Promise((ok, fail) => {
    let buffer = "";
    const timer = setTimeout(
      () => fail(new Error("Connexion HTTPS indisponible.")),
      60000,
    );
    const read = (data) => {
      buffer = (buffer + data.toString()).slice(-10000);
      const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        ok(match[0]);
      }
    };
    tunnel.stdout.on("data", read);
    tunnel.stderr.on("data", read);
    tunnel.once("error", () => {
      clearTimeout(timer);
      fail(new Error("Cloudflared introuvable."));
    });
    tunnel.once("exit", () => {
      clearTimeout(timer);
      fail(new Error("Le tunnel a été interrompu."));
    });
  });
  env.SHOPIFY_APP_URL = publicUrl;
  const config = readFileSync("shopify.app.toml", "utf8");
  env.SCOPES = config.match(/^scopes = "([^"]+)"/m)?.[1] || "";
  const { chromium } = await import("playwright");
  if (!env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    const chromiumPath = chromium.executablePath();
    if (!existsSync(chromiumPath)) {
      await run(
        "node",
        ["node_modules/playwright/cli.js", "install", "chromium"],
        "Installation du navigateur pour les PDF…",
      );
    }
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromiumPath;
  }
  if (!existsSync(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)) {
    throw new Error(
      "Le navigateur PDF configuré est introuvable. Vérifiez PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.",
    );
  }
  const server = start("node", [
    "node_modules/@react-router/serve/bin.js",
    "./build/server/index.js",
  ]);
  server.stdout.resume();
  server.stderr.resume();
  server.once("error", () => stop(1));
  server.once("exit", () => {
    console.error("Serveur arrêté.");
    stop(1);
  });
  tunnel.once("exit", () => {
    console.error("Connexion HTTPS interrompue. Relancez l’application.");
    stop(1);
  });
  await waitHealth();
  if (env.ODOO_AUTOMATION_ENABLED === "true") {
    console.log("Démarrage du connecteur automatique Odoo…");
    const worker = start("node", ["scripts/billing-worker.mjs"], {
      env: { ...env, BILLING_APP_URL: `http://127.0.0.1:${port}` },
    });
    worker.stdout.on("data", (chunk) => process.stdout.write(chunk));
    worker.stderr.on("data", (chunk) => process.stderr.write(chunk));
    worker.once("error", () => stop(1));
    worker.once("exit", (code) => {
      if (!stopping && code) {
        console.error("Connecteur Odoo arrêté.");
        stop(1);
      }
    });
  }
  console.log("Vérification de l’accès HTTPS public et du DNS…");
  console.log(publicUrl);
  let publicReady = false;
  // Les nouveaux sous-domaines trycloudflare peuvent mettre plus d’une minute
  // à apparaître dans le résolveur DNS de macOS, même s’ils sont déjà publiés.
  for (let attempt = 0; attempt < 36; attempt++) {
    try {
      const response = await fetch(`${publicUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok && (await response.json()).status === "ok") {
        publicReady = true;
        break;
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  if (!publicReady)
    throw new Error(
      "Adresse Cloudflare inaccessible après trois minutes. Relancez pour obtenir une nouvelle adresse ; Shopify n’a pas été modifié.",
    );
  writeFileSync(
    "shopify.app.toml",
    config
      .replace(/^application_url = .*$/m, `application_url = "${publicUrl}"`)
      .replace(
        /^redirect_urls = .*$/m,
        `redirect_urls = ["${publicUrl}/auth/callback"]`,
      ),
  );
  await run(
    "shopify",
    ["app", "config", "validate", "--json"],
    "Validation Shopify…",
  );
  await run(
    "shopify",
    ["app", "deploy", "--allow-updates"],
    "Mise à jour de l’adresse dans Shopify…",
  );
  writeFileSync(
    ".shopify/manual-runtime.json",
    JSON.stringify({
      url: publicUrl,
      port,
      startedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  console.log(
    `\nMikado Devis fonctionne sur votre Mac.\nOuvrez Shopify → Applications → Mikado Devis.\nGardez cette fenêtre ouverte et votre Mac éveillé. Ctrl+C pour arrêter.\nFacturation automatique Odoo ${env.ODOO_AUTOMATION_ENABLED === "true" ? "activée : brouillons uniquement." : "désactivée."}`,
  );
} catch (error) {
  console.error(error.message);
  stop(1);
}
