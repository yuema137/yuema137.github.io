# yuema137.github.io

Personal academic/research website for Yue Ma.
Plain HTML + CSS. No build step, no framework, no dependencies, no JavaScript.

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
publications/           Formal scholarly output, reverse-chronological
talks/                  Conference talks, seminars, invited talks
blog/                   Post index + one directory per post
cv/                     Web summary + PDF download
cv/resume/              The CV itself — source of the PDF (see "The CV")
404.html                Served automatically by GitHub Pages

css/style.css           The entire stylesheet, in six commented sections
assets/fonts/           Satoshi woff2 (400/500/700), self-hosted
assets/images/          Photos, figures
assets/papers/          Self-hosted paper PDFs (prefer arXiv links)
assets/slides/          Talk slide decks
assets/cv/              CV PDF — GENERATED, do not hand-edit

tools/build-cv.mjs      Compiles cv/resume/ to the CV PDF
package.json            Build tooling only. Nothing here ships to the browser.

.nojekyll               Required — keep. Disables Jekyll processing.
robots.txt, sitemap.xml Maintained by hand
favicon.svg
```

## Conventions

**All internal paths are root-absolute.** Write `/css/style.css` and
`/assets/images/x.jpg`, never `css/style.css`. Relative paths break on every
page that is not at the site root.

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
case — see "Self-contained documents".) If something else seems to need JS,
reconsider first.

## Updating the last-updated date

The footer carries one site-wide date, identical in all 10 pages. To bump it,
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
term cross-links) with its own embedded stylesheet and JavaScript, and it is the
only JavaScript on the site. Its palette tokens are copied from the ones in
`css/style.css` — if you change the site palette, update that file's `:root`
block too. Its Chinese version is an in-page toggle rather than a `/zh/` URL,
because both languages live in the same data arrays.

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
