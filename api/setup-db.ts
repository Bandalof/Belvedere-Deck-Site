import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";

/**
 * One-time setup/migration endpoint for the bookings table.
 * Hit GET /api/setup-db after provisioning the database AND after the
 * window-based scheduling upgrade (adds graph_event_id + reschedule_token).
 * Safe to run multiple times (IF NOT EXISTS everywhere).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        booking_date DATE NOT NULL,
        booking_time VARCHAR(40) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        project_address VARCHAR(500) NOT NULL,
        project_description TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(booking_date, booking_time)
      )
    `;

    // Window-based scheduling upgrade (idempotent).
    await sql`ALTER TABLE bookings ALTER COLUMN booking_time TYPE VARCHAR(40)`;
    await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS graph_event_id TEXT`;
    await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_token TEXT`;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date)
    `;

    return res.status(200).json({ success: true, message: "Bookings table ready (window-based schema)" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to set up database", details: String(error) });
  }
}
