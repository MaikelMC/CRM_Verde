# Progreso

## Fase 2 — Cliente offline + sync + PWA ✅ (2026-10-27)
- Migración 0001: `sales`, `sale_items`, `stock_movements`, `cash_sessions`, `op_log`, `products.stock_qty`
  e índice `products_tenant_cursor (tenant_id, updated_at, id)`.
- `POST /api/sync`: lote ≤50 ops, `op_log` idempotente por `op_id`, batch atómico por op; la venta
  recalcula `total_cents` en servidor; stock negativo permitido; cajero solo venta/caja.
- `GET /api/sync`: pull solo de `products`, cursor `updated_at:id`.
- Cliente `src/client/`: Dexie (`products`/`outbox`/`sales_local`/`meta`), el outbox se escribe en la
  misma transacción que el efecto local, `/dev` de prueba y banner "Actualizar" (registerType prompt).
- PWA: `vite-plugin-pwa` (generateSW) con manifest + 3 iconos (`scripts/icons.mjs`).
- Assets: el Worker sirve `./dist` y `/api/*` pasa primero por el Worker.

### Decisiones
- Pull solo de productos; ventas y caja no bajan al cliente (Fase 3).
- `cash.*` sin efecto local en Fase 2 (pantalla de caja en Fase 3).
- Backoff de reintentos en memoria y rate limit de login por isolate (no global).
- `updatedAt` local usa el reloj del teléfono solo para ordenar; el servidor manda.
- Una venta de 3 ítems = 8 filas: 1 `sales` + 3 `sale_items` + 3 UPDATE `products` + 1 `op_log`.
- `public/index.html` (placeholder de Fase 1) se eliminó; la raíz la sirve `dist/index.html`.

### Verificado
- `npm run typecheck` exit 0 (root + `src/client`); `npm test` exit 0: 5 servidor + 3 cliente.
- `npm run build` exit 0: `dist/` con index.html, manifest.webmanifest, sw.js y 3 iconos.
- `npx wrangler deploy --dry-run --outdir .wrangler/dry` exit 0 con bindings DB y ASSETS.

### Pendiente
- Deploy remoto: `wrangler login`, `d1 create`, `db:migrate:remote`, secrets y `npm run deploy`.
