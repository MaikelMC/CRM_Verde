import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});
