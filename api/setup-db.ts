import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";

/**
 * One-time setup endpoint to create the bookings table.
 * Hit GET /api/setup-db once after provisioning the database.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        booking_date DATE NOT NULL,
        booking_time VARCHAR(20) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        project_address VARCHAR(500) NOT NULL,
        project_description TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(booking_date, booking_time)
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date)
    `;

    return res.status(200).json({ success: true, message: "Bookings table created" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to set up database", details: String(error) });
  }
}
