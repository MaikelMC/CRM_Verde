import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { cashSessions, memberships, products, sales, tenants, users, type Role } from "../src/db/schema";
import { applyOps, type SyncCtx } from "../src/sync/apply";
import { parseCursor, pullProducts } from "../src/sync/pull";

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

describe("POST /api/sync (applyOps)", () => {
  it("la misma op dos veces: una venta, un descuento, la segunda es duplicate", async () => {
    const { db, ctx, tenantId } = await seed();
    const pid = id();
    await db
      .insert(products)
      .values({ id: pid, tenantId, nombre: "Café", precioCents: 250, updatedAt: new Date(), stockQty: 10, trackStock: true });

    const op = {
      op_id: id(),
      type: "sale.create",
      payload: { id: id(), items: [{ product_id: pid, nombre: "Café", precio_cents: 250, qty: 2 }] },
    };

    const first = await applyOps(db, ctx, [op]);
    const second = await applyOps(db, ctx, [op]);

    expect(first[0]).toEqual({ op_id: op.op_id, status: "applied" });
    expect(second[0]).toEqual({ op_id: op.op_id, status: "duplicate" });

    const saleRows = await db.select().from(sales).where(eq(sales.tenantId, tenantId));
    expect(saleRows).toHaveLength(1);
    expect(saleRows[0]?.totalCents).toBe(500);

    const [product] = await db.select().from(products).where(eq(products.id, pid));
    expect(product?.stockQty).toBe(8);
  });

  it("un lote con una op inválida aplica las válidas y rechaza solo la inválida", async () => {
    const { db, ctx } = await seed();
    const pid = id();

    const results = await applyOps(db, ctx, [
      { op_id: id(), type: "sale.create", payload: { id: id(), items: [] } },
      { op_id: id(), type: "product.upsert", payload: { id: pid, nombre: "Té", precio_cents: 100 } },
      { op_id: id(), type: "stock.adjust", payload: { product_id: pid, delta: 5, tipo: "compra" } },
    ]);

    expect(results.map((r) => r.status)).toEqual(["rejected", "applied", "applied"]);
    expect(results[0]?.error).toBe("invalid_payload");

    const [product] = await db.select().from(products).where(eq(products.id, pid));
    expect(product?.nombre).toBe("Té");
    expect(product?.stockQty).toBe(5);
  });

  it("nadie puede cerrar la caja de otro usuario", async () => {
    const { db, ctx } = await seed("cajero");
    const otroId = id();
    await db.insert(users).values({ id: otroId, name: "Otro", codeHash: id(), createdAt: new Date() });
    await db.insert(memberships).values({ id: id(), userId: otroId, tenantId: ctx.tenantId, role: "cajero" });

    const caja = id();
    const [open] = await applyOps(db, { ...ctx, userId: otroId }, [
      { op_id: id(), type: "cash.open", payload: { id: caja, opening_cents: 1_000, moneda: "CUP" } },
    ]);
    expect(open?.status).toBe("applied");

    await applyOps(db, ctx, [{ op_id: id(), type: "cash.close", payload: { id: caja, closing_cents: 1_000 } }]);
    const [row] = await db.select().from(cashSessions).where(eq(cashSessions.id, caja));
    expect(row?.closedAt).toBeNull();
  });

  it("un cajero no puede hacer product.upsert", async () => {
    const { db, ctx } = await seed("cajero");
    const pid = id();

    const [result] = await applyOps(db, ctx, [
      { op_id: id(), type: "product.upsert", payload: { id: pid, nombre: "Té", precio_cents: 100 } },
    ]);

    expect(result).toMatchObject({ status: "rejected", error: "forbidden" });
    expect(await db.select().from(products).where(eq(products.id, pid))).toHaveLength(0);
  });
});

describe("GET /api/sync (pull)", () => {
  it("el pull de un tenant nunca devuelve datos de otro", async () => {
    const a = await seed();
    const b = await seed();
    const pa = id();
    const pb = id();
    const now = new Date();
    await a.db.insert(products).values({ id: pa, tenantId: a.tenantId, nombre: "A", precioCents: 100, updatedAt: now });
    await b.db.insert(products).values({ id: pb, tenantId: b.tenantId, nombre: "B", precioCents: 100, updatedAt: now });

    const page = await pullProducts(a.db, a.tenantId, null);
    expect(page.products.map((p) => p.id)).toEqual([pa]);
    expect(page.cursor).toBe(`${now.getTime()}:${pa}`);
    expect(page.has_more).toBe(false);

    const next = await pullProducts(a.db, a.tenantId, parseCursor(page.cursor) ?? null);
    expect(next.products).toHaveLength(0);
  });
});
