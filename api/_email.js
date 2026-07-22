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
