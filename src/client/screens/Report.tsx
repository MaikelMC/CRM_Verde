import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "preact/hooks";
import { formatMoney } from "../../shared/money";
import type { Moneda } from "../../shared/ops";
import { db, type SaleLocal } from "../db";
import type { ScreenProps } from "../router";

type Fila = { moneda: Moneda; method: string; ventas: number; total_cents: number };
type Top = { product_id: string; nombre: string; qty: number; moneda: Moneda };
type Negocio = {
  totals: Fila[];
  top_products: { product_id: string; nombre: string; qty: number }[];
  by_user: { user_id: string; nombre: string; moneda: Moneda; ventas: number; total_cents: number }[];
};

const hoyLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Límites del día en la zona horaria del dispositivo.
function rangoDe(dia: string): { from: number; to: number } {
  const [y = 1970, m = 1, d = 1] = dia.split("-").map(Number);
  return { from: new Date(y, m - 1, d).getTime(), to: new Date(y, m - 1, d + 1).getTime() };
}

export default function Report({ session }: ScreenProps) {
  const [dia, setDia] = useState(hoyLocal);
  const [ventas, setVentas] = useState<SaleLocal[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [estadoNegocio, setEstadoNegocio] = useState<"idle" | "cargando" | "error" | "offline">("idle");
  const puedeVerTodo = session.role === "dueno" || session.role === "gerente";

  useEffect(() => {
    const a = liveQuery(() => db.sales_local.orderBy("occurred_at").toArray()).subscribe(setVentas);
    const b = liveQuery(() => db.outbox.filter((o) => o.type === "sale.create" && o.status !== "rejected").count()).subscribe(setPendientes);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      a.unsubscribe();
      b.unsubscribe();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const { from, to } = useMemo(() => rangoDe(dia), [dia]);
  const mias = useMemo(
    () => ventas.filter((v) => v.user_id === session.userId && v.occurred_at >= from && v.occurred_at < to),
    [ventas, session.userId, from, to],
  );

  const porMetodo = useMemo(() => {
    const mapa = new Map<string, Fila>();
    for (const v of mias) {
      const clave = `${v.moneda}|${v.method}`;
      const fila = mapa.get(clave) ?? { moneda: v.moneda, method: v.method, ventas: 0, total_cents: 0 };
      fila.ventas += 1;
      fila.total_cents += v.totalCents;
      mapa.set(clave, fila);
    }
    return [...mapa.values()].sort((a, b) => (a.moneda === b.moneda ? b.total_cents - a.total_cents : a.moneda.localeCompare(b.moneda)));
  }, [mias]);

  const porMoneda = useMemo(() => {
    const mapa = new Map<Moneda, number>();
    for (const v of mias) mapa.set(v.moneda, (mapa.get(v.moneda) ?? 0) + v.totalCents);
    return [...mapa.entries()];
  }, [mias]);

  const top = useMemo(() => {
    const mapa = new Map<string, Top>();
    for (const v of mias) {
      for (const i of v.items) {
        const fila = mapa.get(i.product_id) ?? { product_id: i.product_id, nombre: i.nombre, qty: 0, moneda: v.moneda };
        fila.qty += i.qty;
        mapa.set(i.product_id, fila);
      }
    }
    return [...mapa.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [mias]);

  useEffect(() => {
    if (!puedeVerTodo || !online) {
      setNegocio(null);
      setEstadoNegocio(online ? "idle" : "offline");
      return;
    }
    let vivo = true;
    setEstadoNegocio("cargando");
    void (async () => {
      try {
        const res = await fetch(`/api/reports/day?from=${from}&to=${to}`, { credentials: "same-origin" });
        if (!vivo) return;
        if (!res.ok) return setEstadoNegocio("error");
        setNegocio((await res.json()) as Negocio);
        setEstadoNegocio("idle");
      } catch {
        if (vivo) setEstadoNegocio("error");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [puedeVerTodo, online, from, to]);

  return (
    <main>
      <label for="dia">Día</label>
      <input id="dia" type="date" value={dia} onChange={(e) => setDia((e.currentTarget as HTMLInputElement).value)} />

      <h2>Este dispositivo</h2>
      <p class="estado">
        Ventas de {session.name || "tu usuario"} guardadas aquí el {new Date(from).toLocaleDateString("es")}.
      </p>

      {mias.length === 0 ? (
        <p class="estado">Sin ventas tuyas en este dispositivo ese día.</p>
      ) : (
        <>
          <div class="resumen">
            <div class="bloque">
              <div>Ventas</div>
              <strong>{mias.length}</strong>
            </div>
            {porMoneda.map(([m, total]) => (
              <div class="bloque" key={m}>
                <div>Total en {m}</div>
                <strong class="total">{formatMoney(total, m)}</strong>
                <small>
                  Ticket promedio {formatMoney(Math.round(total / (mias.filter((v) => v.moneda === m).length || 1)), m)}
                </small>
              </div>
            ))}
          </div>

          <h3>Por método de pago</h3>
          <ul class="lista">
            {porMetodo.map((f) => (
              <li key={`${f.moneda}-${f.method}`}>
                <span>
                  {f.moneda} · {f.method}
                </span>
                <span class="der">
                  {f.ventas} · {formatMoney(f.total_cents, f.moneda)}
                </span>
              </li>
            ))}
          </ul>

          <h3>Top 5 productos</h3>
          <ul class="lista">
            {top.map((t) => (
              <li key={t.product_id}>
                <span>{t.nombre}</span>
                <span class="der">{t.qty}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Todo el negocio</h2>
      {!puedeVerTodo && <p class="estado">Solo el dueño o un gerente puede ver el total del negocio.</p>}
      {puedeVerTodo && !online && <p class="estado">Sin conexión: el total del negocio necesita internet. Lo de arriba funciona igual.</p>}
      {puedeVerTodo && online && estadoNegocio === "cargando" && <p class="estado">Consultando el servidor…</p>}
      {puedeVerTodo && online && estadoNegocio === "error" && <p class="error">No se pudo consultar el servidor. Reintenta en un momento.</p>}

      {puedeVerTodo && online && pendientes > 0 && (
        <p class="error">Hay {pendientes} venta{pendientes === 1 ? "" : "s"} sin sincronizar en este dispositivo; el total puede estar incompleto.</p>
      )}

      {puedeVerTodo && negocio && (
        <>
          {negocio.totals.length === 0 && <p class="estado">El servidor no registra ventas ese día.</p>}
          <ul class="lista">
            {negocio.totals.map((f) => (
              <li key={`${f.moneda}-${f.method}`}>
                <span>
                  {f.moneda} · {f.method}
                </span>
                <span class="der">
                  {Number(f.ventas)} · {formatMoney(Number(f.total_cents), f.moneda)}
                </span>
              </li>
            ))}
          </ul>

          {negocio.top_products.length > 0 && (
            <>
              <h3>Top 5 del negocio</h3>
              <ul class="lista">
                {negocio.top_products.map((t) => (
                  <li key={t.product_id}>
                    <span>{t.nombre}</span>
                    <span class="der">{Number(t.qty)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {negocio.by_user.length > 0 && (
            <>
              <h3>Por usuario</h3>
              <ul class="lista">
                {negocio.by_user.map((u) => (
                  <li key={`${u.user_id}-${u.moneda}`}>
                    <span>
                      {u.nombre} · {u.moneda}
                    </span>
                    <span class="der">
                      {Number(u.ventas)} · {formatMoney(Number(u.total_cents), u.moneda)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
