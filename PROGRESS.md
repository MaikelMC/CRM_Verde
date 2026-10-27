# Progreso

## Fase 3 — Pantallas (en curso)
- Datos (migración `0002`): `products.track_stock/min_stock`, `sales.occurred_at/method/cash_session_id`
  + índice `sales_tenant_occurred (tenant_id, occurred_at)`. Dexie v2 (upgrade) con `cash_sessions`.
- Contratos compartidos en `src/shared/`: `ops.ts` (zod de todas las ops), `money.ts`, `cash.ts`.
- `sale.create` en servidor y cliente: descuenta stock solo si `track_stock=1`; si no, no toca la fila.
- Base: router hash con `import()` por pantalla, barra inferior con badge de bajos, CSS móvil único
  y sesión cacheada en Dexie (`/api/me` + login por código; cajero sin Productos).
- Vender: catálogo por moneda con búsqueda (debounce) y categorías; carrito en hoja inferior con ±,
  cantidad editable y método de pago; confirmar = una transacción Dexie (venta + stock + outbox).
- Pantallas: Vender ✅ · Productos, Inventario, Caja y Reporte (en curso).

## Fase 2 ✅
`POST/GET /api/sync` (op_log idempotente, batch atómico por op, pull de productos por cursor);
outbox Dexie transaccional en el cliente; PWA con manifest y 3 iconos; `dist/` servido por el Worker.

## Fase 1 ✅
Auth por código (SHA-256+pepper, cookie HMAC), rate limit por isolate, D1 + Drizzle, aislamiento por tenant.

## Verificado
- `npm run typecheck` exit 0 · `npm test` exit 0: 5 servidor + 3 cliente · migración 0002 aplicada en local.

## Pendiente
- Deploy remoto: `wrangler login`, `d1 create`, `db:migrate:remote`, secrets y `npm run deploy`.
