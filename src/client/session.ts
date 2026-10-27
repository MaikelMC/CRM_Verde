import { db } from "./db";

export type Role = "dueno" | "gerente" | "cajero";
export type Session = { userId: string; name: string; role: Role; tenantId: string };

const KEY = "session";

function toSession(raw: unknown): Session | null {
  const s = raw as Partial<Session> | null;
  if (!s || typeof s.userId !== "string" || typeof s.role !== "string" || typeof s.tenantId !== "string") return null;
  return { userId: s.userId, name: s.name ?? "", role: s.role, tenantId: s.tenantId };
}

async function save(session: Session | null): Promise<void> {
  if (!session) return void (await db.meta.delete(KEY));
  await db.meta.put({ key: KEY, value: JSON.stringify(session) });
}

// Última sesión conocida: sirve sin red.
export async function loadSession(): Promise<Session | null> {
  const row = await db.meta.get(KEY);
  if (!row) return null;
  try {
    return toSession(JSON.parse(row.value));
  } catch {
    return null;
  }
}

// Refresca contra /api/me; sin red devuelve la caché.
export async function refreshSession(): Promise<Session | null> {
  const cached = await loadSession();
  if (typeof navigator !== "undefined" && navigator.onLine === false) return cached;
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (!res.ok) {
      await save(null);
      return null;
    }
    const body = (await res.json()) as { user?: { id: string; name: string }; role?: Role; tenantId?: string };
    const session = toSession({ userId: body.user?.id, name: body.user?.name, role: body.role, tenantId: body.tenantId });
    await save(session);
    return session;
  } catch {
    return cached;
  }
}

export async function login(code: string): Promise<Session | null> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { user: { id: string; name: string }; role: Role; tenantId: string };
  const session = toSession({ userId: body.user.id, name: body.user.name, role: body.role, tenantId: body.tenantId });
  await save(session);
  return session;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  await save(null);
}

export const puedeEditar = (role: Role): boolean => role === "dueno" || role === "gerente";
