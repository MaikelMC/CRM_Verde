import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { registerSW } from "virtual:pwa-register";
import { DevPage } from "./DevPage";
import { SyncStatus } from "./SyncStatus";
import { startSync, flush } from "./sync";
import "./styles.css";

// /dev solo en desarrollo: vite dev o wrangler dev en localhost.
const isDev = import.meta.env.DEV || location.hostname === "localhost" || location.hostname === "127.0.0.1";

let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

function App() {
  const [needRefresh, setNeedRefresh] = useState(false);

  useEffect(() => {
    updateSW = registerSW({ onNeedRefresh: () => setNeedRefresh(true) });
    startSync();
  }, []);

  return (
    <>
      <header>
        <strong>La Verde Gestión</strong>
        <SyncStatus />
      </header>
      {isDev && location.pathname === "/dev" ? (
        <DevPage />
      ) : (
        <main>
          <p>Pantallas en Fase 3.</p>
          {isDev && <a href="/dev">Ir a /dev</a>}
        </main>
      )}
      {needRefresh && (
        <div class="banner">
          <span>Nueva versión disponible</span>
          <button
            type="button"
            onClick={async () => {
              await flush();
              await updateSW?.(true);
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
