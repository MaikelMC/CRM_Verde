# Progreso

## Fase 1 — Esqueleto ✅ (2026-10-27)
- Hono + D1 + Drizzle, migración `drizzle/0000_*.sql` (tenants, users, memberships, products).
- Auth por código: 20 chars (~100 bits), guardado como SHA-256 + `AUTH_SECRET` (pepper).
- Sesión: cookie `lv_sess` httpOnly/Secure/SameSite=Lax, 30 días, firmada con HMAC-SHA256.
- `POST /api/setup` (header `x-setup-token` = `SETUP_TOKEN`) crea tenant + dueño y devuelve el código una vez.
- `POST /api/auth/login` / `logout`, `GET /api/me`, `GET /api/products`, `GET /api/health`.
- Helper de tenant `src/db/tenant.ts`; test de aislamiento entre tenants pasa.
- Rate limit de login: 10 fallos/IP/15 min en memoria + bloqueo temporal (429).
- `npm run typecheck` y `npm test` pasan.

### Decisiones
- Roles ASCII en BD (`dueno|gerente|cajero`); "dueño" solo en UI.
- Sin Vite/Preact aún: `public/index.html` placeholder. El shell PWA entra en Fase 2.
- `products.stock_qty` y tablas de sync se agregan en la migración de Fase 2.
- Rate limit por isolate (no global); mover a D1/DO si hay abuso.
- Login usa la primera membership del usuario; selector multi-tenant queda para Fase 3.

### Pendiente (requiere login de Cloudflare)
- `npx wrangler login`, `npx wrangler d1 create la-verde-gestion`, reemplazar `database_id`,
  `npm run db:migrate:remote`, `wrangler secret put AUTH_SECRET` / `SETUP_TOKEN`, `npm run deploy`.
- `wrangler deploy --dry-run` ya empaqueta correctamente.

Siguiente: Fase 2 — Dexie + outbox + `/api/sync` idempotente + PWA.
