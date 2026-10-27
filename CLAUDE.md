# La Verde Gestión

PWA offline-first de gestión para mipymes/cafeterías cubanas.
Worker + Static Assets + D1 (plan gratis de Cloudflare).

## Stack
TypeScript estricto · Hono · Drizzle + D1 · zod · Vite + Preact · Dexie · vite-plugin-pwa · Wrangler.

## Comandos
- `npm run dev` — Worker local (D1 local + `.dev.vars`)
- `npm test` — Vitest: Worker+D1 con migraciones (`@cloudflare/vitest-plugin`) y cliente con `fake-indexeddb`
- `npm run typecheck`
- `npm run db:generate` — migración Drizzle desde el schema
- `npm run db:migrate:local` / `db:migrate:remote`
- `npm run deploy`

## Convenciones
- Dinero en centavos enteros + moneda `CUP|USD`. Nunca floats.
- IDs ULID: cliente offline; `src/lib/ids.ts` en servidor.
- Roles en BD: `dueno`, `gerente`, `cajero` ("dueño" solo en UI).
- Tablas con `tenant_id`: consultar solo vía helpers de `src/db/tenant.ts`.
- `updated_at` lo asigna el servidor. El stock se ajusta en servidor.
- Worker: 10 ms CPU. Reportes/agregaciones con SQL en D1, no JS.
- Sync: el cliente escribe primero en Dexie; `POST /api/sync` idempotente por `op_id`.
- Auth: código ≥16 chars, guardado como SHA-256+pepper; cookie HMAC.

## Reglas
- Trabaja por FASES. Al terminar: `PROGRESS.md` (≤30 líneas), commit y DETENTE.
- Plan ≤15 líneas antes de codificar. Respuesta final ≤5 líneas.
- Lee solo lo que tocas; usa Edit. Código mínimo, sin deps de más.
- Skills cloudflare/wrangler solo si aplican, solo la sección necesaria.
