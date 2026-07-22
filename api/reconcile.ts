import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { todayKeyET } from "../src/lib/schedule.js";
import { reconcileRange } from "./_reconcile.js";

// GET /api/reconcile - sweep ALL future bookings against the calendar.
// Pinged every 15 minutes (GitHub Actions workflow in this repo), so when
// Austin drags or deletes a booking in Outlook, the database row follows and
// the branded reschedule emails go out within minutes even if nobody is
// browsing the site. Safe to call as often as you like: the guarded SQL
// update means each change is detected, and emailed, exactly once.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ ok: false, error: "DATABASE_URL missing" });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "www.belvederedecks.com";
    const { active, moved, freed, emailsSent } = await reconcileRange(sql, `https://${host}`, todayKeyET(), null);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      checked: active.length + freed,
      unchanged: active.length - moved,
      moved,
      freed,
      emailsSent,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return res.status(500).json({ ok: false, error: "Reconcile failed" });
  }
}
