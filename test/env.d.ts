declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AUTH_SECRET: string;
    SETUP_TOKEN?: string;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}
