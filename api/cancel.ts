import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { neon } from "@neondatabase/serverless";
import { windowById, beforeCutoff, humanDate, RESCHEDULE_CUTOFF_HOURS } from "../src/lib/schedule.js";
import { cancelBookingEvent, graphConfigured } from "./_graph.js";
import { cancelEmailPair } from "./_email.js";

// POST /api/cancel {bid, t} - token-gated customer self-cancellation.
// Frees the slot, cancels the calendar meeting (Exchange notifies the
// customer), and emails both sides.

const MAIL_FROM = process.env.MAIL_FROM || "Belvedere Decks <schedule@belvederedecks.com>";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "schedule@belvederedecks.com";

function sanitize(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 200) : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const bid = sanitize(req.body?.bid);
  const token = sanitize(req.body?.t);
  if (!/^\d+$/.test(bid) || !token) {
    return res.status(400).json({ error: "Invalid link." });
  }

  const sql = neon(process.env.DATABASE_URL!);
  let booking;
  try {
    const rows = await sql`
      SELECT id, booking_date, booking_time, customer_name, customer_email, project_address, graph_event_id
      FROM bookings WHERE id = ${Number(bid)} AND reschedule_token = ${token}
    `;
    booking = rows[0];
  } catch {
    return res.status(500).json({ error: "Could not look up the booking." });
  }
  if (!booking) {
    return res.status(404).json({ error: "Booking not found. The link may be outdated - call us and we'll sort it out." });
  }

  const dateKey = new Date(booking.booking_date).toISOString().split("T")[0];
  const win = windowById(dateKey, booking.booking_time);
  if (!win || !beforeCutoff(dateKey, win.startHour)) {
    return res.status(403).json({ error: `Online changes close ${RESCHEDULE_CUTOFF_HOURS} hours before your window. Please call us instead.` });
  }

  try {
    await sql`DELETE FROM bookings WHERE id = ${booking.id}`;
  } catch {
    return res.status(500).json({ error: "Could not cancel. Please call us." });
  }

  if (graphConfigured() && booking.graph_event_id) {
    try { await cancelBookingEvent(booking.graph_event_id); } catch { /* best effort */ }
  }

  const date = humanDate(dateKey);
  const origin = `https://${(req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "www.belvederedecks.com"}`;
  try {
    const { owner, customer } = cancelEmailPair({
      origin,
      customerName: String(booking.customer_name),
      address: String(booking.project_address),
      date,
      label: win.label,
      ownerNote: "The customer cancelled from their reschedule link. The window is open again on the site.",
    });
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: MAIL_FROM, to: OWNER_EMAIL, subject: owner.subject, html: owner.html });
    await resend.emails.send({
      from: MAIL_FROM,
      to: booking.customer_email,
      replyTo: OWNER_EMAIL,
      subject: customer.subject,
      html: customer.html,
    });
  } catch { /* cancellation already done */ }

  return res.status(200).json({ success: true });
}
