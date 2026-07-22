import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { todayKeyET } from "../src/lib/schedule.js";
import { blockedWindows, rawBusy, rawSchedules, getToken, graphConfigured, BOOKING_CALENDAR, FREEBUSY_CALENDARS } from "./_graph.js";

// GET /api/health-calendar - the Monday-brief watchdog.
// Verifies, from inside the system: credentials work, both calendars answer
// free/busy, and the bookings database is reachable. Returns
// { ok: boolean, issues: string[] } and never leaks secrets.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const issues: string[] = [];

  // 1. Configuration present?
  if (!graphConfigured()) {
    issues.push("Microsoft credentials missing (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars).");
  }
  if (!process.env.DATABASE_URL) issues.push("DATABASE_URL env var missing.");
  if (!process.env.RESEND_API_KEY) issues.push("RESEND_API_KEY env var missing.");

  // 2. Can we authenticate to Microsoft?
  if (graphConfigured()) {
    try {
      await getToken();
    } catch {
      issues.push("Microsoft sign-in failed - the client secret may be expired or revoked (rotate in Entra, update Vercel).");
    }
  }

  // 3. Can we READ EVENTS from EVERY watched calendar? This is the exact
  //    path the site uses to block windows (calendarView, not the free/busy
  //    cache). A per-calendar error means that mailbox's events silently
  //    stop blocking the site, so it is a hard failure, not a shrug.
  let debug: unknown = undefined;
  if (graphConfigured() && !issues.some((i) => i.startsWith("Microsoft sign-in"))) {
    try {
      const today = todayKeyET();
      const perCalendar = await rawBusy(today, today);
      for (const c of perCalendar) {
        if (c.error) issues.push(`Calendar read failed for ${c.calendar}: ${c.error}. Events on that calendar are NOT blocking the site.`);
      }
      // Optional deep-debug: /api/health-calendar?date=YYYY-MM-DD shows the
      // busy events the site sees, the computed blocks, and (for comparison)
      // Exchange's cached free/busy strings.
      const date = typeof req.query.date === "string" ? req.query.date : "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const [busy, blocked, cached] = await Promise.all([
          rawBusy(date, date),
          blockedWindows(date, date),
          rawSchedules(date, date),
        ]);
        debug = {
          date,
          busyEvents: busy,
          blockedWindows: Object.fromEntries(Object.entries(blocked).map(([k, v]) => [k, [...v]])),
          freeBusyCacheForComparison: cached,
        };
      }
    } catch {
      issues.push(`Calendar read failed for ${FREEBUSY_CALENDARS.join(", ")} - check the ${BOOKING_CALENDAR} mailbox and app permissions.`);
    }
  }

  // 4. Is the bookings database reachable?
  if (process.env.DATABASE_URL) {
    try {
      const sql = neon(process.env.DATABASE_URL);
      await sql`SELECT 1 FROM bookings LIMIT 1`;
    } catch {
      issues.push("Bookings database unreachable or table missing (run /api/setup-db).");
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(issues.length ? 500 : 200).json({
    ok: issues.length === 0,
    issues,
    watching: FREEBUSY_CALENDARS,
    checkedAt: new Date().toISOString(),
    ...(debug !== undefined ? { debug } : {}),
  });
}
