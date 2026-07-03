export interface Town {
  slug: string;
  name: string;
  zip: string;
  title: string;
  description: string;
  intro: string;
  housing: string;
  fit: string;
  permitNote: string;
}

export const towns: Town[] = [
  {
    slug: 'potomac',
    name: 'Potomac',
    zip: '20854',
    title: 'Deck Builder in Potomac, MD',
    description:
      'Custom composite decks and deck renovations in Potomac, Maryland. Transparent pricing, MCDPS permit handling, and a 10-year workmanship warranty.',
    intro:
      'Potomac is our home base. We live here, we build here, and we know what an estate-lot deck has to deliver: scale that matches the house, railings and lighting specified like architecture, and a structure that passes inspection without drama.',
    housing:
      'Potomac decks tend to be larger and higher off grade than the county average, which means engineering matters: beam sizing, lateral attachment, and stair design are where big decks go wrong. Many older Potomac decks were built before current lateral-load requirements existed.',
    fit:
      'Most of our Potomac work is fully custom: multi-zone decks, picture-frame borders, lit stairways, and premium PVC boards that handle full-sun exposures. For homes with structurally sound frames, resurfacing with new railings delivers a new deck’s look at a fraction of a new build.',
    permitNote:
      'New builds and structural work in Potomac require a Montgomery County (MCDPS) building permit. We pull it, handle all three inspections, and prepare HOA architectural review documents where your community requires them.',
  },
  {
    slug: 'north-potomac-kentlands',
    name: 'North Potomac & Kentlands',
    zip: '20878',
    title: 'Deck Builder in North Potomac & Kentlands (Gaithersburg), MD',
    description:
      'Deck resurfacing and new deck construction in North Potomac, Kentlands, and Quince Orchard. Honest published pricing and county permit fluency.',
    intro:
      'The Kentlands, Quince Orchard, and North Potomac neighborhoods were largely built between 1985 and 2005, which means thousands of decks here are wearing their original wood boards on frames that are still perfectly sound.',
    housing:
      'That 20-to-40-year-old housing stock is exactly where deck resurfacing shines: the pressure-treated framing under most of these decks has decades of life left, while the walking surface and railings are splintering, fading, and overdue.',
    fit:
      'We inspect the frame honestly (screwdriver test, ledger flashing check, joist spacing) and tell you plainly whether your deck is a resurfacing candidate or genuinely needs a new build. Most homeowners here are surprised how often the answer is the smaller number.',
    permitNote:
      'Resurfacing projects typically do not require a Montgomery County permit when framing stays in place. If we find structural work is needed, we confirm permit requirements with MCDPS before any contract changes, in writing.',
  },
  {
    slug: 'bethesda',
    name: 'Bethesda',
    zip: '20817',
    title: 'Deck Builder in Bethesda, MD',
    description:
      'Composite deck construction and renovation in Bethesda, Maryland with published pricing. See what decks really cost before anyone visits your home.',
    intro:
      'Bethesda has no shortage of deck builders. What it lacks is one who will put real prices in writing before sitting in your kitchen. We publish ours (see the pricing page) because an informed homeowner is our best customer.',
    housing:
      'Bethesda’s mix runs from mid-century homes with aging elevated decks to newer infill with builder-grade decks ready for an upgrade. Elevated decks here deserve special attention to ledger flashing and lateral attachment, the two failure points we check on every inspection.',
    fit:
      'If you’ve collected bids that start at $30,000 before anyone measured anything, our resurfacing line exists precisely for the Bethesda deck whose bones are good. And for full custom builds, one design visit delivers drawings and a fixed price, not a guess.',
    permitNote:
      'We handle MCDPS permits, footing/framing/final inspections, and HOA or neighborhood architectural review paperwork for every Bethesda build that requires them.',
  },
  {
    slug: 'olney',
    name: 'Olney',
    zip: '20832',
    title: 'Deck Builder in Olney, MD',
    description:
      'Deck resurfacing and replacement services in Olney, Maryland. Straight answers, published pricing, code-first construction.',
    intro:
      'Olney’s subdivisions went up mostly between 1975 and 1995, and their decks are now on their second or third decade. This is the sweet spot for smart deck renovation: projects that transform the back of the house without paying for a full rebuild.',
    housing:
      'Decks of this era were commonly built with 24-inch joist spacing and nailed connections. That was fine for the wood boards of the day, but composite boards need 16-inch (or 12-inch diagonal) spacing and modern connectors. We check that before quoting, not after demo.',
    fit:
      'Many Olney decks land in our boards-plus-railings resurfacing level: new composite boards, new railings, and new edge trim on the existing frame, with any tired joists replaced and every connection brought up to standard. It’s the biggest visual change per dollar we offer.',
    permitNote:
      'Board-and-railing replacement typically doesn’t require a county permit. Where we add or replace structure, we confirm requirements with MCDPS first and put it in the contract.',
  },
  {
    slug: 'boyds',
    name: 'Boyds',
    zip: '20841',
    title: 'Deck Builder in Boyds, MD',
    description:
      'Composite deck construction in Boyds, Maryland: first re-deck cycle specialists for 2000s-era homes. Transparent pricing and MCDPS permit handling.',
    intro:
      'Boyds’ neighborhoods were built largely between 2000 and 2015, and the original builder decks are hitting the age where boards gray, fasteners back out, and railings loosen. It is the first re-deck cycle.',
    housing:
      'The good news about 2000s framing: most of it was built to modern spans and is an excellent resurfacing candidate. The catch is builder-grade shortcuts: minimal flashing, undersized footings on some additions. That is why every project starts with a structural walk-through we narrate as we go.',
    fit:
      'Board-only resurfacing here typically runs days, not weeks: existing frame inspected and taped, premium composite boards with hidden fasteners, and railings that finally feel solid. If you’re ready to go bigger, we design and build fully custom decks with the county permit handled end to end.',
    permitNote:
      'New construction and structural changes require an MCDPS permit. We pull it and manage footing, framing, and final inspections. Like-for-like resurfacing typically does not.',
  },
  {
    slug: 'clarksburg',
    name: 'Clarksburg',
    zip: '20871',
    title: 'Deck Builder in Clarksburg, MD',
    description:
      'Deck builder serving Clarksburg, Maryland: resurfacing and new custom composite decks with published pricing and county permit fluency.',
    intro:
      'Clarksburg is one of the county’s youngest communities, and one of its most underserved for deck work. Most established deck firms are based an hour away; we’re up the road, and Clarksburg is a core part of our service area.',
    housing:
      'Homes here were built from the early 2000s onward, many with small builder decks or bare walkouts begging for real outdoor space. HOA architectural review is a fact of life in most Clarksburg communities. We prepare the submission documents as part of every project.',
    fit:
      'Two patterns dominate our Clarksburg work: upgrading the original 10×12 builder deck to a properly sized composite deck, and first-cycle resurfacing projects on the community’s older sections. Either way, you get an exact price fast, not a two-week wait.',
    permitNote:
      'New builds require an MCDPS permit plus, in most communities, HOA approval. We handle the county side entirely and prepare everything your HOA needs from you.',
  },
];
