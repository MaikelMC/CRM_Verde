import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { memberships, tenants, users, type Role } from "../src/db/schema";
import app from "../src/index";
import { signSession } from "../src/lib/auth";
import { applyOps, type SyncCtx } from "../src/sync/apply";

const id = () => crypto.randomUUID();

async function seed(role: Role = "dueno") {
  const db = getDb(env.DB);
  const now = new Date();
  const tenantId = id();
  const userId = id();
  await db.insert(tenants).values({ id: tenantId, name: "Cafetería", createdAt: now });
  await db.insert(users).values({ id: userId, name: `U-${userId.slice(0, 4)}`, codeHash: id(), createdAt: now });
  await db.insert(memberships).values({ id: id(), userId, tenantId, role });
  const ctx: SyncCtx = { tenantId, userId, deviceId: "dev-test", role };
  const token = await signSession({ u: userId, t: tenantId, e: Date.now() + 60_000 }, env.AUTH_SECRET);
  return { db, ctx, tenantId, userId, cookie: `lv_sess=${token}` };
}

type Venta = { moneda: "CUP" | "USD"; method: "efectivo" | "transferencia" | "otro"; items: { pid: string; qty: number; cents: number }[] };

async function vender(ctx: SyncCtx, occurredAt: number, v: Venta) {
  const payload = {
    id: id(),
    moneda: v.moneda,
    method: v.method,
    occurred_at: occurredAt,
    items: v.items.map((i, n) => ({ product_id: i.pid, nombre: `P${n}`, precio_cents: i.cents, qty: i.qty })),
  };
  const [res] = await applyOps(getDb(env.DB), ctx, [{ op_id: id(), type: "sale.create", payload }]);
  expect(res?.status).toBe("applied");
}

describe("GET /api/reports/day", () => {
  it("devuelve los agregados del tenant y nunca datos de otro", async () => {
    const a = await seed();
    const b = await seed();
    const ahora = Date.now();
    const pid = id();
    const pid2 = id();

    await vender(a.ctx, ahora - 3_600_000, { moneda: "CUP", method: "efectivo", items: [{ pid, qty: 2, cents: 250 }] });
    await vender(a.ctx, ahora - 1_800_000, { moneda: "CUP", method: "transferencia", items: [{ pid: pid2, qty: 1, cents: 300 }] });
    await vender(a.ctx, ahora - 600_000, { moneda: "USD", method: "efectivo", items: [{ pid, qty: 1, cents: 100 }] });
    // Otro tenant, misma ventana: no debe aparecer en el reporte de A.
    await vender(b.ctx, ahora - 3_600_000, { moneda: "CUP", method: "efectivo", items: [{ pid: id(), qty: 9, cents: 111 }] });

    const res = await app.request(
      `/api/reports/day?from=${ahora - 7_200_000}&to=${ahora}`,
      { headers: { cookie: a.cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { moneda: string; method: string; ventas: number; total_cents: number }[];
      top_products: { product_id: string; nombre: string; qty: number }[];
      by_user: { user_id: string; nombre: string; moneda: string; ventas: number; total_cents: number }[];
    };

    const clave = (m: string, met: string) => body.totals.find((f) => f.moneda === m && f.method === met);
    expect(Number(clave("CUP", "efectivo")?.ventas)).toBe(1);
    expect(Number(clave("CUP", "efectivo")?.total_cents)).toBe(500);
    expect(Number(clave("CUP", "transferencia")?.total_cents)).toBe(300);
    expect(Number(clave("USD", "efectivo")?.total_cents)).toBe(100);
    expect(body.totals).toHaveLength(3);

    const top = body.top_products.find((t) => t.product_id === pid);
    expect(Number(top?.qty)).toBe(3);
    expect(top?.nombre).toBe("P0");

    // Por usuario y moneda: nunca se mezclan monedas.
    expect(body.by_user).toHaveLength(2);
    expect(body.by_user.every((u) => u.user_id === a.userId)).toBe(true);
    const cup = body.by_user.find((u) => u.moneda === "CUP");
    const usd = body.by_user.find((u) => u.moneda === "USD");
    expect([Number(cup?.ventas), Number(cup?.total_cents)]).toEqual([2, 800]);
    expect([Number(usd?.ventas), Number(usd?.total_cents)]).toEqual([1, 100]);
    expect(body.by_user.some((u) => u.user_id === b.userId)).toBe(false);
  });

  it("el límite superior es exclusivo (no cuenta la venta de las 00:00 del día siguiente)", async () => {
    const a = await seed();
    const ahora = Date.now();
    await vender(a.ctx, ahora, { moneda: "CUP", method: "efectivo", items: [{ pid: id(), qty: 1, cents: 100 }] });

    const res = await app.request(
      `/api/reports/day?from=${ahora - 86_400_000}&to=${ahora}`,
      { headers: { cookie: a.cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totals: unknown[] };
    expect(body.totals).toHaveLength(0);
  });

  it("rechaza rangos mayores de 36 h y a los cajeros", async () => {
    const { cookie } = await seed();
    const ahora = Date.now();
    const grande = await app.request(
      `/api/reports/day?from=${ahora - 40 * 3_600_000}&to=${ahora}`,
      { headers: { cookie } },
      env,
    );
    expect(grande.status).toBe(400);
    expect(await grande.json()).toEqual({ error: "range_too_large" });

    const invertido = await app.request(`/api/reports/day?from=${ahora}&to=${ahora - 1000}`, { headers: { cookie } }, env);
    expect(invertido.status).toBe(400);

    const cajero = await seed("cajero");
    const prohibido = await app.request(
      `/api/reports/day?from=${ahora - 3_600_000}&to=${ahora}`,
      { headers: { cookie: cajero.cookie } },
      env,
    );
    expect(prohibido.status).toBe(403);
  });
});
