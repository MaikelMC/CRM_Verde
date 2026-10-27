import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "preact/hooks";
import { newId } from "../../lib/ids";
import { formatCents, formatMoney, parseMoney } from "../../shared/money";
import { errorMessage, productPayloadSchema, type Moneda } from "../../shared/ops";
import { db, type ProductRow } from "../db";
import { isActivo } from "../lowstock";
import type { ScreenProps } from "../router";
import { enqueue } from "../sync";

type Form = {
  id: string;
  nombre: string;
  categoria: string;
  precio: string;
  moneda: Moneda;
  costo: string;
  trackStock: boolean;
  minStock: string;
  activo: boolean;
};

const enBlanco = (): Form => ({
  id: newId(),
  nombre: "",
  categoria: "",
  precio: "",
  moneda: "CUP",
  costo: "",
  trackStock: false,
  minStock: "0",
  activo: true,
});

const deProducto = (p: ProductRow): Form => ({
  id: p.id,
  nombre: p.nombre,
  categoria: p.categoria ?? "",
  precio: formatCents(p.precioCents),
  moneda: p.moneda,
  costo: p.costoCents === null ? "" : formatCents(p.costoCents),
  trackStock: p.trackStock,
  minStock: String(p.minStock),
  activo: p.activo,
});

export default function Products(_: ScreenProps) {
  const [productos, setProductos] = useState<ProductRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errForm, setErrForm] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    const sub = liveQuery(() => db.products.toArray()).subscribe({
      next: setProductos,
      error: () => setError("No se pudieron leer los productos de este dispositivo."),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  const vivos = useMemo(() => (productos ?? []).filter((p) => !p.deletedAt), [productos]);
  const editando = form ? (vivos.find((p) => p.id === form.id) ?? null) : null;
  const categorias = useMemo(() => [...new Set(vivos.map((p) => p.categoria).filter((c): c is string => !!c))].sort(), [vivos]);
  const visibles = useMemo(
    () =>
      vivos
        .filter((p) => (!cat || p.categoria === cat) && (!query || p.nombre.toLowerCase().includes(query.trim().toLowerCase())))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    [vivos, cat, query],
  );

  async function guardar() {
    if (!form) return;
    const precio = parseMoney(form.precio);
    if (precio === null) return setErrForm("Precio: usa por ejemplo 12,50");
    const costoTxt = form.costo.trim();
    const costo = costoTxt ? parseMoney(costoTxt) : null;
    if (costoTxt && costo === null) return setErrForm("Costo: usa por ejemplo 8,00");
    const min = form.trackStock ? Number(form.minStock.trim() || "0") : 0;
    if (!Number.isInteger(min) || min < 0) return setErrForm("Stock mínimo: número entero mayor o igual a 0");

    const parsed = productPayloadSchema.safeParse({
      id: form.id,
      nombre: form.nombre.trim(),
      categoria: form.categoria.trim() || null,
      precio_cents: precio,
      moneda: form.moneda,
      costo_cents: costo,
      activo: form.activo,
      track_stock: form.trackStock,
      min_stock: min,
    });
    if (!parsed.success) return setErrForm(errorMessage(parsed.error));

    await enqueue("product.upsert", parsed.data);
    setForm(null);
    setAviso("Producto guardado");
  }

  async function eliminar(p: ProductRow) {
    if (!confirm(`¿Eliminar "${p.nombre}"? Dejará de aparecer en el catálogo.`)) return;
    await enqueue("product.delete", { id: p.id });
    setAviso("Producto eliminado");
  }

  if (error) return <main><p class="error">{error}</p></main>;

  return (
    <main>
      <div class="fila">
        <input value={query} placeholder="Buscar producto" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
        <button type="button" class="primario corto" onClick={() => { setErrForm(""); setForm(enBlanco()); }}>
          Nuevo
        </button>
      </div>

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

      {aviso && <p class="ok">{aviso}</p>}
      {productos === null && <p class="estado">Cargando productos…</p>}
      {productos !== null && visibles.length === 0 && (
        <p class="estado">{vivos.length === 0 ? "Todavía no hay productos. Crea el primero con «Nuevo»." : "Ningún producto coincide."}</p>
      )}

      <ul class="lista">
        {visibles.map((p) => (
          <li key={p.id}>
            <div>
              <div>
                {p.nombre} {isActivo(p) ? null : <span class="tag aviso">Inactivo</span>}
              </div>
              <small>
                {formatMoney(p.precioCents, p.moneda)}
                {p.categoria ? ` · ${p.categoria}` : ""}
                {p.trackStock ? ` · Stock ${p.stockQty}` : ""}
              </small>
            </div>
            <div class="der">
              <button type="button" onClick={() => { setErrForm(""); setForm(deProducto(p)); }}>
                Editar
              </button>
            </div>
          </li>
        ))}
      </ul>
      {visibles.length > 0 && (
        <p class="estado">
          {visibles.length} producto{visibles.length === 1 ? "" : "s"}. Para eliminar, abre «Editar».
        </p>
      )}

      {form && (
        <>
          <div class="velo" onClick={() => setForm(null)} />
          <section class="hoja">
            <h2>{editando ? "Editar producto" : "Nuevo producto"}</h2>
            <label for="nombre">Nombre</label>
            <input id="nombre" value={form.nombre} onInput={(e) => setForm({ ...form, nombre: (e.currentTarget as HTMLInputElement).value })} />

            <label for="cat">Categoría</label>
            <input
              id="cat"
              list="categorias"
              value={form.categoria}
              placeholder="Cafés, Refrescos…"
              onInput={(e) => setForm({ ...form, categoria: (e.currentTarget as HTMLInputElement).value })}
            />
            <datalist id="categorias">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>

            <div class="fila">
              <div class="campo">
                <label for="precio">Precio</label>
                <input id="precio" inputmode="decimal" value={form.precio} placeholder="12,50" onInput={(e) => setForm({ ...form, precio: (e.currentTarget as HTMLInputElement).value })} />
              </div>
              <div class="corto">
                <label for="moneda">Moneda</label>
                <select id="moneda" value={form.moneda} onChange={(e) => setForm({ ...form, moneda: (e.currentTarget as HTMLSelectElement).value as Moneda })}>
                  <option value="CUP">CUP</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            <label for="costo">Costo (opcional)</label>
            <input id="costo" inputmode="decimal" value={form.costo} onInput={(e) => setForm({ ...form, costo: (e.currentTarget as HTMLInputElement).value })} />

            <label class="inline">
              <input type="checkbox" checked={form.trackStock} onChange={(e) => setForm({ ...form, trackStock: (e.currentTarget as HTMLInputElement).checked })} />
              Controla inventario
            </label>

            {form.trackStock && (
              <>
                <label for="min">Stock mínimo</label>
                <input id="min" inputmode="numeric" value={form.minStock} onInput={(e) => setForm({ ...form, minStock: (e.currentTarget as HTMLInputElement).value })} />
              </>
            )}

            <label class="inline">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: (e.currentTarget as HTMLInputElement).checked })} />
              Activo (visible en Vender)
            </label>

            {errForm && <p class="error">{errForm}</p>}

            <div class="acciones">
              <button type="button" class="primario" onClick={() => void guardar()}>
                Guardar
              </button>
              <button type="button" onClick={() => setForm(null)}>
                Cancelar
              </button>
              {editando && (
                <button type="button" class="peligro" onClick={() => void eliminar(editando)}>
                  Eliminar
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
