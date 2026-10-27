import type { Moneda } from "./ops";

// Dinero: siempre centavos enteros. Este módulo solo formatea/parsea; nunca hace aritmética con floats.

const SIMBOLO: Record<Moneda, string> = { CUP: "$", USD: "US$" };

// El separador de miles sale de Intl.NumberFormat('es'); algunos motores con ICU recortado no
// agrupan con "es", así que se agrupa a mano con ese separador.
const GRUPOS = new Intl.NumberFormat("es", { maximumFractionDigits: 0 });
const GRUPO = GRUPOS.formatToParts(1000).find((p) => p.type === "group")?.value ?? ".";
const agrupar = (entero: number): string => String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, GRUPO);

// 1250 -> "12,50" (sin símbolo, para editar en formularios)
export function formatCents(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  return `${cents < 0 ? "-" : ""}${agrupar(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, "0")}`;
}

// 1250 -> "$12,50"
export function formatMoney(cents: number, moneda: Moneda = "CUP"): string {
  return `${cents < 0 ? "-" : ""}${SIMBOLO[moneda]}${formatCents(Math.abs(cents))}`;
}

// Separa "1.250" (miles) de "12.50" (decimales) según los dígitos tras el último separador.
function unir(s: string, sep: string): string {
  const partes = s.split(sep);
  if (partes.length === 2) {
    const frac = partes[1] ?? "";
    if (frac.length <= 2) return `${partes[0]}.${frac}`;
    return partes.join("");
  }
  return partes.join("");
}

// "12,50" | "12.50" | "1.250" -> centavos. null si no es un monto válido.
export function parseMoney(input: string): number | null {
  let s = input.trim().replace(/[$\s]/g, "");
  const conComa = s.includes(",");
  const conPunto = s.includes(".");
  if (conComa && conPunto) {
    const dec = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
    const entero = s.slice(0, dec).replace(/[.,]/g, "");
    const frac = s.slice(dec + 1).replace(/[.,]/g, "");
    s = `${entero}.${frac}`;
  } else if (conComa) s = unir(s, ",");
  else if (conPunto) s = unir(s, ".");

  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [entero = "", frac = ""] = s.split(".");
  const cents = Number(entero) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
