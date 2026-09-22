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
  /* ---- the three substantially different recipes ---- */
  'poster', // edge-to-edge typographic poster: the headline is the whole screen
  'editorial-figure', // a large figure with a narrow text column beside it
  'product-demo', // a framed device/browser demonstration, statement alongside
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
    lead: 'statement', hero: 'poster', nav: 'bar', footer: 'masthead',
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
    lead: 'product', hero: 'product-demo', nav: 'bar-cta', footer: 'cta-band',
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
    lead: 'story', hero: 'editorial-figure', nav: 'inline-links', footer: 'colophon',
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
 * Bounded variation — composable layouts from a blueprint
 *
 * A blueprint is a constraint set, not a finished page: two directions that
 * share one can still differ in hero geometry, block variant, section order,
 * navigation, rhythm and measure. Variation here is BOUNDED and VALIDATED —
 * every edit is checked against `validateBlueprint`, and a variant that would
 * break a lead, a chrome rule or an image rule is discarded rather than
 * rendered.
 *
 * ## Why the id carries the variation
 *
 * A variant's id is `<base>~<h><bucket>` where `h` is a hash of the session
 * seed and the base id, and `bucket` is the explore dial rounded to 0-4. The
 * variation is therefore a PURE function of the id: `resolveBlueprint` re-runs
 * the same edits from the same rng and rebuilds the identical layout. A spec
 * on disk, an export opened next week, or a preview link saved yesterday all
 * resolve to the layout that produced them — no registry, no hidden state.
 * ------------------------------------------------------------------ */

/** Exploratory edit budget per bucket (0 = the untouched blueprint). */
const VARIANT_BUCKETS = 4;

/** Deterministic rng, identical to directions.ts's mulberry32 by design. */
function rngFor(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(arr: readonly T[], r: () => number): T => arr[Math.floor(r() * arr.length) % arr.length]!;

/** Hero variants each lead may draw its first screen with, respecting slots. */
const HERO_CHOICES: Record<Lead, readonly HeroVariant[]> = {
  statement: ['display', 'split', 'panel', 'poster', 'compact'],
  product: ['product-demo', 'split', 'compact', 'panel'],
  catalogue: ['compact', 'index', 'split', 'media'],
  story: ['editorial-figure', 'split', 'dateline', 'display', 'media'],
  date: ['dateline', 'compact', 'split', 'media'],
  data: ['compact', 'panel', 'split', 'index'],
  image: ['media', 'editorial-figure', 'poster', 'display'],
  offer: ['split', 'compact', 'panel', 'poster'],
};

/** Heroes that require at least one image slot. */
const SLOT_HEROES: readonly HeroVariant[] = ['media', 'editorial-figure', 'product-demo'];

/** Widths the grid may take; columns themselves stay as the blueprint set them. */
const MAX_WIDTHS = ['76rem', '80rem', '84rem', '88rem', '92rem', '96rem', '100rem'] as const;

export interface VaryOptions {
  /** 0 = untouched, 1 = the full bounded edit budget. */
  explore: number;
}

/**
 * Does this layout still satisfy its own validation rules?
 * Variation is never allowed to emit an invalid blueprint.
 */
function valid(bp: Blueprint): boolean {
  return validateBlueprint(bp).length === 0;
}

/**
 * Apply bounded variation to a blueprint.
 *
 * Deterministic in (base, seed, explore): the same triple always yields the
 * same layout, which is what makes a variant id resolvable back to the exact
 * blueprint that rendered it.
 */
export function varyBlueprint(base: Blueprint, seed: number, opts: VaryOptions): Blueprint {
  const bucket = Math.max(0, Math.min(VARIANT_BUCKETS, Math.round(opts.explore * VARIANT_BUCKETS)));
  if (bucket === 0) return base;

  const r = rngFor(seed);
  const work: Blueprint = {
    ...base,
    sections: base.sections.map((x) => ({ ...x })),
    grid: { ...base.grid },
  };
  let edits = 0;
  const budget = bucket; // 1..4 bounded edits

  const commit = (apply: () => void): boolean => {
    const before = JSON.stringify(work);
    apply();
    if (valid(work)) return true;
    Object.assign(work, JSON.parse(before) as Blueprint);
    return false;
  };

  /* 1 — block variant swaps: the same module, drawn as a different shape. */
  if (edits < budget && r() < 0.85) {
    commit(() => {
      const i = Math.floor(r() * work.sections.length);
      const sec = work.sections[i]!;
      const options = BLOCK_VARIANTS[sec.module].filter((v) => v !== sec.variant);
      if (options.length) {
        const next = pick(options, r);
        work.sections[i] = { ...sec, variant: next };
        edits++;
      }
    });
  }

  /* 2 — section order: move one section, never the lead-critical opener. */
  if (edits < budget && r() < 0.8) {
    commit(() => {
      const first = work.sections[0]!;
      const movable = work.sections.length > 2 ? work.sections.slice(1) : [];
      if (movable.length >= 2) {
        const from = 1 + Math.floor(r() * (work.sections.length - 1));
        const to = 1 + Math.floor(r() * (work.sections.length - 1));
        if (from !== to) {
          const [moved] = work.sections.splice(from, 1);
          work.sections.splice(to, 0, moved!);
          work.sections[0] = first; // the opener never drifts
          edits++;
        }
      }
    });
  }

  /* 3 — hero geometry: a different first screen for the same content. */
  if (edits < budget && r() < 0.75) {
    commit(() => {
      const options = HERO_CHOICES[base.lead].filter((h) => {
        if (h === base.hero) return false;
        const modules = work.sections.map((s) => s.module);
        if (h === 'index' && !modules.includes('items')) return false;
        if (SLOT_HEROES.includes(h) && work.imageSlots === 0) return false;
        if (h === 'product-demo' && !modules.includes('items') && !modules.includes('features')) return false;
        return true;
      });
      if (options.length) {
        work.hero = pick(options, r);
        edits++;
      }
    });
  }

  /* 4 — navigation and footer: chrome is part of the composition. */
  if (edits < budget && r() < 0.7) {
    commit(() => {
      if (r() < 0.5) {
        const options = NAV_VARIANTS.filter((n) => {
          if (n === base.nav) return false;
          if (n === 'none' && (work.sections.length > 4 || work.footer === 'masthead')) return false;
          return true;
        });
        if (options.length) {
          work.nav = pick(options, r);
          edits++;
        }
      } else {
        const options = FOOTER_VARIANTS.filter((f) => f !== base.footer);
        if (options.length) {
          work.footer = pick(options, r);
          edits++;
        }
      }
    });
  }

  /* 5 — rhythm and measure: how much room the page takes. */
  if (edits < budget && r() < 0.7) {
    commit(() => {
      if (r() < 0.55) {
        const idx = RHYTHMS.indexOf(base.rhythm);
        const step = r() < 0.5 ? -1 : 1;
        const next = RHYTHMS[Math.max(0, Math.min(RHYTHMS.length - 1, idx + step))];
        if (next && next !== work.rhythm) {
          work.rhythm = next;
          edits++;
        }
      } else {
        work.grid.maxWidth = pick(MAX_WIDTHS.filter((w) => w !== base.grid.maxWidth), r);
        edits++;
      }
    });
  }

  /* 6 — module selection: add one section the brief can honestly fill.
     Content availability is enforced at SELECTION time (a candidate whose
     modules the inventory cannot fill is dropped there), so this stays a pure
     function of the id. */
  if (edits < budget && work.sections.length < 7 && r() < 0.5) {
    commit(() => {
      const present = new Set(work.sections.map((s) => s.module));
      const options = MODULES.filter((m) => !present.has(m));
      if (options.length) {
        const module = pick(options, r);
        const variant = pick(BLOCK_VARIANTS[module], r);
        const at = Math.min(work.sections.length, 1 + Math.floor(r() * work.sections.length));
        work.sections.splice(at, 0, { module, variant });
        edits++;
      }
    });
  }

  if (JSON.stringify(work) === JSON.stringify(base)) return base;

  /* The id carries the exact seed the edits drew from, so `resolveBlueprint`
     re-runs the identical rng and rebuilds this identical layout. */
  const h = (seed >>> 0).toString(16).padStart(4, '0').slice(-8);
  return {
    ...work,
    id: `${base.id}~${h}${bucket}`,
    label: `${base.label} · variant ${bucket}`,
    family: base.family,
  };
}

/** Parse a variant id back into its base id and variation seed, if it is one. */
export function parseVariantId(id: string): { base: string; seed: number; explore: number } | null {
  const m = /^([a-z0-9-]+)~([0-9a-f]{4,8})([0-4])$/.exec(id);
  if (!m) return null;
  return { base: m[1]!, seed: parseInt(m[2]!, 16) >>> 0, explore: Number(m[3]) / VARIANT_BUCKETS };
}

/**
 * Resolve a blueprint id — base or variant — back to the exact layout.
 *
 * Every lookup of a spec's blueprint goes through here, so a stored spec, an
 * export or a preview link always rebuilds the layout that produced it.
 */
export function resolveBlueprint(id: string): Blueprint | null {
  const direct = BLUEPRINT_BY_ID[id];
  if (direct) return direct;
  const v = parseVariantId(id);
  if (!v) return null;
  const base = BLUEPRINT_BY_ID[v.base];
  if (!base) return null;
  return varyBlueprint(base, v.seed >>> 0, { explore: v.explore });
}

/** Every blueprint id that is a variant of `baseId`. */
export function isVariantOf(id: string, baseId: string): boolean {
  if (id === baseId) return true;
  return parseVariantId(id)?.base === baseId;
}

/* ------------------------------------------------------------------ *
 * Image slots
 *
 * An image request has to describe a PLACE, not just a count. The previous
 * model generated N 256x256 square textures and then cycled them across
 * whatever tiles happened to exist, which is how a page ends up with the same
 * picture on a hero and a thumbnail.
 *
 * A slot says: what this picture is for, what shape it is, how it should be
 * cropped, where it sits, and — the part that matters for honesty — whether a
 * 256px generated asset can fill it without being stretched into something it
 * is not.
 * ------------------------------------------------------------------ */
export type ImageRole = 'hero-texture' | 'hero-figure' | 'item' | 'figure';
export type ImageCrop = 'cover' | 'contain' | 'detail';

export interface BlueprintImageSlot {
  id: string;
  role: ImageRole;
  /** CSS aspect ratio, e.g. '16 / 10'. */
  aspect: string;
  crop: ImageCrop;
  /** Where it sits, for the prompt and for reporting. */
  placement: string;
  /**
   * `native` means a 256px asset is used at or near its true size.
   * `texture` means it is deliberately enlarged and must be drawn as an
   * atmospheric layer — never presented as a photograph.
   */
  scale: 'native' | 'texture';
  /** Approximate rendered width at 1440, used by the upscale check. */
  desktopWidth: number;
}

/**
 * The image places a blueprint actually renders.
 *
 * Deterministic from the blueprint, so image requests and the renderer agree by
 * construction — the failure the baseline found (2 images generated, 0
 * rendered) cannot recur.
 */
export function imageSlotsFor(bp: Blueprint): BlueprintImageSlot[] {
  const slots: BlueprintImageSlot[] = [];

  if (bp.imageSlots > 0) {
    if (bp.hero === 'media') {
      slots.push({
        id: 'hero', role: 'hero-texture', aspect: '16 / 9', crop: 'cover',
        placement: 'full-bleed behind the opening statement', scale: 'texture', desktopWidth: 1200,
      });
    } else if (bp.hero === 'editorial-figure') {
      slots.push({
        id: 'hero', role: 'hero-figure', aspect: '4 / 5', crop: 'cover',
        placement: 'tall plate in the opening, beside the headline', scale: 'texture', desktopWidth: 620,
      });
    } else if (bp.hero === 'product-demo') {
      slots.push({
        id: 'hero', role: 'hero-figure', aspect: '16 / 10', crop: 'detail',
        placement: 'inside the framed demonstration', scale: 'native', desktopWidth: 256,
      });
    }
  }

  const hasGallery = bp.sections.some((s) => s.module === 'gallery');
  const hasItems = bp.sections.some((s) => s.module === 'items');
  const wants = Math.max(0, bp.imageSlots - slots.length);

  if (hasGallery) {
    for (let i = 0; i < Math.min(wants, 5); i++) {
      slots.push({
        id: `gallery-${i + 1}`, role: 'figure', aspect: i % 5 === 0 ? '4 / 3' : '1 / 1', crop: 'cover',
        placement: `mosaic tile ${i + 1}`, scale: 'native', desktopWidth: 256,
      });
    }
  } else if (hasItems) {
    for (let i = 0; i < Math.min(wants, 5); i++) {
      slots.push({
        id: `items-${i + 1}`, role: 'item', aspect: '1 / 1', crop: i === 0 ? 'detail' : 'cover',
        placement: `catalogue tile ${i + 1}`, scale: 'native', desktopWidth: 256,
      });
    }
  }

  return slots;
}

/** Slots a specific rendered variant can actually use. Excludes none, so a
 *  caller can always ask "what will this page show?". */
export function renderedSlots(bp: Blueprint): BlueprintImageSlot[] {
  return imageSlotsFor(bp);
}

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
  if (bp.imageSlots === 0 && bp.hero === 'editorial-figure') {
    add('figure-hero', 'an editorial-figure hero needs at least one image slot');
  }
  if (bp.imageSlots === 0 && bp.hero === 'product-demo') {
    add('demo-hero', 'a product-demo hero needs a frame, which needs an image slot');
  }

  // Chrome coherence.
  if (bp.nav === 'none' && bp.sections.length > 4) add('nav-none', 'four or more sections need navigation');
  if (bp.nav === 'none' && bp.footer === 'masthead') add('nav-none-footer', 'no navigation anywhere');
  if (bp.grid.columns !== 1 && bp.grid.columns < 8) add('grid-columns', 'a multi-column grid below 8 columns is unusable');
  if (bp.hero === 'index' && !modules.includes('items')) add('hero-index', 'an index hero needs items to index');

  // Contact is deliberately NOT mandatory. A brief may supply no way to get in
  // touch at all — a festival poster may carry only a date and a venue, and a
  // manifesto may carry nothing. Inventing an email and a phone number so the
  // section looks complete is fabricating business details, which this tool
  // does not do. When a page does offer contact, it must be reachable.
  if (bp.lead === 'offer' && !modules.includes('contact')) {
    // An offer with no route to act on it is not an offer.
    add('offer-needs-contact', 'an offer-led page needs a way to act on the offer');
  }

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
