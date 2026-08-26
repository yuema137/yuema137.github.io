/**
 * build-cv.mjs — compile cv/resume/index.html to assets/cv/yue-ma-cv.pdf.
 *
 *   npm run cv        build the PDF
 *   npm run cv:png    build the PDF and rasterise every page to PNG
 *
 * The PDF path is fixed: the website links to /assets/cv/yue-ma-cv.pdf from
 * several places and that URL must not move.
 *
 * This script is a checker as much as a compiler. It refuses to write a PDF
 * that is not exactly two Letter pages, because the failure mode this whole
 * migration exists to eliminate — content silently spilling onto a third page,
 * or a page quietly running short — is invisible in a diff and obvious in a
 * page count.
 */

import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "cv", "resume", "index.html");
const OUTPUT = path.join(ROOT, "assets", "cv", "yue-ma-cv.pdf");
const PNG_DIR = path.join(ROOT, "build", "cv-preview");

const EXPECTED_PAGES = 2;
const wantPng = process.argv.includes("--png");

/* Letter at the 96dpi CSS reference. Chromium lays the page out at this
   viewport before printing, so an element that overflows here overflows in
   the PDF too — which is what the overflow probe below relies on. */
const PAGE_W = 816;
const PAGE_H = 1056;

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: PAGE_W, height: PAGE_H },
  deviceScaleFactor: 2,
});

await page.goto(pathToFileURL(SOURCE).href, { waitUntil: "networkidle" });

/* Webfonts are font-display:block, but block still has a swap period. Waiting
   on document.fonts is what makes the output byte-stable across runs. */
await page.evaluate(() => document.fonts.ready);

/* ---- Font-load probe ----------------------------------------------------
   Checked before anything else: if the woff2 files did not load, every later
   measurement is describing a fallback font, and the glyph probe below would
   report the entire alphabet as missing rather than the real cause. */
const fontsLoaded = await page.evaluate(() =>
  ["400", "500", "700"].filter((w) => !document.fonts.check(`${w} 12pt Satoshi`))
);
if (fontsLoaded.length) {
  await browser.close();
  fail(
    `Satoshi failed to load at weight ${fontsLoaded.join(", ")}. ` +
      `Check assets/fonts/satoshi-{400,500,700}.woff2 and the relative @font-face ` +
      `paths in cv/resume/resume.css.`
  );
}

/* ---- Layout probe -------------------------------------------------------
   Each .page is a fixed-height box with overflow:hidden, so content that runs
   long is clipped rather than reflowed. Clipping is silent in the PDF, so
   measure it here instead: compare each page's scrollHeight against its
   clientHeight, and report how much of the page is actually used. */
const pages = await page.evaluate(() => {
  return [...document.querySelectorAll(".page")].map((el, i) => {
    const style = getComputedStyle(el);
    const padTop = parseFloat(style.paddingTop);
    const padBottom = parseFloat(style.paddingBottom);
    const inner = el.clientHeight - padTop - padBottom;

    // Bottom edge of the last laid-out child, relative to the content box.
    const kids = [...el.children];
    const last = kids[kids.length - 1];
    const used = last
      ? last.getBoundingClientRect().bottom - el.getBoundingClientRect().top - padTop
      : 0;

    return {
      index: i + 1,
      overflowPx: Math.max(0, el.scrollHeight - el.clientHeight),
      usedPct: inner > 0 ? (used / inner) * 100 : 0,
      slackPx: inner - used,
    };
  });
});

/* ---- Glyph-coverage probe ----------------------------------------------
   Any character Satoshi lacks silently falls through to a system font, which
   embeds differently on macOS and on the Ubuntu CI runner — the one way this
   otherwise-deterministic build can produce two different PDFs. Catch it here
   rather than by noticing a stray glyph in a rendered page months later. */
const uncovered = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const chars = new Set();
  let node;
  while ((node = walker.nextNode())) {
    for (const ch of node.textContent) if (ch.codePointAt(0) > 31) chars.add(ch);
  }
  const ctx = document.createElement("canvas").getContext("2d");
  const width = (font, ch) => {
    ctx.font = font;
    return ctx.measureText(ch).width;
  };
  return [...chars].filter((ch) => {
    const only = width("40px Satoshi", ch);
    const fallback = width("40px monospace", ch);
    const stacked = width("40px Satoshi, monospace", ch);
    return Math.abs(stacked - fallback) < 0.01 && Math.abs(only - fallback) > 0.01;
  });
});

if (uncovered.length) {
  await browser.close();
  fail(
    `Satoshi has no glyph for ${uncovered
      .map((c) => `${JSON.stringify(c)} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`)
      .join(", ")}. ` +
      `Chromium would substitute a system font and the PDF would stop being reproducible. ` +
      `Use a character Satoshi covers.`
  );
}

if (pages.length !== EXPECTED_PAGES) {
  await browser.close();
  fail(`Found ${pages.length} .page containers, expected ${EXPECTED_PAGES}.`);
}

await mkdir(path.dirname(OUTPUT), { recursive: true });

await page.pdf({
  path: OUTPUT,
  format: "Letter",
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
});

await browser.close();

/* ---- Page-count check ---------------------------------------------------
   Read the page count straight out of the PDF rather than trusting the CSS.
   /Type /Page objects are counted; /Pages (the tree node) is excluded. */
const bytes = await readFile(OUTPUT);
const pdfPages = (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

const { size } = await stat(OUTPUT);

console.log(`\n  assets/cv/yue-ma-cv.pdf  ${(size / 1024).toFixed(0)} KB  ${pdfPages} pages\n`);

for (const p of pages) {
  const bar = "█".repeat(Math.round(p.usedPct / 4)).padEnd(25, "·");
  const flag =
    p.overflowPx > 0.5 ? "  OVERFLOW" : p.usedPct < 82 ? "  short" : "";
  console.log(
    `  page ${p.index}  ${bar} ${p.usedPct.toFixed(1)}% used` +
      `  (${p.slackPx.toFixed(0)}px slack)${flag}`
  );
}
console.log("");

const overflowing = pages.filter((p) => p.overflowPx > 0.5);
if (overflowing.length) {
  fail(
    `Content is clipped on page ${overflowing.map((p) => p.index).join(", ")} ` +
      `(${overflowing.map((p) => `${p.overflowPx.toFixed(0)}px`).join(", ")} lost). ` +
      `Reduce --gap-section or --gap-entry in resume.css.`
  );
}

if (pdfPages !== EXPECTED_PAGES) {
  fail(`PDF has ${pdfPages} pages, expected ${EXPECTED_PAGES}.`);
}

/* Letter is 612 x 792 PostScript points. A MediaBox of any other size means
   @page stopped being honoured — the page count would not catch that. */
const boxes = [...bytes.toString("latin1").matchAll(/\/MediaBox\s*\[\s*([\d.\s-]+?)\]/g)].map((m) =>
  m[1].trim().split(/\s+/).map(Number)
);
const wrongSize = boxes.filter(
  (b) => Math.abs(b[2] - b[0] - 612) > 1 || Math.abs(b[3] - b[1] - 792) > 1
);
if (wrongSize.length) {
  fail(
    `PDF page size is ${wrongSize[0][2] - wrongSize[0][0]} x ${wrongSize[0][3] - wrongSize[0][1]} pt, ` +
      `expected 612 x 792 (US Letter).`
  );
}

/* ---- Optional rasterisation --------------------------------------------
   Rendered from the finished PDF, not from the DOM, so what is inspected is
   what a reader actually receives. Needs poppler (`brew install poppler`,
   `apt-get install poppler-utils`); absence is a warning, not a failure. */
if (wantPng) {
  await mkdir(PNG_DIR, { recursive: true });
  const prefix = path.join(PNG_DIR, "page");
  try {
    await execFileAsync("pdftoppm", ["-png", "-r", "150", OUTPUT, prefix]);
    console.log(`  previews  build/cv-preview/page-{1,2}.png\n`);
  } catch (err) {
    console.warn(
      `  ! pdftoppm unavailable — skipped PNG previews (${err.code || err.message})\n`
    );
  }
}
