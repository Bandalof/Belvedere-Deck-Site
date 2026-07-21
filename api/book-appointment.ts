import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { windowById, isBookableDate, humanDate } from "../src/lib/schedule.js";
import { createBookingEvent, windowIsFree, graphConfigured, BOOKING_CALENDAR } from "./_graph.js";
import { emailShell, heading, row, table, button, CHARCOAL } from "./_email.js";

// Booking flow:
// 1. Validate (window model, no same-day, job details required).
// 2. Reserve the window in Postgres - unique constraint is the lock (409 on race).
// 3. Create a REAL calendar meeting on schedule@ with the customer as attendee.
//    Exchange then handles updates/cancellations automatically when the event
//    is dragged or deleted from any calendar app.
// 4. Send the branded confirmation (arrival-window language, call-ahead note,
//    self-service reschedule button) + owner notification via Resend.

const MAX_FIELD_LENGTH = 1000;
const MAIL_FROM = process.env.MAIL_FROM || "Belvedere Decks <schedule@belvederedecks.com>";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "schedule@belvederedecks.com";

const VALID_SERVICES = [
  "New deck boards only",
  "New boards + new railings",
  "A brand-new deck",
  "Not sure, I'd like an expert to look",
];

function sanitize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_FIELD_LENGTH);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function siteOrigin(req: VercelRequest): string {
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "www.belvederedecks.com";
  return `https://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const name = sanitize(req.body?.name);
  const email = sanitize(req.body?.email);
  const phone = sanitize(req.body?.phone);
  const address = sanitize(req.body?.address);
  const service = sanitize(req.body?.service);
  const dateKey = sanitize(req.body?.dateKey);   // YYYY-MM-DD
  const windowId = sanitize(req.body?.windowId); // "08:00"
  const description = sanitize(req.body?.description);

  if (!name || !email || !phone || !address || !service || !dateKey || !windowId || !description) {
    return res.status(400).json({ error: "All fields are required, including the project details." });
  }
  if (description.length < 20) {
    return res.status(400).json({ error: "Please describe the project in a bit more detail (a sentence or two)." });
  }
  if (!VALID_SERVICES.includes(service)) {
    return res.status(400).json({ error: "Invalid service selection." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return res.status(400).json({ error: "Invalid date." });
  }
  const win = windowById(dateKey, windowId);
  if (!win) {
    return res.status(400).json({ error: "That time isn't available. Please pick a window from the calendar." });
  }
  if (!isBookableDate(dateKey)) {
    return res.status(400).json({ error: "Online booking closes the day before. For a same-day visit, please call us." });
  }

  // Calendar check first (manual blocks, personal appointments). Best-effort:
  // if Graph is briefly down we still book - the DB prevents double-booking
  // against other website bookings, and the owner is notified either way.
  if (graphConfigured()) {
    try {
      if (!(await windowIsFree(dateKey, win))) {
        return res.status(409).json({ error: "That window just became unavailable. Please pick another." });
      }
    } catch { /* proceed on Graph outage */ }
  }

  const rescheduleToken = randomUUID();
  let bookingId: number;

  // Reserve the window - the unique constraint is the lock.
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const inserted = await sql`
      INSERT INTO bookings (booking_date, booking_time, customer_name, customer_email, customer_phone, project_address, project_description, reschedule_token)
      VALUES (${dateKey}, ${win.id}, ${name}, ${email}, ${phone}, ${address}, ${"Service: " + service + "\n" + description}, ${rescheduleToken})
      ON CONFLICT (booking_date, booking_time) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      return res.status(409).json({ error: "That window was just booked by someone else. Please pick another." });
    }
    bookingId = inserted[0].id;
  } catch {
    return res.status(500).json({ error: "Could not save the booking. Please try again or call us." });
  }

  // Create the real calendar meeting (best-effort; booking is already saved).
  let eventCreated = false;
  if (graphConfigured()) {
    try {
      const eventId = await createBookingEvent({
        dateKey, win,
        customerName: name, customerEmail: email, customerPhone: phone,
        address, service, description,
        transactionId: `booking-${bookingId}-${rescheduleToken.slice(0, 8)}`,
      });
      eventCreated = true;
      const sql = neon(process.env.DATABASE_URL!);
      await sql`UPDATE bookings SET graph_event_id = ${eventId} WHERE id = ${bookingId}`;
    } catch { /* owner still gets the email + DB row */ }
  }

  const date = humanDate(dateKey);
  const origin = siteOrigin(req);
  const rescheduleUrl = `${origin}/reschedule?bid=${bookingId}&t=${rescheduleToken}`;

  const ownerHtml = emailShell(origin, `
      ${heading("New Site-Visit Booking")}
      ${table(`
        ${row("Name", escapeHtml(name))}
        ${row("Email", `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`, true)}
        ${row("Phone", `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>`)}
        ${row("Project Address", escapeHtml(address), true)}
        ${row("Service", escapeHtml(service))}
        ${row("Arrival Window", `${escapeHtml(date)} · ${escapeHtml(win.label)}`, true)}
        ${row("Project Details", escapeHtml(description))}
      `)}
      <p style="margin-top: 16px; font-size: 13px; color: #555;">
        ${eventCreated
          ? `On the ${escapeHtml(BOOKING_CALENDAR)} calendar with the customer invited. Drag it there to reschedule; they are notified automatically.`
          : `⚠️ Calendar write failed. This booking is in the database only; add it to the calendar by hand.`}
      </p>`);

  const customerHtml = emailShell(origin, `
      ${heading(`You're booked, ${escapeHtml(name)}.`)}
      ${table(`
        ${row("Arrival window", `${escapeHtml(date)}<br/><strong>${escapeHtml(win.label)}</strong>`)}
        ${row("Address", escapeHtml(address), true)}
        ${row("Service", escapeHtml(service))}
      `)}
      <p style="margin-top: 16px; color: ${CHARCOAL};">
        <strong>About your appointment window:</strong> your visit is scheduled for an arrival
        window, not an exact time. We aim for the start of your window, but site visits sometimes
        run long and travel between homes varies, so <strong>we'll always call you before we head
        your way.</strong>
      </p>
      <p style="color: ${CHARCOAL};">
        Plan on about an hour together. We'll walk the deck, measure, and build your exact price
        in front of you. It works best when everyone who weighs in on the decision can be there.
      </p>
      ${button(rescheduleUrl, "Need to change your appointment?")}
      <p style="font-size: 13px; color: #555;">
        The button above lets you reschedule or cancel up to 4 hours before your window.
        Inside that, just reply to this email or give us a call. You'll also receive a calendar
        invitation from our scheduling calendar. Accept it and the visit sits in your calendar,
        updating automatically if anything changes.
      </p>`);

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: MAIL_FROM,
      to: OWNER_EMAIL,
      subject: `Booking: ${name}, ${date}, ${win.label} (${service})`,
      html: ownerHtml,
    });
    await resend.emails.send({
      from: MAIL_FROM,
      to: email,
      replyTo: OWNER_EMAIL,
      subject: `Your site visit: ${date}, arrival window ${win.label}`,
      html: customerHtml,
    });
  } catch { /* slot + calendar are already saved */ }

  return res.status(200).json({ success: true });
}
