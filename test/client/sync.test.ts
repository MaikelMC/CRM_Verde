import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/client/db";
import { enqueue, flush } from "../../src/client/sync";

const PRODUCT = { id: "01JTESTPRODUCT000000000001", nombre: "Café", precio_cents: 250, moneda: "CUP" as const };
const SALE = {
  id: "01JTESTSALE000000000000001",
  items: [{ product_id: PRODUCT.id, nombre: "Café", precio_cents: 250, qty: 1 }],
};

function fakeServer() {
  const seen = new Set<string>();
  const sales: string[] = [];
  let cut = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/sync?since")) {
      return new Response(JSON.stringify({ products: [], cursor: "", has_more: false }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      ops: { op_id: string; type: string; payload: { id?: string } }[];
    };
    const results = body.ops.map((op) => {
      if (seen.has(op.op_id)) return { op_id: op.op_id, status: "duplicate" };
      seen.add(op.op_id);
      if (op.type === "sale.create" && op.payload.id) sales.push(op.payload.id);
      return { op_id: op.op_id, status: "applied" };
    });
    if (cut) {
      cut = false;
      // El servidor aplicó, pero se corta la conexión antes de la respuesta.
      throw new TypeError("network cut");
    }
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, sales, cutOnce: () => (cut = true) };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("cliente offline", () => {
  it("sin red las ops quedan pending", async () => {
    await enqueue("product.upsert", PRODUCT);
    await enqueue("sale.create", SALE);

    await flush({ online: false });

    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("al volver la red se sincronizan y el outbox se vacía", async () => {
    await enqueue("product.upsert", PRODUCT);
    await enqueue("sale.create", SALE);
    const server = fakeServer();

    await flush({ fetch: server.fetchImpl });

    expect(await db.outbox.count()).toBe(0);
    expect(server.sales).toEqual([SALE.id]);
    expect(await db.sales_local.count()).toBe(1);
  });

  it("un flush cortado a la mitad y reintentado no duplica", async () => {
    await enqueue("product.upsert", PRODUCT);
    await enqueue("sale.create", SALE);
    const server = fakeServer();

    server.cutOnce();
    await flush({ fetch: server.fetchImpl });
    expect(await db.outbox.count()).toBe(2);
    expect(server.sales).toHaveLength(1);

    await flush({ fetch: server.fetchImpl });
    expect(await db.outbox.count()).toBe(0);
    expect(server.sales).toHaveLength(1);
  });
});
