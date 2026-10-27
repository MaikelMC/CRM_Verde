import { z } from "zod";

// Contratos de las ops de sync, compartidos por servidor (validación) y cliente (tipos/formularios).

export const monedaSchema = z.enum(["CUP", "USD"]);
export type Moneda = z.infer<typeof monedaSchema>;

export const methodSchema = z.enum(["efectivo", "transferencia", "otro"]);
export type PaymentMethod = z.infer<typeof methodSchema>;

export const opTypeSchema = z.enum([
  "sale.create",
  "product.upsert",
  "product.delete",
  "stock.adjust",
  "cash.open",
  "cash.close",
]);
export type OpType = z.infer<typeof opTypeSchema>;

export const saleItemSchema = z.object({
  product_id: z.string().min(1).max(40),
  nombre: z.string().min(1).max(120),
  precio_cents: z.number().int().min(0),
  qty: z.number().int().min(1).max(10_000),
});
export type SaleItemPayload = z.infer<typeof saleItemSchema>;

export const salePayloadSchema = z.object({
  id: z.string().min(1).max(40),
  moneda: monedaSchema.default("CUP"),
  method: methodSchema.default("efectivo"),
  cash_session_id: z.string().min(1).max(40).nullish(),
  occurred_at: z.number().int().positive().optional(),
  items: z.array(saleItemSchema).min(1).max(100),
});
export type SalePayload = z.infer<typeof salePayloadSchema>;

export const productPayloadSchema = z.object({
  id: z.string().min(1).max(40),
  nombre: z.string().min(1).max(120),
  categoria: z.string().max(80).nullish(),
  precio_cents: z.number().int().min(0),
  moneda: monedaSchema.default("CUP"),
  costo_cents: z.number().int().min(0).nullish(),
  activo: z.boolean().optional(),
  track_stock: z.boolean().optional(),
  min_stock: z.number().int().min(0).optional(),
});
export type ProductPayload = z.infer<typeof productPayloadSchema>;

export const deletePayloadSchema = z.object({ id: z.string().min(1).max(40) });

export const stockPayloadSchema = z.object({
  product_id: z.string().min(1).max(40),
  delta: z.number().int().refine((v) => v !== 0, "delta no puede ser 0"),
  tipo: z.enum(["compra", "ajuste", "merma"]),
  nota: z.string().max(200).nullish(),
});
export type StockPayload = z.infer<typeof stockPayloadSchema>;

export const cashOpenPayloadSchema = z.object({
  id: z.string().min(1).max(40),
  opening_cents: z.number().int().min(0),
  moneda: monedaSchema.default("CUP"),
});
export type CashOpenPayload = z.infer<typeof cashOpenPayloadSchema>;

export const cashClosePayloadSchema = z.object({
  id: z.string().min(1).max(40),
  closing_cents: z.number().int().min(0),
});
export type CashClosePayload = z.infer<typeof cashClosePayloadSchema>;

export const opSchema = z.object({
  op_id: z.string().min(1).max(40),
  type: opTypeSchema,
  payload: z.unknown(),
});

const ETIQUETAS: Record<string, string> = {
  nombre: "Nombre",
  categoria: "Categoría",
  precio_cents: "Precio",
  costo_cents: "Costo",
  min_stock: "Stock mínimo",
  moneda: "Moneda",
  items: "Ítems",
  opening_cents: "Monto inicial",
  closing_cents: "Efectivo contado",
  delta: "Cantidad",
};

// Primer error de zod en español, con el nombre del campo.
export function errorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Datos inválidos";
  const campo = String(issue.path[0] ?? "");
  const etiqueta = ETIQUETAS[campo] ?? campo;
  if (issue.code === "invalid_type") return `${etiqueta}: valor inválido`;
  return etiqueta ? `${etiqueta}: ${issue.message}` : issue.message;
}
