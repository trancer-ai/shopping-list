import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const pool = new Pool({ connectionString: DATABASE_URL });
