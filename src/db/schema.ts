import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type Role = "dueno" | "gerente" | "cajero";
export type Moneda = "CUP" | "USD";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Los códigos se guardan solo como SHA-256(pepper + código).
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  codeHash: text("code_hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    role: text("role", { enum: ["dueno", "gerente", "cajero"] }).notNull(),
  },
  (t) => [uniqueIndex("memberships_user_tenant").on(t.userId, t.tenantId)],
);

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  nombre: text("nombre").notNull(),
  categoria: text("categoria"),
  precioCents: integer("precio_cents").notNull(),
  moneda: text("moneda", { enum: ["CUP", "USD"] }).notNull().default("CUP"),
  costoCents: integer("costo_cents"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  stockQty: integer("stock_qty").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
}, (t) => [index("products_tenant_cursor").on(t.tenantId, t.updatedAt, t.id)]);

export const sales = sqliteTable("sales", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  userId: text("user_id").notNull().references(() => users.id),
  deviceId: text("device_id"),
  totalCents: integer("total_cents").notNull(),
  moneda: text("moneda", { enum: ["CUP", "USD"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const saleItems = sqliteTable("sale_items", {
  id: text("id").primaryKey(),
  saleId: text("sale_id").notNull().references(() => sales.id),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  productId: text("product_id").notNull(),
  nombre: text("nombre").notNull(),
  precioCents: integer("precio_cents").notNull(),
  qty: integer("qty").notNull(),
});

export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  productId: text("product_id").notNull(),
  delta: integer("delta").notNull(),
  tipo: text("tipo", { enum: ["compra", "ajuste", "merma"] }).notNull(),
  nota: text("nota"),
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const cashSessions = sqliteTable("cash_sessions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  userId: text("user_id").notNull().references(() => users.id),
  openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  openingCents: integer("opening_cents").notNull(),
  closingCents: integer("closing_cents"),
  moneda: text("moneda", { enum: ["CUP", "USD"] }).notNull(),
});

// Idempotencia de sync: una fila por op aplicada.
export const opLog = sqliteTable("op_log", {
  opId: text("op_id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  userId: text("user_id").notNull().references(() => users.id),
  deviceId: text("device_id"),
  appliedAt: integer("applied_at", { mode: "timestamp_ms" }).notNull(),
});
