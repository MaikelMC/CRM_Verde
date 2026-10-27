import { liveQuery } from "dexie";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { registerSW } from "virtual:pwa-register";
import { db } from "./db";
import { isActivo, isLowStock } from "./lowstock";
import { Login } from "./Login";
import { NavBar, Screen, useHashRoute } from "./router";
import { logout, refreshSession, type Session } from "./session";
import { SyncStatus } from "./SyncStatus";
import { flush, startSync } from "./sync";
import "./styles.css";

let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [bajos, setBajos] = useState(0);
  const route = useHashRoute();

  useEffect(() => {
    updateSW = registerSW({ onNeedRefresh: () => setNeedRefresh(true) });
    startSync();
    void (async () => {
      setSession(await refreshSession());
      await flush();
    })();
  }, []);

  useEffect(() => {
    if (!session) return;
    const sub = liveQuery(async () => (await db.products.toArray()).filter((p) => isActivo(p) && isLowStock(p)).length).subscribe(setBajos);
    return () => sub.unsubscribe();
  }, [session]);

  if (session === undefined) return <p class="estado">Cargando…</p>;

  if (session === null) {
    return (
      <>
        <header>
          <h1>La Verde Gestión</h1>
          <SyncStatus />
        </header>
        <Login onLogin={setSession} />
      </>
    );
  }

  return (
    <>
      <header>
        <h1>La Verde Gestión</h1>
        <SyncStatus />
        <button
          type="button"
          class="sync-badge"
          onClick={() => {
            void (async () => {
              await logout();
              setSession(null);
            })();
          }}
        >
          Salir
        </button>
      </header>
      <Screen route={route} session={session} />
      <NavBar route={route} role={session.role} bajos={bajos} />
      {needRefresh && (
        <div class="banner">
          <span>Nueva versión disponible</span>
          <button
            type="button"
            class="primario"
            onClick={() => {
              void (async () => {
                await flush();
                await updateSW?.(true);
              })();
            }}
          >
            Actualizar
          </button>
        </div>
      )}
    </>
  );
}

render(<App />, document.getElementById("app")!);
