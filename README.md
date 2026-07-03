# Belvedere Decks, website

Static Astro site. Replaces the old React SPA (`monumental-decks-site`), which is
now a coming-soon gate.

## DO NOT DEPLOY PUBLICLY until Day L
Maryland law (Bus. Reg. §8-601, COMAR 09.08.01.09) prohibits advertising home
improvement services without an MHIC license. This site is built dark on purpose.

## Launch checklist (Day L)
1. `src/config/brand.ts`: fill `mhic`, `phone`/`phoneDisplay`, confirm `email`,
   set `formEndpoint` (Formspree or serverless), then set `launched: true`
   (removes the preview banner and the noindex tag).
2. BOOKING CALENDAR: the /contact page has a live booking calendar backed by
   Vercel serverless functions in `api/`. It needs four environment variables in
   the Vercel project (Settings -> Environment Variables), copy the values from
   the old monumental-decks-site Vercel project:
   - DATABASE_URL (Neon Postgres, same DB reuses the existing bookings table;
     for a fresh DB, hit GET /api/setup-db once after setting the var)
   - RESEND_API_KEY (email sending)
   - MAIL_FROM (e.g. "Belvedere Decks <hello@belvederedecks.com>" once the domain
     is verified in Resend; falls back to onboarding@resend.dev)
   - OWNER_EMAIL (where booking notifications go)
   Then TEST a booking end to end (audit item, the old site's form was never verified).
   Slots: weekdays 9-4, Saturdays 9-12, Sundays blocked; double-bookings are
   rejected at the database level.
3. Add real project photos to `/portfolio` and town pages (no stock, no AI images).
4. Point belvederedecks.com at Vercel; submit sitemap to Search Console.
5. Add og:image (best finished-deck hero shot).

## Develop / build
    npm install
    npm run dev       # local preview
    npm run build     # output in dist/

## Deploy (Vercel)
Create a new Vercel project from this folder (framework preset: Astro).
Keep it on a preview URL (or password-protect) until Day L.
