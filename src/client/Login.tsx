import { useState } from "preact/hooks";
import { login, type Session } from "./session";

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg("");
    const online = typeof navigator === "undefined" || navigator.onLine !== false;
    if (!online) {
      setMsg("Sin conexión: entra una vez con red para guardar la sesión en este dispositivo.");
      setBusy(false);
      return;
    }
    const session = await login(code.trim());
    setBusy(false);
    if (!session) return setMsg("Código inválido.");
    await navigator.storage?.persist?.();
    onLogin(session);
  }

  return (
    <main class="login">
      <h1>La Verde Gestión</h1>
      <p>Introduce tu código de acceso para trabajar en este dispositivo.</p>
      <form onSubmit={(e) => void onSubmit(e)}>
        <input
          value={code}
          autocomplete="off"
          autocapitalize="off"
          placeholder="Código de acceso"
          onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="primario" disabled={busy || code.trim().length < 16}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
      {msg && <p class="error">{msg}</p>}
      <small>Funciona sin conexión después de la primera entrada.</small>
    </main>
  );
}
