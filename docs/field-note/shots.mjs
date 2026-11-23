#!/usr/bin/env node
/**
 * Demo footage for the DR-6 Confidential Tokens field note: named stills (PNG)
 * and short clips (WebM), rendered headless with puppeteer-core and the system
 * Chrome from the run logs in docs/field-note/runs/ and three public pages
 * (stellar.expert, the game, the OpenZeppelin demo).
 *
 *   node docs/field-note/shots.mjs            # stills and clips
 *   node docs/field-note/shots.mjs --stills   # PNGs only  -> docs/field-note/shots/
 *   node docs/field-note/shots.mjs --clips    # WebMs only -> docs/field-note/clips/
 *   node docs/field-note/shots.mjs --only=audit,explorer   # names containing these
 *
 * Run it from the repo root so puppeteer-core resolves. CHROME_PATH overrides
 * the Chrome binary. Clips shell out to ffmpeg (must be on PATH).
 */
import puppeteer from 'puppeteer-core';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS_DIR = resolve(HERE, 'shots');
const CLIPS_DIR = resolve(HERE, 'clips');
const PREFIX = 'DR-6_confidential-tokens-field-note_';
const W = 1920;
const H = 1080;
const MAX_LINES = 38;
const NAV_TIMEOUT = 90_000;

const CARD = resolve(HERE, 'card/card.png');
const LOGS = {
  recon: resolve(HERE, 'runs/run0-recon.log'),
  deploy: resolve(HERE, 'runs/run1-deploy.log'),
  lifecycle: resolve(HERE, 'runs/run2-lifecycle.log'),
  audit: resolve(HERE, 'runs/run3-audit.log'),
};
const accounts = JSON.parse(readFileSync(resolve(HERE, '../../state/accounts.public.json'), 'utf8'));
const run = JSON.parse(readFileSync(resolve(HERE, '../../state/lifecycle.public.json'), 'utf8'));
const TRANSFER_TX = run.txs.transfer.hash;
const BOB = accounts.bob.address;
const EXPLORER_TX = `https://stellar.expert/explorer/testnet/tx/${TRANSFER_TX}`;
const EXPLORER_BOB = `https://stellar.expert/explorer/testnet/account/${BOB}`;
const GERALD = 'https://gerald.stellar.buzz/';
const OZ_DEMO = 'https://stellar-confidential-token-demo.billowing-moon-0c6f.workers.dev/';

const args = process.argv.slice(2);
const wantStills = args.includes('--stills') || !args.includes('--clips');
const wantClips = args.includes('--clips') || !args.includes('--stills');
const only = (args.find((a) => a.startsWith('--only=')) ?? '--only=').slice(7).split(',').filter(Boolean);
const wanted = (name) => only.length === 0 || only.some((o) => name.includes(o));
const stillPath = (name) => resolve(SHOTS_DIR, `${PREFIX}${name}.png`);
const clipPath = (name) => resolve(CLIPS_DIR, `${name}.webm`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- log excerpts -----------------------------------------------------------
const STAMP = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)(?:  (.*))?$/;

function readLog(file) {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0 || true);
}

/** Lines of the sections whose "== title" matches one of the regexes, in file order. */
function sections(file, titles) {
  const lines = readLog(file);
  const out = [];
  let keep = false;
  for (const line of lines) {
    const m = STAMP.exec(line);
    const text = m ? (m[2] ?? '') : line;
    if (text.startsWith('== ')) keep = titles.some((t) => t.test(text));
    if (keep) out.push(line);
  }
  while (out.length && out[0].trim().endsWith('')) {
    if (STAMP.exec(out[0])?.[2] === undefined || STAMP.exec(out[0])?.[2] === '') out.shift();
    else break;
  }
  return out;
}

function firstLines(file, n) {
  return readLog(file).slice(0, n);
}

function clampLines(lines, max = MAX_LINES) {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), '…'];
}

// ---- terminal rendering -----------------------------------------------------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function terminalRow(line, highlight) {
  const m = STAMP.exec(line);
  const stamp = m ? m[1] : '';
  const text = m ? (m[2] ?? '') : line;
  const hot = highlight && highlight.test(text);
  const section = text.startsWith('== ');
  return `<div class="row${hot ? ' hot' : ''}${section ? ' section' : ''}"><span class="stamp">${esc(stamp)}</span><span class="text">${esc(text)}</span></div>`;
}

function terminalHtml(lines, { title = '', highlight = null } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#15130f;width:${W}px;height:${H}px;overflow:hidden}
    .frame{position:absolute;inset:40px;background:#1d1a15;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden}
    .bar{height:44px;background:#2a261f;display:flex;align-items:center;padding:0 18px;font:15px/1 "SF Mono","JetBrains Mono",Menlo,monospace;color:#b7ad98}
    .dot{width:12px;height:12px;border-radius:50%;margin-right:8px;background:#5a534a}
    .dot.r{background:#e0624f}.dot.y{background:#e8b84d}.dot.g{background:#6fbf73}
    .title{margin-left:14px}
    .body{padding:18px 22px;font:17px/1.52 "SF Mono","JetBrains Mono",Menlo,monospace;color:#e6dfd0;white-space:pre-wrap;word-break:break-all}
    .row{display:flex}.stamp{color:#7f776a;flex:0 0 236px;white-space:nowrap}.text{flex:1}
    .row.section .text{color:#f2c96b;font-weight:600}
    .row.hot .text{color:#9fe3a4;font-weight:600}
    .cursor{display:inline-block;width:10px;height:19px;background:#e6dfd0;vertical-align:-3px;animation:b 1s steps(2) infinite}
    @keyframes b{to{visibility:hidden}}
  </style></head><body><div class="frame"><div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">${esc(title)}</span></div><div class="body" id="body">${lines.map((l) => terminalRow(l, highlight)).join('')}</div></div></body></html>`;
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  return page;
}

async function renderTerminal(page, lines, opts) {
  await page.setContent(terminalHtml(clampLines(lines), opts), { waitUntil: 'load' });
  await sleep(300);
}

/** Type the lines into an empty terminal, one per `perLine` ms, scrolling as it fills. */
async function typeTerminal(page, lines, { title, highlight, perLine = 420 }) {
  await page.setContent(terminalHtml([], { title, highlight }), { waitUntil: 'load' });
  const rows = lines.map((l) => terminalRow(l, highlight));
  await page.evaluate(async (rows, perLine, maxLines) => {
    const body = document.getElementById('body');
    for (const row of rows) {
      body.insertAdjacentHTML('beforeend', row);
      while (body.children.length > maxLines) body.removeChild(body.firstChild);
      await new Promise((r) => setTimeout(r, perLine));
    }
    body.insertAdjacentHTML('beforeend', '<div class="row"><span class="stamp"></span><span class="text"><span class="cursor"></span></span></div>');
  }, rows, perLine, MAX_LINES);
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleep(2500);
}

/** Chrome emits a screencast frame only on repaint; a 1px blinking dot keeps frames coming. */
async function startHeartbeat(page) {
  await page.evaluate(() => {
    const dot = document.createElement('div');
    dot.id = '__hb';
    dot.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;background:#000;opacity:.02;z-index:99999';
    document.body.appendChild(dot);
    window.__hbTimer = setInterval(() => { dot.style.opacity = dot.style.opacity === '0.02' ? '0.03' : '0.02'; }, 100);
  });
}

async function openDetails(page, index) {
  await page.evaluate((i) => {
    const d = document.querySelectorAll('details')[i];
    if (d) d.open = true;
  }, index);
}

async function slowScroll(page, px, ms) {
  const steps = Math.max(1, Math.round(ms / 50));
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((dy) => window.scrollBy(0, dy), px / steps);
    await sleep(50);
  }
}

/** Record `fn` to `file` (WebM). The raw screencast is remuxed by ffmpeg so it carries a duration. */
async function record(page, file, fn) {
  const raw = `${file}.raw.webm`;
  const recorder = await page.screencast({ path: raw, fps: 30, overwrite: true });
  try {
    await startHeartbeat(page);
    await fn();
  } finally {
    await recorder.stop();
  }
  const mux = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-c', 'copy', file], { encoding: 'utf8' });
  if (mux.status !== 0) {
    renameSync(raw, file);
  } else {
    unlinkSync(raw);
  }
}

// ---- the shot list ----------------------------------------------------------
const TX_LINE = /: tx [0-9a-f]{64}|MATCH|restored|auditTransfer|NOT among|identical \(recoverable\)|fails:/;

const STILLS = [
  { name: '00-card', run: async () => copyFileSync(CARD, stillPath('00-card')) },
  {
    name: '01-recon-vks',
    run: async (page) => {
      const lines = sections(LOGS.recon, [/verification keys/, /RPC retention/]);
      await renderTerminal(page, lines, { title: 'run 0, recon: pnpm recon -- --log docs/field-note/runs/run0-recon.log', highlight: /MATCH|OUTSIDE/ });
      await page.screenshot({ path: stillPath('01-recon-vks') });
    },
  },
  {
    name: '02-register-transfer',
    run: async (page) => {
      const lines = [...sections(LOGS.lifecycle, [/accounts and keys/]), ...sections(LOGS.lifecycle, [/step 1/]), ...sections(LOGS.lifecycle, [/step 4/])];
      await renderTerminal(page, lines, { title: 'run 2, the lifecycle: pnpm lifecycle -- --log docs/field-note/runs/run2-lifecycle.log', highlight: TX_LINE });
      await page.screenshot({ path: stillPath('02-register-transfer') });
    },
  },
  {
    name: '03-restore-fee',
    run: async (page) => {
      const lines = sections(LOGS.audit, [/what each transaction paid for/]);
      await renderTerminal(page, lines, { title: 'run 3: what each transaction paid for', highlight: /register-alice|restored/ });
      await page.screenshot({ path: stillPath('03-restore-fee') });
    },
  },
  {
    name: '04-transfer-explorer',
    run: async (page) => {
      await open(page, EXPLORER_TX);
      await page.screenshot({ path: stillPath('04-transfer-explorer') });
    },
  },
  {
    name: '05-bob-account-empty',
    run: async (page) => {
      await open(page, EXPLORER_BOB);
      await slowScroll(page, 500, 600);
      await sleep(1500);
      await page.screenshot({ path: stillPath('05-bob-account-empty') });
    },
  },
  {
    name: '06-audit',
    run: async (page) => {
      const lines = [...sections(LOGS.audit, [/what the public sees/]), ...sections(LOGS.audit, [/auditor opens/]), ...sections(LOGS.audit, [/recipient's explorer page/])];
      await renderTerminal(page, lines, { title: 'run 3, the auditor: pnpm auditor -- --log docs/field-note/runs/run3-audit.log', highlight: /auditTransfer|NOT among|no "amount"/ });
      await page.screenshot({ path: stillPath('06-audit') });
    },
  },
  {
    name: '07-own-deploy',
    run: async (page) => {
      const all = readLog(LOGS.deploy);
      const start = all.findIndex((l) => l.includes('== pnpm deploy:contracts'));
      const lines = [all[0], ...all.slice(Math.max(1, start), start + 24)];
      await renderTerminal(page, lines, { title: 'run 1, own deployment: pnpm build:contracts && pnpm deploy:contracts (stellar CLI 30.0.1)', highlight: /verifier =|auditor =|token =|factory =|registered/ });
      await page.screenshot({ path: stillPath('07-own-deploy') });
    },
  },
  {
    name: '08-gerald',
    run: async (page) => {
      await open(page, GERALD);
      await openDetails(page, 1);
      await sleep(800);
      await page.screenshot({ path: stillPath('08-gerald') });
    },
  },
  {
    name: '09-oz-demo',
    run: async (page) => {
      await open(page, OZ_DEMO);
      await page.screenshot({ path: stillPath('09-oz-demo') });
    },
  },
];

const CLIPS = [
  {
    name: 'clip-a-lifecycle',
    run: async (page) => {
      const lines = readLog(LOGS.lifecycle).filter((l) => !/^\s*$/.test(STAMP.exec(l)?.[2] ?? l) || true);
      await record(page, clipPath('clip-a-lifecycle'), async () => {
        await typeTerminal(page, lines, { title: 'pnpm lifecycle -- --log docs/field-note/runs/run2-lifecycle.log', highlight: TX_LINE, perLine: 330 });
        await sleep(2500);
      });
    },
  },
  {
    name: 'clip-b-audit',
    run: async (page) => {
      const lines = [...sections(LOGS.audit, [/what the public sees/]), ...sections(LOGS.audit, [/auditor opens/]), ...sections(LOGS.audit, [/recipient's explorer page/]), ...sections(LOGS.audit, [/what each transaction paid for/])];
      await record(page, clipPath('clip-b-audit'), async () => {
        await typeTerminal(page, lines, { title: 'pnpm auditor -- --log docs/field-note/runs/run3-audit.log', highlight: /auditTransfer|NOT among|restored|no "amount"/, perLine: 520 });
        await sleep(2500);
      });
    },
  },
  {
    name: 'clip-c-explorer',
    run: async (page) => {
      await open(page, EXPLORER_TX);
      await record(page, clipPath('clip-c-explorer'), async () => {
        await sleep(1500);
        await slowScroll(page, 900, 4000);
        await sleep(1200);
        await page.goto(EXPLORER_BOB, { waitUntil: 'networkidle2' });
        await sleep(2000);
        await slowScroll(page, 700, 3000);
        await sleep(1500);
      });
    },
  },
  {
    name: 'clip-d-gerald',
    run: async (page) => {
      await open(page, GERALD);
      await record(page, clipPath('clip-d-gerald'), async () => {
        await sleep(2000);
        await openDetails(page, 0);
        await sleep(3000);
        await slowScroll(page, 500, 2500);
        await sleep(1000);
        await openDetails(page, 1);
        await sleep(3000);
        await slowScroll(page, 800, 3000);
        await sleep(2000);
      });
    },
  },
];

// ---- main -------------------------------------------------------------------
mkdirSync(SHOTS_DIR, { recursive: true });
mkdirSync(CLIPS_DIR, { recursive: true });
if (!existsSync(CARD)) {
  console.error(`missing ${CARD}; run pnpm card first`);
  process.exit(1);
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', `--window-size=${W},${H}`] });
try {
  if (wantStills) {
    for (const s of STILLS) {
      if (!wanted(s.name)) continue;
      const page = await newPage(browser);
      try {
        await s.run(page);
        console.log(`still ${PREFIX}${s.name}.png`);
      } catch (error) {
        console.log(`still ${s.name}: FAILED ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await page.close();
      }
    }
  }
  if (wantClips) {
    for (const c of CLIPS) {
      if (!wanted(c.name)) continue;
      const page = await newPage(browser);
      try {
        await c.run(page);
        console.log(`clip ${c.name}.webm`);
      } catch (error) {
        console.log(`clip ${c.name}: FAILED ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
