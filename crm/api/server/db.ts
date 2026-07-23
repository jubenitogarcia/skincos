// Replit Auth Integration: Database connection configuration
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";
import { createPgPool } from "./postgres/pool.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const pool = createPgPool(process.env.DATABASE_URL, { domain: 'crm' });
if (!pool) throw new Error("DATABASE_URL environment variable is required");

export const db = drizzle(pool, { schema });
