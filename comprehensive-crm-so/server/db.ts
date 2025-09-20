// Replit Auth Integration: Database connection configuration
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Initialize connection
client.connect().catch(console.error);

export const db = drizzle(client, { schema });