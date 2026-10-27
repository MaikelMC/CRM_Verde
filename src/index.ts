import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { getDb } from "./db/client";
import { memberships, tenants, users, type Role } from "./db/schema";
import { tenantProducts } from "./db/tenant";
import { accessCode, allowLogin, failLogin, hashCode, resetLogin, signSession, verifySession } from "./lib/auth";
import { newId } from "./lib/ids";
import { applyOps, syncBodySchema } from "./sync/apply";
import { parseCursor, pullProducts } from "./sync/pull";

export type Env = {
  DB: D1Database;
  AUTH_SECRET: string;
  SETUP_TOKEN?: string;
};

type Vars = { userId: string; tenantId: string; role: Role };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();
const COOKIE = "lv_sess";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

app.use("/api/*", secureHeaders());
app.use("/api/*", async (c, next) => {
  if (!c.env.AUTH_SECRET) return c.json({ error: "server_misconfigured" }, 500);
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true }));

// Bootstrap con SETUP_TOKEN: crea tenant + dueño y devuelve el código una sola vez.
app.post("/api/setup", async (c) => {
  if (!c.env.SETUP_TOKEN || c.req.header("x-setup-token") !== c.env.SETUP_TOKEN) {
    return c.json({ error: "not_found" }, 404);
  }
  const parsed = z
    .object({ tenantName: z.string().min(1).max(80), userName: z.string().min(1).max(80) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const code = accessCode();
  const now = new Date();
  const tenantId = newId();
  const userId = newId();
  const db = getDb(c.env.DB);
  await db.batch([
    db.insert(tenants).values({ id: tenantId, name: parsed.data.tenantName, createdAt: now }),
    db
      .insert(users)
      .values({ id: userId, name: parsed.data.userName, codeHash: await hashCode(code, c.env.AUTH_SECRET), createdAt: now }),
    db.insert(memberships).values({ id: newId(), userId, tenantId, role: "dueno" }),
  ]);
  return c.json({ tenantId, userId, code });
});

app.post("/api/auth/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (!allowLogin(ip)) return c.json({ error: "too_many_attempts" }, 429, { "Retry-After": "900" });

  const parsed = z
    .object({ code: z.string().min(16).max(80) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const db = getDb(c.env.DB);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.codeHash, await hashCode(parsed.data.code, c.env.AUTH_SECRET)))
    .limit(1);
  if (!user) {
    failLogin(ip);
    return c.json({ error: "invalid_code" }, 401);
  }

  const [membership] = await db
    .select({ tenantId: memberships.tenantId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);
  if (!membership) return c.json({ error: "no_membership" }, 403);

  resetLogin(ip);
  const token = await signSession({ u: user.id, t: membership.tenantId, e: Date.now() + SESSION_MS }, c.env.AUTH_SECRET);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  return c.json({ user: { id: user.id, name: user.name }, tenantId: membership.tenantId, role: membership.role });
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  const token = getCookie(c, COOKIE);
  const session = token ? await verifySession(token, c.env.AUTH_SECRET) : null;
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const [membership] = await getDb(c.env.DB)
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, session.u), eq(memberships.tenantId, session.t)))
    .limit(1);
  if (!membership) return c.json({ error: "unauthorized" }, 401);

  c.set("userId", session.u);
  c.set("tenantId", session.t);
  c.set("role", membership.role);
  await next();
});

app.get("/api/me", async (c) => {
  const [user] = await getDb(c.env.DB)
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, c.get("userId")))
    .limit(1);
  return c.json({ user, tenantId: c.get("tenantId"), role: c.get("role") });
});

app.get("/api/products", async (c) => {
  const products = await tenantProducts(getDb(c.env.DB), c.get("tenantId")).list();
  return c.json({ products });
});

app.post("/api/sync", async (c) => {
  const parsed = syncBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const results = await applyOps(
    getDb(c.env.DB),
    {
      tenantId: c.get("tenantId"),
      userId: c.get("userId"),
      deviceId: parsed.data.device_id,
      role: c.get("role"),
    },
    parsed.data.ops,
  );
  return c.json({ results });
});

app.get("/api/sync", async (c) => {
  const since = parseCursor(c.req.query("since"));
  if (since === undefined) return c.json({ error: "invalid_cursor" }, 400);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 200) || 200, 1), 500);
  return c.json(await pullProducts(getDb(c.env.DB), c.get("tenantId"), since, limit));
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
