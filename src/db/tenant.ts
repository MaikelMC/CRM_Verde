import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { products } from "./schema";

export type NewProduct = Omit<typeof products.$inferInsert, "tenantId">;

// Toda consulta a tablas con tenant_id pasa por un helper como este.
export function tenantProducts(db: Db, tenantId: string) {
  return {
    list: () => db.select().from(products).where(eq(products.tenantId, tenantId)),
    insert: (p: NewProduct) => db.insert(products).values({ ...p, tenantId }),
  };
}
