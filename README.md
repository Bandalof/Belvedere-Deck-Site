# Belvedere Decks, website

Static Astro site. Replaces the old React SPA (`monumental-decks-site`), which is
now a coming-soon gate.

## HOUSE STYLE RULE: no em dashes
No em dashes (and no en dashes) anywhere in this project: page copy, emails,
error messages, code comments, commit messages. Use a comma, a period, a
semicolon, a colon, or the word "to" instead. Time ranges use a plain hyphen
("8:00 - 10:00 AM"). This is a standing rule from Austin; enforce it in review.

## DO NOT DEPLOY PUBLICLY until Day L
Maryland law (Bus. Reg. 8-601, COMAR 09.08.01.09) prohibits advertising home
improvement services without an MHIC license. This site is built dark on purpose.

## Booking system (live)
The /estimate page runs a window-based scheduling system backed by the Vercel
functions in `api/`:

- Customers book a 2-hour ARRIVAL WINDOW (weekdays 8-10 / 11-1 / 2-4 / 5-7,
  Saturdays 8-10 / 11-1 / 2-4, Sundays closed, nothing same-day, all Eastern).
  Window definitions live in ONE place: `src/lib/schedule.js`.
- Availability = database reservations + live free/busy from Microsoft 365
  (`schedule@belvederedecks.com` AND `austin@belvederedecks.com`). Any event on
  either calendar blocks the overlapping windows automatically; blocking time
  means creating a calendar event, nothing more.
- A booking becomes a real calendar meeting on schedule@ with the customer
  invited. Dragging it in Outlook reschedules it: Exchange emails the customer
  the update, and `/api/bookings` self-heals the database row so the old window
  reopens on the site.
- Customers self-serve reschedule/cancel via a tokenized link in their
  confirmation email (`/reschedule?bid=..&t=..`), cutoff 4 hours before the
  window. Emails are branded (charcoal header, gold rule, hosted logo at
  `/public/images/email/logo.png`).
- `/api/health-calendar` verifies credentials, free/busy, and the database;
  Austin's Monday brief polls it (CALENDAR SYNC: YES/NO).

Environment variables (Vercel project settings): DATABASE_URL, RESEND_API_KEY,
MAIL_FROM, OWNER_EMAIL, BOOKING_CALENDAR, FREEBUSY_CALENDARS, AZURE_TENANT_ID,
AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (rotate before 7/20/2028). Schema changes
go in `/api/setup-db` (idempotent; hit it once after deploying a migration).

## Launch checklist (Day L)
1. `src/config/brand.ts`: fill `mhic`, `phone`/`phoneDisplay`, confirm `email`,
   set `formEndpoint` (Formspree or serverless), then set `launched: true`
   (removes the preview banner and the noindex tag).
2. TEST a booking end to end on the production domain.
3. Add real project photos to `/portfolio` and town pages (no stock, no AI images).
4. Point belvederedecks.com at Vercel; submit sitemap to Search Console.
5. Add og:image (best finished-deck hero shot).

## Develop / build
    npm install
    npm run dev       # local preview
    npm run build     # output in dist/

## Deploy (Vercel)
Vercel project: belvedere-deck-site (auto-deploys from main).
Keep it on a preview URL until Day L.
