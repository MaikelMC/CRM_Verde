import type { Moneda, PaymentMethod } from "./ops";

// Caja: funciones puras (sin Dexie ni red) para poder probarlas aisladas.

export type CashSale = {
  cash_session_id?: string | null;
  method: PaymentMethod;
  moneda: Moneda;
  total_cents: number;
};

// Efectivo esperado = inicial + ventas en efectivo de esa sesión y esa moneda.
export function expectedCashCents(
  openingCents: number,
  sessionId: string,
  moneda: Moneda,
  sales: readonly CashSale[],
): number {
  return sales.reduce(
    (sum, s) => (s.method === "efectivo" && s.moneda === moneda && s.cash_session_id === sessionId ? sum + s.total_cents : sum),
    openingCents,
  );
}

// Sobra si > 0, falta si < 0.
export function cashDifferenceCents(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents;
}
