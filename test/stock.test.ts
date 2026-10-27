import { env } from "cloudflare:workers";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { memberships, opLog, products, saleItems, sales, tenants, users, type Role } from "../src/db/schema";
import { applyOps, type SyncCtx } from "../src/sync/apply";

async function seed(role: Role = "dueno") {
  const db = getDb(env.DB);
  const now = new Date();
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db.insert(tenants).values({ id: tenantId, name: "Cafetería", createdAt: now });
  await db.insert(users).values({ id: userId, name: "Empleado", codeHash: crypto.randomUUID(), createdAt: now });
  await db.insert(memberships).values({ id: crypto.randomUUID(), userId, tenantId, role });
  const ctx: SyncCtx = { tenantId, userId, deviceId: "dev-test", role };
  return { db, ctx, tenantId };
}

const id = () => crypto.randomUUID();

// Filas escritas por lo aplicado hasta ahora: sales + sale_items + op_log + productos tocados.
async function filasEscritas(db: ReturnType<typeof getDb>, tenantId: string, sentinel: number) {
  const [s, i, o, p] = await Promise.all([
    db.select().from(sales).where(eq(sales.tenantId, tenantId)),
    db.select().from(saleItems).where(eq(saleItems.tenantId, tenantId)),
    db.select().from(opLog).where(eq(opLog.tenantId, tenantId)),
    db.select().from(products).where(and(eq(products.tenantId, tenantId), ne(products.updatedAt, new Date(sentinel)))),
  ]);
  return s.length + i.length + o.length + p.length;
}

// Venta de 3 ítems, cada uno de un producto distinto.
const ventaDeTres = (pids: string[]) => ({
  op_id: id(),
  type: "sale.create" as const,
  payload: { id: id(), items: pids.map((pid, n) => ({ product_id: pid, nombre: `P${n}`, precio_cents: 100, qty: 1 })) },
});

describe("sale.create y control de inventario", () => {
  it("track_stock=0 no cambia stock_qty ni updated_at; track_stock=1 sí descuenta", async () => {
    const { db, ctx, tenantId } = await seed();
    const sinControl = id();
    const conControl = id();
    const antes = new Date(Date.now() - 60_000);
    await db.insert(products).values([
      { id: sinControl, tenantId, nombre: "Agua", precioCents: 100, updatedAt: antes, stockQty: 7, trackStock: false },
      { id: conControl, tenantId, nombre: "Café", precioCents: 250, updatedAt: antes, stockQty: 9, trackStock: true },
    ]);

    const [res] = await applyOps(db, ctx, [
      {
        op_id: id(),
        type: "sale.create",
        payload: {
          id: id(),
          items: [
            { product_id: sinControl, nombre: "Agua", precio_cents: 100, qty: 3 },
            { product_id: conControl, nombre: "Café", precio_cents: 250, qty: 2 },
          ],
        },
      },
    ]);
    expect(res?.status).toBe("applied");

    const [agua] = await db.select().from(products).where(eq(products.id, sinControl));
    const [cafe] = await db.select().from(products).where(eq(products.id, conControl));
    expect(agua?.stockQty).toBe(7);
    expect(agua?.updatedAt.getTime()).toBe(antes.getTime());
    expect(cafe?.stockQty).toBe(7);
    expect(cafe?.updatedAt.getTime()).toBeGreaterThan(antes.getTime());
  });

  it("mide las filas escritas por una venta de 3 ítems: 5 sin control y 8 con control", async () => {
    const { db, ctx, tenantId } = await seed();
    const sentinel = Date.now();
    const sinControl = [id(), id(), id()];
    const conControl = [id(), id(), id()];
    await db.insert(products).values([
      ...sinControl.map((id, n) => ({ id, tenantId, nombre: `Sin ${n}`, precioCents: 100, updatedAt: new Date(sentinel), trackStock: false })),
      ...conControl.map((id, n) => ({ id, tenantId, nombre: `Con ${n}`, precioCents: 100, updatedAt: new Date(sentinel), trackStock: true })),
    ]);

    const base = await filasEscritas(db, tenantId, sentinel);
    await applyOps(db, ctx, [ventaDeTres(sinControl)]);
    const sinControlFilas = (await filasEscritas(db, tenantId, sentinel)) - base;

    const base2 = await filasEscritas(db, tenantId, sentinel);
    await applyOps(db, ctx, [ventaDeTres(conControl)]);
    const conControlFilas = (await filasEscritas(db, tenantId, sentinel)) - base2;

    // 1 sales + 3 sale_items + 1 op_log (+ 3 UPDATE de products solo si controlan stock)
    expect(sinControlFilas).toBe(5);
    expect(conControlFilas).toBe(8);
  });
});
