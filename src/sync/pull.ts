import { and, asc, eq, gt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { products } from "../db/schema";

export type Cursor = { ts: number; id: string };

// Cursor "updated_at:id". null = desde el principio; undefined = inválido.
export function parseCursor(s: string | undefined): Cursor | null | undefined {
  if (!s) return null;
  const sep = s.indexOf(":");
  if (sep <= 0) return undefined;
  const ts = Number(s.slice(0, sep));
  const id = s.slice(sep + 1);
  if (!Number.isInteger(ts) || ts < 0 || !id) return undefined;
  return { ts, id };
}

function toWire(p: typeof products.$inferSelect) {
  return {
    id: p.id,
    nombre: p.nombre,
    categoria: p.categoria,
    precioCents: p.precioCents,
    moneda: p.moneda,
    costoCents: p.costoCents,
    activo: p.activo,
    trackStock: p.trackStock,
    minStock: p.minStock,
    stockQty: p.stockQty,
    updatedAt: p.updatedAt.getTime(),
    deletedAt: p.deletedAt ? p.deletedAt.getTime() : null,
  };
}

export async function pullProducts(db: Db, tenantId: string, cursor: Cursor | null, limit = 200) {
  const after = cursor
    ? or(
        gt(products.updatedAt, new Date(cursor.ts)),
        and(eq(products.updatedAt, new Date(cursor.ts)), gt(products.id, cursor.id)),
      )
    : undefined;
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), after))
    .orderBy(asc(products.updatedAt), asc(products.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    products: page.map(toWire),
    cursor: last ? `${last.updatedAt.getTime()}:${last.id}` : cursor ? `${cursor.ts}:${cursor.id}` : "",
    has_more: hasMore,
  };
}
