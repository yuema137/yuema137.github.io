# yuema137.github.io

Personal academic/research website for Yue Ma.
Plain HTML + CSS. No build step, no framework, no dependencies, almost no
JavaScript (see "Conventions").

Live at <https://yuema137.github.io>, deployed from the `main` branch root by
GitHub Pages.

## Local preview

Paths are root-absolute (`/css/style.css`), so opening files with `file://`
will not work. Serve the directory instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Structure

```
index.html              Home — landing page, points at everything else
research/               Research interests and long-term direction
projects/               What I build; one card per project
publications/           Formal scholarly output, representative work first
talks/                  Conference talks, seminars, invited talks
blog/                   Post index + one directory per post
cv/                     Web summary + PDF download
cv/resume/              The CV itself — source of the PDF (see "The CV")
games/                  Games index + one self-contained directory per game (see "Games")
scieval/                Generated, self-contained SciEval snapshot
ble/                    Generated, self-contained Leaderboard of Benchmarks snapshot
404.html                Served automatically by GitHub Pages

css/style.css           The entire stylesheet, in six commented sections
assets/fonts/           Satoshi woff2 (400/500/700), self-hosted
assets/images/          Photos, figures
assets/papers/          Self-hosted paper PDFs (prefer arXiv links)
assets/slides/          Talk slide decks
assets/cv/              CV PDF — GENERATED, do not hand-edit

tools/build-cv.mjs      Compiles cv/resume/ to the CV PDF
tests/                  Node tests for the games' logic. Not published.
package.json            Build tooling only. Nothing here ships to the browser.

.nojekyll               Required — keep. Disables Jekyll processing.
robots.txt, sitemap.xml Maintained by hand
favicon.svg
```

`scieval/` is an intentionally isolated exception to the site's hand-written
page structure. It is generated and validated in
`yuema137/scientific-eval-environments`, then synchronized here through a PR
that is restricted to `scieval/**`. The main Pages workflow only copies the
last-known-good snapshot; it never builds SciEval or shares its CSS and
JavaScript with the personal site.

`ble/` follows the same pattern. It is generated in
`yuema137/benchs-last-exam` and synchronized here through a PR restricted to
`ble/**`.

## Conventions

**All internal paths are root-absolute.** Write `/css/style.css` and
`/assets/images/x.jpg`, never `css/style.css`. Relative paths break on every
page that is not at the site root.

The generated `scieval/` snapshot is the sole exception: all of its paths are
relative to `/scieval/` so the bundle remains self-contained and portable.

**Header and footer are duplicated in every page**, wrapped in
`<!-- SHARED:HEADER start -->` / `<!-- SHARED:FOOTER start -->` markers. There
is no include mechanism by design. When you change one, change all of them.
The only permitted difference between copies is `aria-current="page"` on the
nav link for the current page.

To find every copy:

```sh
grep -rl 'SHARED:HEADER' --include='*.html' .
```

**Styling goes through tokens.** Change values in the `:root` block at the top
of `css/style.css`, not in the rules below it. If a colour is chosen for
contrast reasons, record the measured ratio in a comment next to it.

**Typeface is Satoshi**, self-hosted from `assets/fonts/` in three weights
(400/500/700). Nothing is fetched from a third party — no Google Fonts, no CDN.
400 and 700 are preloaded in every page head.

**Design language.** Low-saturation blue, translucent surfaces over a fixed
CSS-only background wash (three radial gradients plus a faint grid). Body 16.5px,
metadata 11.5–13px in monospace, cards 8px radius with hairline borders. Two
buttons exist: `.btn--p` (filled) and `.btn--s` (outline). No decorative
pseudo-element flourishes — structure comes from type, spacing and rules.

**Every colour pair is contrast-checked.** Body 15.4:1, muted 5.0:1, accent blue
4.0:1, button text 8.7:1; the dark palette passes too. Low saturation makes it
easy to slip under 4.5:1 — recheck when changing any value.

**Almost no JavaScript.** The nav wraps instead of using a hamburger, and the
blog language switch is a plain link. There is exactly one script on the regular
pages — `js/blog-tags.js`, which filters `/blog/` by tag. It is progressive
enhancement: with JavaScript off, every post is listed, the tags are still
visible, and the tag links still resolve. (The AV evaluation post is a separate
case — see "Self-contained documents". The generated `scieval/` and `ble/`
snapshots ship their own scripts and are outside these rules, and so are the games
under `games/` — see "Games".) If something else seems to need JS, reconsider first.

## Updating the last-updated date

The footer carries one site-wide date, identical in all 12 pages. To bump it,
change both the machine-readable and the human-readable form together:

```sh
NEW_ISO=2026-09-14
NEW_HUMAN="14 September 2026"
grep -rl 'Last updated <time' --include='*.html' . | xargs sed -i '' \
  -E "s|Last updated <time datetime=\"[^\"]*\">[^<]*</time>|Last updated <time datetime=\"$NEW_ISO\">$NEW_HUMAN</time>|"
```

Then confirm all copies still match:

```sh
for f in $(grep -rl 'SHARED:FOOTER' --include='*.html' .); do
  sed -n '/SHARED:FOOTER start/,/SHARED:FOOTER end/p' "$f" | shasum | cut -c1-10
done | sort -u   # must print exactly one hash
```

The `/cv/` page has its own separate "Last updated" line — that one refers to
the PDF, not the site, and is bumped when you replace the PDF.

## Adding a blog post

English is always the default. Chinese versions are optional and live in a
`zh/` subdirectory.

```
blog/2026-09-example/index.html        → /blog/2026-09-example/
blog/2026-09-example/zh/index.html     → /blog/2026-09-example/zh/
```

1. `mkdir -p blog/<YYYY-MM-slug>` and start from the skeleton below.
2. Update `<title>`, description, `<link rel="canonical">`, and the Open Graph tags.
3. For a bilingual post, also create `zh/index.html` with `<html lang="zh-Hans">`, and
   cross-link both with `hreflang` (`x-default` always points at the English one).
4. For an English-only post, delete the `lang-switch` list and the `hreflang` links.
5. Add a row to `blog/index.html`, newest first.
6. Add the URL(s) to `sitemap.xml`.
6a. Give the new row in `blog/index.html` a `data-tags` attribute — space
   separated, lowercase, hyphens for spaces (`llm-workflow`). The filter bar is
   built from these at runtime, so a brand-new tag needs no other change. Repeat
   the tags as `<ul class="tags">` links inside the row so they are visible and
   work without JavaScript.
7. If it should appear on the homepage, update "Latest writing" in `index.html`.

### Post skeleton

Head — after the standard tags shared with every page:

```html
<link rel="canonical" href="https://yuema137.github.io/blog/SLUG/">
<link rel="alternate" hreflang="en"        href="https://yuema137.github.io/blog/SLUG/">
<link rel="alternate" hreflang="zh-Hans"   href="https://yuema137.github.io/blog/SLUG/zh/">
<link rel="alternate" hreflang="x-default" href="https://yuema137.github.io/blog/SLUG/">
```

Body — inside the usual `<main id="main"><div class="c">`:

```html
<article>
  <section class="hero hero--page">
    <p class="meta muted"><a class="link" href="/blog/">← All posts</a></p>
    <h1 class="mt-2">TITLE</h1>
    <p class="meta muted mt-2"><time datetime="YYYY-MM-DD">D Month YYYY</time></p>
    <!-- Plain links, never a JS toggle. Delete on English-only posts. -->
    <ul class="lang-switch mt-2">
      <li><a aria-current="true" href="/blog/SLUG/" hreflang="en">English</a></li>
      <li><a href="/blog/SLUG/zh/" hreflang="zh-Hans" lang="zh-Hans">简体中文</a></li>
    </ul>
  </section>
  <section class="section"><div class="prose">
    <p>…</p>
  </div></section>
</article>
```

## Self-contained documents

`blog/2026-08-av-evaluation/` is the one page that does **not** use `css/style.css`.
It is a standalone interactive document (sidebar sections, searchable glossary,
term cross-links) with its own embedded stylesheet and JavaScript. Apart from
`js/blog-tags.js` and the generated snapshots, it is the only JavaScript on the
site. Its palette tokens are copied from the ones in
`css/style.css` — if you change the site palette, update that file's `:root`
block too. Its Chinese version is an in-page toggle rather than a `/zh/` URL,
because both languages live in the same data arrays.

Its sections are rendered by JavaScript from those arrays, so the page also
carries a static copy of the full English text for readers without
JavaScript, between the `STATIC:NAV` and `STATIC:MAIN` markers. The copy is
generated, not hand-written: after editing the post's content, run

```sh
npm run av:static
```

and commit the page. With JavaScript the copy is hidden before the body is
parsed (the head script adds `class="js"` to `<html>`), so there is no flash.

## Games

`/games/` is a plain page listing the games; each game lives in its own
directory, `games/<slug>/`, and is the one place on the site built around
JavaScript. A game is self-contained: native ES modules, no framework, no
build step, no CDN, no network requests, no analytics. It loads
`/css/style.css` for the shared header, footer and tokens, and its own
`style.css` after it. Paths inside a game directory are relative (`./game.js`),
because module imports are. Progress is kept in `localStorage` only, and every
access is wrapped so the game still works when storage is blocked.

To add a game: create `games/<slug>/`, copy the shared header and footer into
its `index.html` (with `aria-current="page"` on **Games**), add a card to
`games/index.html`, and add the URL to `sitemap.xml`. `games/` is already in
the publish allowlist.

### Give Way

```
games/give-way/
  index.html     page, dialogs, controls
  style.css      game styles, on top of the site tokens
  game.js        UI: rendering, input, animation, saving, custom boards
  generator.js   board rules, generator, difficulty and shape metrics,
                 board text format (no DOM)
  levels.js      GENERATED: the 100 boards, stored as text
  worker.js      runs the generator off the main thread for custom boards
  rules.js       in-level state machine: taps, lives, hints, items, clock (no DOM)
  items.js       item registry: bomb, scissors, sweep — items may only REMOVE
                 arrows (no DOM)
  save.js        save format, validation, migration (no DOM)
tests/give-way/generator.test.mjs
tools/give-way-levels.mjs   generates levels.js (authoring tool, not published)
```

Run the tests (no install needed):

```sh
node tests/give-way/generator.test.mjs
```

**The 100 levels are stored, not generated.** `tools/give-way-levels.mjs`
generates them offline and writes the boards to `levels.js`, one short line
of text per board (see `encodeBoard`): about 50 KB for all 100, less than half
that over the wire. The game only decodes them, so every level is identical on
every device and loads instantly. Levels are stored portrait and drawn a
quarter turn on landscape screens; that changes nothing about the puzzle.

Four bands, defined in `BANDS` in `generator.js`, set each level's board size
and difficulty targets. Difficulty is the share of arrows that can exit at the
start, and after 20% and after 50% of arrows have been removed by random legal
play; lower is harder. Every stored level also covers at least 90% of the
board, has long arrows (a minimum mean length per band), and almost never has
one arrow pointing straight at another's tail.

| Levels | Band | Board | Free at start | After 20% | After 50% |
|---|---|---|---|---|---|
| 1–5 | Easy | 8×12 | 30% ± 10 | 30% ± 10 | 40% ± 10 |
| 6–20 | Medium | 8×12 | 20% ± 5 | 25% ± 5 | 30% ± 5 |
| 21–50 | Hard | 18×26 | 15% ± 5 | 20% ± 5 | 20% ± 5 |
| 51–100 | Expert | 22×30 | 10% ± 5 | 10% ± 5 | 15% ± 5 |

The generator builds boards in reverse removal order, so every board is
solvable by construction, and checks it again before returning it. Hard and
expert boards are framed by hairpin-shaped arrows around the rim, which keeps
the number of free arrows at the start low. `searchBoard` tries seeds until a
board meets all of the above.

**Items mode** gives one of each item per level: a bomb (every arrow touching
a 3×3 square), scissors (one arrow) and a sweep (every arrow crossing a row or
column, as seen on screen). Items may only remove arrows, which keeps every
board solvable; a new item that does anything else needs its own proof.

Players can also generate a **custom board** of any band from the Levels
dialog. It runs in `worker.js` and usually takes well under a second, but the
UI warns that it can take a few seconds on a slow phone. A custom board is
identified by its band and a random key in the URL (`?custom=expert-k3x…`), so
the link rebuilds the same board for anyone; custom boards are not recorded in
the save.

**To change the levels:** edit the generator or `BANDS`, run
`node tools/give-way-levels.mjs` (a minute or two), bump `LEVELS_VERSION` in
that tool if any stored board changed, rerun it, run the tests, and update the
fingerprint in the test in the same commit. Players' saves record
`LEVELS_VERSION` and they are told when levels change. The tests fail if any
level misses its targets or if the stored boards change unannounced.

## Publishing slides and PDFs

Decks exported from Keynote or PowerPoint embed images at full resolution and are
usually several times larger than they need to be. Shrink them before committing:

```sh
brew install ghostscript          # once
tools/optimize-pdf.sh ~/Downloads/deck.pdf assets/slides/2026-09-fastml.pdf
```

Defaults to the `/ebook` preset (150 dpi images; text and vector art untouched).
Use `screen` for a smaller file, `printer` if the deck must stay printable. The
0νββ summer-school deck went 19.3 MB → 7.9 MB with no visible difference.

**Always open the result and compare a few image-heavy pages before shipping.**
The script checks that the page count survived, but it cannot judge image quality.

Ghostscript is an authoring tool on your machine, not a site dependency — nothing
in `tools/` runs when the site is served, and the published files are plain PDFs.

Naming: `assets/slides/YYYY-MM-event-slug.pdf`. Use the event, not the source
filename, so the URL does not expose a personal file name.

Never publish the editable source (`.key`, `.pptx`) — only the PDF.

## The CV

The CV is an HTML document that Chromium prints to PDF. There is no LaTeX and
no Overleaf.

```
cv/resume/index.html    The document. Content lives here.
cv/resume/resume.css    The typesetting. Layout lives here.
tools/build-cv.mjs      The compiler.
assets/cv/yue-ma-cv.pdf The output. Committed, because Pages serves it as a file.
```

**Never hand-edit `assets/cv/yue-ma-cv.pdf`.** It is overwritten on every build.
The path is linked from the homepage, `/cv/`, and LinkedIn, so it must not move.

`cv/resume/` is a **build input, not a page of the site**, and it is not
published. `.github/workflows/pages.yml` stages an explicit allowlist and
deletes `cv/resume/` from it, so `/cv/resume/` returns 404 on the live site.
The source is still public in this repository — the repository is public — but
it is not part of the website.

**This is why the site does not use Pages' default branch publishing:** that
mode serves every file in the repository, including this source, the build
tooling, and this README. If you add a new top-level section, add it to
`PUBLISH` in that workflow or it will 404.

### Editing it

```bash
npm install                 # once
npx playwright install chromium   # once
npm run cv:png              # build the PDF and render both pages to PNG
```

Then **look at `build/cv-preview/page-1.png` and `page-2.png`.** The build
succeeding is not the same as the CV looking right. This step is the entire
reason the migration happened.

### Two pages, explicitly

Each `<section class="page">` is one physical sheet with a fixed height and
`overflow:hidden`. Content does **not** flow between them. Page one running
long does not push text to page two — it clips it. That is deliberate: a
clipped page is loud, a silently reflowed one is not, and uncontrolled
pagination is exactly what made the LaTeX version painful.

So when you add content, you also decide which page it belongs on.

### What the build refuses to do

`npm run cv` fails, rather than producing a subtly wrong PDF, when:

| Check | Why it exists |
|---|---|
| A page's content overflows its sheet | Clipping is invisible in a diff |
| The PDF is not exactly two pages | A stray third page is easy to miss |
| A character is missing from Satoshi | Chromium would substitute a system font, and the PDF would render differently on the CI runner than on a Mac |

It also prints how full each page is. Aim for **90–97%** on both. Below ~85%
looks unfinished; above 97% leaves no room for the next edit.

### Rebalancing

Reach for the tokens in `resume.css` in this order, and stop as soon as it
looks right:

1. `--gap-section`, `--gap-entry`, `--gap-bullet` — whitespace
2. `--lh-tight` — line height
3. `--t-body` — type size, last resort

Do not fix a long page by shrinking the whole document.

### Fonts

`resume.css` uses **relative** font paths (`../../assets/fonts/...`), unlike
every other stylesheet here. This is required: the build loads the page over
`file://`, where a leading `/` resolves to the filesystem root. Relative paths
are correct under both `file://` and `https://yuema137.github.io/cv/resume/`.

Fonts are self-hosted so the CI runner and a Mac produce the same layout. Do
not add a system-font fallback.

### CI

`.github/workflows/build-cv.yml` rebuilds the PDF on any change to the source
and fails if the committed PDF is stale, comparing text layers rather than
bytes. It uploads both page PNGs as an artifact, so a pull request can be
reviewed by looking at it.

## Content that is mirrored

The homepage repeats a short version of content that lives elsewhere:

| Homepage section | Source of truth |
|---|---|
| Selected projects | `projects/index.html` |
| Selected publications | `publications/index.html` |
| Recent talks | `talks/index.html` |
| Latest from the blog | `blog/index.html` |

Keep the homepage to the top two or three of each. At this volume manual
syncing is cheaper than any abstraction.

## Deliberately not used

React, Next.js, Vue, Svelte, Tailwind, bundlers, static-site generators,
webfonts, analytics, and external runtime dependencies of any kind. Every page
loads one HTML file and one stylesheet, and nothing else.

The one npm dependency, Playwright, is **build tooling for the CV only**. It is
a devDependency, it runs on your machine or in CI, and not one byte of it
reaches a visitor. Adding npm packages that ship to the browser is still off
the table.
