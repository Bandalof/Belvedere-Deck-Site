// ============================================================
// Calendar-to-database reconciler. The calendar is the boss:
// when Austin drags or deletes a booking directly in Outlook,
// this notices, fixes the database row (freeing the old window
// on the site), and sends the SAME branded reschedule emails
// to the owner and the customer that the self-service page
// sends. Runs from /api/bookings (every availability lookup)
// and /api/reconcile (the 15-minute ping), and the guarded SQL
// update makes sure only one of them sends the emails.
// Files starting with "_" are not deployed as functions.
// ============================================================
import { Resend } from "resend";
import { windowsFor, windowById, humanDate } from "../src/lib/schedule.js";
import { getEventTimes, graphConfigured } from "./_graph.js";
import { rescheduleEmailPair } from "./_email.js";

const MAIL_FROM = process.env.MAIL_FROM || "Belvedere Decks <schedule@belvederedecks.com>";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "schedule@belvederedecks.com";

/** "9:15 AM" from 24h parts. @param {number} h @param {number} m */
function timeLabel(h, m) {
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** Send the branded pair; best effort, never throws.
 * @param {{ origin: string, customerName: string, customerEmail: string, address: string,
 *           oldDate: string, oldLabel: string, newDate: string, newLabel: string }} i */
async function sendReschedulePair(i) {
  try {
    const { owner, customer } = rescheduleEmailPair({
      ...i,
      ownerNote: "You moved this on the calendar. The customer has been emailed the change, and the old window is open again on the site.",
    });
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: MAIL_FROM, to: OWNER_EMAIL, subject: owner.subject, html: owner.html });
    await resend.emails.send({
      from: MAIL_FROM, to: i.customerEmail, replyTo: OWNER_EMAIL,
      subject: customer.subject, html: customer.html,
    });
    return 2;
  } catch {
    return 0;
  }
}

/**
 * Reconcile bookings in [startKey .. endKey] (endKey null = all future).
 * Returns the surviving reservations (for availability maps) plus counters.
 * @param {any} sql neon client
 * @param {string} origin absolute site origin for email links
 * @param {string} startKey YYYY-MM-DD inclusive
 * @param {string | null} endKey YYYY-MM-DD inclusive, or null for no cap
 * @returns {Promise<{ active: { dateKey: string, windowId: string }[], moved: number, freed: number, emailsSent: number }>}
 */
export async function reconcileRange(sql, origin, startKey, endKey) {
  const rows = endKey
    ? await sql`
        SELECT id, booking_date, booking_time, customer_name, customer_email, project_address, graph_event_id
        FROM bookings
        WHERE booking_date >= ${startKey}::date AND booking_date <= ${endKey}::date`
    : await sql`
        SELECT id, booking_date, booking_time, customer_name, customer_email, project_address, graph_event_id
        FROM bookings
        WHERE booking_date >= ${startKey}::date`;

  /** @type {{ dateKey: string, windowId: string }[]} */
  const active = [];
  let moved = 0, freed = 0, emailsSent = 0;

  await Promise.all(rows.map(async (r) => {
    const dbDateKey = new Date(r.booking_date).toISOString().split("T")[0];
    const dbWindowId = String(r.booking_time);

    if (!r.graph_event_id || !graphConfigured()) {
      active.push({ dateKey: dbDateKey, windowId: dbWindowId });
      return;
    }
    try {
      const live = await getEventTimes(String(r.graph_event_id));
      if (live === null) {
        // Deleted/cancelled in Outlook: free the slot. Exchange already sent
        // the customer the cancellation when the meeting was deleted.
        await sql`DELETE FROM bookings WHERE id = ${r.id}`;
        freed++;
        return;
      }

      const oldDate = humanDate(dbDateKey);
      const oldLabel = (windowById(dbDateKey, dbWindowId) || { label: dbWindowId }).label;
      const liveWin = live.startMinute === 0
        ? windowsFor(live.dateKey).find((w) => w.startHour === live.startHour)
        : undefined;

      if (liveWin && live.dateKey === dbDateKey && liveWin.id === dbWindowId) {
        // Unchanged.
        active.push({ dateKey: dbDateKey, windowId: dbWindowId });
        return;
      }

      if (liveWin) {
        // Dragged to a different window: move the reservation with it.
        // The guard makes this atomic: exactly ONE reconciler run wins the
        // update, and only the winner sends the emails (no duplicates).
        const won = await sql`
          UPDATE bookings SET booking_date = ${live.dateKey}, booking_time = ${liveWin.id}
          WHERE id = ${r.id}
            AND booking_date = ${dbDateKey}::date AND booking_time = ${dbWindowId}
            AND NOT EXISTS (
              SELECT 1 FROM bookings b2
              WHERE b2.booking_date = ${live.dateKey} AND b2.booking_time = ${liveWin.id} AND b2.id <> ${r.id}
            )
          RETURNING id
        `;
        if (won.length) {
          moved++;
          active.push({ dateKey: live.dateKey, windowId: liveWin.id });
          emailsSent += await sendReschedulePair({
            origin,
            customerName: String(r.customer_name),
            customerEmail: String(r.customer_email),
            address: String(r.project_address),
            oldDate, oldLabel,
            newDate: humanDate(live.dateKey),
            newLabel: liveWin.label,
          });
          return;
        }
        // Lost the guard (another run already moved it, or the target window
        // holds a different booking): keep the row where the database has it.
        active.push({ dateKey: dbDateKey, windowId: dbWindowId });
        return;
      }

      // Dragged to a time that is not a standard window: release the database
      // lock (the calendar busy check still blocks whatever it overlaps) and
      // tell both sides the EXACT new times.
      const gone = await sql`
        DELETE FROM bookings
        WHERE id = ${r.id} AND booking_date = ${dbDateKey}::date AND booking_time = ${dbWindowId}
        RETURNING id
      `;
      if (gone.length) {
        freed++;
        emailsSent += await sendReschedulePair({
          origin,
          customerName: String(r.customer_name),
          customerEmail: String(r.customer_email),
          address: String(r.project_address),
          oldDate, oldLabel,
          newDate: humanDate(live.dateKey),
          newLabel: `${timeLabel(live.startHour, live.startMinute)} - ${timeLabel(live.endHour, live.endMinute)}`,
        });
      }
    } catch {
      // Graph hiccup: keep the row as-is rather than lose the lock.
      active.push({ dateKey: dbDateKey, windowId: dbWindowId });
    }
  }));

  return { active, moved, freed, emailsSent };
}
