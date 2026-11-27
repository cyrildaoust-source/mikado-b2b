import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLocked, nextThrottle, THROTTLE } from "../app/services/auth.server";
import { bearerOk, requireInternal } from "../app/services/internal.server";

test("cinq échecs sur un e-mail verrouillent la connexion un quart d'heure", () => {
  const t0 = new Date("2026-11-27T10:00:00Z");
  let t = null as ReturnType<typeof nextThrottle> | null;
  for (let i = 1; i < THROTTLE.perEmail; i++) {
    t = nextThrottle(t, THROTTLE.perEmail, new Date(t0.getTime() + i * 1000));
    assert.equal(isLocked(t, t0), false, `essai ${i}`);
  }
  t = nextThrottle(t, THROTTLE.perEmail, new Date(t0.getTime() + 10_000));
  assert.equal(isLocked(t, new Date(t0.getTime() + 11_000)), true);
  assert.equal(
    isLocked(t, new Date(t0.getTime() + 10_000 + THROTTLE.lockMs + 1)),
    false,
  );
});

test("hors de la fenêtre, le compteur repart de un", () => {
  const t0 = new Date("2026-11-27T10:00:00Z");
  const a = nextThrottle(null, 5, t0);
  const b = nextThrottle(
    { ...a, failures: 4 },
    5,
    new Date(t0.getTime() + THROTTLE.windowMs + 1),
  );
  assert.equal(b.failures, 1);
  assert.equal(isLocked(b, b.windowStart), false);
});

const req = (auth?: string) =>
  new Request("https://pro.example/internal/dedar?list=1", {
    headers: auth ? { authorization: auth } : {},
  });

test("routes internes : jeton exact exigé, jeton court refusé", async () => {
  const secret = "x".repeat(40);
  assert.equal(bearerOk(req(`Bearer ${secret}`), secret), true);
  assert.equal(bearerOk(req(`Bearer ${secret}y`), secret), false);
  assert.equal(bearerOk(req(), secret), false);
  assert.equal(bearerOk(req("Bearer court"), "court"), false);

  const before = {
    token: process.env.INTERNAL_TOKEN,
    mode: process.env.APP_MODE,
  };
  process.env.INTERNAL_TOKEN = secret;
  delete process.env.APP_MODE;
  try {
    await requireInternal(req(`Bearer ${secret}`));
    await assert.rejects(
      () => requireInternal(req()),
      (e: unknown) => e instanceof Response && e.status === 404,
    );
    delete process.env.INTERNAL_TOKEN;
    await assert.rejects(
      () => requireInternal(req(`Bearer ${secret}`)),
      (e: unknown) => e instanceof Response && e.status === 404,
    );
  } finally {
    if (before.token === undefined) delete process.env.INTERNAL_TOKEN;
    else process.env.INTERNAL_TOKEN = before.token;
    if (before.mode !== undefined) process.env.APP_MODE = before.mode;
  }
});

test("chaque route /internal de remplissage passe par requireInternal", () => {
  for (const name of [
    "dedar",
    "designersguild",
    "elitis",
    "kvadrat",
    "peek",
    "rubelli",
  ]) {
    const src = readFileSync(`app/routes/internal.${name}.ts`, "utf8");
    assert.match(src, /await requireInternal\(request\);/, name);
  }
});

test("un compte externe ne lit jamais les clients Shopify", async () => {
  const { isExternal } = await import("../app/services/context.server");
  const base = { shop: "s", admin: null, demo: false, actor: null, embedded: false };
  const u = (role: string) =>
    ({ ...base, user: { id: 1, email: "a@b.be", name: "A", role } }) as never;
  assert.equal(isExternal(u("architect")), true);
  assert.equal(isExternal(u("autre")), true);
  assert.equal(isExternal(u("admin")), false);
  assert.equal(isExternal({ ...base, user: null } as never), false);

  const catalog = readFileSync("app/routes/app.catalog.tsx", "utf8");
  assert.match(catalog, /"customers" && isExternal\(c\)\)/);
  const quote = readFileSync("app/routes/app.quotes.$id.tsx", "utf8");
  assert.match(quote, /customerId: null/);
  assert.doesNotMatch(quote, /role === "architect" \? lockPrices/);
});
