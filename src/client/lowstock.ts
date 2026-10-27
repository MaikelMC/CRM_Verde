import type { ProductRow } from "./db";

// Regla única de "stock bajo": controla inventario y está en o bajo el mínimo (o agotado).
export function isLowStock(p: ProductRow): boolean {
  return p.trackStock && p.stockQty <= Math.max(p.minStock, 0);
}

export function isActivo(p: ProductRow): boolean {
  return !p.deletedAt && p.activo;
}
