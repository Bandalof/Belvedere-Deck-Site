import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { todayKeyET } from "../src/lib/schedule.js";
import { blockedWindows, rawSchedules, getToken, graphConfigured, BOOKING_CALENDAR, FREEBUSY_CALENDARS } from "./_graph.js";

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

  // 3. Does free/busy answer for EVERY watched calendar? A per-calendar
  //    error means that mailbox's events silently stop blocking the site,
  //    so it is a hard failure, not a shrug.
  let debug: unknown = undefined;
  if (graphConfigured() && !issues.some((i) => i.startsWith("Microsoft sign-in"))) {
    try {
      const today = todayKeyET();
      const schedules = await rawSchedules(today, today);
      for (const s of schedules) {
        if (s.error) issues.push(`Free/busy failed for ${s.calendar}: ${s.error}. Events on that calendar are NOT blocking the site.`);
        else if (!s.availabilityView) issues.push(`Free/busy for ${s.calendar} returned no data.`);
      }
      // Optional deep-debug: /api/health-calendar?date=YYYY-MM-DD shows the
      // raw per-calendar availability strings plus the computed blocks.
      const date = typeof req.query.date === "string" ? req.query.date : "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const raw = await rawSchedules(date, date);
        const blocked = await blockedWindows(date, date);
        debug = {
          date,
          schedules: raw,
          blockedWindows: Object.fromEntries(Object.entries(blocked).map(([k, v]) => [k, [...v]])),
        };
      }
    } catch {
      issues.push(`Free/busy lookup failed for ${FREEBUSY_CALENDARS.join(", ")} - check the ${BOOKING_CALENDAR} mailbox and app permissions.`);
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
