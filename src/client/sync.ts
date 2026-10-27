import { newId } from "../lib/ids";
import type { CashClosePayload, CashOpenPayload, OpType, ProductPayload, SalePayload, StockPayload } from "../shared/ops";
import { db, getDeviceId, type ProductRow } from "./db";

type FetchLike = typeof fetch;
type SyncResult = { op_id: string; status: "applied" | "duplicate" | "rejected"; error?: string };
type SyncPage = { products: ProductRow[]; cursor: string; has_more: boolean };

export type { CashClosePayload, CashOpenPayload, ProductPayload, SalePayload, StockPayload };

const listeners = new Set<() => void>();
let needsLogin = false;
let flushing = false;
let backoffMs = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let enqueueTimer: ReturnType<typeof setTimeout> | undefined;

export function onSync(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const emit = () => listeners.forEach((l) => l());

export function loginRequired(): boolean {
  return needsLogin;
}

const isBrowser = () => typeof window !== "undefined";
const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

// Usuario de la sesión cacheada (la escribe ./session.ts al entrar o al refrescar /api/me).
async function currentUserId(): Promise<string> {
  const row = await db.meta.get("session");
  if (!row) return "";
  try {
    return (JSON.parse(row.value) as { userId?: string }).userId ?? "";
  } catch {
    return "";
  }
}

// Efecto local de la op. Todo dentro de la transacción de enqueue.
async function applyLocal(type: OpType, payload: unknown): Promise<void> {
  switch (type) {
    case "sale.create": {
      const p = payload as SalePayload;
      const totalCents = p.items.reduce((sum, i) => sum + i.precio_cents * i.qty, 0);
      // Solo se descuenta lo que se controla (misma regla que el servidor).
      for (const i of p.items) {
        const prod = await db.products.get(i.product_id);
        if (prod?.trackStock) await db.products.update(prod.id, { stockQty: prod.stockQty - i.qty });
      }
      await db.sales_local.put({
        id: p.id,
        occurred_at: p.occurred_at ?? Date.now(),
        totalCents,
        moneda: p.moneda,
        method: p.method,
        cash_session_id: p.cash_session_id ?? null,
        user_id: await currentUserId(),
        items: p.items,
      });
      break;
    }
    case "product.upsert": {
      const p = payload as ProductPayload;
      const local = await db.products.get(p.id);
      await db.products.put({
        id: p.id,
        nombre: p.nombre,
        categoria: p.categoria ?? null,
        precioCents: p.precio_cents,
        moneda: p.moneda,
        costoCents: p.costo_cents ?? null,
        activo: p.activo ?? true,
        trackStock: p.track_stock ?? local?.trackStock ?? false,
        minStock: p.min_stock ?? local?.minStock ?? 0,
        stockQty: local?.stockQty ?? 0,
        // Reloj del teléfono: solo para orden local; el servidor manda.
        updatedAt: Date.now(),
        deletedAt: null,
      });
      break;
    }
    case "product.delete": {
      const p = payload as { id: string };
      if (await db.products.get(p.id)) {
        await db.products.update(p.id, { deletedAt: Date.now(), updatedAt: Date.now() });
      }
      break;
    }
    case "stock.adjust": {
      const p = payload as StockPayload;
      const prod = await db.products.get(p.product_id);
      if (prod) await db.products.update(prod.id, { stockQty: prod.stockQty + p.delta });
      break;
    }
    case "cash.open": {
      const p = payload as CashOpenPayload;
      await db.cash_sessions.put({
        id: p.id,
        user_id: await currentUserId(),
        moneda: p.moneda,
        opened_at: Date.now(),
        closed_at: null,
        opening_cents: p.opening_cents,
        closing_cents: null,
      });
      break;
    }
    case "cash.close": {
      const p = payload as CashClosePayload;
      const session = await db.cash_sessions.get(p.id);
      if (session) await db.cash_sessions.update(p.id, { closed_at: Date.now(), closing_cents: p.closing_cents });
      break;
    }
  }
}

export async function enqueue(type: OpType, payload: unknown): Promise<string> {
  const op_id = newId();
  await db.transaction("rw", db.products, db.outbox, db.sales_local, db.cash_sessions, db.meta, async () => {
    await applyLocal(type, payload);
    await db.outbox.add({ op_id, type, payload, created_at: Date.now(), status: "pending", attempts: 0 });
  });
  scheduleFlush();
  emit();
  return op_id;
}

function scheduleFlush(): void {
  if (!isBrowser()) return;
  clearTimeout(enqueueTimer);
  enqueueTimer = setTimeout(() => void flush(), 800);
}

function scheduleRetry(): void {
  if (!isBrowser()) return;
  backoffMs = Math.min(backoffMs ? backoffMs * 2 : 2_000, 300_000);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void flush(), backoffMs);
}

async function revert(ids: string[]): Promise<void> {
  await db.outbox.where("op_id").anyOf(ids).modify({ status: "pending" });
}

async function sendAll(f: FetchLike): Promise<void> {
  const device_id = await getDeviceId();
  for (;;) {
    const pending = await db.outbox
      .orderBy("created_at")
      .filter((r) => r.status !== "rejected")
      .limit(50)
      .toArray();
    if (!pending.length) return;

    const ids = pending.map((r) => r.op_id);
    await db.outbox.where("op_id").anyOf(ids).modify((r) => {
      r.status = "sending";
      r.attempts += 1;
    });

    let res: Response;
    try {
      res = await f("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          device_id,
          ops: pending.map((r) => ({ op_id: r.op_id, type: r.type, payload: r.payload })),
        }),
      });
    } catch {
      await revert(ids);
      scheduleRetry();
      emit();
      return;
    }

    if (res.status === 401) {
      // Pausa sin perder el outbox; la UI pide re-login.
      await revert(ids);
      needsLogin = true;
      emit();
      return;
    }
    if (!res.ok) {
      await revert(ids);
      scheduleRetry();
      emit();
      return;
    }

    const body = (await res.json()) as { results: SyncResult[] };
    const answered = new Set(body.results.map((r) => r.op_id));
    await db.transaction("rw", db.outbox, async () => {
      for (const r of body.results) {
        if (r.status === "rejected") await db.outbox.update(r.op_id, { status: "rejected", error: r.error ?? "rejected" });
        else await db.outbox.delete(r.op_id);
      }
      // Respuesta incompleta: lo no contestado vuelve a pendiente.
      const missing = ids.filter((id) => !answered.has(id));
      if (missing.length) await db.outbox.where("op_id").anyOf(missing).modify({ status: "pending" });
    });

    backoffMs = 0;
    needsLogin = false;
    emit();
    if (pending.length < 50) return;
  }
}

async function pull(f: FetchLike): Promise<void> {
  for (;;) {
    const cursor = (await db.meta.get("cursor"))?.value ?? "";
    const res = await f(`/api/sync?since=${encodeURIComponent(cursor)}&limit=200`, { credentials: "same-origin" });
    if (res.status === 401) {
      needsLogin = true;
      emit();
      return;
    }
    if (!res.ok) {
      scheduleRetry();
      return;
    }
    const page = (await res.json()) as SyncPage;
    await db.transaction("rw", db.products, db.meta, async () => {
      // El servidor manda: put directo (las ops pendientes ya se enviaron antes del pull).
      for (const p of page.products) await db.products.put(p);
      await db.meta.put({ key: "cursor", value: page.cursor });
    });
    if (!page.has_more) return;
  }
}

export async function flush(opts: { fetch?: FetchLike; online?: boolean } = {}): Promise<void> {
  if (flushing) return;
  if (!(opts.online ?? isOnline())) return;
  flushing = true;
  const f = opts.fetch ?? fetch;
  const run = async () => {
    try {
      await sendAll(f);
      await pull(f);
    } catch {
      scheduleRetry();
    } finally {
      emit();
    }
  };
  try {
    if (typeof navigator !== "undefined" && "locks" in navigator && navigator.locks) {
      await navigator.locks.request("lv-flush", run);
    } else {
      await run();
    }
  } finally {
    flushing = false;
  }
}

// Disparadores: abrir, online, visible, cada 60 s visible+online. Sin Background Sync (iOS).
export function startSync(): void {
  if (!isBrowser()) return;
  void flush();
  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  setInterval(() => {
    if (document.visibilityState === "visible" && navigator.onLine) void flush();
  }, 60_000);
}
