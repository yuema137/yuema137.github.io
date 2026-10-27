/**
 * prerender-av.mjs — write the no-JavaScript copy of the AV evaluation post.
 *
 *   node tools/prerender-av.mjs
 *
 * blog/2026-08-av-evaluation/ renders its sections in the browser from data
 * arrays, so without JavaScript the page used to show only its introduction.
 * This script opens the page in Chromium, runs the page's own render() for
 * every section of both rounds in English, turns the controls that need
 * JavaScript into plain links (glossary terms become anchors into the
 * glossary; the AV stack rail links to its cards; the glossary search and
 * filters are dropped), and writes the result between the STATIC:NAV and
 * STATIC:MAIN markers in the page. With JavaScript the copy is hidden and the
 * interactive document renders as before.
 *
 * Run it after editing the post's content, and commit the page. Running it
 * again replaces the previous copy. Authoring tool only: not published.
 */

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = path.join(ROOT, 'blog', '2026-08-av-evaluation', 'index.html');

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(PAGE).href);

const { sections, nav } = await page.evaluate(() => {
  /* global LANG, ROUND, SEC, GQ, GCAT, GMAP, UI, render */
  const SHARED = { 0: 1, 4: 1, 6: 1 }; // sections common to both rounds
  const glossaryId = (term) => 'g-' + term.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const arg = (el, fn) => {
    const m = new RegExp(fn + "\\('((?:[^'\\\\]|\\\\.)*)'\\)").exec(el.getAttribute('onclick') || '');
    return m ? m[1].replace(/\\'/g, "'") : null;
  };
  LANG = 'en';
  GQ = '';
  GCAT = 'all';
  const sections = [];
  const nav = [];
  for (const round of ['vv', 'm']) {
    for (let sec = 0; sec < 7; sec++) {
      if (round === 'm' && SHARED[sec]) continue;
      ROUND = round;
      SEC = sec;
      render();
      const main = document.getElementById('main');
      main.querySelectorAll('.gtools').forEach((el) => el.remove());
      main.querySelectorAll('button.j').forEach((b) => {
        const key = arg(b, 'jumpTo');
        const a = document.createElement('a');
        a.className = 'j';
        a.textContent = b.textContent;
        if (b.title) a.title = b.title;
        if (key && GMAP[key]) a.href = '#' + glossaryId(GMAP[key][0]);
        b.replaceWith(a);
      });
      main.querySelectorAll('.rail button').forEach((b) => {
        const a = document.createElement('a');
        a.href = '#card-' + arg(b, 'openCard');
        a.textContent = b.textContent;
        b.replaceWith(a);
      });
      // In-text links that switch section (onclick="go(n)") point at that
      // section's anchor instead.
      main.querySelectorAll('a[onclick*="go("]').forEach((a) => {
        const n = Number(/go\((\d+)/.exec(a.getAttribute('onclick'))[1]);
        a.href = `#s-${SHARED[n] ? 'vv' : round}-${n + 1}`;
        a.removeAttribute('onclick');
      });
      if (SHARED[sec]) main.querySelector('.eyebrow').textContent = 'Rounds 01 & 02';
      const id = `s-${round}-${sec + 1}`;
      sections.push(`<section class="static-sec" id="${id}">${main.innerHTML}</section>`);
      nav.push({ id, round, n: sec + 1, label: UI.en.nav[round][sec] });
    }
  }
  return { sections, nav };
});
await browser.close();

if (errors.length) {
  console.error(`\n  ✗ The page raised errors while rendering:\n    ${errors.join('\n    ')}\n`);
  process.exit(1);
}

// Every id must be unique once all sections share one page.
const ids = sections.join('').match(/ id="[^"]+"/g) ?? [];
const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
if (dupes.length) {
  console.error(`\n  ✗ Duplicate ids in the static copy: ${dupes.join(', ')}\n`);
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');
const navHtml =
  '<div class="static">' +
  ['vv', 'm']
    .map(
      (round) =>
        `<h5>${round === 'vv' ? 'Round 01 · V&amp;V' : 'Round 02 · Metrics'}</h5>` +
        nav
          .filter((s) => s.round === round)
          .map((s) => `<a class="navbtn" href="#${s.id}"><i>${pad(s.n)}</i><span>${s.label}</span></a>`)
          .join('')
    )
    .join('') +
  '</div>';
const mainHtml =
  '<div class="static">' +
  '<p class="static-note">This is the full English text, section by section. The interactive version ' +
  '(round tabs, a searchable glossary, and the 简体中文 version) needs JavaScript.</p>' +
  sections.join('') +
  '</div>';

const fill = (source, name, html) => {
  const re = new RegExp(`(<!-- STATIC:${name} -->)[\\s\\S]*?(<!-- /STATIC:${name} -->)`);
  if (!re.test(source)) throw new Error(`Marker STATIC:${name} not found in ${PAGE}`);
  return source.replace(re, (_, open, close) => open + html + close);
};
let source = await readFile(PAGE, 'utf8');
source = fill(source, 'NAV', navHtml);
source = fill(source, 'MAIN', mainHtml);
await writeFile(PAGE, source);
console.log(`\n  wrote ${sections.length} sections (${(mainHtml.length / 1024).toFixed(0)} KB) into ${path.relative(ROOT, PAGE)}\n`);
