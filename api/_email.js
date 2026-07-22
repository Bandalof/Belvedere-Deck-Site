// ============================================================
// Shared email chrome for all booking-system emails.
// Brand: charcoal #1c1c1c, gold #b8965a, cream #f5f2ee.
// House rule: no em dashes anywhere in customer-facing copy.
// Files starting with "_" are not deployed as functions.
// ============================================================

export const CHARCOAL = "#1c1c1c";
export const GOLD = "#b8965a";
export const CREAM = "#f5f2ee";

/**
 * Wrap inner HTML in the branded shell: charcoal header with the
 * company name set in type (no image; text renders crisply in every
 * mail client and both color modes), gold rule, white body.
 * @param {string} origin kept for signature compatibility; no longer used
 * @param {string} inner
 */
export function emailShell(origin, inner) {
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: ${CHARCOAL}; padding: 24px; border-radius: 6px 6px 0 0; border-bottom: 3px solid ${GOLD};">
      <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 30px; line-height: 1.1; letter-spacing: 0.5px; color: ${CREAM};">Belvedere Decks</span>
    </div>
    <div style="padding: 8px 4px 0 4px;">
      ${inner}
    </div>
    <div style="margin-top: 28px; padding: 14px 4px; border-top: 1px solid #e5e0d8; font-size: 12px; color: #888;">
      Belvedere Decks LLC · Montgomery County, Maryland
    </div>
  </div>`;
}

/** Heading with the gold underline treatment. @param {string} text */
export function heading(text) {
  return `<h2 style="color: ${CHARCOAL}; border-bottom: 2px solid ${GOLD}; padding-bottom: 8px; margin: 16px 0 8px;">${text}</h2>`;
}

/** Detail-table row. @param {string} label @param {string} value @param {boolean} [alt] */
export function row(label, value, alt = false) {
  return `<tr${alt ? ` style="background: ${CREAM};"` : ""}>
    <td style="padding: 8px 12px; font-weight: bold; color: ${CHARCOAL}; width: 150px; vertical-align: top;">${label}</td>
    <td style="padding: 8px 12px;">${value}</td>
  </tr>`;
}

/** Open + close for the detail table. @param {string} rows */
export function table(rows) {
  return `<table style="width: 100%; border-collapse: collapse; margin-top: 16px; border: 1px solid #eee;">${rows}</table>`;
}

/** Gold call-to-action button. @param {string} href @param {string} label */
export function button(href, label) {
  return `<p style="margin: 24px 0;">
    <a href="${href}" style="background: ${GOLD}; color: ${CHARCOAL}; padding: 13px 26px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block;">${label}</a>
  </p>`;
}

/**
 * The branded "Booking Rescheduled" owner + customer pair. ONE source of
 * truth, used by both reschedule paths: the customer's self-service page
 * AND the reconciler that notices Austin dragging the event in Outlook.
 * @param {{ origin: string, customerName: string, address: string,
 *           oldDate: string, oldLabel: string, newDate: string, newLabel: string,
 *           ownerNote: string }} i
 * @returns {{ owner: { subject: string, html: string }, customer: { subject: string, html: string } }}
 */
export function rescheduleEmailPair(i) {
  const owner = {
    subject: `Rescheduled: ${i.customerName} moved to ${i.newDate}, ${i.newLabel}`,
    html: emailShell(i.origin, `
        ${heading("Booking Rescheduled")}
        ${table(`
          ${row("Customer", i.customerName)}
          ${row("Old window", `<span style="text-decoration: line-through; color: #888;">${i.oldDate}, ${i.oldLabel}</span>`, true)}
          ${row("New window", `<strong>${i.newDate}, ${i.newLabel}</strong>`)}
          ${row("Address", i.address, true)}
        `)}
        <p style="margin-top: 16px; font-size: 13px; color: #555;">${i.ownerNote}</p>`),
  };
  const customer = {
    subject: `RESCHEDULED: your site visit is now ${i.newDate}, ${i.newLabel}`,
    html: emailShell(i.origin, `
        ${heading("Your visit has been RESCHEDULED.")}
        <p style="color: ${CHARCOAL}; font-size: 15px;">Please note the change so there's no confusion on the day:</p>
        ${table(`
          ${row("Old window", `<span style="text-decoration: line-through; color: #888;">${i.oldDate}<br/>${i.oldLabel}</span>`, true)}
          ${row("NEW window", `<span style="background: ${CREAM}; border-left: 4px solid ${GOLD}; padding: 6px 10px; display: inline-block;"><strong style="font-size: 16px;">${i.newDate}</strong><br/><strong style="font-size: 16px;">${i.newLabel}</strong></span>`)}
        `)}
        <p style="margin-top: 16px; color: ${CHARCOAL};">Your calendar invitation updates automatically, and as always, we'll call before we head your way.</p>`),
  };
  return { owner, customer };
}

/**
 * The branded "Booking Cancelled" owner + customer pair. ONE source of
 * truth, used by both cancellation paths: the customer's self-service
 * page AND the reconciler that notices Austin deleting the event in
 * Outlook. Sent no matter WHO cancels, so both sides always hear it.
 * @param {{ origin: string, customerName: string, address: string,
 *           date: string, label: string, ownerNote: string }} i
 * @returns {{ owner: { subject: string, html: string }, customer: { subject: string, html: string } }}
 */
export function cancelEmailPair(i) {
  const owner = {
    subject: `Cancelled: ${i.customerName}, ${i.date}, ${i.label}`,
    html: emailShell(i.origin, `
        ${heading("Booking Cancelled")}
        ${table(`
          ${row("Customer", i.customerName)}
          ${row("Was", `${i.date}, ${i.label}`, true)}
          ${row("Address", i.address)}
        `)}
        <p style="margin-top: 16px; font-size: 13px; color: #555;">${i.ownerNote}</p>`),
  };
  const customer = {
    subject: `Cancelled: your site visit on ${i.date}`,
    html: emailShell(i.origin, `
        ${heading("Your visit is cancelled.")}
        <p style="color: ${CHARCOAL};">Your ${i.date} appointment (${i.label}) has been cancelled. No charge, no hard feelings.
        When you're ready to talk decks again, book any time at our website.</p>`),
  };
  return { owner, customer };
}
