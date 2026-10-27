import Dexie, { type Table } from "dexie";
import { newId } from "../lib/ids";
import type { Moneda, OpType, PaymentMethod } from "../shared/ops";

export type { Moneda, OpType, PaymentMethod };

export type ProductRow = {
  id: string;
  nombre: string;
  categoria: string | null;
  precioCents: number;
  moneda: Moneda;
  costoCents: number | null;
  activo: boolean;
  trackStock: boolean;
  minStock: number;
  stockQty: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type OutboxRow = {
  op_id: string;
  type: OpType;
  payload: unknown;
  created_at: number;
  status: "pending" | "sending" | "rejected";
  attempts: number;
  error?: string;
};

export type SaleLocal = {
  id: string;
  occurred_at: number;
  totalCents: number;
  moneda: Moneda;
  method: PaymentMethod;
  cash_session_id: string | null;
  user_id: string;
  items: { product_id: string; nombre: string; precio_cents: number; qty: number }[];
};

export type CashSessionRow = {
  id: string;
  user_id: string;
  moneda: Moneda;
  opened_at: number;
  closed_at: number | null;
  opening_cents: number;
  closing_cents: number | null;
};

export type MetaRow = { key: string; value: string };

class LvDb extends Dexie {
  products!: Table<ProductRow, string>;
  outbox!: Table<OutboxRow, string>;
  sales_local!: Table<SaleLocal, string>;
  cash_sessions!: Table<CashSessionRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("lv_gestion");
    this.version(1).stores({
      products: "id, updatedAt",
      outbox: "op_id, created_at, status",
      sales_local: "id, created_at",
      meta: "key",
    });
    // v2: inventario (trackStock/minStock), caja y ventas locales con método y sesión.
    this.version(2)
      .stores({
        products: "id, updatedAt, moneda",
        outbox: "op_id, created_at, status",
        sales_local: "id, occurred_at, moneda, cash_session_id",
        cash_sessions: "id, opened_at, closed_at, [user_id+moneda]",
        meta: "key",
      })
      .upgrade(async (tx) => {
        await tx
          .table("products")
          .toCollection()
          .modify((p: ProductRow) => {
            p.trackStock ??= false;
            p.minStock ??= 0;
          });
      });
  }
}

export const db = new LvDb();

export async function getDeviceId(): Promise<string> {
  const row = await db.meta.get("device_id");
  if (row) return row.value;
  const value = newId();
  await db.meta.put({ key: "device_id", value });
  return value;
}
