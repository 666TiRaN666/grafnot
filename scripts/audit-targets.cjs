// N1 target audit (S0 script, S12 rewrite for the new IA).
// report: prints violations table, exit 0. enforce: exit 1 on violations.
// Usage: node scripts/audit-targets.cjs [report|enforce]   (needs preview :5199)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const http = require('http');

const URL = 'http://localhost:5199/';
const EXE = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const MODE = (process.env.MODE || process.argv[2] || 'report').replace(/^--mode=/, '');
const OUT = path.join(__dirname, '..', 'docs', 'ux-audit-raw.json');

const VIEWPORTS = [
  { name: 'desktop 1440x900', w: 1440, h: 900, mobile: false },
  // isMobile+hasTouch required: coarse-pointer CSS only applies in mobile emulation.
  { name: 'mobile 390x844', w: 390, h: 844, mobile: true },
];

// Redesigned IA pages (deep-link hashes; deterministic, no click chains).
const PAGES = [
  { key: 'notes-list', hash: '#/notes' },
  { key: 'notes-editor', hash: '#/notes/a1' },
  { key: 'plan-list', hash: '#/plan/list' },
  { key: 'plan-week', hash: '#/plan/week' },
  { key: 'map', hash: '#/map/g1' },
  { key: 'prompts-lib', hash: '#/prompts' },
  { key: 'prompts-wb', hash: '#/prompts/ct1' },
  { key: 'settings-profiles', hash: '#/settings/profiles' },
  { key: 'settings-appearance', hash: '#/settings/appearance' },
  { key: 'settings-trash', hash: '#/settings/trash' },
  { key: 'settings-keys', hash: '#/settings/keys' },
  { key: 'settings-data', hash: '#/settings/data' },
];

// Explicit allowlist: exceptions to N1 only with a reason (S12 gate).
// Match: testid (exact) or cls (substring) or svg (any SVG-namespaced element).
const ALLOW = [
  { cls: 't-check', reason: 'чекбокс 24px, хит-зона 44px через margin (S11)' },
  { cls: 'w-chipcheck', reason: 'чекбокс чипа 24px, хит-зона 44px через margin (S11)' },
  { cls: 'g-taskchip', reason: 'цель — вся строка 64px, чип текстом не отдельная цель (S11)' },
  { cls: 'g-linkbtn', reason: 'высота 44px, ширина по тексту, зазор от соседей >=8px (S11)' },
  { cls: 'g-noteopen', reason: 'хит-зона — вся строка .g-noterow (position:relative) через ::after inset:0; N1 разрешает расширение через ::after (S12)' },
  { svg: true, reason: 'узел SVG карты: невидимый хит-круг r24, шейпы/текст не цели (S10)' },
];

function allowed(el) {
  for (const a of ALLOW) {
    if (a.testid && el.testid === a.testid) return a.reason;
    if (a.cls && (el.cls || '').split(' ').includes(a.cls)) return a.reason;
    if (a.svg && el.svg) return a.reason;
  }
  return null;
}

function docPara(text) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}
function seed() {
  const notes = [
    { id: 'a1', title: 'Alpha note', content: docPara('alpha body one two'), text: 'alpha body one two', linkedIds: [], calcs: [], updated: 2 },
    { id: 'b1', title: 'Beta', content: '', text: '', linkedIds: [], calcs: [], updated: 1 },
  ];
  return {
    'grafnot-profiles-v1': JSON.stringify({ profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1' }),
    'grafnot-store-p1': JSON.stringify({
      schemaVersion: 5, notes, activeId: 'a1',
      tasks: [{ id: 't1', text: 'Today run task', done: false }],
      trash: [], trashTasks: [],
      graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
      prompts: [],
      customTpls: [{ id: 'ct1', name: 'My SQL', body: 'SELECT {{what}}', defaults: {} }],
    }),
  };
}
function storageStateFor(s) {
  return {
    cookies: [],
    origins: [{ origin: 'http://localhost:5199', localStorage: Object.entries(s).map(([name, value]) => ({ name, value })) }],
  };
}

function n1check(vp, el) {
  const w = el.w;
  const h = el.h;
  if (vp.mobile) {
    if (w < 44 || h < 44) return `FAIL touch<44 (${w}x${h})`;
    return 'OK';
  }
  // desktop: text button >=32h, icon-only >=36x36
  if (el.tag === 'input' || el.tag === 'select' || el.tag === 'textarea') {
    if (h < 32) return `FAIL h<32 (${w}x${h})`;
    return 'OK';
  }
  const isIcon = !el.text;
  if (isIcon) {
    if (w < 36 || h < 36) return `FAIL icon<36 (${w}x${h})`;
    return 'OK';
  }
  if (h < 32) return `FAIL h<32 (${w}x${h})`;
  return 'OK';
}

function precheck() {
  return new Promise((resolve) => {
    const req = http.get(URL, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error('audit-targets misconfigured: Chrome not found at ' + EXE);
    process.exit(2);
  }
  if (!(await precheck())) {
    console.error('audit-targets precheck failed: nothing serves ' + URL + ' — start preview first');
    process.exit(2);
  }
  const browser = await chromium.launch({ executablePath: EXE });
  const rows = [];
  let violations = 0;
  let allowedCount = 0;
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      storageState: storageStateFor(seed()),
    });
    const pg = await ctx.newPage();
    for (const p of PAGES) {
      await pg.goto(URL + p.hash, { waitUntil: 'networkidle' });
      await pg.waitForTimeout(700);
      const els = await pg.evaluate(() => {
        const sel = 'button, a, input, select, textarea, [role=button], [role=checkbox], [tabindex]';
        const out = [];
        for (const n of document.querySelectorAll(sel)) {
          const r = n.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
          const style = window.getComputedStyle(n);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const tag = n.tagName.toLowerCase();
          const text = (n.innerText || n.value || n.getAttribute('aria-label') || '').trim().slice(0, 40).replace(/\s+/g, ' ');
          const testid = n.getAttribute('data-testid') || '';
          const svg = (n.namespaceURI || '').includes('svg');
          const cls = svg ? '' : String(n.className || '').split(' ').slice(0, 3).join(' ');
          out.push({ tag, text, testid, cls, svg, w: Math.round(r.width), h: Math.round(r.height) });
        }
        return out.slice(0, 200);
      });
      for (const el of els) {
        const verdict = n1check(vp, el);
        if (verdict.startsWith('FAIL')) {
          const why = allowed(el);
          if (why) {
            allowedCount++;
            rows.push({ viewport: vp.name, page: p.key, ...el, n1: 'ALLOW: ' + why });
          } else {
            violations++;
            rows.push({ viewport: vp.name, page: p.key, ...el, n1: verdict });
          }
        } else {
          rows.push({ viewport: vp.name, page: p.key, ...el, n1: verdict });
        }
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ mode: MODE, violations, allowed: allowedCount, rows }, null, 2));
  console.log(`audit-targets ${MODE}: viewports=${VIEWPORTS.length} pages=${PAGES.length} elements=${rows.length} violations=${violations} allowed=${allowedCount}`);
  for (const r of rows.filter((x) => x.n1.startsWith('FAIL')).slice(0, 40)) {
    console.log(`FAIL ${r.viewport} ${r.page} ${r.tag}.${r.cls || '-'} [${r.testid || r.text}] ${r.w}x${r.h} ${r.n1}`);
  }
  console.log(`raw: docs/ux-audit-raw.json`);
  if (MODE === 'enforce' && violations > 0) {
    console.error(`ENFORCE FAIL: ${violations} N1 violations`);
    process.exit(1);
  }
})().catch((e) => { console.error('audit-targets failed: ' + ((e && e.message) || e)); process.exit(2); });
