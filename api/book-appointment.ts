import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { neon } from "@neondatabase/serverless";

// Ported from Band Outdoor Living's send-estimate.ts, with two changes:
// 1. The slot is INSERTed (reserved) BEFORE emails send - a conflict returns 409
//    so two visitors can never book the same hour.
// 2. Job-detail fields (service line + description) are required and validated
//    server-side so no appointment lands without scope information.

const MAX_FIELD_LENGTH = 1000;
const MAIL_FROM = process.env.MAIL_FROM || "Belvedere Decks <onboarding@resend.dev>";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "bandalof17@gmail.com";
const BOOKING_TZID = "America/New_York";
const BOOKING_DURATION_MINUTES = 60;

const VALID_SERVICES = [
  "New deck boards only",
  "New boards + new railings",
  "A brand-new deck",
  "Not sure, I'd like an expert to look",
];

// Server-side availability rules - must match src/lib the contact page uses.
const WEEKDAY_SLOTS = ["9:00 AM","10:00 AM","11:00 AM","12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM"];
const SATURDAY_SLOTS = ["9:00 AM","10:00 AM","11:00 AM","12:00 PM"];

function slotsFor(dateKey: string): string[] {
  const d = new Date(`${dateKey}T12:00:00`);
  const day = d.getDay();
  if (day === 0) return [];
  if (day === 6) return SATURDAY_SLOTS;
  return WEEKDAY_SLOTS;
}

function sanitize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_FIELD_LENGTH);
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function parse12hTime(time: string): { hours: number; minutes: number } | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

function toIcsUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function toIcsLocal(y: number, mo: number, d: number, h: number, mi: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}${pad(mo)}${pad(d)}T${pad(h)}${pad(mi)}00`;
}

function addMinutes(y: number, mo: number, d: number, h: number, mi: number, add: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi + add, 0));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), hours: dt.getUTCHours(), minutes: dt.getUTCMinutes() };
}

interface IcsEventInput {
  uid: string;
  startLocal: { year: number; month: number; day: number; hours: number; minutes: number };
  durationMinutes: number;
  summary: string;
  location: string;
  description: string;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
}

function buildIcs(input: IcsEventInput): string {
  const dtstamp = toIcsUtc(new Date());
  const s = input.startLocal;
  const dtstart = toIcsLocal(s.year, s.month, s.day, s.hours, s.minutes);
  const e = addMinutes(s.year, s.month, s.day, s.hours, s.minutes, input.durationMinutes);
  const dtend = toIcsLocal(e.year, e.month, e.day, e.hours, e.minutes);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Belvedere Decks//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    `TZID:${BOOKING_TZID}`,
    "X-LIC-LOCATION:America/New_York",
    "BEGIN:DAYLIGHT","TZNAME:EDT","DTSTART:19700308T020000","TZOFFSETFROM:-0500","TZOFFSETTO:-0400","RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU","END:DAYLIGHT",
    "BEGIN:STANDARD","TZNAME:EST","DTSTART:19701101T020000","TZOFFSETFROM:-0400","TZOFFSETTO:-0500","RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU","END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${BOOKING_TZID}:${dtstart}`,
    `DTEND;TZID=${BOOKING_TZID}:${dtend}`,
    `SUMMARY:${escapeIcs(input.summary)}`,
    `LOCATION:${escapeIcs(input.location)}`,
    `DESCRIPTION:${escapeIcs(input.description)}`,
    `ORGANIZER;CN=${escapeIcs(input.organizerName)}:mailto:${input.organizerEmail}`,
    `ATTENDEE;CN=${escapeIcs(input.attendeeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${input.attendeeEmail}`,
    "STATUS:CONFIRMED","TRANSP:OPAQUE","SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
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
  const date = sanitize(req.body?.date);       // human-readable
  const time = sanitize(req.body?.time);       // "9:00 AM"
  const dateKey = sanitize(req.body?.dateKey); // YYYY-MM-DD
  const description = sanitize(req.body?.description);

  // Hard requirements - the job details are the point.
  if (!name || !email || !phone || !address || !service || !date || !time || !dateKey || !description) {
    return res.status(400).json({ error: "All fields are required, including the project details." });
  }
  if (description.length < 20) {
    return res.status(400).json({ error: "Please describe the project in a bit more detail (a sentence or two)." });
  }
  if (!VALID_SERVICES.includes(service)) {
    return res.status(400).json({ error: "Invalid service selection." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !slotsFor(dateKey).includes(time)) {
    return res.status(400).json({ error: "That time isn't available. Please pick a slot from the calendar." });
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(`${dateKey}T12:00:00`) < today) {
    return res.status(400).json({ error: "That date is in the past." });
  }

  const fullDescription = `Service: ${service}\n${description}`;

  // 1. Reserve the slot FIRST - the unique constraint is the lock.
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const inserted = await sql`
      INSERT INTO bookings (booking_date, booking_time, customer_name, customer_email, customer_phone, project_address, project_description)
      VALUES (${dateKey}, ${time}, ${name}, ${email}, ${phone}, ${address}, ${fullDescription})
      ON CONFLICT (booking_date, booking_time) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) {
      return res.status(409).json({ error: "That time was just booked by someone else. Please pick another slot." });
    }
  } catch {
    return res.status(500).json({ error: "Could not save the booking. Please try again or call us." });
  }

  // 2. Emails + calendar invite (best-effort - the slot is already saved).
  const parsedTime = parse12hTime(time);
  const dateMatch = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let icsContent: string | null = null;
  if (dateMatch && parsedTime) {
    icsContent = buildIcs({
      uid: `${dateKey}-${String(parsedTime.hours).padStart(2, "0")}${String(parsedTime.minutes).padStart(2, "0")}@belvederedecks.com`,
      startLocal: { year: +dateMatch[1], month: +dateMatch[2], day: +dateMatch[3], hours: parsedTime.hours, minutes: parsedTime.minutes },
      durationMinutes: BOOKING_DURATION_MINUTES,
      summary: `Deck consultation: ${name}`,
      location: address,
      description: `Customer: ${name}\nEmail: ${email}\nPhone: ${phone}\n\n${fullDescription}`,
      organizerName: "Belvedere Decks",
      organizerEmail: OWNER_EMAIL,
      attendeeName: name,
      attendeeEmail: email,
    });
  }

  const row = (label: string, value: string, alt = false) =>
    `<tr${alt ? ' style="background: #f5f2ee;"' : ""}>
      <td style="padding: 8px 12px; font-weight: bold; color: #1c1c1c; width: 150px; vertical-align: top;">${label}</td>
      <td style="padding: 8px 12px;">${value}</td>
    </tr>`;

  const ownerHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1c1c1c; border-bottom: 2px solid #b8965a; padding-bottom: 8px;">New Consultation Booking</h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        ${row("Name", escapeHtml(name))}
        ${row("Email", `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`, true)}
        ${row("Phone", `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>`)}
        ${row("Project Address", escapeHtml(address), true)}
        ${row("Service", escapeHtml(service))}
        ${row("Date & Time", `${escapeHtml(date)} at ${escapeHtml(time)}`, true)}
        ${row("Project Details", escapeHtml(description))}
      </table>
      <p style="margin-top: 16px; font-size: 13px; color: #555;">Calendar invite attached as <code>invite.ics</code>.</p>
      <p style="margin-top: 8px; font-size: 12px; color: #888;">Submitted via the Belvedere Decks booking calendar.</p>
    </div>`;

  const customerHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1c1c1c; border-bottom: 2px solid #b8965a; padding-bottom: 8px;">You're booked, ${escapeHtml(name)}.</h2>
      <p style="color: #1c1c1c;">Your deck consultation is scheduled. We'll confirm by phone within 24 hours.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        ${row("Date & Time", `${escapeHtml(date)} at ${escapeHtml(time)}`)}
        ${row("Address", escapeHtml(address), true)}
        ${row("Service", escapeHtml(service))}
      </table>
      <p style="margin-top: 16px; color: #1c1c1c;">
        Plan on about an hour, and it works best when everyone who weighs in on the decision can be there.
        We'll walk the deck together, measure, and build your exact price in front of you, same visit.
      </p>
      <p style="margin-top: 8px; font-size: 13px; color: #555;">Need to reschedule? Just reply to this email or call us.</p>
    </div>`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const attachments = icsContent
      ? [{ filename: "invite.ics", content: Buffer.from(icsContent).toString("base64") }]
      : undefined;

    await resend.emails.send({
      from: MAIL_FROM,
      to: OWNER_EMAIL,
      subject: `Booking: ${name}, ${date} ${time} (${service})`,
      html: ownerHtml,
      attachments,
    });
    await resend.emails.send({
      from: MAIL_FROM,
      to: email,
      subject: `Your deck consultation: ${date} at ${time}`,
      html: customerHtml,
      attachments,
    });
  } catch {
    // Slot is saved; owner can still see it in the DB. Don't fail the request.
  }

  return res.status(200).json({ success: true });
}
