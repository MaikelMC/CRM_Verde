import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import type { Db } from "../db/client";
import { cashSessions, opLog, products, saleItems, sales, stockMovements, type Role } from "../db/schema";
import { newId } from "../lib/ids";

type Stmt = BatchItem<"sqlite">;

export type SyncCtx = { tenantId: string; userId: string; deviceId: string; role: Role };
export type OpResult = { op_id: string; status: "applied" | "duplicate" | "rejected"; error?: string };

export const syncBodySchema = z.object({
  device_id: z.string().min(1).max(80),
  ops: z.array(z.unknown()).min(1).max(50),
});

const opSchema = z.object({
  op_id: z.string().min(1).max(40),
  type: z.enum(["sale.create", "product.upsert", "product.delete", "stock.adjust", "cash.open", "cash.close"]),
  payload: z.unknown(),
});

type OpType = z.infer<typeof opSchema>["type"];

const salePayload = z.object({
  id: z.string().min(1).max(40),
  moneda: z.enum(["CUP", "USD"]).default("CUP"),
  created_at: z.number().int().positive().optional(),
  items: z
    .array(
      z.object({
        product_id: z.string().min(1).max(40),
        nombre: z.string().min(1).max(120),
        precio_cents: z.number().int().min(0),
        qty: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(100),
});

const productPayload = z.object({
  id: z.string().min(1).max(40),
  nombre: z.string().min(1).max(120),
  categoria: z.string().max(80).nullish(),
  precio_cents: z.number().int().min(0),
  moneda: z.enum(["CUP", "USD"]).default("CUP"),
  costo_cents: z.number().int().min(0).nullish(),
  activo: z.boolean().optional(),
});

const deletePayload = z.object({ id: z.string().min(1).max(40) });

const stockPayload = z.object({
  product_id: z.string().min(1).max(40),
  delta: z.number().int().refine((v) => v !== 0, "delta no puede ser 0"),
  tipo: z.enum(["compra", "ajuste", "merma"]),
  nota: z.string().max(200).nullish(),
});

const cashOpenPayload = z.object({
  id: z.string().min(1).max(40),
  opening_cents: z.number().int().min(0),
  moneda: z.enum(["CUP", "USD"]).default("CUP"),
});

const cashClosePayload = z.object({
  id: z.string().min(1).max(40),
  closing_cents: z.number().int().min(0),
});

// El cajero solo vende y mueve caja; dueño/gerente pueden todo.
const CAJERO = new Set<OpType>(["sale.create", "cash.open", "cash.close"]);

// Devuelve los statements de la op (sin op_log) o un código de error.
function build(db: Db, ctx: SyncCtx, type: OpType, payload: unknown, now: Date): Stmt[] | string {
  switch (type) {
    case "sale.create": {
      const p = salePayload.safeParse(payload);
      if (!p.success) return "invalid_payload";
      const totalCents = p.data.items.reduce((sum, i) => sum + i.precio_cents * i.qty, 0);
      const stmts: Stmt[] = [
        db.insert(sales).values({
          id: p.data.id,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          deviceId: ctx.deviceId,
          totalCents,
          moneda: p.data.moneda,
          createdAt: new Date(p.data.created_at ?? now.getTime()),
        }),
      ];
      for (const i of p.data.items) {
        stmts.push(
          db.insert(saleItems).values({
            id: newId(),
            saleId: p.data.id,
            tenantId: ctx.tenantId,
            productId: i.product_id,
            nombre: i.nombre,
            precioCents: i.precio_cents,
            qty: i.qty,
          }),
          // Venta ya ocurrió: se permite stock negativo. Sin stock_movements.
          db
            .update(products)
            .set({ stockQty: sql`${products.stockQty} - ${i.qty}`, updatedAt: now })
            .where(and(eq(products.id, i.product_id), eq(products.tenantId, ctx.tenantId))),
        );
      }
      return stmts;
    }
    case "product.upsert": {
      const p = productPayload.safeParse(payload);
      if (!p.success) return "invalid_payload";
      const set = {
        nombre: p.data.nombre,
        categoria: p.data.categoria ?? null,
        precioCents: p.data.precio_cents,
        moneda: p.data.moneda,
        costoCents: p.data.costo_cents ?? null,
        activo: p.data.activo ?? true,
        deletedAt: null,
        updatedAt: now,
      };
      // setWhere: nunca mueve un producto de otro tenant. Gana la última op aplicada.
      return [
        db
          .insert(products)
          .values({ id: p.data.id, tenantId: ctx.tenantId, ...set, stockQty: 0 })
          .onConflictDoUpdate({ target: products.id, set, setWhere: eq(products.tenantId, ctx.tenantId) }),
      ];
    }
    case "product.delete": {
      const p = deletePayload.safeParse(payload);
      if (!p.success) return "invalid_payload";
      return [
        db
          .update(products)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(eq(products.id, p.data.id), eq(products.tenantId, ctx.tenantId))),
      ];
    }
    case "stock.adjust": {
      const p = stockPayload.safeParse(payload);
      if (!p.success) return "invalid_payload";
      return [
        db.insert(stockMovements).values({
          id: newId(),
          tenantId: ctx.tenantId,
          productId: p.data.product_id,
          delta: p.data.delta,
          tipo: p.data.tipo,
          nota: p.data.nota ?? null,
          userId: ctx.userId,
          createdAt: now,
        }),
        db
          .update(products)
          .set({ stockQty: sql`${products.stockQty} + ${p.data.delta}`, updatedAt: now })
          .where(and(eq(products.id, p.data.product_id), eq(products.tenantId, ctx.tenantId))),
      ];
    }
    case "cash.open": {
      const p = cashOpenPayload.safeParse(payload);
      if (!p.success) return "invalid_payload";
      return [
        db.insert(cashSessions).values({
          id: p.data.id,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          openedAt: now,
          openingCents: p.data.opening_cents,
          moneda: p.data.moneda,
        }),
      ];
    }
    case "cash.close": {
      const p = cashClosePayload.safeParse(payload);
      if (!p.success) return "invalid_payload";
      return [
        db
          .update(cashSessions)
          .set({ closedAt: now, closingCents: p.data.closing_cents })
          .where(and(eq(cashSessions.id, p.data.id), eq(cashSessions.tenantId, ctx.tenantId))),
      ];
    }
  }
}

function rawOpId(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "op_id" in raw) {
    const id = (raw as { op_id?: unknown }).op_id;
    if (typeof id === "string" && id.length > 0 && id.length <= 40) return id;
  }
  return "(invalid)";
}

async function applyOne(db: Db, ctx: SyncCtx, raw: unknown): Promise<OpResult> {
  const parsed = opSchema.safeParse(raw);
  if (!parsed.success) return { op_id: rawOpId(raw), status: "rejected", error: "invalid_op" };
  const { op_id, type } = parsed.data;

  const [existing] = await db.select({ tenantId: opLog.tenantId }).from(opLog).where(eq(opLog.opId, op_id)).limit(1);
  if (existing) {
    return existing.tenantId === ctx.tenantId
      ? { op_id, status: "duplicate" }
      : { op_id, status: "rejected", error: "op_id_conflict" };
  }

  if (ctx.role === "cajero" && !CAJERO.has(type)) return { op_id, status: "rejected", error: "forbidden" };

  const now = new Date();
  const built = build(db, ctx, type, parsed.data.payload, now);
  if (typeof built === "string") return { op_id, status: "rejected", error: built };

  const stmts: Stmt[] = [
    ...built,
    db.insert(opLog).values({ opId: op_id, tenantId: ctx.tenantId, userId: ctx.userId, deviceId: ctx.deviceId, appliedAt: now }),
  ];
  try {
    await db.batch(stmts as [Stmt, ...Stmt[]]);
    return { op_id, status: "applied" };
  } catch {
    // Carrera con otro dispositivo que aplicó el mismo op_id: el batch revirtió todo.
    const [other] = await db.select({ tenantId: opLog.tenantId }).from(opLog).where(eq(opLog.opId, op_id)).limit(1);
    if (other) {
      return other.tenantId === ctx.tenantId
        ? { op_id, status: "duplicate" }
        : { op_id, status: "rejected", error: "op_id_conflict" };
    }
    return { op_id, status: "rejected", error: "write_failed" };
  }
}

export async function applyOps(db: Db, ctx: SyncCtx, ops: unknown[]): Promise<OpResult[]> {
  const results: OpResult[] = [];
  for (const op of ops) results.push(await applyOne(db, ctx, op));
  return results;
}
