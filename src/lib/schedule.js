// ============================================================
// SCHEDULE - single source of truth for booking windows.
// Used by BOTH the website pages and the /api functions.
// Plain JS (with JSDoc types) so Vercel's ESM runtime can load
// it directly - always import it WITH the .js extension.
//
// Model: customers book a 2-hour ARRIVAL WINDOW (one visit per
// window). The visit runs 30-60 min; the slack absorbs travel
// and overruns. Nothing is bookable same-day - earliest is
// tomorrow (America/New_York). Sundays closed.
// ============================================================

export const BOOKING_TZ = "America/New_York";
export const RESCHEDULE_CUTOFF_HOURS = 4;

/**
 * @typedef {Object} BookingWindow
 * @property {string} id        stable key, stored in the DB ("08:00")
 * @property {string} label     customer-facing ("8:00 - 10:00 AM")
 * @property {number} startHour 24h, ET
 * @property {number} endHour   24h, ET
 */

/** @type {BookingWindow[]} */
export const WEEKDAY_WINDOWS = [
  { id: "08:00", label: "8:00 - 10:00 AM", startHour: 8, endHour: 10 },
  { id: "11:00", label: "11:00 AM - 1:00 PM", startHour: 11, endHour: 13 },
  { id: "14:00", label: "2:00 - 4:00 PM", startHour: 14, endHour: 16 },
  { id: "17:00", label: "5:00 - 7:00 PM", startHour: 17, endHour: 19 },
];

// Saturday: no evening window (last visit wraps by ~4 PM).
/** @type {BookingWindow[]} */
export const SATURDAY_WINDOWS = WEEKDAY_WINDOWS.slice(0, 3);

/** @param {string} dateKey @returns {BookingWindow[]} */
export function windowsFor(dateKey) {
  const day = new Date(dateKey + "T12:00:00").getDay();
  if (day === 0) return [];           // Sunday closed
  if (day === 6) return SATURDAY_WINDOWS;
  return WEEKDAY_WINDOWS;
}

/** @param {string} dateKey @param {string} id @returns {BookingWindow | undefined} */
export function windowById(dateKey, id) {
  return windowsFor(dateKey).find((w) => w.id === id);
}

/** Today's date key (YYYY-MM-DD) in ET - the booking timezone, not the visitor's.
 * @param {Date} [now] */
export function todayKeyET(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BOOKING_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** True if dateKey is bookable at all: strictly after today (ET). No same-day.
 * @param {string} dateKey @param {Date} [now] */
export function isBookableDate(dateKey, now = new Date()) {
  return dateKey > todayKeyET(now);
}

/**
 * Convert an ET wall-clock time to a real UTC instant, DST-safe.
 * Tries both possible offsets (minus 4 or minus 5) and keeps the one that round-trips.
 * @param {string} dateKey @param {number} hour @param {number} [minute]
 */
export function etToUtc(dateKey, hour, minute = 0) {
  for (const offset of [4, 5]) {
    const guess = new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-0${offset}:00`);
    const back = new Intl.DateTimeFormat("en-US", {
      timeZone: BOOKING_TZ, hour12: false, hour: "2-digit", minute: "2-digit",
    }).format(guess);
    const [h, m] = back.split(":").map(Number);
    if ((h === hour || (hour === 0 && h === 24)) && m === minute) return guess;
  }
  // Fallback (should never hit): assume EST
  return new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-05:00`);
}

/** True while a customer may still self-reschedule/cancel this booking.
 * @param {string} dateKey @param {number} windowStartHour @param {Date} [now] */
export function beforeCutoff(dateKey, windowStartHour, now = new Date()) {
  const start = etToUtc(dateKey, windowStartHour);
  return start.getTime() - now.getTime() > RESCHEDULE_CUTOFF_HOURS * 60 * 60 * 1000;
}

/** Human date like "Thursday, July 23, 2026" from a dateKey.
 * @param {string} dateKey */
export function humanDate(dateKey) {
  return new Date(dateKey + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}
