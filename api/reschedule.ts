import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { neon } from "@neondatabase/serverless";
import { windowById, isBookableDate, beforeCutoff, humanDate, RESCHEDULE_CUTOFF_HOURS } from "../src/lib/schedule.js";
import { moveBookingEvent, windowIsFree, graphConfigured } from "./_graph.js";
import { emailShell, heading, row, table, CHARCOAL, GOLD, CREAM } from "./_email.js";

// GET  /api/reschedule?bid=..&t=..            -> booking summary (token-gated)
// POST /api/reschedule {bid, t, dateKey, windowId} -> move the booking
//
// Moving updates: the DB reservation, the calendar meeting (Exchange emails
// the customer the updated invite automatically), and a branded confirmation.

const MAIL_FROM = process.env.MAIL_FROM || "Belvedere Decks <schedule@belvederedecks.com>";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "schedule@belvederedecks.com";

function sanitize(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 200) : "";
}

async function loadBooking(bid: string, token: string) {
  if (!/^\d+$/.test(bid) || !token) return null;
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT id, booking_date, booking_time, customer_name, customer_email, project_address, graph_event_id
    FROM bookings WHERE id = ${Number(bid)} AND reschedule_token = ${token}
  `;
  return rows[0] || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const bid = sanitize(req.method === "GET" ? req.query.bid : req.body?.bid);
  const token = sanitize(req.method === "GET" ? req.query.t : req.body?.t);

  let booking;
  try {
    booking = await loadBooking(bid, token);
  } catch {
    return res.status(500).json({ error: "Could not look up the booking." });
  }
  if (!booking) {
    return res.status(404).json({ error: "Booking not found. The link may be outdated - call us and we'll sort it out." });
  }

  const currentDateKey = new Date(booking.booking_date).toISOString().split("T")[0];
  const currentWin = windowById(currentDateKey, booking.booking_time);
  const changeable = currentWin ? beforeCutoff(currentDateKey, currentWin.startHour) : false;

  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      firstName: String(booking.customer_name).split(" ")[0],
      dateKey: currentDateKey,
      date: humanDate(currentDateKey),
      windowId: booking.booking_time,
      windowLabel: currentWin?.label || booking.booking_time,
      changeable,
      cutoffHours: RESCHEDULE_CUTOFF_HOURS,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!changeable) {
    return res.status(403).json({ error: `Online changes close ${RESCHEDULE_CUTOFF_HOURS} hours before your window. Please call us instead.` });
  }

  const dateKey = sanitize(req.body?.dateKey);
  const windowId = sanitize(req.body?.windowId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return res.status(400).json({ error: "Invalid date." });
  }
  const win = windowById(dateKey, windowId);
  if (!win) {
    return res.status(400).json({ error: "Pick a window from the calendar." });
  }
  if (!isBookableDate(dateKey)) {
    return res.status(400).json({ error: "Online booking closes the day before. For a same-day change, please call us." });
  }
  if (dateKey === currentDateKey && windowId === booking.booking_time) {
    return res.status(400).json({ error: "That's your current appointment." });
  }

  if (graphConfigured()) {
    try {
      if (!(await windowIsFree(dateKey, win))) {
        return res.status(409).json({ error: "That window just became unavailable. Please pick another." });
      }
    } catch { /* proceed on Graph outage */ }
  }

  // Move the reservation. Unique constraint still guards the new slot.
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const updated = await sql`
      UPDATE bookings SET booking_date = ${dateKey}, booking_time = ${win.id}
      WHERE id = ${booking.id}
        AND NOT EXISTS (
          SELECT 1 FROM bookings b2 WHERE b2.booking_date = ${dateKey} AND b2.booking_time = ${win.id} AND b2.id <> ${booking.id}
        )
      RETURNING id
    `;
    if (updated.length === 0) {
      return res.status(409).json({ error: "That window was just booked by someone else. Please pick another." });
    }
  } catch {
    return res.status(500).json({ error: "Could not move the booking. Please try again or call us." });
  }

  // Move the calendar meeting; Exchange notifies the customer automatically.
  if (graphConfigured() && booking.graph_event_id) {
    try {
      await moveBookingEvent(booking.graph_event_id, dateKey, win);
    } catch { /* DB moved; owner sees the branded email below */ }
  }

  const date = humanDate(dateKey);
  const oldDate = humanDate(currentDateKey);
  const oldLabel = currentWin?.label || booking.booking_time;
  const origin = siteOrigin(req);

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: MAIL_FROM,
      to: OWNER_EMAIL,
      subject: `Rescheduled: ${booking.customer_name} moved to ${date}, ${win.label}`,
      html: emailShell(origin, `
        ${heading("Booking Rescheduled")}
        ${table(`
          ${row("Customer", String(booking.customer_name))}
          ${row("Old window", `<span style="text-decoration: line-through; color: #888;">${oldDate}, ${oldLabel}</span>`, true)}
          ${row("New window", `<strong>${date}, ${win.label}</strong>`)}
          ${row("Address", String(booking.project_address), true)}
        `)}
        <p style="margin-top: 16px; font-size: 13px; color: #555;">The calendar has been updated and the old window is open again.</p>`),
    });
    await resend.emails.send({
      from: MAIL_FROM,
      to: booking.customer_email,
      replyTo: OWNER_EMAIL,
      subject: `RESCHEDULED: your site visit is now ${date}, ${win.label}`,
      html: emailShell(origin, `
        ${heading("Your visit has been RESCHEDULED.")}
        <p style="color: ${CHARCOAL}; font-size: 15px;">Please note the change so there's no confusion on the day:</p>
        ${table(`
          ${row("Old window", `<span style="text-decoration: line-through; color: #888;">${oldDate}<br/>${oldLabel}</span>`, true)}
          ${row("NEW window", `<span style="background: ${CREAM}; border-left: 4px solid ${GOLD}; padding: 6px 10px; display: inline-block;"><strong style="font-size: 16px;">${date}</strong><br/><strong style="font-size: 16px;">${win.label}</strong></span>`)}
        `)}
        <p style="margin-top: 16px; color: ${CHARCOAL};">Your calendar invitation updates automatically, and as always, we'll call before we head your way.</p>`),
    });
  } catch { /* moves already happened */ }

  return res.status(200).json({ success: true, date, windowLabel: win.label });
}

function siteOrigin(req: VercelRequest): string {
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "www.belvederedecks.com";
  return `https://${host}`;
}
