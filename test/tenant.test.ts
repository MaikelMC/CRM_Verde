import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { tenants } from "../src/db/schema";
import { tenantProducts } from "../src/db/tenant";

describe("aislamiento entre tenants", () => {
  it("cada tenant solo ve sus productos", async () => {
    const db = getDb(env.DB);
    const now = new Date();
    await db.insert(tenants).values([
      { id: "t1", name: "Cafetería A", createdAt: now },
      { id: "t2", name: "Cafetería B", createdAt: now },
    ]);

    const a = tenantProducts(db, "t1");
    const b = tenantProducts(db, "t2");
    await a.insert({ id: "p1", nombre: "Café", precioCents: 100, updatedAt: now });
    await b.insert({ id: "p2", nombre: "Té", precioCents: 100, updatedAt: now });

    const rows = await a.list();
    expect(rows.map((r) => r.id)).toEqual(["p1"]);
  });
});
