# Belvedere Decks — website

Static Astro site. Replaces the old React SPA (`monumental-decks-site`), which is
now a coming-soon gate.

## DO NOT DEPLOY PUBLICLY until Day L
Maryland law (Bus. Reg. §8-601, COMAR 09.08.01.09) prohibits advertising home
improvement services without an MHIC license. This site is built dark on purpose.

## Launch checklist (Day L)
1. `src/config/brand.ts`: fill `mhic`, `phone`/`phoneDisplay`, confirm `email`,
   set `formEndpoint` (Formspree or serverless) — then set `launched: true`
   (removes the preview banner and the noindex tag).
2. Test the contact form end to end (audit item — the old site's form was never verified).
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
