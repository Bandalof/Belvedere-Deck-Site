// ============================================================
// BRAND CONFIG - single source of truth for the whole site.
// LAUNCH GATE: the site must NOT go live until `mhic` is filled
// in (COMAR 09.08.01.09 requires name + MHIC number on all
// advertising) and `launched` is set to true. While launched is
// false, every page renders a PREVIEW banner and noindex.
// ============================================================
export const brand = {
  launched: false,               // flip to true on Day L only
  name: 'Belvedere Decks',
  legalName: 'Belvedere Decks LLC',
  tagline: 'Composite deck specialists serving Baltimore County, Frederick County, Howard County, and Montgomery County',
  mhic: '',                      // MHIC #_____ - fill on Day L
  phone: '',                     // business line - pending setup
  phoneDisplay: '(240) 555-0000', // TODO replace with real business line
  email: 'hello@belvederedecks.com', // TODO confirm after domain + M365
  domain: 'https://www.belvederedecks.com',
  formEndpoint: '',              // TODO: Formspree/serverless endpoint before launch
  serviceArea: 'Baltimore County, Frederick County, Howard County, and Montgomery County',
  // GA4 measurement ID (G-XXXXXXXXXX). Leave empty until the GA4 property exists -
  // the tag renders nothing while this is blank. Server-side booking_completed also
  // needs GA4_API_SECRET (+ GA4_MEASUREMENT_ID) set as Vercel env vars.
  // UTM convention (the one convention, everywhere): utm_source=google|meta|nextdoor|yard-sign,
  // utm_medium=cpc|social|print|referral, utm_campaign=<launch|spring26|...>.
  ga4: '',
  // No published minimum job while pre-launch: small repair work is welcomed early
  // to build reviews (decided Aug 3 2026). Reintroduce a real, estimator-derived
  // minimum here when established - never an invented number.
};
