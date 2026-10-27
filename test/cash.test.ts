import { describe, expect, it } from "vitest";
import { cashDifferenceCents, expectedCashCents, type CashSale } from "../src/shared/cash";
import { formatCents, formatMoney, parseMoney } from "../src/shared/money";

const venta = (method: CashSale["method"], moneda: CashSale["moneda"], total_cents: number, cash_session_id: string | null = "s1"): CashSale => ({
  method,
  moneda,
  total_cents,
  cash_session_id,
});

describe("caja: efectivo esperado y diferencia (funciones puras)", () => {
  it("sin ventas el esperado es el monto inicial", () => {
    expect(expectedCashCents(50_000, "s1", "CUP", [])).toBe(50_000);
    expect(cashDifferenceCents(50_000, 50_000)).toBe(0);
  });

  it("solo suma ventas en efectivo de esa sesión y esa moneda", () => {
    const ventas = [
      venta("efectivo", "CUP", 1_250),
      venta("transferencia", "CUP", 900),
      venta("otro", "CUP", 400),
      venta("efectivo", "USD", 500),
      venta("efectivo", "CUP", 700, "otra-sesion"),
    ];
    expect(expectedCashCents(10_000, "s1", "CUP", ventas)).toBe(11_250);
    expect(expectedCashCents(0, "s1", "USD", ventas)).toBe(500);
  });

  it("la diferencia es positiva si sobra y negativa si falta", () => {
    expect(cashDifferenceCents(12_000, 11_250)).toBe(750);
    expect(cashDifferenceCents(10_000, 11_250)).toBe(-1_250);
    expect(cashDifferenceCents(11_250, 11_250)).toBe(0);
  });

  it("el dinero nunca se guarda como float", () => {
    expect(parseMoney("12,50")).toBe(1_250);
    expect(parseMoney("12.50")).toBe(1_250);
    expect(parseMoney("1.250")).toBe(125_000);
    expect(parseMoney("1.250,50")).toBe(125_050);
    expect(parseMoney("2.400")).toBe(240_000);
    expect(parseMoney("0,05")).toBe(5);
    expect(parseMoney("$ 30")).toBe(3_000);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    // Con un solo separador, 3 dígitos detrás se leen como miles (igual que "1.250").
    expect(parseMoney("12,555")).toBe(1_255_500);
    expect(parseMoney("12,5x")).toBeNull();
    expect(parseMoney("-5")).toBeNull();

    expect(formatCents(125_050)).toBe("1.250,50");
    expect(formatMoney(-1_250, "USD")).toBe("-US$12,50");
    expect(formatMoney(1_250, "CUP")).toBe("$12,50");
  });
});
