/* Give Way — UI: rendering, input, animation, and saving.
 *
 * All game truth lives in rules.js; this file draws it and reacts to it. An
 * arrow is removed from the rules the instant it starts leaving, so taps on
 * other arrows during the animation are judged against the real board.
 */

import { DIRS, MAX_LEVEL, BANDS, difficulty, customSeed, searchBoard, decodeBoard, encodeBoard, head } from './generator.js';
import { loadLevel, LEVELS_VERSION } from './levels.js';
import { ITEMS, bombArea } from './items.js';
import * as rules from './rules.js';
import * as saves from './save.js';

/* Names in one place, so a rename is a one-line change here (plus the page
   title, heading and the games index, which are static HTML). Changing the
   slug does NOT change any level: seeds use a fixed namespace in generator.js. */
export const GAME = Object.freeze({ name: 'Give Way', slug: 'give-way' });

const SVG_NS = 'http://www.w3.org/2000/svg';
const STROKE = 0.14; // arrow line width, in cells
const CONFETTI_COLOURS = ['--gw-arrow', '--gw-hint', '--gw-error', '--gw-bomb', '--blue'];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const $ = (id) => document.getElementById(id);
const els = {
  stage: $('gw-stage'),
  board: $('gw-board'),
  level: $('gw-level'),
  levelWord: $('gw-level-word'),
  modeTag: $('gw-mode-tag'),
  timer: $('gw-timer'),
  lives: $('gw-lives'),
  status: $('gw-status'),
  restart: $('gw-restart'),
  hint: $('gw-hint'),
  bomb: $('gw-bomb'),
  next: $('gw-next'),
  levels: $('gw-levels'),
  mode: $('gw-mode'),
  winDialog: $('gw-win'),
  winTitle: $('gw-win-title'),
  winTime: $('gw-win-time'),
  winDetail: $('gw-win-detail'),
  winNext: $('gw-win-next'),
  loseDialog: $('gw-lose'),
  levelsDialog: $('gw-levels-dialog'),
  levelsTitle: $('gw-levels-title'),
  levelGrid: $('gw-level-grid'),
  perfectKey: $('gw-perfect-key'),
  makeBand: $('gw-make-band'),
  makeGo: $('gw-make-go'),
  confirmDialog: $('gw-confirm'),
  confirmTitle: $('gw-confirm-title'),
};


/* ---- Storage: every access may throw (private mode, blocked storage) ---- */

const store = {
  read() {
    try {
      return window.localStorage.getItem(saves.SAVE_KEY);
    } catch {
      return null;
    }
  },
  /* Merges with whatever another tab may have saved meanwhile, writes, and
     returns the merged save for this tab to carry on with. */
  write(save) {
    try {
      const stored = saves.parseSave(window.localStorage.getItem(saves.SAVE_KEY)).save;
      const merged = saves.mergeSaves(stored, save);
      window.localStorage.setItem(saves.SAVE_KEY, JSON.stringify(merged));
      return merged;
    } catch {
      return save; /* Playing without saving is fine. */
    }
  },
};

const loaded = saves.parseSave(store.read());
let save = loaded.save;


/* ---- Per-level state ---------------------------------------------------- */

let level = 1;
let custom = null; // { band, key, board } while playing a custom board
let game = null;
let arrowEls = new Map(); // id -> { g, line, tip }
let errorTimers = new Map(); // id -> timeout
let hintTimer = null;
let hintedId = -1;
let statusTimer = null;
let endTimer = null;
let clockTimer = null;
let aiming = null; // { itemId, cell, preview: [ids] } while an item is being aimed
let aimEls = null; // { rect } overlay for the aimed area
let token = 0; // bumped on every level start; stale callbacks check it
let rotated = false; // board shown a quarter turn clockwise (landscape)

function now() {
  return performance.now();
}

/* A numbered level: loaded from levels.js, recorded in the save. */
function startLevel(n) {
  custom = null;
  level = n;
  save.currentLevel = n;
  save = store.write(save);
  setUrl({ level: String(n) });
  startBoard(loadLevel(n));
}

/* A custom board: built from band + key (see generateCustom), never saved. */
function startCustom(spec) {
  custom = spec;
  setUrl({ custom: `${spec.band}-${spec.key}` });
  startBoard(spec.board);
}

function restart() {
  if (custom) startCustom(custom);
  else startLevel(level);
}

function next() {
  if (custom) generateCustom(custom.band);
  else startLevel(Math.min(MAX_LEVEL, level + 1));
}

function setUrl(params) {
  const url = new URL(window.location.href);
  url.search = new URLSearchParams(params).toString();
  window.history.replaceState(null, '', url);
}

function startBoard(board) {
  token++;
  cancelGeneration();
  for (const t of errorTimers.values()) clearTimeout(t);
  errorTimers = new Map();
  clearTimeout(hintTimer);
  clearTimeout(endTimer);
  clearInterval(clockTimer);
  hintTimer = null;
  clockTimer = null;
  hintedId = -1;
  aiming = null;

  game = rules.createGame(board, save.mode);
  closeDialogs();
  rotated = wantRotated(rotated);
  renderBoard();
  renderLives(false);
  updateHud();
  setStatus('');
}


/* ---- View orientation --------------------------------------------------- */

/* Levels are generated portrait. On a landscape area the board is drawn a
   quarter turn clockwise: the same puzzle with the same solution, turned to
   fit. Rules always work in board coordinates; only drawing and hit-testing
   go through these helpers. */
const TURN = { up: 'right', right: 'down', down: 'left', left: 'up' };

function viewSize() {
  const { W, H } = game.board;
  return rotated ? { W: H, H: W } : { W, H };
}
function toView(c) {
  return rotated ? { x: game.board.H - 1 - c.y, y: c.x } : c;
}
function fromView(c) {
  return rotated ? { x: c.y, y: game.board.H - 1 - c.x } : c;
}
function viewArrow(arrow) {
  if (!rotated) return arrow;
  return { id: arrow.id, dir: TURN[arrow.dir], cells: arrow.cells.map(toView) };
}

/* Phones (the narrow layout) follow the device: portrait unless the phone is
   held sideways. Wider windows get whichever orientation gives bigger cells,
   with a little hysteresis so a window near square does not flip back and
   forth. */
function wantRotated(current) {
  if (!wide.matches) return window.innerWidth > window.innerHeight;
  const wrap = els.board.parentElement;
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight || window.innerHeight;
  if (!availW || !availH) return current;
  const { W, H } = game.board;
  const portrait = Math.min(availW / W, availH / H);
  const landscape = Math.min(availW / H, availH / W);
  return current ? landscape * 1.04 >= portrait : landscape > portrait * 1.04;
}

function fitOrientation() {
  if (!game) return;
  const next = wantRotated(rotated);
  if (next === rotated) return;
  rotated = next;
  renderBoard();
  renderAim();
}


/* ---- Rendering ---------------------------------------------------------- */

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const centre = (c) => ({ x: c.x + 0.5, y: c.y + 0.5 });
const fmt = (n) => Math.round(n * 1000) / 1000;

function linePath(cells, extend = 0, dir = null) {
  const pts = cells.map(centre);
  if (extend && dir) {
    const h = pts[pts.length - 1];
    pts.push({ x: h.x + dir.x * extend, y: h.y + dir.y * extend });
  }
  return pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

/* A rounded triangle whose tip sits just past the centre of the head cell. */
function tipPath(arrow) {
  const c = centre(head(arrow));
  const d = DIRS[arrow.dir];
  const p = { x: -d.y, y: d.x };
  const tip = { x: c.x + d.x * 0.34, y: c.y + d.y * 0.34 };
  const back = { x: c.x - d.x * 0.08, y: c.y - d.y * 0.08 };
  const a = { x: back.x + p.x * 0.25, y: back.y + p.y * 0.25 };
  const b = { x: back.x - p.x * 0.25, y: back.y - p.y * 0.25 };
  return `M${fmt(tip.x)} ${fmt(tip.y)} L${fmt(a.x)} ${fmt(a.y)} L${fmt(b.x)} ${fmt(b.y)} Z`;
}

/* Draws the arrows still in play, in view coordinates. Called on level start
   and whenever the orientation changes mid-level. */
function renderBoard() {
  const { W, H } = viewSize();
  const board = els.board;
  board.replaceChildren();
  board.setAttribute('viewBox', `0 0 ${W} ${H}`);
  board.setAttribute('aria-label', `${boardName()} board, ${W} by ${H}, ${rules.remainingCount(game)} arrows left`);
  els.stage.style.setProperty('--gw-ratio', String(W / H));

  const defs = svg('defs');
  const pattern = svg('pattern', { id: 'gw-dots', width: 1, height: 1, patternUnits: 'userSpaceOnUse' });
  pattern.append(svg('circle', { cx: 0.5, cy: 0.5, r: 0.045, class: 'gw-dot' }));
  // Arrows sliding out are clipped at the board edge, not at the SVG's box.
  const clip = svg('clipPath', { id: 'gw-clip' });
  clip.append(svg('rect', { x: 0, y: 0, width: W, height: H, rx: 0.22 }));
  defs.append(pattern, clip);
  board.append(defs);
  board.append(svg('rect', { x: 0, y: 0, width: W, height: H, rx: 0.22, class: 'gw-surface' }));
  board.append(svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#gw-dots)' }));

  const layer = svg('g', { class: 'gw-arrows', 'clip-path': 'url(#gw-clip)' });
  arrowEls = new Map();
  for (const source of game.board.arrows) {
    if (!game.pos.remaining.has(source.id)) continue;
    const arrow = viewArrow(source);
    const g = svg('g', { class: 'gw-arrow' });
    if (errorTimers.has(arrow.id)) g.classList.add('is-error');
    if (arrow.id === hintedId) g.classList.add('is-hint');
    const line = svg('path', { d: linePath(arrow.cells), class: 'gw-line', 'stroke-width': STROKE });
    const tip = svg('path', { d: tipPath(arrow), class: 'gw-tip' });
    g.append(line, tip);
    layer.append(g);
    arrowEls.set(arrow.id, { g, line, tip });
  }
  board.append(layer);

  const rect = svg('rect', { class: 'gw-aim', rx: 0.16, visibility: 'hidden' });
  board.append(rect);
  aimEls = { rect };
}

function renderLives(animateLoss) {
  if (els.lives.children.length !== rules.LIVES) {
    els.lives.replaceChildren(
      ...Array.from({ length: rules.LIVES }, () => {
        const s = document.createElement('span');
        s.className = 'gw-life';
        return s;
      })
    );
  }
  [...els.lives.children].forEach((dot, i) => {
    const lost = i >= game.lives;
    dot.classList.toggle('is-lost', lost);
    if (!lost || !animateLoss) dot.classList.remove('is-losing');
    if (lost && animateLoss && i === game.lives) {
      dot.classList.remove('is-losing');
      void dot.offsetWidth; // restart the animation
      dot.classList.add('is-losing');
    }
  });
  els.lives.setAttribute('aria-label', `${game.lives} of ${rules.LIVES} lives left`);
}

function renderClock() {
  els.timer.textContent = saves.formatTime(rules.elapsedMs(game, now()) / 1000);
}

/* The clock starts with the first action and stops when the level ends. */
function syncClock() {
  const running = game.status === 'playing' && game.startedAt !== null;
  if (running && !clockTimer) clockTimer = setInterval(renderClock, 250);
  if (!running && clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
  renderClock();
}

function updateHud() {
  const playing = game.status === 'playing';
  const itemsMode = game.mode === 'items';
  els.levelWord.textContent = custom ? 'Custom' : 'Level';
  els.level.textContent = custom ? bandName(custom.band) : String(level);
  els.modeTag.hidden = !itemsMode;
  els.mode.setAttribute('aria-checked', String(itemsMode));

  els.hint.textContent = `Hint (${game.hintsLeft})`;
  els.hint.disabled = game.hintsLeft <= 0 || !playing;

  const bombs = game.items.bomb ?? 0;
  els.bomb.hidden = !itemsMode;
  els.bomb.textContent = aiming ? 'Cancel bomb' : `${ITEMS.bomb.name} ×${bombs}`;
  els.bomb.disabled = !aiming && (bombs <= 0 || !playing);
  els.bomb.setAttribute('aria-pressed', String(!!aiming));

  els.next.hidden = game.status !== 'won' || (!custom && level >= MAX_LEVEL);
  els.next.textContent = custom ? 'New board' : 'Next level';
  els.restart.classList.toggle('btn--p', game.status === 'lost');
  els.restart.classList.toggle('btn--s', game.status !== 'lost');
  els.board.classList.toggle('is-over', !playing);
  els.board.classList.toggle('is-aiming', !!aiming);
  syncClock();
}

function setStatus(text, ms = 0) {
  clearTimeout(statusTimer);
  els.status.textContent = text;
  if (ms) statusTimer = setTimeout(() => (els.status.textContent = ''), ms);
}


/* ---- Animation ---------------------------------------------------------- */

function exitDuration(arrow) {
  return Math.min(400, 250 + arrow.cells.length * 20);
}

function forgetArrow(id) {
  const parts = arrowEls.get(id);
  arrowEls.delete(id);
  clearTimeout(errorTimers.get(id));
  errorTimers.delete(id);
  if (parts) parts.g.classList.remove('is-hint', 'is-error', 'is-bomb');
  return parts;
}

/* The arrow crawls along its own body and out past the edge, like a snake:
   the visible dash is exactly the body length and slides along a path that
   continues straight out of the head. */
function animateExit(id) {
  const parts = forgetArrow(id);
  if (!parts) return 0;
  const { g, line, tip } = parts;
  g.classList.add('is-leaving');

  if (reducedMotion.matches) {
    g.classList.add('is-fading');
    setTimeout(() => g.remove(), 220);
    return 220;
  }

  const arrow = viewArrow(game.board.arrows[id]);
  const d = DIRS[arrow.dir];
  const h = head(arrow);
  const { W, H } = viewSize();
  const toEdge = { up: h.y + 0.5, down: H - h.y - 0.5, left: h.x + 0.5, right: W - h.x - 0.5 }[arrow.dir];
  const bodyLen = arrow.cells.length - 1;
  const travel = bodyLen + toEdge + 0.6; // until the tail cap has cleared the edge

  line.setAttribute('d', linePath(arrow.cells, travel, d));
  line.style.strokeDasharray = `${bodyLen} ${bodyLen + travel + 2}`;
  line.style.strokeDashoffset = '0';

  const duration = exitDuration(arrow);
  const t0 = now();
  const frame = () => {
    if (!g.isConnected) return;
    const t = Math.min(1, (now() - t0) / duration);
    const s = travel * t * t; // ease in: it accelerates away
    line.style.strokeDashoffset = String(-s);
    tip.setAttribute('transform', `translate(${fmt(d.x * s)} ${fmt(d.y * s)})`);
    if (t < 1) requestAnimationFrame(frame);
    else g.remove();
  };
  requestAnimationFrame(frame);
  return duration;
}

/* Bombed arrows shrink and fade where they are. */
function animateBlast(ids, cell) {
  const duration = 300;
  if (!reducedMotion.matches) {
    const v = toView(cell);
    const flash = svg('circle', { cx: v.x + 0.5, cy: v.y + 0.5, r: 1.6, class: 'gw-flash' });
    els.board.append(flash);
    flash
      .animate(
        [
          { transform: 'scale(.15)', opacity: 0.75 },
          { transform: 'scale(1)', opacity: 0 },
        ],
        { duration, easing: 'ease-out' }
      )
      .finished.then(() => flash.remove(), () => flash.remove());
  }
  for (const id of ids) {
    const parts = forgetArrow(id);
    if (!parts) continue;
    const { g } = parts;
    g.classList.add('is-leaving', 'is-bombed');
    const frames = reducedMotion.matches
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(.35)', opacity: 0 },
        ];
    g.animate(frames, { duration, easing: 'ease-in', fill: 'forwards' }).finished.then(
      () => g.remove(),
      () => g.remove()
    );
  }
  return duration;
}

function flashError(id) {
  const parts = arrowEls.get(id);
  if (!parts) return;
  parts.g.classList.add('is-error');
  clearTimeout(errorTimers.get(id));
  errorTimers.set(
    id,
    setTimeout(() => {
      errorTimers.delete(id);
      // Look the arrow up again: the board may have been redrawn (turned) since.
      arrowEls.get(id)?.g.classList.remove('is-error');
    }, rules.ERROR_MS)
  );
}

function syncHint() {
  if (game.hint && hintedId === game.hint.id) return;
  if (hintedId !== -1) arrowEls.get(hintedId)?.g.classList.remove('is-hint');
  clearTimeout(hintTimer);
  hintTimer = null;
  hintedId = -1;
  if (!game.hint) return;
  hintedId = game.hint.id;
  arrowEls.get(hintedId)?.g.classList.add('is-hint');
  const t = token;
  hintTimer = setTimeout(() => {
    if (t !== token) return;
    rules.clearHint(game);
    syncHint();
  }, Math.max(0, game.hint.until - now()));
}

/* A burst of confetti from the top of the win dialog. The pieces live inside
   the dialog so they draw above its backdrop; position:fixed lets them fly
   across the whole window. Purely decorative, so Math.random is fine here. */
function celebrate() {
  if (reducedMotion.matches) return;
  const layer = document.createElement('div');
  layer.className = 'gw-confetti';
  layer.setAttribute('aria-hidden', 'true');
  els.winDialog.append(layer);

  const box = els.winDialog.getBoundingClientRect();
  const ox = box.left + box.width / 2;
  const oy = box.top + 12;
  const styles = getComputedStyle(document.documentElement);
  const colours = CONFETTI_COLOURS.map((v) => styles.getPropertyValue(v).trim()).filter(Boolean);
  const pieces = window.innerWidth < 600 ? 70 : 110;
  let longest = 0;

  for (let i = 0; i < pieces; i++) {
    const p = document.createElement('i');
    p.style.left = `${ox}px`;
    p.style.top = `${oy}px`;
    p.style.background = colours[i % colours.length];
    if (i % 3 === 0) p.style.borderRadius = '50%';
    layer.append(p);

    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 220 + Math.random() * 380;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed;
    const spin = (Math.random() - 0.5) * 1440;
    const duration = 1400 + Math.random() * 900;
    longest = Math.max(longest, duration);
    p.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.6}px,${dy * 0.6}px) rotate(${spin * 0.4}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px,${dy + 520}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }
    );
  }
  setTimeout(() => layer.remove(), longest + 50);
}


/* ---- Game events -------------------------------------------------------- */

function logDeadlock(where) {
  console.error(
    `[${GAME.slug}] Deadlock after ${where}: arrows remain but none can exit. This is a bug.`,
    { level: custom ? `custom ${custom.band}-${custom.key}` : level, levelsVersion: LEVELS_VERSION, position: JSON.stringify(rules.boardView(game)) }
  );
}

function handleTap(id) {
  const ev = rules.tap(game, id, now());
  if (ev.hintCleared) syncHint();
  if (ev.type === 'exit') {
    const duration = animateExit(id);
    if (ev.deadlock) logDeadlock('a tap');
    if (ev.won) finishLevel(duration);
  } else if (ev.type === 'blocked') {
    flashError(id);
    renderLives(true);
    if (ev.lost) {
      setStatus('');
      const t = token;
      endTimer = setTimeout(() => t === token && showDialog(els.loseDialog), 600);
    } else {
      setStatus('Blocked. Something is in its way.', 1600);
    }
  }
  updateHud();
}

function handleHint() {
  const ev = rules.useHint(game, now());
  if (ev.type === 'deadlock') logDeadlock('a hint request');
  syncHint();
  updateHud();
}

function finishLevel(delay) {
  stopAiming();
  const rec = rules.result(game);
  let timeNote = '';
  if (!custom) {
    const outcome = saves.recordWin(save, game.mode, level, rec);
    save = outcome.save;
    save = store.write(save);
    const best = save.completed[game.mode][level]?.bestTimeSec;
    if (outcome.newBestTime) timeNote = ' · New best!';
    else if (best !== undefined && best < rec.timeSec) timeNote = ` · Best ${saves.formatTime(best)}`;
  }

  const last = !custom && level >= MAX_LEVEL;
  els.winTitle.textContent = custom
    ? '🎉 Board cleared'
    : last ? `🎉 All ${MAX_LEVEL} levels complete` : `🎉 Level ${level} complete`;
  els.winTime.textContent = `Time ${saves.formatTime(rec.timeSec)}${timeNote}`;

  const parts = [
    rec.livesLeft === rules.LIVES ? 'No lives lost' : `${rec.livesLeft} of ${rules.LIVES} lives left`,
    rec.hintsUsed ? `${rec.hintsUsed} hint${rec.hintsUsed > 1 ? 's' : ''} used` : 'no hints',
  ];
  if (game.mode === 'items') parts.push(rec.itemsUsed ? `${rec.itemsUsed} item${rec.itemsUsed > 1 ? 's' : ''} used` : 'no items');
  els.winDetail.textContent =
    parts.join(', ') + '.' + (saves.isPerfect(game.mode, rec) ? ' A perfect clear.' : '') +
    (last ? ` That was the last level for now. Replay any level from Levels.` : '');
  els.winNext.hidden = last;
  els.winNext.textContent = custom ? 'New board' : 'Next level';

  const t = token;
  endTimer = setTimeout(() => {
    if (t !== token) return;
    showDialog(els.winDialog);
    celebrate();
  }, delay + 120);
}


/* ---- Items -------------------------------------------------------------- */

function setPreview(ids) {
  const next = new Set(ids);
  for (const [id, parts] of arrowEls) parts.g.classList.toggle('is-bomb', next.has(id));
}

function renderAim() {
  const rect = aimEls?.rect;
  if (!rect) return;
  if (!aiming || !aiming.cell) {
    rect.setAttribute('visibility', 'hidden');
    setPreview([]);
    return;
  }
  const a = bombArea(game.board, aiming.cell, ITEMS[aiming.itemId].radius);
  const p = toView({ x: a.x0, y: a.y0 });
  const q = toView({ x: a.x1, y: a.y1 });
  const x0 = Math.min(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  rect.setAttribute('x', x0 + 0.04);
  rect.setAttribute('y', y0 + 0.04);
  rect.setAttribute('width', Math.max(p.x, q.x) - x0 + 1 - 0.08);
  rect.setAttribute('height', Math.max(p.y, q.y) - y0 + 1 - 0.08);
  rect.setAttribute('visibility', 'visible');
  setPreview(rules.previewItem(game, aiming.itemId, aiming.cell));
}

function startAiming(itemId) {
  if (game.status !== 'playing' || !(game.items[itemId] > 0)) return;
  aiming = { itemId, cell: null };
  setStatus('Pick a spot. Every arrow touching the 3×3 square is removed.');
  renderAim();
  updateHud();
}

function stopAiming() {
  if (!aiming) return;
  aiming = null;
  renderAim();
  setStatus('');
  updateHud();
}

function aimAt(cell) {
  if (!aiming) return;
  const same = aiming.cell && cell && aiming.cell.x === cell.x && aiming.cell.y === cell.y;
  if (same || (!aiming.cell && !cell)) return;
  aiming.cell = cell;
  renderAim();
}

function detonate(cell) {
  const itemId = aiming.itemId;
  const ev = rules.useItem(game, itemId, cell, now());
  if (ev.type === 'empty') {
    setStatus('Nothing to hit here. Pick a spot with arrows in it.', 2000);
    return;
  }
  if (ev.type !== 'used') return;
  aiming = null;
  renderAim();
  setStatus('');
  const duration = animateBlast(ev.ids, cell);
  if (ev.hintCleared) syncHint();
  if (ev.deadlock) logDeadlock('an item');
  if (ev.won) finishLevel(duration);
  updateHud();
}


/* ---- Modes -------------------------------------------------------------- */

function applyMode(mode) {
  save.mode = mode;
  save = store.write(save);
  restart();
}

function requestModeSwitch() {
  const target = game.mode === 'items' ? 'basic' : 'items';
  if (game.status === 'playing' && game.actions > 0) {
    els.confirmTitle.textContent = target === 'items' ? 'Turn on items mode?' : 'Turn off items mode?';
    els.confirmDialog.dataset.target = target;
    showDialog(els.confirmDialog);
  } else {
    applyMode(target);
  }
}


/* ---- Custom boards ------------------------------------------------------ */

function bandName(id) {
  return BANDS.find((b) => b.id === id)?.name ?? id;
}

function boardName() {
  return custom ? `Custom ${bandName(custom.band)}` : `Level ${level}`;
}

let worker = null;
let generating = 0; // bumped per request, so a stale result is ignored

function cancelGeneration() {
  generating++;
  worker?.terminate();
  worker = null;
  setGenerating(false);
}

/* While a board is being built, the current one and its controls are dimmed
   and inert, so nothing is spent on a board about to be replaced. */
function setGenerating(on) {
  els.stage.classList.toggle('is-generating', on);
  for (const el of els.stage.querySelectorAll('.gw-buttons, .gw-switch')) el.inert = on;
}

function randomKey() {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => n.toString(36)).join('').slice(0, 10);
}

/* Builds a board for band + key in a worker (a larger board can take a few
   seconds) and starts it. The same band and key always give the same board,
   which is what makes ?custom= links shareable. Falls back to the main thread
   if workers are unavailable. */
function generateCustom(band, key = randomKey()) {
  cancelGeneration();
  const request = generating;
  const { W, H } = difficulty(band);
  const label = `${bandName(band)} ${W}×${H}`;
  closeDialogs();
  stopAiming();
  setGenerating(true);
  setStatus(`Generating a new ${label} board. This can take a few seconds.`);

  const done = (text) => {
    if (request !== generating) return;
    worker?.terminate();
    worker = null;
    startCustom({ band, key, board: decodeBoard(text) });
    setStatus(`New ${label} board. Share this page's link to share the board.`, 5000);
  };

  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (!worker) {
    // No workers: generate here. The page is unresponsive meanwhile.
    setTimeout(() => {
      const found = searchBoard(difficulty(band), (v) => customSeed(key, v), { maxVariants: 20000, goodEnough: 1 });
      done(encodeBoard(found.board));
    }, 50);
    return;
  }
  worker.onmessage = (e) => {
    if (request !== generating) return;
    if (e.data.type === 'progress') {
      setStatus(`Generating a new ${label} board. This can take a few seconds. Tried ${e.data.tried} layouts.`);
    } else if (e.data.type === 'done') {
      done(e.data.text);
    }
  };
  worker.onerror = () => {
    if (request !== generating) return;
    cancelGeneration();
    setStatus('Could not generate a board. Please try again.', 5000);
  };
  worker.postMessage({ band, key });
}

for (const band of BANDS) {
  const o = document.createElement('option');
  o.value = band.id;
  o.textContent = `${band.name} · ${band.size[0]}×${band.size[1]}`;
  els.makeBand.append(o);
}
els.makeGo.addEventListener('click', () => generateCustom(els.makeBand.value));

/* `?custom=` value -> { band, key }, or null. */
function parseCustomParam(value) {
  const m = /^([a-z]+)-([a-z0-9]{1,16})$/.exec(value ?? '');
  return m && BANDS.some((b) => b.id === m[1]) ? { band: m[1], key: m[2] } : null;
}


/* ---- Dialogs ------------------------------------------------------------ */

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialogs() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

function openLevels() {
  stopAiming();
  const records = save.completed[save.mode];
  const top = Math.max(save.maxUnlocked, save.currentLevel);
  els.levelsTitle.textContent = save.mode === 'items' ? 'Levels · items mode' : 'Levels';
  els.perfectKey.hidden = save.mode !== 'basic';
  const frag = document.createDocumentFragment();
  for (let n = 1; n <= top; n++) {
    const rec = records[n];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gw-lvl';
    b.textContent = String(n);
    b.dataset.level = String(n);
    const notes = [];
    if (rec) {
      b.classList.add('is-done');
      notes.push('completed');
      if (rec.bestTimeSec !== undefined) {
        b.title = `Best time ${saves.formatTime(rec.bestTimeSec)}`;
        notes.push(`best time ${saves.formatTime(rec.bestTimeSec)}`);
      }
    }
    if (saves.isPerfect(save.mode, rec)) {
      b.classList.add('is-perfect');
      notes.push('perfect');
    }
    if (!custom && n === level) {
      b.setAttribute('aria-current', 'true');
      notes.push('current');
    }
    b.setAttribute('aria-label', `Level ${n}${notes.length ? `, ${notes.join(', ')}` : ''}`);
    frag.append(b);
  }
  els.levelGrid.replaceChildren(frag);
  if (custom) els.makeBand.value = custom.band;
  showDialog(els.levelsDialog);
  els.levelGrid.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
}


/* ---- Input -------------------------------------------------------------- */

/* Hit-testing is by cell, not by the thin stroke, so the whole cell is a
   target. getScreenCTM accounts for however the SVG is scaled and centred.
   Returns board coordinates. */
function cellFromEvent(e) {
  const ctm = els.board.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  const { W, H } = viewSize();
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  return fromView({ x, y });
}

els.board.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || game.status !== 'playing') return;
  const cell = cellFromEvent(e);
  if (aiming) {
    // Aiming: press shows the area, release fires. Nothing slides or costs a life.
    e.preventDefault();
    aimAt(cell);
    return;
  }
  if (!cell) return;
  const id = rules.arrowAt(game, cell.x, cell.y);
  if (id >= 0) handleTap(id);
});

els.board.addEventListener('pointermove', (e) => {
  if (aiming) aimAt(cellFromEvent(e));
});

els.board.addEventListener('pointerup', (e) => {
  if (!aiming || e.button > 0) return;
  const cell = cellFromEvent(e);
  if (cell) detonate(cell);
});

els.board.addEventListener('pointerleave', (e) => {
  if (aiming && e.pointerType === 'mouse') aimAt(null);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && aiming && !document.querySelector('dialog[open]')) stopAiming();
});

els.restart.addEventListener('click', restart);
els.next.addEventListener('click', next);
els.hint.addEventListener('click', handleHint);
els.levels.addEventListener('click', openLevels);
els.mode.addEventListener('click', requestModeSwitch);
els.bomb.addEventListener('click', () => (aiming ? stopAiming() : startAiming('bomb')));

els.levelGrid.addEventListener('click', (e) => {
  const b = e.target.closest('[data-level]');
  if (b) startLevel(Number(b.dataset.level));
});

for (const dialog of [els.winDialog, els.loseDialog, els.levelsDialog, els.confirmDialog]) {
  dialog.addEventListener('close', () => {
    const value = dialog.returnValue;
    dialog.returnValue = '';
    if (value === 'next') next();
    else if (value === 'restart') restart();
    else if (value === 'switch') applyMode(dialog.dataset.target);
  });
  // A click on the backdrop (outside the panel) closes the dialog.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}


/* ---- Fit the stage to the viewport ------------------------------------- */

/* The sticky site header wraps to several lines on narrow screens, so its
   height is measured rather than assumed; the stage fills the rest. */
const header = document.querySelector('.site-header');
const measureHeader = () => {
  if (header) document.documentElement.style.setProperty('--gw-header', `${header.offsetHeight}px`);
};
measureHeader(); // before first paint, so the stage does not jump
if (header && 'ResizeObserver' in window) new ResizeObserver(measureHeader).observe(header);

/* Narrow layout: the board gets whatever height the title and controls leave,
   so the three sit together instead of the board floating in a tall row. */
const wide = window.matchMedia('(min-width: 760px)');
const topBar = document.querySelector('.gw-top');
const ctrl = document.querySelector('.gw-ctrl');
function fitBoard() {
  if (wide.matches) return;
  const cs = getComputedStyle(els.stage);
  const free =
    els.stage.clientHeight -
    parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) -
    topBar.offsetHeight - ctrl.offsetHeight - 2 * parseFloat(cs.rowGap);
  els.stage.style.setProperty('--gw-board-max', `${Math.max(160, Math.floor(free))}px`);
}

function fit() {
  fitBoard();
  fitOrientation();
}
if ('ResizeObserver' in window) {
  const ro = new ResizeObserver(fit);
  for (const el of [els.stage, topBar, ctrl, els.board.parentElement]) ro.observe(el);
}
wide.addEventListener('change', fit);


/* ---- Boot --------------------------------------------------------------- */

const query = new URLSearchParams(window.location.search);
const fromUrl = saves.parseLevelParam(query.get('level'));
const customFromUrl = parseCustomParam(query.get('custom'));
if (loaded.levelsChanged) {
  save.levelsVersion = LEVELS_VERSION;
  save = store.write(save);
}
fitBoard();
startLevel(fromUrl ?? save.currentLevel);
fitBoard();
fitOrientation();
if (customFromUrl) {
  // Keep the shared link in the address bar while the board is built, so it
  // is not lost if generation fails.
  setUrl({ custom: `${customFromUrl.band}-${customFromUrl.key}` });
  generateCustom(customFromUrl.band, customFromUrl.key);
}
if (loaded.levelsChanged) {
  setStatus('Levels have been updated since your last visit. Your level number is kept.', 6000);
}
