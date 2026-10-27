import { drizzle } from "drizzle-orm/d1";

export function getDb(d1: D1Database) {
  return drizzle(d1);
}

export type Db = ReturnType<typeof getDb>;
