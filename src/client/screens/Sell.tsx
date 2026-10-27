import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "preact/hooks";
import { newId } from "../../lib/ids";
import { formatMoney } from "../../shared/money";
import type { Moneda, PaymentMethod } from "../../shared/ops";
import { db, type CashSessionRow, type ProductRow } from "../db";
import { isActivo } from "../lowstock";
import type { ScreenProps } from "../router";
import { enqueue } from "../sync";

type Item = { product_id: string; nombre: string; precio_cents: number; qty: number; trackStock: boolean; stockQty: number };

const MONEDAS: { id: Moneda; label: string }[] = [
  { id: "CUP", label: "CUP ($)" },
  { id: "USD", label: "USD (US$)" },
];

const METODOS: { id: PaymentMethod; label: string }[] = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "otro", label: "Otro" },
];

export default function Sell({ session }: ScreenProps) {
  const [moneda, setMoneda] = useState<Moneda>("CUP");
  const [productos, setProductos] = useState<ProductRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [metodo, setMetodo] = useState<PaymentMethod>("efectivo");
  const [hoja, setHoja] = useState(false);
  const [aviso, setAviso] = useState("");
  const [sesiones, setSesiones] = useState<CashSessionRow[]>([]);

  useEffect(() => {
    const sub = liveQuery(() => db.products.toArray()).subscribe({
      next: setProductos,
      error: () => setError("No se pudieron leer los productos de este dispositivo."),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const sub = liveQuery(() =>
      db.cash_sessions
        .where("[user_id+moneda]")
        .equals([session.userId, moneda])
        .toArray(),
    ).subscribe(setSesiones);
    return () => sub.unsubscribe();
  }, [session.userId, moneda]);

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(query.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  const catalogo = useMemo(() => (productos ?? []).filter((p) => isActivo(p) && p.moneda === moneda), [productos, moneda]);
  const categorias = useMemo(() => [...new Set(catalogo.map((p) => p.categoria).filter((c): c is string => !!c))].sort(), [catalogo]);
  const visibles = useMemo(
    () => catalogo.filter((p) => (!cat || p.categoria === cat) && (!busqueda || p.nombre.toLowerCase().includes(busqueda))),
    [catalogo, cat, busqueda],
  );

  const abierta = sesiones.find((s) => s.closed_at === null) ?? null;
  const total = items.reduce((sum, i) => sum + i.precio_cents * i.qty, 0);
  const cantidad = items.reduce((sum, i) => sum + i.qty, 0);

  function cambiarMoneda(m: Moneda) {
    if (m === moneda) return;
    if (items.length) {
      setItems([]);
      setAviso("Carrito vaciado al cambiar de moneda");
    }
    setMoneda(m);
    setCat(null);
  }

  function sumar(p: ProductRow) {
    setItems((prev) => {
      const igual = prev.find((i) => i.product_id === p.id);
      if (igual) return prev.map((i) => (i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { product_id: p.id, nombre: p.nombre, precio_cents: p.precioCents, qty: 1, trackStock: p.trackStock, stockQty: p.stockQty }];
    });
  }

  function poner(id: string, qty: number) {
    setItems((prev) => prev.map((i) => (i.product_id === id ? { ...i, qty: Math.max(1, Math.min(10_000, qty || 1)) } : i)));
  }

  async function abrirCaja() {
    const id = newId();
    await enqueue("cash.open", { id, opening_cents: 0, moneda });
    setAviso(`Caja abierta en ${moneda} con monto inicial 0`);
  }

  async function confirmar() {
    if (!items.length) return;
    await enqueue("sale.create", {
      id: newId(),
      moneda,
      method: metodo,
      cash_session_id: abierta?.id ?? null,
      occurred_at: Date.now(),
      items: items.map((i) => ({ product_id: i.product_id, nombre: i.nombre, precio_cents: i.precio_cents, qty: i.qty })),
    });
    setItems([]);
    setHoja(false);
    setAviso("Venta guardada");
  }

  if (error) return <main><p class="error">{error}</p></main>;

  return (
    <main>
      <div class="fila">
        <div class="chips" style="flex:1">
          {MONEDAS.map((m) => (
            <button key={m.id} type="button" class={m.id === moneda ? "chip on" : "chip"} onClick={() => cambiarMoneda(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div class="corto">
          {abierta ? (
            <span class="tag bien">Caja abierta</span>
          ) : (
            <button type="button" class="chip" onClick={() => void abrirCaja()}>
              Caja cerrada · Abrir
            </button>
          )}
        </div>
      </div>

      <input value={query} placeholder="Buscar producto" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />

      {categorias.length > 0 && (
        <div class="chips">
          <button type="button" class={cat === null ? "chip on" : "chip"} onClick={() => setCat(null)}>
            Todas
          </button>
          {categorias.map((c) => (
            <button key={c} type="button" class={cat === c ? "chip on" : "chip"} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {productos === null && <p class="estado">Cargando productos…</p>}
      {productos !== null && visibles.length === 0 && (
        <p class="estado">
          {catalogo.length === 0 ? `No hay productos en ${moneda}.` : "Ningún producto coincide con la búsqueda."}
        </p>
      )}

      <div class="grid">
        {visibles.map((p) => {
          const sinStock = p.trackStock && p.stockQty <= 0;
          return (
            <button key={p.id} type="button" class="tarjeta" onClick={() => sumar(p)}>
              <span>{p.nombre}</span>
              <span class="precio">{formatMoney(p.precioCents, p.moneda)}</span>
              {sinStock ? <span class="tag bajo">Sin stock</span> : p.trackStock ? <span class="tag">Quedan {p.stockQty}</span> : null}
            </button>
          );
        })}
      </div>

      {cantidad > 0 && (
        <button type="button" class="primario" style="position:fixed;left:12px;right:12px;bottom:calc(var(--nav-alto) + env(safe-area-inset-bottom) + 8px);z-index:25" onClick={() => setHoja(true)}>
          {cantidad} ítem{cantidad === 1 ? "" : "s"} · {formatMoney(total, moneda)}
        </button>
      )}

      {aviso && <p class="ok">{aviso}</p>}

      {hoja && (
        <>
          <div class="velo" onClick={() => setHoja(false)} />
          <section class="hoja">
            <h2>Carrito · {moneda}</h2>
            {items.length === 0 && <p class="estado">El carrito está vacío.</p>}
            <ul class="lista">
              {items.map((i) => (
                <li key={i.product_id}>
                  <div>
                    <div>{i.nombre}</div>
                    <small>
                      {formatMoney(i.precio_cents, moneda)} ·{" "}
                      {i.trackStock && i.stockQty - i.qty < 0 ? <span class="error">Sin stock suficiente</span> : "ok"}
                    </small>
                  </div>
                  <div class="qty">
                    <button type="button" onClick={() => poner(i.product_id, i.qty - 1)}>
                      −
                    </button>
                    <input
                      inputmode="numeric"
                      value={String(i.qty)}
                      onInput={(e) => poner(i.product_id, Number((e.currentTarget as HTMLInputElement).value))}
                    />
                    <button type="button" onClick={() => poner(i.product_id, i.qty + 1)}>
                      +
                    </button>
                    <button type="button" class="peligro" onClick={() => setItems((prev) => prev.filter((x) => x.product_id !== i.product_id))}>
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <h3>Método de pago</h3>
            <div class="chips">
              {METODOS.map((m) => (
                <button key={m.id} type="button" class={m.id === metodo ? "chip on" : "chip"} onClick={() => setMetodo(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            {!abierta && <p class="estado">Caja cerrada. La venta se guardará igual; puedes abrir la caja desde aquí.</p>}

            <div class="hoja-pie">
              <span class="total">{formatMoney(total, moneda)}</span>
              <div class="acciones">
                <button type="button" onClick={() => setHoja(false)}>
                  Seguir
                </button>
                <button type="button" class="primario" disabled={!items.length} onClick={() => void confirmar()}>
                  Confirmar venta
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
