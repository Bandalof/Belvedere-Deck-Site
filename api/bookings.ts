import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { windowsFor, todayKeyET } from "../src/lib/schedule";
import { blockedWindows, graphConfigured } from "./_graph";

// GET /api/bookings?month=YYYY-MM
// Returns { "YYYY-MM-DD": ["08:00", ...] } of UNAVAILABLE window ids for the
// month — the union of database reservations and calendar busy time
// (schedule@ + Austin's own calendar). Same-day/past filtering happens
// client-side AND server-side at booking time.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month query param required (YYYY-MM)" });
  }

  const startKey = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const endKey = `${month}-${String(lastDay).padStart(2, "0")}`;

  const taken: Record<string, string[]> = {};
  const add = (dateKey: string, id: string) => {
    if (!(taken[dateKey] ||= []).includes(id)) taken[dateKey].push(id);
  };

  // 1. Database reservations (the booking lock).
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT booking_date, booking_time
      FROM bookings
      WHERE booking_date >= ${startKey}::date
        AND booking_date <= ${endKey}::date
    `;
    for (const row of rows) {
      const dateKey = new Date(row.booking_date).toISOString().split("T")[0];
      add(dateKey, String(row.booking_time));
    }
  } catch {
    return res.status(500).json({ error: "Failed to fetch bookings" });
  }

  // 2. Calendar busy time (manual blocks, personal appointments, everything).
  //    Best-effort: if Graph is down, DB reservations still protect double-booking.
  if (graphConfigured()) {
    try {
      // Don't waste Graph quota on days that are already unbookable.
      const today = todayKeyET();
      const graphStart = startKey > today ? startKey : today;
      if (graphStart <= endKey) {
        const blocked = await blockedWindows(graphStart, endKey);
        for (const [dateKey, ids] of Object.entries(blocked)) {
          for (const id of ids) add(dateKey, id);
        }
      }
    } catch {
      /* calendar unreachable — fall back to DB-only availability */
    }
  }

  // Normalize: only report ids that are real windows for that day.
  for (const dateKey of Object.keys(taken)) {
    const valid = new Set(windowsFor(dateKey).map((w) => w.id));
    taken[dateKey] = taken[dateKey].filter((id) => valid.has(id));
    if (!taken[dateKey].length) delete taken[dateKey];
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(taken);
}
