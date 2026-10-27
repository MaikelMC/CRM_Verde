import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "preact/hooks";
import { newId } from "../../lib/ids";
import { cashDifferenceCents, expectedCashCents, type CashSale } from "../../shared/cash";
import { formatCents, formatMoney, parseMoney } from "../../shared/money";
import type { Moneda } from "../../shared/ops";
import { db, type CashSessionRow, type SaleLocal } from "../db";
import type { ScreenProps } from "../router";
import { enqueue } from "../sync";

const MONEDAS: Moneda[] = ["CUP", "USD"];

const fecha = (ms: number) => new Date(ms).toLocaleString("es", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function Cash({ session }: ScreenProps) {
  const [sesiones, setSesiones] = useState<CashSessionRow[] | null>(null);
  const [ventas, setVentas] = useState<SaleLocal[]>([]);
  const [error, setError] = useState("");
  const [moneda, setMoneda] = useState<Moneda>("CUP");
  const [inicial, setInicial] = useState("");
  const [errForm, setErrForm] = useState("");
  const [contado, setContado] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    const a = liveQuery(() => db.cash_sessions.orderBy("opened_at").reverse().toArray()).subscribe({
      next: setSesiones,
      error: () => setError("No se pudieron leer las cajas de este dispositivo."),
    });
    const b = liveQuery(() => db.sales_local.toArray()).subscribe(setVentas);
    return () => {
      a.unsubscribe();
      b.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  const mias = useMemo(
    () => (sesiones ?? []).filter((s) => s.user_id === session.userId),
    [sesiones, session.userId],
  );
  const abiertas = mias.filter((s) => s.closed_at === null);
  const libres = MONEDAS.filter((m) => !abiertas.some((s) => s.moneda === m));
  const monedaLibre = libres.includes(moneda) ? moneda : libres[0];
  const historial = mias.filter((s) => s.closed_at !== null).slice(0, 10);
  const ventasComoCaja: CashSale[] = useMemo(
    () =>
      ventas.map((v) => ({
        cash_session_id: v.cash_session_id,
        method: v.method,
        moneda: v.moneda,
        total_cents: v.totalCents,
      })),
    [ventas],
  );

  async function abrir() {
    if (!monedaLibre) return;
    const monto = parseMoney(inicial);
    if (monto === null) return setErrForm("Monto inicial: usa por ejemplo 500,00");
    await enqueue("cash.open", { id: newId(), opening_cents: monto, moneda: monedaLibre });
    setInicial("");
    setAviso(`Caja abierta en ${monedaLibre}`);
  }

  async function cerrar(s: CashSessionRow, esperado: number) {
    const texto = (contado[s.id] ?? "").trim();
    const monto = parseMoney(texto);
    if (monto === null) return setErrForm("Efectivo contado: usa por ejemplo 1200,00");
    await enqueue("cash.close", { id: s.id, closing_cents: monto });
    setContado({ ...contado, [s.id]: "" });
    setAviso(`Caja de ${s.moneda} cerrada`);
  }

  if (error) return <main><p class="error">{error}</p></main>;

  return (
    <main>
      {aviso && <p class="ok">{aviso}</p>}
      {sesiones === null && <p class="estado">Cargando cajas…</p>}

      {sesiones !== null && monedaLibre && (
        <section>
          <h2>Abrir caja</h2>
          <p class="estado">Una sesión abierta por usuario y moneda.</p>
          <div class="chips">
            {libres.map((m) => (
              <button key={m} type="button" class={m === monedaLibre ? "chip on" : "chip"} onClick={() => setMoneda(m)}>
                {m}
              </button>
            ))}
          </div>
          <label for="ini">Monto inicial</label>
          <input id="ini" inputmode="decimal" value={inicial} placeholder="500,00" onInput={(e) => setInicial((e.currentTarget as HTMLInputElement).value)} />
          {errForm && <p class="error">{errForm}</p>}
          <div class="acciones">
            <button type="button" class="primario" onClick={() => void abrir()}>
              Abrir caja en {monedaLibre}
            </button>
          </div>
        </section>
      )}

      {abiertas.map((s) => {
        const esperado = expectedCashCents(s.opening_cents, s.id, s.moneda, ventasComoCaja);
        const enEfectivo = esperado - s.opening_cents;
        const texto = contado[s.id] ?? "";
        const monto = parseMoney(texto);
        const diferencia = monto === null ? null : cashDifferenceCents(monto, esperado);
        return (
          <section key={s.id}>
            <h2>
              Caja abierta · {s.moneda} <span class="tag bien">{fecha(s.opened_at)}</span>
            </h2>
            <div class="resumen">
              <div class="bloque">
                <div>Monto inicial</div>
                <strong>{formatMoney(s.opening_cents, s.moneda)}</strong>
              </div>
              <div class="bloque">
                <div>Ventas en efectivo de esta caja</div>
                <strong>{formatMoney(enEfectivo, s.moneda)}</strong>
              </div>
              <div class="bloque">
                <div>Efectivo esperado</div>
                <strong class="total">{formatMoney(esperado, s.moneda)}</strong>
              </div>
            </div>

            <h3>Cerrar caja</h3>
            <label for={`contado-${s.id}`}>Efectivo contado</label>
            <input
              id={`contado-${s.id}`}
              inputmode="decimal"
              value={texto}
              placeholder={formatCents(esperado)}
              onInput={(e) => setContado({ ...contado, [s.id]: (e.currentTarget as HTMLInputElement).value })}
            />
            {diferencia !== null && (
              <p class={diferencia === 0 ? "ok" : "error"}>
                {diferencia === 0
                  ? "Cuadra exacto"
                  : diferencia > 0
                    ? `Sobran ${formatMoney(diferencia, s.moneda)}`
                    : `Faltan ${formatMoney(-diferencia, s.moneda)}`}
              </p>
            )}
            {errForm && <p class="error">{errForm}</p>}
            <div class="acciones">
              <button type="button" class="primario" disabled={texto.trim() === ""} onClick={() => void cerrar(s, esperado)}>
                Confirmar cierre
              </button>
            </div>
          </section>
        );
      })}

      <h2>Últimas 10 sesiones</h2>
      {mias.length === 0 && sesiones !== null && <p class="estado">Todavía no hay sesiones de caja en este dispositivo.</p>}
      <ul class="lista">
        {historial.map((s) => {
          const esperado = expectedCashCents(s.opening_cents, s.id, s.moneda, ventasComoCaja);
          const diferencia = s.closing_cents === null ? null : cashDifferenceCents(s.closing_cents, esperado);
          return (
            <li key={s.id}>
              <div>
                <div>
                  {s.moneda} · {fecha(s.opened_at)}
                </div>
                <small>
                  Inicial {formatMoney(s.opening_cents, s.moneda)} · esperado {formatMoney(esperado, s.moneda)}
                </small>
              </div>
              <div class="der">
                <div>Contado {s.closing_cents === null ? "—" : formatMoney(s.closing_cents, s.moneda)}</div>
                {diferencia !== null && (
                  <small class={diferencia === 0 ? "ok" : "error"}>
                    {diferencia === 0 ? "cuadra" : diferencia > 0 ? `sobran ${formatMoney(diferencia, s.moneda)}` : `faltan ${formatMoney(-diferencia, s.moneda)}`}
                  </small>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
