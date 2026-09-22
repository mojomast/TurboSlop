// baseline/capture.mjs — measure generated page layouts from the live DOM.
// Measurement only; reads baseline/out/*.html, writes baseline/structure.json,
// baseline/timings.json and baseline/shots/*.png. No source files touched.
import { chromium } from '/tmp/opencode/node_modules/playwright-core/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = '/home/mojo/mimotest/turboslop';
const OUT = path.join(ROOT, 'baseline/out');
const SHOTS = path.join(ROOT, 'baseline/shots');
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

// slug -> spec file slug (the images run was renamed after generation)
const DESIGNS = [
  'shop', 'event', 'editorial', 'software', 'service', 'artist', 'technical',
  'shop-run2', 'shop-run3', 'shop-run4', 'technical-images',
];

const MEASURE_FN = () => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const cs = (el) => getComputedStyle(el);
  const rect = (el) => el.getBoundingClientRect();

  const main = q('main') || document.body;
  const h1 = q('main h1') || q('h1');
  const hero = q('#top-hero');

  const sections = qa('main section[id]').map((s) => s.id);
  const navLabels = qa('.site-head .nav-list a').map((a) => a.textContent.trim());

  const head = q('.site-head');
  let navPosition = null;
  if (head) {
    const st = cs(head);
    const topBefore = rect(head).top;
    const bgBefore = st.backgroundColor;
    const bfBefore = st.backdropFilter;
    const shadowBefore = st.boxShadow;
    window.scrollTo(0, 800);
    const topAfter = rect(head).top;
    const bgAfter = cs(head).backgroundColor;
    const bfAfter = cs(head).backdropFilter;
    const shadowAfter = cs(head).boxShadow;
    navPosition = {
      cssPosition: st.position,
      stickyOrFixed: st.position === 'sticky' || st.position === 'fixed',
      topBeforeScrollPx: Math.round(topBefore * 100) / 100,
      topAfterScrollPx: Math.round(topAfter * 100) / 100,
      pinnedAfterScroll: Math.abs(topAfter) < 4,
      changesOnScroll: bgBefore !== bgAfter || bfBefore !== bfAfter || shadowBefore !== shadowAfter,
      backdropFilter: bfBefore || 'none',
    };
    window.scrollTo(0, 0);
  }

  let h1FontSizePx = null;
  let h1Lines = null;
  if (h1) {
    h1FontSizePx = parseFloat(cs(h1).fontSize);
    const range = document.createRange();
    range.selectNodeContents(h1);
    const rects = Array.from(range.getClientRects()).filter((r) => r.height > 1 && r.width > 1);
    const tops = new Set(rects.map((r) => Math.round(r.top)));
    const lh = parseFloat(cs(h1).lineHeight);
    h1Lines = tops.size || Math.max(1, Math.round(rect(h1).height / (lh || h1FontSizePx)));
  }

  const heroInfo = {};
  if (hero) {
    const eb = q('.eyebrow', hero);
    const lede = q('.lede', hero);
    const btns = qa('.btn', hero);
    heroInfo.eyebrowAbove = !!(eb && h1 && rect(eb).bottom <= rect(h1).top + 1);
    heroInfo.eyebrowText = eb ? eb.textContent.trim() : null;
    heroInfo.ledeInFirstViewport = !!(lede && rect(lede).top < 900);
    heroInfo.buttonsInFirstViewport = btns.filter((b) => rect(b).top < 900).length;
    heroInfo.taglineText = h1 ? h1.textContent.trim() : null;
    heroInfo.heroTopPx = Math.round(rect(hero).top);
    heroInfo.heroHeightPx = Math.round(rect(hero).height);
  }

  const classify = (el) => {
    const cl = el.classList;
    const tag = el.tagName.toLowerCase();
    if (cl.contains('eyebrow')) return 'eyebrow';
    if (tag === 'h1') return 'h1';
    if (tag === 'h2') return 'h2';
    if (tag === 'h3') return 'h3';
    if (cl.contains('lede')) return 'lede';
    if (cl.contains('btn') || tag === 'button') return 'buttons';
    if (cl.contains('ticker')) return 'ticker';
    if (cl.contains('hero-art')) return 'figure';
    if (tag === 'figure') return 'figure';
    if (tag === 'img') return 'figure';
    if (cl.contains('stat') || cl.contains('stats')) return 'stats';
    if (cl.contains('split__panel') || cl.contains('masthead__side')) return 'panel';
    if (cl.contains('rule')) return 'rule';
    if (cl.contains('anchored')) return 'caption';
    if (cl.contains('contact-form')) return 'form';
    return null;
  };
  const blocks = [];
  const seen = new Set();
  qa('main *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0) return;
    if (r.top >= 900 || r.bottom <= 0) return;
    const t = classify(el);
    if (!t || seen.has(t)) return;
    seen.add(t);
    blocks.push(t);
  });

  const footer = q('footer');
  let footerShape = null;
  if (footer) {
    const wrap = q('.wrap', footer) || footer;
    footerShape = {
      display: cs(wrap).display,
      directBlocks: wrap.children.length,
      blocks: Array.from(wrap.children).map((c) => ({
        tag: c.tagName.toLowerCase(),
        cls: c.className,
        text: (c.textContent || '').trim().slice(0, 70),
      })),
      columnCount: cs(wrap).gridTemplateColumns !== 'none' ? cs(wrap).gridTemplateColumns : null,
      containsAddress: !!q('.eyebrow', footer),
      containsPhoneLink: !!q('a[href^="tel:"]', footer),
      containsMasthead: !!q('.masthead', footer),
    };
  }

  const contact = q('#contact');
  let contactTreatment;
  if (contact) {
    const form = q('form', contact);
    const mail = q('a[href^="mailto:"]', contact);
    const tel = q('a[href^="tel:"]', contact);
    contactTreatment = {
      hasForm: !!form,
      fieldCount: form ? form.querySelectorAll('input,select,textarea').length : 0,
      mailto: mail ? mail.getAttribute('href') : null,
      emailText: mail ? mail.textContent.trim() : null,
      telText: tel ? tel.textContent.trim() : null,
      descriptor: [form ? 'form' : null, mail ? 'email' : null, tel ? 'phone' : null]
        .filter(Boolean)
        .join(' + ') || 'none',
    };
  } else {
    const mail = q('a[href^="mailto:"]');
    contactTreatment = {
      hasForm: false,
      fieldCount: 0,
      mailto: mail ? mail.getAttribute('href') : null,
      emailText: mail ? mail.textContent.trim() : null,
      telText: null,
      descriptor: mail ? 'email only' : 'none',
    };
  }

  const imgs = qa('main img');
  const byLoc = {};
  imgs.forEach((img) => {
    const sec = img.closest('section[id]');
    const l = sec ? sec.id : 'main';
    byLoc[l] = (byLoc[l] || 0) + 1;
  });
  const heroImageCount = imgs.filter((i) => rect(i).top < 900).length;

  const headingOrder = qa('main h1, main h2, main h3').map((h) => ({
    tag: h.tagName.toLowerCase(),
    text: h.textContent.trim().slice(0, 60),
  }));

  const de = document.documentElement;
  const overflow = {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    overflowX: de.scrollWidth > de.clientWidth + 1,
  };

  const html = document.documentElement;

  return {
    composition: html.getAttribute('data-composition'),
    effects: html.getAttribute('data-effects'),
    palette: html.getAttribute('data-palette'),
    emotion: html.getAttribute('data-emotion'),
    sections,
    navLabels,
    navPosition,
    h1FontSizePx,
    h1Lines,
    hero: heroInfo,
    firstScreenBlocks: blocks,
    footerShape,
    contactTreatment,
    imageCount: imgs.length,
    imageByLocation: byLoc,
    heroImageCount,
    headingOrder,
    overflow,
  };
};

const OVERFLOW_FN = () => {
  const de = document.documentElement;
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowX: de.scrollWidth > de.clientWidth + 1,
  };
};

function metricsFromSpec(spec) {
  const m = spec.meta;
  const jevIn = m.inputTokens || 0;
  const wIn = m.writerInputTokens || 0;
  const wOut = m.writerOutputTokens || 0;
  const jevCostUsd = (jevIn / 1e6) * 0.042;
  const writerCostUsd = (wIn / 1e6) * 0.15 + (wOut / 1e6) * 0.6;
  return {
    decider: m.decider,
    model: m.model,
    writer: m.writer,
    writerModel: m.writerModel,
    latencyMs: m.latencyMs,
    inputTokens: jevIn,
    outputTokens: m.outputTokens || 0,
    estimatedUsd: m.estimatedUsd,
    writerLatencyMs: m.writerLatencyMs,
    writerInputTokens: wIn,
    writerOutputTokens: wOut,
    writerReasoningTokens: m.writerReasoningTokens || 0,
    writerEstimatedUsd: m.writerEstimatedUsd,
    imageMs: m.imageMs || 0,
    imageCount: m.imageCount || 0,
    imageSteps: m.imageSteps || 0,
    imageCfg: m.imageCfg || 0,
    composite: spec.composite ? spec.composite.normalized : null,
    picked: Object.fromEntries(spec.decisions.map((d) => [d.axis, d.picked])),
    jevCostUsd,
    writerCostUsd,
    totalCostUsd: jevCostUsd + writerCostUsd,
  };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();

  const structure = {};
  const timings = {};
  const warnings = [];

  for (const slug of DESIGNS) {
    const htmlPath = path.join(OUT, `${slug}.html`);
    const specPath = path.join(OUT, `${slug}.spec.json`);
    const url = pathToFileURL(htmlPath).href;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    try {
      await Promise.race([
        page.evaluate(() => document.fonts.ready.then(() => true)),
        page.waitForTimeout(8000),
      ]);
    } catch {}
    await page.waitForTimeout(400);

    // first screen + full page
    await page.screenshot({ path: path.join(SHOTS, `${slug}-desktop.png`) });
    await page.screenshot({ path: path.join(SHOTS, `${slug}-full.png`), fullPage: true });

    const data = await page.evaluate(MEASURE_FN);

    // mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, `${slug}-mobile.png`) });
    const overflow390 = await page.evaluate(OVERFLOW_FN);

    let spec;
    try {
      spec = JSON.parse(await readFile(specPath, 'utf8'));
    } catch (e) {
      warnings.push(`missing spec for ${slug}`);
    }

    const entry = {
      slug,
      html: `baseline/out/${slug}.html`,
      composition: data.composition,
      effects: data.effects,
      palette: data.palette,
      emotion: data.emotion,
      sections: data.sections,
      navLabels: data.navLabels,
      navPosition: data.navPosition,
      h1FontSizePx: data.h1FontSizePx,
      h1Lines: data.h1Lines,
      hero: data.hero,
      firstScreenBlocks: data.firstScreenBlocks,
      footerShape: data.footerShape,
      contactTreatment: data.contactTreatment,
      imageCount: data.imageCount,
      imageByLocation: data.imageByLocation,
      heroImageCount: data.heroImageCount,
      headingOrder: data.headingOrder,
      bodyOverflowX: { at1440: data.overflow, at390: overflow390 },
      spec: spec ? metricsFromSpec(spec) : null,
    };
    structure[slug] = entry;

    if (spec) {
      timings[slug] = metricsFromSpec(spec);
    }
    process.stdout.write(`captured ${slug}\n`);
  }

  await browser.close();

  const now = new Date().toISOString();
  await writeFile(
    path.join(ROOT, 'baseline/structure.json'),
    JSON.stringify(
      {
        capturedAt: now,
        method: 'live DOM via Playwright (chromium-1228), reduced-motion emulated for stable reveals',
        viewports: { desktop: '1440x900', mobile: '390x844', deviceScaleFactor: 1 },
        sourceProvenance: 'baseline/src-provenance.txt',
        warnings,
        designs: structure,
      },
      null,
      2,
    ),
  );

  // timings + costs
  const designs = Object.entries(timings).map(([slug, m]) => ({ slug, ...m }));
  const wall = {
    'shop-run2': 7879,
    'shop-run3': 8006,
    'shop-run4': 8495,
    'technical-images': 16569,
  };
  designs.forEach((d) => {
    d.measuredEndToEndMs = wall[d.slug] ?? null;
  });

  const totals = designs.reduce(
    (a, d) => {
      a.jevInputTokens += d.inputTokens;
      a.jevCostUsd += d.jevCostUsd;
      a.writerInputTokens += d.writerInputTokens;
      a.writerOutputTokens += d.writerOutputTokens;
      a.writerCostUsd += d.writerCostUsd;
      a.totalCostUsd += d.totalCostUsd;
      a.imageMs += d.imageMs;
      return a;
    },
    {
      designs: designs.length,
      jevInputTokens: 0,
      jevCostUsd: 0,
      writerInputTokens: 0,
      writerOutputTokens: 0,
      writerCostUsd: 0,
      totalCostUsd: 0,
      imageMs: 0,
    },
  );

  await writeFile(
    path.join(ROOT, 'baseline/timings.json'),
    JSON.stringify(
      {
        capturedAt: now,
        pricing: {
          note: 'Estimates, not billing. Jev: $0.042/M input tokens, output free. Writer: $0.15/M input + $0.60/M output. Images self-hosted, $0.',
          jevPerMTokIn: 0.042,
          writerPerMTokIn: 0.15,
          writerPerMTokOut: 0.6,
          imagePerImageUsd: 0,
        },
        measured: {
          batch7TotalMs: 53015,
          batch7AvgMs: 7574,
          batch7FromCliOutput: true,
          shopRun2Ms: 7879,
          shopRun3Ms: 8006,
          shopRun4Ms: 8495,
          technicalImagesMs: 16569,
          note: 'End-to-end wall time measured only for individually timed runs. Render time is included in those figures but not separated (renderHtml is a pure function; the CLI does not report it).',
        },
        designs,
        totals,
      },
      null,
      2,
    ),
  );

  console.log('done. warnings:', warnings);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
