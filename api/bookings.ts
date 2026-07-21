import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { windowsFor, todayKeyET } from "../src/lib/schedule.js";
import { blockedWindows, getEventTimes, graphConfigured } from "./_graph.js";

// GET /api/bookings?month=YYYY-MM
// Returns { "YYYY-MM-DD": ["08:00", ...] } of UNAVAILABLE window ids for the
// month - the union of database reservations and calendar busy time
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

  // 1. Database reservations (the booking lock), self-healed against the
  //    calendar first: if Austin dragged a booking to a new time (or deleted
  //    it) directly in Outlook, the calendar is the truth. We move or clear
  //    the database row to match, which frees the old window on the site.
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT id, booking_date, booking_time, graph_event_id
      FROM bookings
      WHERE booking_date >= ${startKey}::date
        AND booking_date <= ${endKey}::date
    `;

    const reconciled: { dateKey: string; windowId: string }[] = [];
    await Promise.all(rows.map(async (r) => {
      const dbDateKey = new Date(r.booking_date).toISOString().split("T")[0];
      const dbWindowId = String(r.booking_time);

      if (!r.graph_event_id || !graphConfigured()) {
        reconciled.push({ dateKey: dbDateKey, windowId: dbWindowId });
        return;
      }
      try {
        const live = await getEventTimes(String(r.graph_event_id));
        if (live === null) {
          // Event deleted/cancelled in Outlook: free the slot entirely.
          await sql`DELETE FROM bookings WHERE id = ${r.id}`;
          return;
        }
        const liveWin = windowsFor(live.dateKey).find((w) => w.startHour === live.startHour);
        if (liveWin && (live.dateKey !== dbDateKey || liveWin.id !== dbWindowId)) {
          // Dragged to a different window: move the reservation with it.
          const moved = await sql`
            UPDATE bookings SET booking_date = ${live.dateKey}, booking_time = ${liveWin.id}
            WHERE id = ${r.id}
              AND NOT EXISTS (
                SELECT 1 FROM bookings b2
                WHERE b2.booking_date = ${live.dateKey} AND b2.booking_time = ${liveWin.id} AND b2.id <> ${r.id}
              )
            RETURNING id
          `;
          if (moved.length) { reconciled.push({ dateKey: live.dateKey, windowId: liveWin.id }); return; }
        } else if (!liveWin) {
          // Dragged to a non-window time: the calendar busy check (below)
          // covers the real conflict; release the database lock.
          await sql`DELETE FROM bookings WHERE id = ${r.id}`;
          return;
        }
        reconciled.push({ dateKey: dbDateKey, windowId: dbWindowId });
      } catch {
        // Graph hiccup: keep the row as-is rather than lose the lock.
        reconciled.push({ dateKey: dbDateKey, windowId: dbWindowId });
      }
    }));

    for (const r of reconciled) add(r.dateKey, r.windowId);
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
      /* calendar unreachable - fall back to DB-only availability */
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
