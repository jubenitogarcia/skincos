// Replit Auth Integration: Storage operations for user management (JavaScript)
import { Client } from "pg";

// Database client setup
let dbClient = null;
async function getDbClient() {
  if (!dbClient) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    
    dbClient = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });
    
    await dbClient.connect();
  }
  return dbClient;
}

// Storage class
class DatabaseStorage {
  async getUser(id) {
    try {
      const client = await getDbClient();
      const result = await client.query(
        'SELECT id, email, first_name, last_name, profile_image_url, created_at, updated_at FROM users WHERE id = $1',
        [id]
      );
      
      if (result.rows.length === 0) {
        return undefined;
      }
      
      const row = result.rows[0];
      return {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        profileImageUrl: row.profile_image_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.error('Error getting user:', error);
      return undefined;
    }
  }

  async upsertUser(userData) {
    try {
      const client = await getDbClient();
      const result = await client.query(`
        INSERT INTO users (id, email, first_name, last_name, profile_image_url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) 
        DO UPDATE SET 
          email = EXCLUDED.email,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          profile_image_url = EXCLUDED.profile_image_url,
          updated_at = NOW()
        RETURNING id, email, first_name, last_name, profile_image_url, created_at, updated_at
      `, [userData.id, userData.email, userData.firstName, userData.lastName, userData.profileImageUrl]);
      
      const row = result.rows[0];
      return {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        profileImageUrl: row.profile_image_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.error('Error upserting user:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const storage = new DatabaseStorage();