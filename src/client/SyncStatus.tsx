import { liveQuery } from "dexie";
import { useEffect, useState } from "preact/hooks";
import { db } from "./db";
import { loginRequired, onSync } from "./sync";

export function SyncStatus() {
  const [online, setOnline] = useState(typeof navigator === "undefined" || navigator.onLine !== false);
  const [login, setLogin] = useState(loginRequired());
  const [counts, setCounts] = useState({ pending: 0, failed: 0 });
  const [failed, setFailed] = useState<{ op_id: string; type: string; error?: string }[] | null>(null);

  useEffect(() => {
    const sub = liveQuery(async () => ({
      pending: await db.outbox.where("status").anyOf("pending", "sending").count(),
      failed: await db.outbox.where("status").equals("rejected").count(),
    })).subscribe((v) => setCounts(v));

    const refresh = () => {
      setLogin(loginRequired());
      setOnline(navigator.onLine !== false);
    };
    const un = onSync(refresh);
    const onOffline = () => setOnline(false);
    const onOnline = () => setOnline(true);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      sub.unsubscribe();
      un();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  const label = !online
    ? "Sin conexión"
    : login
      ? "Sesión expirada — vuelve a entrar"
      : counts.failed
        ? `${counts.failed} con error`
        : counts.pending
          ? `${counts.pending} pendientes`
          : "Sincronizado";

  async function toggleDetail() {
    if (failed) return setFailed(null);
    const rows = await db.outbox.where("status").equals("rejected").toArray();
    setFailed(rows.map((r) => ({ op_id: r.op_id, type: r.type, error: r.error })));
  }

  return (
    <div class="sync">
      <button type="button" class={counts.failed ? "sync-badge bad" : "sync-badge"} onClick={() => void toggleDetail()}>
        {label}
      </button>
      {failed && failed.length > 0 && (
        <ul class="sync-failed">
          {failed.map((r) => (
            <li key={r.op_id}>
              {r.type}: {r.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
