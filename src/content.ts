/**
 * TurboSlop — the content model.
 *
 * A design is not "a layout with the studio's boilerplate poured in". The brief
 * decides the DESIGN (Jev's job) and it also decides the CONTENT — who the brand
 * is, what they sell, what the page says.
 *
 * Everything here is generated from the brief. Nothing about any particular
 * studio is baked in.
 *
 * ## Emphasis convention
 * Headings may mark ONE word or phrase with asterisks, e.g.
 *
 *     "Six problems *worth* solving"
 *
 * which renders as `Six problems <em>worth</em> solving` in the accent face.
 * This is how the type system gets its editorial accent without the model
 * emitting HTML.
 */
import { z } from 'zod';

/** A heading block: label, headline (may contain *emphasis*), optional note. */
export const Section = z.object({
  eyebrow: z.string().min(2).max(80),
  title: z.string().min(4).max(120),
  note: z.string().max(240).default(''),
});
export type Section = z.infer<typeof Section>;

/** A card in the portfolio / product / menu grid. */
export const Item = z.object({
  name: z.string().min(1).max(40),
  meta: z.string().min(2).max(80),
  /** Keep in step with LIMITS.tag in the repair pass, or the clamp is a no-op. */
  tags: z.array(z.string().min(1).max(40)).max(4).default([]),
});
export type Item = z.infer<typeof Item>;

export const Stat = z.object({
  value: z.string().min(1).max(12),
  label: z.string().min(1).max(40),
  note: z.string().max(140).default(''),
});

export const Feature = z.object({
  name: z.string().min(2).max(40),
  detail: z.string().min(10).max(180),
});

export const Fact = z.object({
  label: z.string().min(2).max(24),
  value: z.string().min(1).max(48),
});

/** A pull quote, set large, used by the editorial compositions. */
export const PullQuote = z.object({
  text: z.string().min(20).max(260),
  attribution: z.string().max(60).default(''),
});

/**
 * How a page can be contacted.
 *
 * Every field is optional, and the whole object is optional, because a brief
 * does not always supply a way to make contact — a festival poster may carry
 * only a date and a venue, and a manifesto may carry nothing at all. The old
 * shape demanded an email, a phone number AND a postal address on every page,
 * which meant the writer invented them. That is fabricating business details to
 * satisfy a template, which this tool does not do.
 *
 * At least one field must be present when the object IS present: an empty
 * contact block is worse than none.
 */
export const Contact = z
  .object({
    email: z.string().min(3).max(80).optional(),
    phone: z.string().min(3).max(40).optional(),
    address: z.string().min(2).max(120).optional(),
    /** A real URL the brief implies (booking page, docs, shop). */
    url: z.string().min(4).max(120).optional(),
    /** A social handle, when that is how the brief says people find them. */
    handle: z.string().min(2).max(40).optional(),
    /** Anything the brief does say about reaching them, verbatim-ish. */
    note: z.string().max(160).optional(),
  })
  .refine((v) => Object.values(v).some((x) => typeof x === 'string' && x.trim().length > 0), {
    message: 'contact needs at least one of email/phone/address/url/handle/note',
  });
export type Contact = z.infer<typeof Contact>;

/** A numbered step in a process / method list. */
export const ProcessStep = z.object({
  name: z.string().min(2).max(40),
  detail: z.string().min(10).max(180),
});

export const Content = z.object({
  /** The brand the page is for. Invented to fit the brief. */
  brand: z.string().min(2).max(32),
  title: z.string().min(4).max(140),
  description: z.string().min(20).max(320),
  /** Small label above the headline. */
  eyebrow: z.string().min(2).max(90),
  /** The hero headline. May contain one *emphasised* phrase. */
  tagline: z.string().min(8).max(160),
  lede: z.string().min(20).max(400),
  cta: z.string().min(2).max(40),
  /**
   * Optional label overrides, matched POSITIONALLY to the blueprint's sections.
   * When the count does not match the blueprint the labels are ignored and the
   * renderer derives them from the modules — the previous code indexed into this
   * array with the wrong offset, so labels drifted onto the wrong links.
   */
  nav: z.array(z.string().min(2).max(20)).max(8).default([]),

  /**
   * Per-module heading blocks. Partial on purpose: a blueprint renders only the
   * modules it declares, so the writer is asked only for those. The renderer
   * falls back to the module name when one is absent.
   */
  sections: z
    .object({
      items: Section.optional(),
      features: Section.optional(),
      stats: Section.optional(),
      about: Section.optional(),
      process: Section.optional(),
      quote: Section.optional(),
      gallery: Section.optional(),
      schedule: Section.optional(),
      pricing: Section.optional(),
      faq: Section.optional(),
      contact: Section.optional(),
    })
    .default({}),

  /* ---- modules -----------------------------------------------------------
     Each is optional. A blueprint declares which modules it needs, the writer is
     asked only for those, and a page renders only what it has. This is what
     stops every page being forced into work/features/stats/about/contact. */
  items: z.array(Item).max(8).default([]),
  stats: z.array(Stat).max(4).default([]),
  features: z.array(Feature).max(8).default([]),
  aboutFacts: z.array(Fact).max(5).default([]),
  aboutBody: z.array(z.string().min(40).max(700)).max(3).default([]),

  /**
   * How to reach them — present only when the brief actually implies a way.
   * Never invented to fill a slot.
   */
  contact: Contact.optional(),

  /** One line of footer provenance/voice. */
  footerNote: z.string().min(2).max(160),

  /* ---- optional extra elements -------------------------------------------
     Optional on purpose: a missing element must never cost us the whole
     generation. Compositions decide which of these they actually use. */
  /** A short phrase list for a band/ticker. */
  ticker: z.array(z.string().min(2).max(28)).max(8).default([]),
  /** One pull quote. */
  pullQuote: PullQuote.optional(),
  /** A process / method list. */
  process: z.array(ProcessStep).max(6).default([]),
});
export type Content = z.infer<typeof Content>;

/* ================================================================== *
 * Emphasis
 * ================================================================== */
/** Escape, then turn `*phrase*` into `<em>phrase</em>`. */
export function emphasize(raw: string): string {
  const escaped = raw.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
  return escaped.replace(/\*([^*\n]{1,60})\*/g, '<em>$1</em>');
}

/** Plain-text version (asterisks removed), for meta tags and file names. */
export function stripEmphasis(raw: string): string {
  return raw.replace(/\*/g, '');
}

/**
 * Make asterisk emphasis balanced.
 *
 * Models occasionally emit an odd number of asterisks. Left alone that prints a
 * literal `*` in a headline, so we drop the stray one rather than render it.
 */
export function balanceEmphasis(raw: string): string {
  const count = (raw.match(/\*/g) ?? []).length;
  if (count % 2 === 0) return raw;
  const last = raw.lastIndexOf('*');
  return raw.slice(0, last) + raw.slice(last + 1);
}

/* ================================================================== *
 * Tolerant repair
 *
 * A generated object is almost never wrong in a way that should cost the whole
 * design. It is far more often slightly over-long — a 29-character tag against a
 * 28-character limit. Rejecting the entire generation for that and silently
 * substituting the specimen is the worst possible trade: we lose the brand the
 * model invented AND the variety.
 *
 * So: clamp, trim, drop the excess, fill the gaps, then validate.
 * ================================================================== */
const LIMITS = {
  brand: 32, title: 140, description: 320, eyebrow: 90, tagline: 160,
  lede: 400, cta: 40, footerNote: 160,
  sectionEyebrow: 80, sectionTitle: 120, sectionNote: 240,
  itemName: 40, itemMeta: 80, tag: 40,
  statValue: 12, statLabel: 40, statNote: 140,
  featureName: 40, featureDetail: 180,
  factLabel: 24, factValue: 48,
  navLabel: 20, tickerWord: 28,
  quoteText: 260, quoteAttr: 60,
  stepName: 40, stepDetail: 180,
  contactField: 120, aboutParagraph: 700,
} as const;

const str = (v: unknown, max: number, min = 1): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = balanceEmphasis(v.replace(/\s+/g, ' ').trim());
  if (t.length < min) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
};

const list = <T>(v: unknown, max: number, map: (x: unknown, i: number) => T | undefined): T[] =>
  Array.isArray(v)
    ? v.map(map).filter((x): x is T => x !== undefined).slice(0, max)
    : [];

/** Clamp a generated object into the Content shape. Returns null only if the
 *  result still cannot satisfy the schema's required minimums. */
export function repairContent(raw: unknown): Content | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const sections = (r.sections ?? {}) as Record<string, unknown>;
  const sec = (key: string) => {
    const s = (sections[key] ?? {}) as Record<string, unknown>;
    return {
      eyebrow: str(s.eyebrow, LIMITS.sectionEyebrow, 2) ?? 'Section',
      title: str(s.title, LIMITS.sectionTitle, 4) ?? 'Untitled section',
      note: str(s.note, LIMITS.sectionNote, 0) ?? '',
    };
  };

  const contact = (r.contact ?? {}) as Record<string, unknown>;

  const candidate = {
    brand: str(r.brand, LIMITS.brand, 2),
    title: str(r.title, LIMITS.title, 4),
    description: str(r.description, LIMITS.description, 20),
    eyebrow: str(r.eyebrow, LIMITS.eyebrow, 2),
    tagline: str(r.tagline, LIMITS.tagline, 8),
    lede: str(r.lede, LIMITS.lede, 20),
    cta: str(r.cta, LIMITS.cta, 2),
    nav: list(r.nav, 6, (v) => str(v, LIMITS.navLabel, 2)),
    sections: {
      items: sec('items'),
      features: sec('features'),
      about: sec('about'),
      contact: sec('contact'),
    },
    items: list(r.items, 8, (v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const name = str(o.name, LIMITS.itemName, 1);
      const meta = str(o.meta, LIMITS.itemMeta, 2);
      return name && meta
        ? { name, meta, tags: list(o.tags, 4, (t) => str(t, LIMITS.tag, 1)) as string[] }
        : undefined;
    }),
    stats: list(r.stats, 4, (v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const value = str(o.value, LIMITS.statValue, 1);
      const label = str(o.label, LIMITS.statLabel, 1);
      return value && label ? { value, label, note: str(o.note, LIMITS.statNote, 0) ?? '' } : undefined;
    }),
    features: list(r.features, 8, (v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const name = str(o.name, LIMITS.featureName, 2);
      const detail = str(o.detail, LIMITS.featureDetail, 10);
      return name && detail ? { name, detail } : undefined;
    }),
    aboutFacts: list(r.aboutFacts, 5, (v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const label = str(o.label, LIMITS.factLabel, 2);
      const value = str(o.value, LIMITS.factValue, 1);
      return label && value ? { label, value } : undefined;
    }),
    aboutBody: list(r.aboutBody, 3, (v) => str(v, LIMITS.aboutParagraph, 40)),
    // Only the fields the brief actually supports. An absent field stays absent
    // rather than being filled with a plausible-looking invention.
    contact: (() => {
      const fields = {
        email: str(contact.email, LIMITS.contactField, 3),
        phone: str(contact.phone, LIMITS.contactField, 3),
        address: str(contact.address, LIMITS.contactField, 2),
        url: str(contact.url, LIMITS.contactField, 4),
        handle: str(contact.handle, LIMITS.contactField, 2),
        note: str(contact.note, LIMITS.contactField, 1),
      };
      const present = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => typeof v === 'string' && v.length > 0),
      );
      return Object.keys(present).length ? present : undefined;
    })(),
    footerNote: str(r.footerNote, LIMITS.footerNote, 2),
    ticker: list(r.ticker, 8, (v) => str(v, LIMITS.tickerWord, 2)),
    pullQuote: (() => {
      const q = (r.pullQuote ?? null) as Record<string, unknown> | null;
      if (!q || typeof q !== 'object') return undefined;
      const text = str(q.text, LIMITS.quoteText, 20);
      return text ? { text, attribution: str(q.attribution, LIMITS.quoteAttr, 0) ?? '' } : undefined;
    })(),
    process: list(r.process, 6, (v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const name = str(o.name, LIMITS.stepName, 2);
      const detail = str(o.detail, LIMITS.stepDetail, 10);
      return name && detail ? { name, detail } : undefined;
    }),
  };

  // Guards: only what a page cannot be rendered without. Module arrays may be
  // empty — a blueprint that does not use `stats` should not be blocked for
  // lacking them. Contact is genuinely optional: we no longer require an
  // invented email, phone and address on every page.
  if (!candidate.brand || !candidate.tagline || !candidate.lede) return null;

  const parsed = Content.safeParse(candidate);
  if (!parsed.success && process.env.FORGE_DEBUG_REPAIR === '1') {
    console.error('[repairContent] rejected:', JSON.stringify(parsed.error.issues.slice(0, 8), null, 1));
  }
  return parsed.success ? parsed.data : null;
}

/**
 * Does this content satisfy what a blueprint needs?
 *
 * A blueprint that declares `pricing` but receives no features cannot be
 * rendered honestly, and we will not invent prices to fill it. The offending
 * direction is rejected and another is used.
 */
export function validateContentForBlueprint(
  content: Content,
  required: readonly string[],
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const has: Record<string, boolean> = {
    items: content.items.length > 0,
    features: content.features.length > 0,
    stats: content.stats.length > 0,
    about: content.aboutBody.length > 0,
    process: content.process.length > 0,
    quote: Boolean(content.pullQuote),
    gallery: content.items.length > 0,
    schedule: content.items.length > 0,
    pricing: content.features.length > 0 && content.stats.length > 0,
    faq: content.features.length > 0,
    // A contact section can always be rendered honestly — with the details the
    // brief supplied, or with a plain statement that it supplied none.
    contact: true,
  };
  for (const m of required) if (!has[m]) missing.push(m);
  return { ok: missing.length === 0, missing };
}

/* ================================================================== *
 * Fallback content
 *
 * Used when no LLM is configured. It does NOT pretend to be a brand: it is an
 * honest specimen that presents the design AND the decisions that produced it,
 * which is genuinely useful when you are evaluating a direction rather than
 * shipping a business.
 * ================================================================== */
const ROLE_BY_EMOTION: Record<string, { brand: string; voice: string }> = {
  awe: { brand: 'SPECIMEN', voice: 'Vast, quiet, monumental' },
  serenity: { brand: 'SPECIMEN', voice: 'Calm, weightless, unhurried' },
  delight: { brand: 'SPECIMEN', voice: 'Bright, playful, rewarding' },
  tension: { brand: 'SPECIMEN', voice: 'Precise, industrial, alert' },
  nostalgia: { brand: 'SPECIMEN', voice: 'Printed, warm, permanent' },
  mystery: { brand: 'SPECIMEN', voice: 'Shadowed, withheld, curious' },
  trust: { brand: 'SPECIMEN', voice: 'Legible, rigorous, safe' },
  energy: { brand: 'SPECIMEN', voice: 'Fast, loud, competitive' },
  intimacy: { brand: 'SPECIMEN', voice: 'Warm, personal, close' },
  optimism: { brand: 'SPECIMEN', voice: 'Bright, open, hopeful' },
  other: { brand: 'SPECIMEN', voice: 'Restrained, neutral' },
};

const CAP = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const pretty = (id: string) => CAP(id.replace(/-/g, ' '));

/** First meaningful clause of the brief, for use as a lede. */
function firstClause(brief: string, max = 240): string {
  const flat = brief.replace(/\s+/g, ' ').trim();
  const cut = flat.split(/(?<=[.!?])\s/)[0] ?? flat;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

export interface FallbackAxis {
  axis: string;
  picked: string;
  confidence: number;
}

/**
 * Deterministic, brief-aware content for when no writer is configured.
 * Presents the design and its decisions rather than inventing a company.
 */
export function fallbackContent(brief: string, axes: FallbackAxis[]): Content {
  const emotion = axes.find((a) => a.axis === 'emotion')?.picked ?? 'other';
  const voice = ROLE_BY_EMOTION[emotion]?.voice ?? 'Restrained, neutral';
  const subject = firstClause(brief, 200);
  const byAxis = (axis: string) => axes.find((a) => a.axis === axis);

  return Content.parse({
    brand: 'SPECIMEN',
    title: `Specimen — a ${emotion} direction`,
    description: `A generated design specimen: ${emotion} register, ${pretty(
      byAxis('palette')?.picked ?? 'neutral',
    )} palette, ${pretty(byAxis('typography')?.picked ?? 'neutral')} type. Built from a one-line brief.`,
    eyebrow: `${voice} — design specimen`,
    tagline: `A ${emotion} interface, built from *one* line`,
    lede: subject,
    cta: 'Start a project',
    nav: ['Direction', 'Decisions', 'Method', 'Contact'],

    sections: {
      items: {
        eyebrow: 'Direction / how it is applied',
        title: 'The same brief, *applied* to six surfaces',
        note: 'Placeholder content. Configure a writer to generate real brand copy.',
      },
      features: {
        eyebrow: 'Decisions / chosen axes',
        title: 'What this direction is *made* of',
        note: '',
      },
      about: {
        eyebrow: 'Method / how this was made',
        title: 'Deciding is cheap. *Generating* is not.',
        note: '',
      },
      contact: {
        eyebrow: 'Contact / next step',
        title: "Let's make something that *lasts*",
        note: 'Placeholder details — no writer is configured.',
      },
    },

    items: [
      { name: 'Landing', meta: 'Entry surface · full viewport', tags: ['Hero', 'Type'] },
      { name: 'Portfolio', meta: 'Asymmetric grid · mixed spans', tags: ['Grid', 'Case work'] },
      { name: 'System', meta: 'Live token specimen', tags: ['Tokens', 'Colour'] },
      { name: 'Capabilities', meta: 'Expandable rows', tags: ['Index', 'Detail'] },
      { name: 'Numbers', meta: 'Tabular figures', tags: ['Data', 'Proof'] },
      { name: 'Contact', meta: 'Form and details', tags: ['Form', 'CTA'] },
    ],

    stats: axes.slice(0, 4).map((a) => ({
      value: a.confidence.toFixed(2),
      label: pretty(a.axis),
      note: a.picked,
    })),

    features: axes.slice(0, 6).map((a) => ({
      name: pretty(a.axis),
      detail: `Selected \`${a.picked}\` at ${a.confidence.toFixed(2)} confidence.`,
    })),

    aboutFacts: [
      { label: 'Register', value: emotion },
      { label: 'Palette', value: pretty(byAxis('palette')?.picked ?? '—') },
      { label: 'Type', value: pretty(byAxis('typography')?.picked ?? '—') },
      { label: 'Density', value: pretty(byAxis('density')?.picked ?? '—') },
    ],

    aboutBody: [
      'This specimen was produced without a copywriter, so it presents the design and the decisions behind it instead of inventing a company to fill the page.',
      'Set FORGE_LLM_PROVIDER and a matching key to have a language model write real content for your brief. The design decisions are unaffected either way.',
    ],

    // No contact details: a specimen has none to give, and inventing an email
    // and phone number to fill the slot is exactly the behaviour we removed.
    // The contact section states this plainly instead.

    footerNote: 'Specimen content. The design, not the words.',

    ticker: axes.slice(0, 6).map((a) => pretty(a.axis)),
    pullQuote: undefined,
    process: [
      { name: 'Decide', detail: 'Jev chooses every axis from the catalog and returns calibrated confidence.' },
      { name: 'Write', detail: 'A language model writes the content in the register the design selected.' },
      { name: 'Illustrate', detail: 'Optionally, an image model produces artwork for the layout.' },
      { name: 'Compose', detail: 'Code assembles the page from validated decisions. The model never writes markup.' },
    ],
  });
}
