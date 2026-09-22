const pw = (await import('/tmp/opencode/node_modules/playwright-core/index.js')) as any;
const chromium = pw.chromium ?? pw.default?.chromium;
const b = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome` });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('console', (m: any) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
p.on('pageerror', (e: any) => console.log('PAGE ERROR:', e.message));
await p.goto('http://127.0.0.1:4478/', { waitUntil: 'load' });
await p.fill('#brief', 'A three-day independent games festival in Rotterdam.');
await p.click('#directions');
await new Promise(r => setTimeout(r, 20000));
const st = await p.evaluate(() => ({
  sheetHidden: (document.querySelector('#sheet') as HTMLElement)?.hidden,
  gridChildren: document.querySelectorAll('#sheet-grid .dir').length,
  gridHTML: (document.querySelector('#sheet-grid') as HTMLElement)?.innerHTML.slice(0, 200),
  metricsChildren: document.querySelectorAll('#sheet-metrics .metric').length,
  label: (document.querySelector('#sheet-label') as HTMLElement)?.textContent,
  log: (document.querySelector('#log') as HTMLElement)?.textContent,
}));
console.log(JSON.stringify(st, null, 1));
await b.close();
