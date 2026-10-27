const enc = new TextEncoder();
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

export function accessCode(): string {
  const rand = crypto.getRandomValues(new Uint8Array(20));
  return [...rand].map((b) => ALPHABET.charAt(b % 32)).join("");
}

export function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

export async function hashCode(code: string, pepper: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(pepper + normalizeCode(code)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export type Session = { u: string; t: string; e: number };

export async function signSession(session: Session, secret: string): Promise<string> {
  const data = b64url(enc.encode(JSON.stringify(session)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

export async function verifySession(token: string, secret: string): Promise<Session | null> {
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(data));
    if (!ok) return null;
    const session = JSON.parse(new TextDecoder().decode(fromB64url(data))) as Session;
    if (session.e < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

// ponytail: límite por isolate, no global. Mover a D1/DO si aparece abuso real.
const tries = new Map<string, { n: number; until: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_TRIES = 10;

export function allowLogin(ip: string): boolean {
  const b = tries.get(ip);
  return !b || b.until < Date.now() || b.n < MAX_TRIES;
}

export function failLogin(ip: string): void {
  const now = Date.now();
  const b = tries.get(ip);
  if (!b || b.until < now) tries.set(ip, { n: 1, until: now + WINDOW_MS });
  else b.n += 1;
}

export function resetLogin(ip: string): void {
  tries.delete(ip);
}
