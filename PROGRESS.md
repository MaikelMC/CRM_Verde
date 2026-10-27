# Progreso

## Fase 3 — Pantallas ✅ (2026-10-27)
- Datos (migración `0002`): `products.track_stock/min_stock`, `sales.occurred_at/method/cash_session_id`
  e índice `sales_tenant_occurred`; Dexie v2 (upgrade) con `cash_sessions`; contratos zod en `src/shared/`.
- `sale.create` (servidor y cliente) descuenta stock solo si `track_stock=1`; los demás productos no se tocan.
- Base: router hash con `import()` por pantalla, barra inferior con badge de bajos, CSS móvil único y sesión
  cacheada en Dexie (`/api/me` + login por código); el cajero no ve Productos.
- Vender, Productos, Inventario, Caja y Reporte ✅ + `GET /api/reports/day` (dueño/gerente, ≤3 consultas SQL
  en un batch sobre `occurred_at`, rango máximo 36 h, sin agregar en JS).
- Pruebas: 13 servidor + 5 cliente = 18 (stock condicional, reporte con aislamiento y límites, venta offline).
### Medido y decidido
- Venta de 3 ítems (3 productos distintos): 5 filas sin control de stock (1 `sales` + 3 `sale_items` + 1 `op_log`)
  y 8 con control (+3 UPDATE `products`).
- JS inicial: 41,9 kB gzip (entry) + 1,7 kB CSS ≈ 43,6 kB; con `workbox-window` ≈ 45,8 kB. Objetivo ≤150 kB.
- `sales.created_at` → `occurred_at` (hora de la venta); el índice `sales(tenant_id, created_at)` del plan no
  existía en `0001`, así que se creó el nuevo. `sale.create` ganó `method` y `cash_session_id` (opcionales).
- Caja: efectivo esperado y diferencia son funciones puras en `src/shared/cash.ts`; una sesión abierta por
  usuario y moneda y no bloquea vender. El reporte nunca suma monedas distintas (el servidor agrupa por moneda).
- Dinero: separador de miles desde `Intl.NumberFormat("es")` y agrupado a mano (workerd con ICU recortado no
  agrupa en "es"); `parseMoney` acepta "12,50" y "12.50" y devuelve centavos enteros.
### Verificado
- `npm run typecheck` exit 0 · `npm test` exit 0 (15+5 tras correcciones) · `npm run build` exit 0 ·
  `wrangler deploy --dry-run` exit 0 con bindings DB y ASSETS · migración 0002 aplicada en local.
- Correcciones de la revisión: `cash.close` solo por el dueño de la sesión, gate de rol en Productos,
  reporte con límite superior exclusivo `[from,to)` y `DevPage.tsx` eliminado.
### Pendiente
- Deploy remoto: `npx wrangler login`, `npx wrangler d1 create la-verde-gestion`, `database_id` real en
  `wrangler.jsonc`, `npm run db:migrate:remote`, secrets `AUTH_SECRET`/`SETUP_TOKEN`, `npm run deploy`.
- Fuera de alcance: anular ventas, tickets, multi-local, Excel, fotos, turnos, cuentas por cobrar.
