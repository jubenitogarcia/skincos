// Replit Auth Integration: Database connection configuration
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";
import { createPgPool } from "./harmonia/store/pg.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const client = createPgPool(process.env.DATABASE_URL, { domain: 'replit-auth' });
if (!client) throw new Error("DATABASE_URL environment variable is required");

export const db = drizzle(client, { schema });
