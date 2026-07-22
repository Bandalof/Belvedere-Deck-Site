// ============================================================
// Microsoft Graph helper for the booking system.
// App-only auth (client credentials) against the Belvedere
// Booking System app registration. Plain JS so Vercel's ESM
// runtime loads it directly; files starting with "_" are NOT
// deployed as standalone functions.
// ============================================================
import { BOOKING_TZ, windowsFor, etToUtc } from "../src/lib/schedule.js";

const TENANT = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

export const BOOKING_CALENDAR = process.env.BOOKING_CALENDAR || "schedule@belvederedecks.com";
export const FREEBUSY_CALENDARS = (process.env.FREEBUSY_CALENDARS || BOOKING_CALENDAR)
  .split(",").map((s) => s.trim()).filter(Boolean);

export function graphConfigured() {
  return Boolean(TENANT && CLIENT_ID && CLIENT_SECRET);
}

/** @type {{ token: string, expiresAt: number } | null} */
let cachedToken = null;

export async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph auth failed (${res.status})`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function graphFetch(path, init) {
  const token = await getToken();
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init && init.headers ? init.headers : {}),
    },
  });
}

/**
 * DEBUG ONLY (health-calendar ?date=): Exchange's cached free/busy view,
 * kept for comparison against rawBusy. The live blocking path no longer
 * uses this; getSchedule returned all-free for austin@ despite a Busy event.
 * Raw free/busy per calendar for [startKey .. endKey] (inclusive), ET.
 * Each calendar is queried DIRECTLY (its own mailbox as the target and the
 * only schedule) so no cross-mailbox free/busy sharing rules apply; the app
 * permission alone decides. Returns one entry per calendar with the
 * availabilityView string and any per-schedule error Microsoft reported.
 * @param {string} startKey @param {string} endKey
 * @returns {Promise<{ calendar: string, availabilityView: string, error: string | null }[]>}
 */
export async function rawSchedules(startKey, endKey) {
  return Promise.all(FREEBUSY_CALENDARS.map(async (cal) => {
    try {
      const res = await graphFetch(`/users/${encodeURIComponent(cal)}/calendar/getSchedule`, {
        method: "POST",
        body: JSON.stringify({
          schedules: [cal],
          startTime: { dateTime: `${startKey}T00:00:00`, timeZone: BOOKING_TZ },
          endTime: { dateTime: `${endKey}T23:59:59`, timeZone: BOOKING_TZ },
          availabilityViewInterval: 30,
        }),
      });
      if (!res.ok) return { calendar: cal, availabilityView: "", error: `HTTP ${res.status}` };
      const data = await res.json();
      const entry = (data.value || [])[0] || {};
      return {
        calendar: cal,
        availabilityView: entry.availabilityView || "",
        error: entry.error ? String(entry.error.responseCode || entry.error.message || "unknown") : null,
      };
    } catch (e) {
      return { calendar: cal, availabilityView: "", error: String(e && e.message || e) };
    }
  }));
}

/**
 * The events that actually block time, per calendar, for
 * [startKey .. endKey] (inclusive), ET. Reads the REAL events via
 * calendarView instead of trusting getSchedule, because Exchange's
 * free/busy cache proved unreliable for austin@ (a confirmed Busy
 * event kept reporting as all-free). calendarView reads the calendar
 * itself, so what Outlook shows is what the site sees.
 * Cancelled and "Show as: Free" events are filtered out here.
 * Times come back as ET wall-clock strings (Prefer: outlook.timezone).
 * @param {string} startKey @param {string} endKey
 * @returns {Promise<{ calendar: string, events: { start: string, end: string, showAs: string }[], error: string | null }[]>}
 */
export async function rawBusy(startKey, endKey) {
  const startISO = etToUtc(startKey, 0).toISOString();
  const dayAfterEnd = new Date(new Date(endKey + "T12:00:00").getTime() + 86_400_000)
    .toISOString().split("T")[0];
  const endISO = etToUtc(dayAfterEnd, 0).toISOString();

  return Promise.all(FREEBUSY_CALENDARS.map(async (cal) => {
    try {
      /** @type {{ start: string, end: string, showAs: string }[]} */
      const events = [];
      let path =
        `/users/${encodeURIComponent(cal)}/calendarView` +
        `?startDateTime=${encodeURIComponent(startISO)}&endDateTime=${encodeURIComponent(endISO)}` +
        `&$select=start,end,showAs,isCancelled&$top=200`;
      for (let page = 0; page < 10 && path; page++) {
        const res = await graphFetch(path, {
          headers: { Prefer: `outlook.timezone="${BOOKING_TZ}"` },
        });
        if (!res.ok) return { calendar: cal, events, error: `HTTP ${res.status}` };
        const data = await res.json();
        for (const e of data.value || []) {
          if (e.isCancelled) continue;
          if (String(e.showAs || "busy").toLowerCase() === "free") continue;
          events.push({
            start: String(e.start && e.start.dateTime || ""),
            end: String(e.end && e.end.dateTime || ""),
            showAs: String(e.showAs || "busy"),
          });
        }
        const next = data["@odata.nextLink"];
        path = next ? String(next).replace("https://graph.microsoft.com/v1.0", "") : "";
      }
      return { calendar: cal, events, error: null };
    } catch (e) {
      return { calendar: cal, events: [], error: String(e && e.message || e) };
    }
  }));
}

/**
 * Free/busy for [startKey .. endKey] (inclusive), ET, across all
 * FREEBUSY_CALENDARS. Returns a map dateKey -> Set of blocked window ids.
 * A window is blocked if ANY calendar has ANY non-free event overlapping it.
 * @param {string} startKey @param {string} endKey
 * @returns {Promise<Record<string, Set<string>>>}
 */
export async function blockedWindows(startKey, endKey) {
  const perCalendar = await rawBusy(startKey, endKey);
  const events = perCalendar.flatMap((c) => c.events);
  /** @type {Record<string, Set<string>>} */
  const blocked = {};

  const start = new Date(startKey + "T12:00:00");
  const end = new Date(endKey + "T12:00:00");
  const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const dateKey = d.toISOString().split("T")[0];
    const wins = windowsFor(dateKey);
    if (!wins.length) continue;
    for (const w of wins) {
      // Event times and window bounds are both ET wall-clock ISO strings,
      // zero-padded, so plain string comparison is a correct overlap test.
      const wStart = `${dateKey}T${String(w.startHour).padStart(2, "0")}:00:00`;
      const wEnd = `${dateKey}T${String(w.endHour).padStart(2, "0")}:00:00`;
      const busy = events.some((ev) => ev.start && ev.end && ev.start < wEnd && ev.end > wStart);
      if (busy) (blocked[dateKey] || (blocked[dateKey] = new Set())).add(w.id);
    }
  }
  return blocked;
}

/** True if this specific window is free on every watched calendar.
 * @param {string} dateKey @param {import("../src/lib/schedule.js").BookingWindow} win */
export async function windowIsFree(dateKey, win) {
  const blocked = await blockedWindows(dateKey, dateKey);
  return !(blocked[dateKey] && blocked[dateKey].has(win.id));
}

/**
 * @typedef {Object} BookingEventInput
 * @property {string} dateKey
 * @property {import("../src/lib/schedule.js").BookingWindow} win
 * @property {string} customerName
 * @property {string} customerEmail
 * @property {string} customerPhone
 * @property {string} address
 * @property {string} service
 * @property {string} description
 * @property {string} transactionId
 */

/** @param {BookingEventInput} i */
function eventBody(i) {
  return {
    transactionId: i.transactionId,
    subject: `Site visit: ${i.customerName} - ${i.service}`,
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

/** Create the booking as a real meeting (customer = attendee). Returns the Graph event id.
 * @param {BookingEventInput} i @returns {Promise<string>} */
export async function createBookingEvent(i) {
  const res = await graphFetch(`/users/${encodeURIComponent(BOOKING_CALENDAR)}/events`, {
    method: "POST",
    body: JSON.stringify(eventBody(i)),
  });
  if (!res.ok) throw new Error(`Event create failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

/** Move an existing event; Exchange emails the attendee the update automatically.
 * @param {string} eventId @param {string} dateKey
 * @param {import("../src/lib/schedule.js").BookingWindow} win */
export async function moveBookingEvent(eventId, dateKey, win) {
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

/**
 * Where does this event live right now? Used to reconcile the database with
 * the calendar after Austin drags or deletes a booking directly in Outlook.
 * Returns { dateKey, startHour } in ET, or null if the event is gone/cancelled.
 * @param {string} eventId
 * @returns {Promise<{ dateKey: string, startHour: number } | null>}
 */
export async function getEventTimes(eventId) {
  const res = await graphFetch(
    `/users/${encodeURIComponent(BOOKING_CALENDAR)}/events/${encodeURIComponent(eventId)}?$select=start,isCancelled`,
    { headers: { Prefer: `outlook.timezone="${BOOKING_TZ}"` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Event lookup failed (${res.status})`);
  const data = await res.json();
  if (data.isCancelled) return null;
  const dt = String(data.start && data.start.dateTime || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}/.test(dt)) return null;
  return { dateKey: dt.slice(0, 10), startHour: Number(dt.slice(11, 13)) };
}

/** Cancel an event; Exchange emails the attendee the cancellation automatically.
 * @param {string} eventId */
export async function cancelBookingEvent(eventId) {
  const res = await graphFetch(
    `/users/${encodeURIComponent(BOOKING_CALENDAR)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) throw new Error(`Event cancel failed (${res.status})`);
}
