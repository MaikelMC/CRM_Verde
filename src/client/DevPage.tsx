import { liveQuery } from "dexie";
import { useEffect, useState } from "preact/hooks";
import { newId } from "../lib/ids";
import { db, type OutboxRow } from "./db";
import { SyncStatus } from "./SyncStatus";
import { enqueue, flush } from "./sync";

export function DevPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [productos, setProductos] = useState(0);

  useEffect(() => {
    const a = liveQuery(() => db.outbox.orderBy("created_at").toArray()).subscribe(setRows);
    const b = liveQuery(() => db.products.count()).subscribe(setProductos);
    return () => {
      a.unsubscribe();
      b.unsubscribe();
    };
  }, []);

  async function login(e: Event) {
    e.preventDefault();
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return setMsg("Código inválido");
    await navigator.storage?.persist?.();
    setMsg("Sesión iniciada");
    await flush();
  }

  async function testSale() {
    let first = await db.products.orderBy("id").first();
    if (!first) {
      const id = newId();
      await enqueue("product.upsert", { id, nombre: "Café de prueba", precio_cents: 250, moneda: "CUP" });
      first = await db.products.get(id);
    }
    if (!first) return;
    const p = first;
    const items = [1, 2, 3].map(() => ({
      product_id: p.id,
      nombre: p.nombre,
      precio_cents: p.precioCents,
      qty: 1,
    }));
    await enqueue("sale.create", { id: newId(), moneda: p.moneda, items });
    setMsg("Venta de prueba encolada (3 ítems)");
  }

  async function testAdjust() {
    const p = await db.products.orderBy("id").first();
    if (!p) return setMsg("Primero usa 'venta de prueba' para crear un producto");
    await enqueue("stock.adjust", { product_id: p.id, delta: 10, tipo: "compra", nota: "prueba /dev" });
    setMsg("Ajuste de stock encolado");
  }

  return (
    <main class="dev">
      <h1>/dev</h1>
      <SyncStatus />
      <form onSubmit={(e) => void login(e)}>
        <input value={code} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} placeholder="Código de acceso" />
        <button type="submit">Entrar</button>
      </form>
      <p>{msg}</p>
      <p>Productos locales: {productos}</p>
      <div class="actions">
        <button type="button" onClick={() => void testSale()}>
          Venta de prueba
        </button>
        <button type="button" onClick={() => void testAdjust()}>
          Ajuste de stock
        </button>
        <button type="button" onClick={() => void flush()}>
          Sincronizar ahora
        </button>
      </div>
      <h2>Pendientes ({rows.length})</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.op_id}>
            {r.type} · {r.status}
            {r.error ? ` · ${r.error}` : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
