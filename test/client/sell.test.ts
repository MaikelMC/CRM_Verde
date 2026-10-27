import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/client/db";
import { enqueue } from "../../src/client/sync";

const MONEDA = "CUP" as const;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await db.meta.put({
    key: "session",
    value: JSON.stringify({ userId: "u1", name: "Ana", role: "cajero", tenantId: "t1" }),
  });
});

describe("venta offline", () => {
  it("descuenta stock local solo en productos con control, encola la op y no toca la red", async () => {
    await enqueue("product.upsert", { id: "p1", nombre: "Café", precio_cents: 250, moneda: MONEDA, track_stock: true });
    await enqueue("product.upsert", { id: "p2", nombre: "Agua", precio_cents: 100, moneda: MONEDA, track_stock: false });
    await enqueue("stock.adjust", { product_id: "p1", delta: 5, tipo: "compra" });
    await db.outbox.clear();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sin red"));

    const occurred_at = Date.now();
    await enqueue("sale.create", {
      id: "s1",
      moneda: MONEDA,
      method: "efectivo",
      cash_session_id: null,
      occurred_at,
      items: [
        { product_id: "p1", nombre: "Café", precio_cents: 250, qty: 2 },
        { product_id: "p2", nombre: "Agua", precio_cents: 100, qty: 3 },
      ],
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    // p1 controla inventario: 5 - 2 = 3. p2 no lo controla: sigue en 0.
    expect((await db.products.get("p1"))?.stockQty).toBe(3);
    expect((await db.products.get("p2"))?.stockQty).toBe(0);

    const outbox = await db.outbox.toArray();
    expect(outbox.map((o) => o.type)).toEqual(["sale.create"]);
    expect(outbox[0]?.status).toBe("pending");

    const local = await db.sales_local.get("s1");
    expect(local).toMatchObject({ totalCents: 250 * 2 + 100 * 3, moneda: MONEDA, method: "efectivo", user_id: "u1", occurred_at });
  });

  it("la venta y su op quedan en la misma transacción: si falla el outbox no se descuenta stock", async () => {
    await enqueue("product.upsert", { id: "p1", nombre: "Café", precio_cents: 250, moneda: MONEDA, track_stock: true });
    await db.outbox.clear();

    const add = vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("disco lleno"));
    await expect(
      enqueue("sale.create", {
        id: "s2",
        moneda: MONEDA,
        method: "transferencia",
        cash_session_id: null,
        occurred_at: Date.now(),
        items: [{ product_id: "p1", nombre: "Café", precio_cents: 250, qty: 1 }],
      }),
    ).rejects.toThrow();
    add.mockRestore();

    expect((await db.products.get("p1"))?.stockQty).toBe(0);
    expect(await db.sales_local.get("s2")).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});
