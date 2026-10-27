import { and, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import { products, saleItems, sales, users } from "./schema";

export type NewProduct = Omit<typeof products.$inferInsert, "tenantId">;

// Toda consulta a tablas con tenant_id pasa por un helper como este.
export function tenantProducts(db: Db, tenantId: string) {
  return {
    list: () => db.select().from(products).where(eq(products.tenantId, tenantId)),
    insert: (p: NewProduct) => db.insert(products).values({ ...p, tenantId }),
  };
}

// Reporte del día: agregaciones en SQL (3 consultas), el JS solo da forma al JSON.
export function tenantReports(db: Db, tenantId: string) {
  const rango = (from: number, to: number) =>
    and(eq(sales.tenantId, tenantId), gte(sales.occurredAt, new Date(from)), lte(sales.occurredAt, new Date(to)));

  return {
    porMetodo: (from: number, to: number) =>
      db
        .select({
          moneda: sales.moneda,
          method: sales.method,
          ventas: count(),
          total_cents: sql<number>`coalesce(sum(${sales.totalCents}), 0)`,
        })
        .from(sales)
        .where(rango(from, to))
        .groupBy(sales.moneda, sales.method),
    topProductos: (from: number, to: number) =>
      db
        .select({
          product_id: saleItems.productId,
          nombre: sql<string>`max(${saleItems.nombre})`,
          qty: sql<number>`coalesce(sum(${saleItems.qty}), 0)`,
        })
        .from(saleItems)
        .innerJoin(sales, eq(sales.id, saleItems.saleId))
        .where(rango(from, to))
        .groupBy(saleItems.productId)
        .orderBy(desc(sql`sum(${saleItems.qty})`))
        .limit(5),
    // Por usuario Y moneda: nunca se suman monedas distintas.
    porUsuario: (from: number, to: number) =>
      db
        .select({
          user_id: sales.userId,
          nombre: users.name,
          moneda: sales.moneda,
          ventas: count(),
          total_cents: sql<number>`coalesce(sum(${sales.totalCents}), 0)`,
        })
        .from(sales)
        .innerJoin(users, eq(users.id, sales.userId))
        .where(rango(from, to))
        .groupBy(sales.userId, users.name, sales.moneda),
  };
}
