import test from "node:test";
import assert from "node:assert/strict";
import db from "../../app/db.server";
import {
  hashPassword,
  login,
  THROTTLE,
  TooManyAttempts,
} from "../../app/services/auth.server";

process.env.SESSION_SECRET ||= "s".repeat(40);

const from = (ip: string) =>
  new Request("https://pro.example/connexion", {
    method: "POST",
    headers: { "x-real-ip": ip, origin: "https://pro.example" },
  });

test("cinq mauvais mots de passe bloquent le compte, même avec le bon ensuite", async () => {
  await db.user.create({
    data: {
      email: "verrou@test.be",
      name: "Verrou",
      passwordHash: await hashPassword("bon-mot-de-passe"),
    },
  });
  for (let i = 0; i < THROTTLE.perEmail; i++)
    assert.equal(
      await login(from(`10.0.0.${i}`), "verrou@test.be", "faux", "/app"),
      null,
    );
  await assert.rejects(
    () =>
      login(from("10.0.0.99"), "Verrou@Test.be", "bon-mot-de-passe", "/app"),
    TooManyAttempts,
  );
  // Le verrou levé, le bon mot de passe ouvre la session et efface le compteur.
  await db.authThrottle.updateMany({
    data: { lockedUntil: new Date(Date.now() - 1) },
  });
  const ok = await login(
    from("10.0.0.99"),
    "verrou@test.be",
    "bon-mot-de-passe",
    "/app",
  );
  assert.equal(ok?.status, 302);
  assert.equal(
    await db.authThrottle.count({ where: { key: "email:verrou@test.be" } }),
    0,
  );
});

test("une même adresse IP qui essaie beaucoup d'e-mails est bloquée", async () => {
  for (let i = 0; i < THROTTLE.perIp; i++)
    assert.equal(
      await login(from("10.9.9.9"), `inconnu${i}@test.be`, "x", "/app"),
      null,
    );
  await assert.rejects(
    () => login(from("10.9.9.9"), "autre@test.be", "x", "/app"),
    TooManyAttempts,
  );
});
