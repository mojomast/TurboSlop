/**
 * TurboSlop — the page blueprint.
 *
 * The previous model had one coarse decision ("composition") selecting one of
 * seven whole-page templates. Every member of a family therefore repeated the
 * same site chrome, the same hero shape, and the same required blocks, so pages
 * read as one design family no matter how the palette or effect kit changed.
 *
 * A blueprint separates the brief's SEMANTIC CONTENT from the ARRANGEMENT of
 * that content. It is a typed, validated description of:
 *
 *   - which sections exist        (a subset, in order — not a fixed list)
 *   - what the FIRST SCREEN is for (its `lead`)
 *   - the hero, nav and footer treatments
 *   - a block variant for every section
 *   - grid geometry, spacing rhythm and image slots
 *   - which content modules it REQUIRES (so the writer is asked only for those)
 *
 * Blueprints are ingredients, not templates: two blueprints in the same family
 * can differ in lead, order, block variants, chrome and rhythm.
 */

/* ------------------------------------------------------------------ *
 * Modules and variants
 * ------------------------------------------------------------------ */
export const MODULES = [
  'items', // catalogue, portfolio, menu, products
  'features', // capabilities, services, benefits
  'stats', // numbers
  'about', // story
  'process', // how it works / how it is made
  'quote', // pull quote or testimonial
  'gallery', // image-forward grid
  'schedule', // dates, agenda, programme
  'pricing', // tiers, rates, packages
  'faq', // questions
  'contact', // how to reach them
] as const;
export type ModuleId = (typeof MODULES)[number];

/** Per-module block variants. A variant is a shape, not a style. */
export const BLOCK_VARIANTS: Record<ModuleId, readonly string[]> = {
  items: ['rail', 'grid', 'editorial-index', 'table', 'bento', 'gallery', 'list'],
  features: ['cards', 'rows', 'deflist', 'pills'],
  stats: ['row', 'tiles', 'inline'],
  about: ['columns', 'rail-text', 'letter'],
  process: ['steps', 'timeline'],
  quote: ['large', 'inline', 'band'],
  gallery: ['mosaic', 'strip'],
  schedule: ['table', 'agenda'],
  pricing: ['tiers', 'table'],
  faq: ['accordion'],
  contact: ['form', 'email', 'split'],
} as const;

/** What the first screen is FOR. This is the axis that was missing. */
export const LEADS = ['statement', 'product', 'catalogue', 'story', 'date', 'data', 'image', 'offer'] as const;
export type Lead = (typeof LEADS)[number];

export const HERO_VARIANTS = [
  'display', // one enormous statement
  'split', // statement beside a panel of facts or an image
  'compact', // small masthead, content starts immediately
  'panel', // a framed panel containing the statement and key facts
  'media', // image-led opening
  'index', // the opening IS an index/list of what is below
  'dateline', // a date/venue/programme strip leads
] as const;
export type HeroVariant = (typeof HERO_VARIANTS)[number];

export const NAV_VARIANTS = [
  'bar', // brand left, links right, sticky
  'bar-cta', // as bar, plus a primary action
  'minimal', // brand only; navigation lives in the footer
  'inline-links', // a single line of links, no brand lockup
  'stacked', // brand above, links beneath
  'none', // no chrome at all
] as const;
export type NavVariant = (typeof NAV_VARIANTS)[number];

export const FOOTER_VARIANTS = [
  'masthead', // enormous wordmark
  'columns', // link columns
  'minimal', // one line
  'cta-band', // a closing call to action
  'ledger', // contact details as a table
  'colophon', // editorial note
] as const;
export type FooterVariant = (typeof FOOTER_VARIANTS)[number];

export const RHYTHMS = ['tight', 'even', 'generous', 'dramatic'] as const;
export type Rhythm = (typeof RHYTHMS)[number];

/* ------------------------------------------------------------------ *
 * The blueprint
 * ------------------------------------------------------------------ */
export interface Section {
  module: ModuleId;
  variant: string;
}

export interface Blueprint {
  id: string;
  label: string;
  /** Rough family, for reporting. Two blueprints in a family must still differ. */
  family: string;
  /** A one-line description used when scoring fit against a brief. */
  suits: string;
  lead: Lead;
  hero: HeroVariant;
  nav: NavVariant;
  footer: FooterVariant;
  /** Ordered sections AFTER the hero. `contact` need not be last. */
  sections: Section[];
  grid: { columns: number; maxWidth: string };
  rhythm: Rhythm;
  /** How many image slots the layout wants; 0 means it needs no artwork. */
  imageSlots: number;
}

/* ------------------------------------------------------------------ *
 * The catalog
 *
 * Deliberately not grouped one-per-family: several live in the same family and
 * differ by lead, order, variants, chrome and rhythm.
 * ------------------------------------------------------------------ */
const s = (module: ModuleId, variant: string): Section => ({ module, variant });

export const BLUEPRINTS: Blueprint[] = [
  /* ---- statement-led ------------------------------------------------ */
  {
    id: 'statement-display',
    label: 'Statement, full display',
    family: 'statement',
    suits: 'A confident position stated at maximum scale, then evidence beneath.',
    lead: 'statement', hero: 'display', nav: 'bar', footer: 'masthead',
    sections: [s('about', 'columns'), s('features', 'rows'), s('quote', 'large'), s('items', 'editorial-index'), s('contact', 'email')],
    grid: { columns: 12, maxWidth: '96rem' }, rhythm: 'dramatic', imageSlots: 0,
  },
  {
    id: 'statement-panel',
    label: 'Statement in a panel',
    family: 'statement',
    suits: 'A framed opening that reads as an object, with the facts beside the claim.',
    lead: 'statement', hero: 'panel', nav: 'minimal', footer: 'minimal',
    sections: [s('stats', 'inline'), s('about', 'letter'), s('process', 'steps'), s('contact', 'split')],
    grid: { columns: 12, maxWidth: '84rem' }, rhythm: 'generous', imageSlots: 0,
  },
  {
    id: 'statement-letter',
    label: 'Letter to a reader',
    family: 'statement',
    suits: 'A studio or individual speaking directly and at length, with almost no structure.',
    lead: 'statement', hero: 'display', nav: 'none', footer: 'colophon',
    sections: [s('about', 'letter'), s('quote', 'inline'), s('items', 'list'), s('contact', 'email')],
    grid: { columns: 1, maxWidth: '46rem' }, rhythm: 'generous', imageSlots: 0,
  },

  /* ---- product-led -------------------------------------------------- */
  {
    id: 'product-demo',
    label: 'Product demonstration first',
    family: 'product',
    suits: 'Show the thing working before explaining it; the product is the argument.',
    lead: 'product', hero: 'split', nav: 'bar-cta', footer: 'cta-band',
    sections: [s('items', 'bento'), s('features', 'cards'), s('stats', 'row'), s('faq', 'accordion'), s('contact', 'form')],
    grid: { columns: 12, maxWidth: '88rem' }, rhythm: 'even', imageSlots: 4,
  },
  {
    id: 'product-spec',
    label: 'Product specification',
    family: 'product',
    suits: 'An evaluative audience: precise numbers, a spec table, honest limits.',
    lead: 'data', hero: 'compact', nav: 'inline-links', footer: 'ledger',
    sections: [s('stats', 'row'), s('items', 'table'), s('features', 'deflist'), s('faq', 'accordion'), s('contact', 'split')],
    grid: { columns: 12, maxWidth: '80rem' }, rhythm: 'tight', imageSlots: 0,
  },
  {
    id: 'product-pricing',
    label: 'Offer and price',
    family: 'product',
    suits: 'A commercial offer where what it costs is the point.',
    lead: 'offer', hero: 'split', nav: 'bar-cta', footer: 'cta-band',
    sections: [s('pricing', 'tiers'), s('features', 'cards'), s('faq', 'accordion'), s('stats', 'inline'), s('contact', 'form')],
    grid: { columns: 12, maxWidth: '84rem' }, rhythm: 'even', imageSlots: 0,
  },

  /* ---- catalogue-led ------------------------------------------------ */
  {
    id: 'catalogue-gallery',
    label: 'Catalogue as gallery',
    family: 'catalogue',
    suits: 'Things sold or made, where the objects carry the page.',
    lead: 'catalogue', hero: 'compact', nav: 'bar', footer: 'columns',
    sections: [s('items', 'gallery'), s('about', 'rail-text'), s('features', 'pills'), s('contact', 'email')],
    grid: { columns: 12, maxWidth: '96rem' }, rhythm: 'tight', imageSlots: 6,
  },
  {
    id: 'catalogue-rail',
    label: 'Catalogue as rail',
    family: 'catalogue',
    suits: 'A browsable set where the catalogue should feel inexhaustible.',
    lead: 'catalogue', hero: 'index', nav: 'inline-links', footer: 'minimal',
    sections: [s('items', 'rail'), s('items', 'grid'), s('stats', 'inline'), s('contact', 'email')],
    grid: { columns: 12, maxWidth: '100rem' }, rhythm: 'tight', imageSlots: 6,
  },
  {
    id: 'catalogue-market',
    label: 'Market list',
    family: 'catalogue',
    suits: 'A long list of small things, priced, where scanning matters more than drama.',
    lead: 'catalogue', hero: 'compact', nav: 'stacked', footer: 'ledger',
    sections: [s('items', 'table'), s('about', 'columns'), s('schedule', 'table'), s('contact', 'form')],
    grid: { columns: 12, maxWidth: '76rem' }, rhythm: 'tight', imageSlots: 0,
  },

  /* ---- story-led ---------------------------------------------------- */
  {
    id: 'story-editorial',
    label: 'Editorial feature',
    family: 'story',
    suits: 'Long-form writing with photography; the reading experience is the product.',
    lead: 'story', hero: 'compact', nav: 'inline-links', footer: 'colophon',
    sections: [s('about', 'columns'), s('quote', 'band'), s('gallery', 'mosaic'), s('items', 'editorial-index'), s('contact', 'email')],
    grid: { columns: 12, maxWidth: '78rem' }, rhythm: 'generous', imageSlots: 4,
  },
  {
    id: 'story-profile',
    label: 'Profile of a person',
    family: 'story',
    suits: 'An individual or small team, told through their work and their own voice.',
    lead: 'story', hero: 'split', nav: 'minimal', footer: 'minimal',
    sections: [s('about', 'rail-text'), s('gallery', 'strip'), s('quote', 'large'), s('process', 'timeline'), s('contact', 'email')],
    grid: { columns: 12, maxWidth: '82rem' }, rhythm: 'generous', imageSlots: 3,
  },
  {
    id: 'story-origin',
    label: 'Origin story',
    family: 'story',
    suits: 'How something came to exist, told in order.',
    lead: 'story', hero: 'dateline', nav: 'bar', footer: 'masthead',
    sections: [s('process', 'timeline'), s('gallery', 'strip'), s('about', 'columns'), s('quote', 'band'), s('stats', 'row'), s('contact', 'split')],
    grid: { columns: 12, maxWidth: '84rem' }, rhythm: 'even', imageSlots: 2,
  },

  /* ---- date-led ----------------------------------------------------- */
  {
    id: 'event-programme',
    label: 'Event programme',
    family: 'date',
    suits: 'A dated event: when, where, and what happens in what order.',
    lead: 'date', hero: 'dateline', nav: 'bar-cta', footer: 'cta-band',
    sections: [s('schedule', 'agenda'), s('items', 'list'), s('features', 'rows'), s('pricing', 'table'), s('contact', 'form')],
    grid: { columns: 12, maxWidth: '84rem' }, rhythm: 'tight', imageSlots: 0,
  },
  {
    id: 'event-festival',
    label: 'Festival poster',
    family: 'date',
    suits: 'A loud, image-forward event announcement.',
    lead: 'image', hero: 'media', nav: 'minimal', footer: 'cta-band',
    sections: [s('schedule', 'table'), s('gallery', 'mosaic'), s('quote', 'band'), s('pricing', 'tiers'), s('contact', 'email')],
    grid: { columns: 12, maxWidth: '96rem' }, rhythm: 'dramatic', imageSlots: 5,
  },
  {
    id: 'event-ticketing',
    label: 'Ticketing page',
    family: 'date',
    suits: 'Selling admission: dates, tiers, questions.',
    lead: 'offer', hero: 'compact', nav: 'bar-cta', footer: 'ledger',
    sections: [s('pricing', 'tiers'), s('schedule', 'table'), s('faq', 'accordion'), s('contact', 'form')],
    grid: { columns: 12, maxWidth: '78rem' }, rhythm: 'tight', imageSlots: 0,
  },

  /* ---- image-led ---------------------------------------------------- */
  {
    id: 'image-mosaic',
    label: 'Image-first mosaic',
    family: 'image',
    suits: 'Visual work where the pictures must arrive before any words.',
    lead: 'image', hero: 'media', nav: 'minimal', footer: 'masthead',
    sections: [s('gallery', 'mosaic'), s('about', 'letter'), s('quote', 'inline'), s('contact', 'email')],
    grid: { columns: 12, maxWidth: '100rem' }, rhythm: 'tight', imageSlots: 7,
  },
  {
    id: 'image-strip',
    label: 'Image strip, then text',
    family: 'image',
    suits: 'A single row of work, argued about below.',
    lead: 'image', hero: 'media', nav: 'stacked', footer: 'columns',
    sections: [s('gallery', 'strip'), s('items', 'list'), s('features', 'deflist'), s('contact', 'split')],
    grid: { columns: 12, maxWidth: '92rem' }, rhythm: 'even', imageSlots: 4,
  },

  /* ---- data-led ----------------------------------------------------- */
  {
    id: 'data-metrics',
    label: 'Numbers first',
    family: 'data',
    suits: 'A technical or financial offering where the figures are the argument.',
    lead: 'data', hero: 'compact', nav: 'inline-links', footer: 'ledger',
    sections: [s('stats', 'tiles'), s('items', 'table'), s('features', 'deflist'), s('about', 'columns'), s('contact', 'split')],
    grid: { columns: 12, maxWidth: '80rem' }, rhythm: 'tight', imageSlots: 0,
  },
  {
    id: 'data-calculator',
    label: 'Price, worked through',
    family: 'data',
    suits: 'Explaining how a cost is arrived at, with the working shown.',
    lead: 'data', hero: 'panel', nav: 'bar', footer: 'ledger',
    sections: [s('pricing', 'table'), s('stats', 'row'), s('features', 'rows'), s('faq', 'accordion'), s('contact', 'form')],
    grid: { columns: 12, maxWidth: '76rem' }, rhythm: 'tight', imageSlots: 0,
  },
];

export const BLUEPRINT_BY_ID = Object.fromEntries(BLUEPRINTS.map((b) => [b.id, b]));

/* ------------------------------------------------------------------ *
 * Validation and compatibility
 *
 * A blueprint that cannot honestly be filled from a brief's real information is
 * rejected before it is ever rendered. We do not fabricate contact details or
 * business claims to satisfy a layout.
 * ------------------------------------------------------------------ */
export interface BlueprintIssue {
  blueprint: string;
  rule: string;
  detail: string;
}

/** Which content modules a blueprint needs the writer to supply. */
export function requiredModules(bp: Blueprint): ModuleId[] {
  const out = new Set<ModuleId>();
  for (const sec of bp.sections) out.add(sec.module);
  return [...out];
}

export function validateBlueprint(bp: Blueprint): BlueprintIssue[] {
  const issues: BlueprintIssue[] = [];
  const add = (rule: string, detail: string) => issues.push({ blueprint: bp.id, rule, detail });

  const modules = bp.sections.map((x) => x.module);

  if (bp.sections.length < 2) add('min-sections', 'a page needs at least two sections after the hero');
  if (bp.sections.length > 7) add('max-sections', 'more than seven sections is not a page, it is a list');

  for (const sec of bp.sections) {
    const allowed = BLOCK_VARIANTS[sec.module];
    if (!allowed) add('unknown-module', `unknown module "${sec.module}"`);
    else if (!allowed.includes(sec.variant)) {
      add('unknown-variant', `"${sec.variant}" is not a variant of ${sec.module} (have: ${allowed.join(', ')})`);
    }
  }

  // The lead has to actually be delivered by the page.
  const first = modules[0];
  if (bp.lead === 'product' && !['items', 'features'].includes(first ?? '')) {
    add('lead-product', 'a product-led page must open with items or features');
  }
  if (bp.lead === 'catalogue' && first !== 'items') add('lead-catalogue', 'a catalogue-led page must open with items');
  if (bp.lead === 'date' && !modules.includes('schedule')) add('lead-date', 'a date-led page needs a schedule');
  if (bp.lead === 'story' && !modules.includes('about')) add('lead-story', 'a story-led page needs an about module');
  if (bp.lead === 'data' && !modules.includes('stats') && !modules.includes('pricing')) {
    add('lead-data', 'a data-led page needs stats or pricing');
  }
  if (bp.lead === 'image' && !modules.includes('gallery') && !modules.includes('items')) {
    add('lead-image', 'an image-led page needs a gallery or items');
  }
  if (bp.lead === 'offer' && !modules.includes('pricing')) add('lead-offer', 'an offer-led page needs pricing');

  // Image slots must match the layout's appetite.
  const imageModules = modules.filter((m) => m === 'gallery' || m === 'items').length;
  if (bp.imageSlots > 0 && imageModules === 0) add('images-unused', 'imageSlots > 0 but no module can show an image');
  if (bp.imageSlots === 0 && bp.hero === 'media') add('media-hero', 'a media hero needs at least one image slot');

  // Chrome coherence.
  if (bp.nav === 'none' && bp.sections.length > 4) add('nav-none', 'four or more sections need navigation');
  if (bp.nav === 'none' && bp.footer === 'masthead') add('nav-none-footer', 'no navigation anywhere');
  if (bp.grid.columns !== 1 && bp.grid.columns < 8) add('grid-columns', 'a multi-column grid below 8 columns is unusable');
  if (bp.hero === 'index' && !modules.includes('items')) add('hero-index', 'an index hero needs items to index');

  // contact should be reachable, though not necessarily last.
  if (!modules.includes('contact')) add('no-contact', 'every page needs a way to make contact');

  return issues;
}

/** Every blueprint must validate. Checked by the test suite. */
export function validateAllBlueprints(): BlueprintIssue[] {
  return BLUEPRINTS.flatMap(validateBlueprint);
}

/* ------------------------------------------------------------------ *
 * Fingerprints
 *
 * A fingerprint describes the page's STRUCTURE: what leads, what chrome, which
 * blocks in which order, and the grid. It deliberately excludes colour, copy,
 * class names and byte length, each of which can differ while the page reads
 * exactly the same.
 * ------------------------------------------------------------------ */
export interface Fingerprint {
  lead: Lead;
  hero: HeroVariant;
  nav: NavVariant;
  footer: FooterVariant;
  sequence: string; // "items:gallery>about:rail-text>contact:email"
  columns: number;
  rhythm: Rhythm;
}

export function fingerprintOf(bp: Blueprint): Fingerprint {
  return {
    lead: bp.lead,
    hero: bp.hero,
    nav: bp.nav,
    footer: bp.footer,
    sequence: bp.sections.map((x) => `${x.module}:${x.variant}`).join('>'),
    columns: bp.grid.columns,
    rhythm: bp.rhythm,
  };
}

/** A stable single-line key, for grouping and de-duplication. */
export function fingerprintKey(bp: Blueprint): string {
  const f = fingerprintOf(bp);
  return [f.lead, f.hero, f.nav, f.footer, f.columns, f.rhythm, f.sequence].join('|');
}

/**
 * How structurally far apart two blueprints are, 0..1.
 *
 * Section sequence carries the most weight: two pages with different headers but
 * the same blocks in the same order still read as the same page.
 */
export function fingerprintDistance(a: Blueprint, b: Blueprint): number {
  const fa = fingerprintOf(a);
  const fb = fingerprintOf(b);
  const parts: [number, boolean][] = [
    [0.3, fa.lead === fb.lead],
    [0.2, fa.hero === fb.hero],
    [0.12, fa.nav === fb.nav],
    [0.1, fa.footer === fb.footer],
    [0.18, fa.sequence === fb.sequence],
    [0.06, fa.columns === fb.columns],
    [0.04, fa.rhythm === fb.rhythm],
  ];
  let same = 0;
  for (const [weight, identical] of parts) if (identical) same += weight;
  return Number((1 - same).toFixed(4));
}
