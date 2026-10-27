ALTER TABLE `products` ADD `track_stock` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `min_stock` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `method` text DEFAULT 'efectivo' NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `cash_session_id` text;--> statement-breakpoint
ALTER TABLE `sales` RENAME COLUMN `created_at` TO `occurred_at`;--> statement-breakpoint
CREATE INDEX `sales_tenant_occurred` ON `sales` (`tenant_id`,`occurred_at`);
