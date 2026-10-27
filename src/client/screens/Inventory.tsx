import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "preact/hooks";
import { stockPayloadSchema, errorMessage } from "../../shared/ops";
import { db, type ProductRow } from "../db";
import { isLowStock } from "../lowstock";
import type { ScreenProps } from "../router";
import { puedeEditar } from "../session";
import { enqueue } from "../sync";

type Tipo = "compra" | "ajuste" | "merma";
type Ajuste = { producto: ProductRow; tipo: Tipo; cantidad: string; signo: 1 | -1; nota: string };

const TIPOS: { id: Tipo; label: string }[] = [
  { id: "compra", label: "Compra (entrada)" },
  { id: "ajuste", label: "Ajuste (±)" },
  { id: "merma", label: "Merma (salida)" },
];

export default function Inventory({ session }: ScreenProps) {
  const [productos, setProductos] = useState<ProductRow[] | null>(null);
  const [error, setError] = useState("");
  const [soloBajos, setSoloBajos] = useState(false);
  const [query, setQuery] = useState("");
  const [ajuste, setAjuste] = useState<Ajuste | null>(null);
  const [errForm, setErrForm] = useState("");
  const [aviso, setAviso] = useState("");
  const editar = puedeEditar(session.role);

  useEffect(() => {
    const sub = liveQuery(() => db.products.toArray()).subscribe({
      next: setProductos,
      error: () => setError("No se pudo leer el inventario de este dispositivo."),
    });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(""), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  const conControl = useMemo(() => (productos ?? []).filter((p) => !p.deletedAt && p.trackStock), [productos]);
  const visibles = useMemo(
    () =>
      conControl
        .filter((p) => (!soloBajos || isLowStock(p)) && (!query || p.nombre.toLowerCase().includes(query.trim().toLowerCase())))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    [conControl, soloBajos, query],
  );
  const bajos = conControl.filter(isLowStock).length;

  async function guardarAjuste() {
    if (!ajuste) return;
    const q = Number(ajuste.cantidad.trim());
    if (!Number.isInteger(q) || q <= 0) return setErrForm("Cantidad: número entero mayor que 0");
    const delta = ajuste.tipo === "compra" ? q : ajuste.tipo === "merma" ? -q : q * ajuste.signo;
    const parsed = stockPayloadSchema.safeParse({
      product_id: ajuste.producto.id,
      delta,
      tipo: ajuste.tipo,
      nota: ajuste.nota.trim() || null,
    });
    if (!parsed.success) return setErrForm(errorMessage(parsed.error));

    await enqueue("stock.adjust", parsed.data);
    setAjuste(null);
    setAviso("Stock ajustado");
  }

  if (error) return <main><p class="error">{error}</p></main>;

  return (
    <main>
      <div class="fila">
        <input value={query} placeholder="Buscar" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
        <div class="corto">
          <button type="button" class={soloBajos ? "chip on" : "chip"} onClick={() => setSoloBajos(!soloBajos)}>
            Solo bajos {bajos > 0 ? `(${bajos})` : ""}
          </button>
        </div>
      </div>

      {aviso && <p class="ok">{aviso}</p>}
      {productos === null && <p class="estado">Cargando inventario…</p>}
      {productos !== null && conControl.length === 0 && (
        <p class="estado">Ningún producto controla inventario todavía. Actívalo en Productos → Controla inventario.</p>
      )}
      {productos !== null && conControl.length > 0 && visibles.length === 0 && <p class="estado">Sin resultados.</p>}

      <ul class="lista">
        {visibles.map((p) => (
          <li key={p.id}>
            <div>
              <div>
                {p.nombre} {p.activo ? null : <span class="tag aviso">Inactivo</span>}
              </div>
              <small>
                Stock {p.stockQty} · mínimo {p.minStock}
              </small>
            </div>
            <div class="der">
              {isLowStock(p) && <span class="tag bajo">{p.stockQty <= 0 ? "Agotado" : "Bajo"}</span>}{" "}
              {editar && (
                <button type="button" onClick={() => { setErrForm(""); setAjuste({ producto: p, tipo: "compra", cantidad: "", signo: 1, nota: "" }); }}>
                  Ajustar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!editar && <p class="estado">Solo lectura: tu rol no puede ajustar stock.</p>}

      {ajuste && (
        <>
          <div class="velo" onClick={() => setAjuste(null)} />
          <section class="hoja">
            <h2>Ajustar stock · {ajuste.producto.nombre}</h2>
            <p class="estado">
              Stock actual {ajuste.producto.stockQty} · mínimo {ajuste.producto.minStock}
            </p>

            <div class="chips">
              {TIPOS.map((t) => (
                <button key={t.id} type="button" class={t.id === ajuste.tipo ? "chip on" : "chip"} onClick={() => setAjuste({ ...ajuste, tipo: t.id })}>
                  {t.label}
                </button>
              ))}
            </div>

            <div class="fila">
              <div class="campo">
                <label for="cant">Cantidad</label>
                <input id="cant" inputmode="numeric" value={ajuste.cantidad} placeholder="0" onInput={(e) => setAjuste({ ...ajuste, cantidad: (e.currentTarget as HTMLInputElement).value })} />
              </div>
              {ajuste.tipo === "ajuste" && (
                <div class="corto">
                  <label>Signo</label>
                  <div class="chips">
                    <button type="button" class={ajuste.signo === 1 ? "chip on" : "chip"} onClick={() => setAjuste({ ...ajuste, signo: 1 })}>
                      + suma
                    </button>
                    <button type="button" class={ajuste.signo === -1 ? "chip on" : "chip"} onClick={() => setAjuste({ ...ajuste, signo: -1 })}>
                      − resta
                    </button>
                  </div>
                </div>
              )}
            </div>

            <label for="nota">Nota (opcional)</label>
            <input id="nota" value={ajuste.nota} onInput={(e) => setAjuste({ ...ajuste, nota: (e.currentTarget as HTMLInputElement).value })} />

            {errForm && <p class="error">{errForm}</p>}

            <div class="acciones">
              <button type="button" class="primario" onClick={() => void guardarAjuste()}>
                Guardar ajuste
              </button>
              <button type="button" onClick={() => setAjuste(null)}>
                Cancelar
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
