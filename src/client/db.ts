import Dexie, { type Table } from "dexie";
import { newId } from "../lib/ids";

export type ProductRow = {
  id: string;
  nombre: string;
  categoria: string | null;
  precioCents: number;
  moneda: "CUP" | "USD";
  costoCents: number | null;
  activo: boolean;
  stockQty: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type OpType = "sale.create" | "product.upsert" | "product.delete" | "stock.adjust" | "cash.open" | "cash.close";

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
  created_at: number;
  totalCents: number;
  moneda: "CUP" | "USD";
  items: { product_id: string; nombre: string; precio_cents: number; qty: number }[];
};

export type MetaRow = { key: string; value: string };

class LvDb extends Dexie {
  products!: Table<ProductRow, string>;
  outbox!: Table<OutboxRow, string>;
  sales_local!: Table<SaleLocal, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("lv_gestion");
    // v1: esquema inicial. Cambios futuros = this.version(2).stores(...).
    this.version(1).stores({
      products: "id, updatedAt",
      outbox: "op_id, created_at, status",
      sales_local: "id, created_at",
      meta: "key",
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
