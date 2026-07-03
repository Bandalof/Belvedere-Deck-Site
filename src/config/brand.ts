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
  legalName: 'Belvedere Decks LLC',   // pending SDAT amendment
  tagline: 'Composite deck specialists serving Maryland, based in Montgomery County',
  mhic: '',                      // MHIC #_____ - fill on Day L
  phone: '',                     // business line - pending setup
  phoneDisplay: '(240) 555-0000', // TODO replace with real business line
  email: 'hello@belvederedecks.com', // TODO confirm after domain + M365
  domain: 'https://www.belvederedecks.com',
  formEndpoint: '',              // TODO: Formspree/serverless endpoint before launch
  serviceArea: 'Maryland, based in Montgomery County',
  minimumJob: 5000,
};
