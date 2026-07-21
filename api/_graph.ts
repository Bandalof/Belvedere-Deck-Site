// ============================================================
// Microsoft Graph helper for the booking system.
// App-only auth (client credentials) against the Belvedere
// Booking System app registration. Files starting with "_"
// are NOT deployed as standalone Vercel functions.
// ============================================================
import { BOOKING_TZ, windowsFor, type BookingWindow } from "../src/lib/schedule";

const TENANT = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

export const BOOKING_CALENDAR = process.env.BOOKING_CALENDAR || "schedule@belvederedecks.com";
export const FREEBUSY_CALENDARS = (process.env.FREEBUSY_CALENDARS || BOOKING_CALENDAR)
  .split(",").map((s) => s.trim()).filter(Boolean);

export function graphConfigured(): boolean {
  return Boolean(TENANT && CLIENT_ID && CLIENT_SECRET);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph auth failed (${res.status})`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function graphFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken();
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
}

/**
 * Free/busy for [startKey .. endKey] (inclusive), ET, across all
 * FREEBUSY_CALENDARS. Returns a map dateKey -> Set of blocked window ids.
 * A window is blocked if ANY calendar shows ANY non-free time inside it.
 */
export async function blockedWindows(startKey: string, endKey: string): Promise<Record<string, Set<string>>> {
  const res = await graphFetch(`/users/${encodeURIComponent(BOOKING_CALENDAR)}/calendar/getSchedule`, {
    method: "POST",
    body: JSON.stringify({
      schedules: FREEBUSY_CALENDARS,
      startTime: { dateTime: `${startKey}T00:00:00`, timeZone: BOOKING_TZ },
      endTime: { dateTime: `${endKey}T23:59:59`, timeZone: BOOKING_TZ },
      availabilityViewInterval: 30,
    }),
  });
  if (!res.ok) throw new Error(`getSchedule failed (${res.status})`);
  const data = await res.json();

  // availabilityView: one char per 30-min slot from startTime, per schedule.
  // '0' = free; anything else (tentative/busy/oof) blocks.
  const views: string[] = (data.value || []).map((s: any) => s.availabilityView || "");
  const blocked: Record<string, Set<string>> = {};

  const start = new Date(startKey + "T12:00:00");
  const end = new Date(endKey + "T12:00:00");
  const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const dateKey = d.toISOString().split("T")[0];
    const wins = windowsFor(dateKey);
    if (!wins.length) continue;
    for (const w of wins) {
      const chunkStart = i * 48 + w.startHour * 2;          // 48 half-hours per day
      const chunkEnd = i * 48 + w.endHour * 2;
      const busy = views.some((view) => {
        for (let c = chunkStart; c < chunkEnd; c++) {
          const ch = view[c];
          if (ch && ch !== "0") return true;
        }
        return false;
      });
      if (busy) (blocked[dateKey] ||= new Set()).add(w.id);
    }
  }
  return blocked;
}

/** True if this specific window is free on every watched calendar. */
export async function windowIsFree(dateKey: string, win: BookingWindow): Promise<boolean> {
  const blocked = await blockedWindows(dateKey, dateKey);
  return !blocked[dateKey]?.has(win.id);
}

export interface BookingEventInput {
  dateKey: string;
  win: BookingWindow;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  service: string;
  description: string;
  transactionId: string;
}

function eventBody(i: BookingEventInput): object {
  return {
    transactionId: i.transactionId,
    subject: `Site visit: ${i.customerName} — ${i.service}`,
    body: {
      contentType: "text",
      content:
        `Customer: ${i.customerName}\nPhone: ${i.customerPhone}\nEmail: ${i.customerEmail}\n` +
        `Address: ${i.address}\nService: ${i.service}\n\n${i.description}\n\n` +
        `Arrival window ${i.win.label}. Call the customer before heading over.`,
    },
    start: { dateTime: `${i.dateKey}T${String(i.win.startHour).padStart(2, "0")}:00:00`, timeZone: BOOKING_TZ },
    end: { dateTime: `${i.dateKey}T${String(i.win.endHour).padStart(2, "0")}:00:00`, timeZone: BOOKING_TZ },
    location: { displayName: i.address },
    attendees: [
      { emailAddress: { address: i.customerEmail, name: i.customerName }, type: "required" },
    ],
    isReminderOn: true,
    reminderMinutesBeforeStart: 60,
  };
}

/** Create the booking as a real meeting (customer = attendee). Returns the Graph event id. */
export async function createBookingEvent(i: BookingEventInput): Promise<string> {
  const res = await graphFetch(`/users/${encodeURIComponent(BOOKING_CALENDAR)}/events`, {
    method: "POST",
    body: JSON.stringify(eventBody(i)),
  });
  if (!res.ok) throw new Error(`Event create failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

/** Move an existing event; Exchange emails the attendee the update automatically. */
export async function moveBookingEvent(eventId: string, dateKey: string, win: BookingWindow): Promise<void> {
  const res = await graphFetch(
    `/users/${encodeURIComponent(BOOKING_CALENDAR)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        start: { dateTime: `${dateKey}T${String(win.startHour).padStart(2, "0")}:00:00`, timeZone: BOOKING_TZ },
        end: { dateTime: `${dateKey}T${String(win.endHour).padStart(2, "0")}:00:00`, timeZone: BOOKING_TZ },
      }),
    },
  );
  if (!res.ok) throw new Error(`Event move failed (${res.status})`);
}

/** Cancel an event; Exchange emails the attendee the cancellation automatically. */
export async function cancelBookingEvent(eventId: string): Promise<void> {
  const res = await graphFetch(
    `/users/${encodeURIComponent(BOOKING_CALENDAR)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) throw new Error(`Event cancel failed (${res.status})`);
}
