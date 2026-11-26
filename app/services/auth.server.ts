import { createCookieSessionStorage, redirect } from "react-router";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import db from "../db.server";

function scryptAsync(password: string, salt: Buffer, keylen: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export type Role = "admin" | "architect";
export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
};

function secret() {
  const s = process.env.SESSION_SECRET || "";
  if (s.length < 32)
    throw Error("SESSION_SECRET doit contenir au moins 32 caractères.");
  return s;
}

type SessionData = { userId: number };
let storage: ReturnType<typeof createCookieSessionStorage<SessionData>> | null =
  null;
function sessions() {
  storage ??= createCookieSessionStorage<SessionData>({
    cookie: {
      name: "__mikado_pro",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
      secrets: [secret()],
    },
  });
  return storage;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16),
    key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [kind, salt, key] = stored.split("$");
  if (kind !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64"),
    actual = await scryptAsync(
      password,
      Buffer.from(salt, "base64"),
      expected.length,
    );
  return timingSafeEqual(expected, actual);
}

export function passwordProblem(password: string) {
  if (password.length < 10)
    return "Le mot de passe doit contenir au moins 10 caractères.";
  if (password.length > 200) return "Mot de passe trop long.";
  return null;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function currentUser(
  request: Request,
): Promise<SessionUser | null> {
  const session = await sessions().getSession(request.headers.get("Cookie"));
  const id = session.get("userId");
  if (typeof id !== "number") return null;
  const user = await db.user.findUnique({ where: { id } });
  if (!user || !user.active || !user.passwordHash) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "admin" ? "admin" : "architect",
  };
}

export function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== new URL(request.url).host)
    throw new Response("Origine refusée", { status: 403 });
}

export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) {
    const u = new URL(request.url);
    throw redirect(
      `/connexion?suite=${encodeURIComponent(u.pathname + u.search)}`,
    );
  }
  assertSameOrigin(request);
  return user;
}

export async function login(
  request: Request,
  email: string,
  password: string,
  next: string,
) {
  const user = await db.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !user.active || !ok) return null;
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  return startSession(request, user.id, next);
}

export async function startSession(
  request: Request,
  userId: number,
  next: string,
) {
  const session = await sessions().getSession(request.headers.get("Cookie"));
  session.set("userId", userId);
  return redirect(safeNext(next), {
    headers: { "Set-Cookie": await sessions().commitSession(session) },
  });
}

export async function logout(request: Request) {
  const session = await sessions().getSession(request.headers.get("Cookie"));
  return redirect("/connexion", {
    headers: { "Set-Cookie": await sessions().destroySession(session) },
  });
}

export function safeNext(next: string) {
  return /^\/app(\/|\?|$)/.test(next) ? next : "/app";
}

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Invitation à usage unique, valable 7 jours. Le lien n'est montré qu'une fois. */
export async function createInvite(userId: number) {
  const token = randomBytes(32).toString("base64url");
  await db.invite.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  return token;
}

export async function findInvite(token: string) {
  const invite = await db.invite.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  if (
    !invite ||
    invite.usedAt ||
    invite.expiresAt < new Date() ||
    !invite.user.active
  )
    return null;
  return invite;
}

export async function acceptInvite(token: string, password: string) {
  const invite = await findInvite(token);
  if (!invite)
    throw Error("Ce lien n'est plus valable. Demandez-en un nouveau à Mikado Deco.");
  const problem = passwordProblem(password);
  if (problem) throw Error(problem);
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: invite.userId }, data: { passwordHash } }),
  ]);
  return invite.userId;
}
