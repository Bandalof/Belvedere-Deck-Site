import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";

// GET /api/bookings?month=YYYY-MM
// Returns { "YYYY-MM-DD": ["9:00 AM", ...], ... } of TAKEN slots for the month.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month query param required (YYYY-MM)" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL!);
    const startDate = `${month}-01`;
    const rows = await sql`
      SELECT booking_date, booking_time
      FROM bookings
      WHERE booking_date >= ${startDate}::date
        AND booking_date < (${startDate}::date + INTERVAL '1 month')
      ORDER BY booking_date, booking_time
    `;

    const bookings: Record<string, string[]> = {};
    for (const row of rows) {
      const dateKey = new Date(row.booking_date).toISOString().split("T")[0];
      (bookings[dateKey] ||= []).push(row.booking_time);
    }
    return res.status(200).json(bookings);
  } catch {
    return res.status(500).json({ error: "Failed to fetch bookings" });
  }
}
