/* Give Way — level generation and board rules.
 *
 * Pure logic: no DOM, no timers, no Math.random(), no Date. Everything that
 * decides what a level looks like flows from the seeded PRNG below, so level N
 * is the same on every device, forever — until GENERATOR_VERSION is bumped.
 *
 * Coordinates: (x, y) with (0, 0) at the top left. An arrow is
 *   { id, dir, cells: [{x, y}, ...] }
 * where cells[0] is the tail and the last cell is the head, and dir is the
 * direction the head points ('up' | 'right' | 'down' | 'left').
 */

/* Bump when the generator changes in any way that alters existing levels.
   The save file records it, and the game tells players when it changes. */
export const GENERATOR_VERSION = 1;

/* Part of every seed. Deliberately NOT derived from the game's display name:
   renaming the game must not regenerate every level. */
const SEED_NAMESPACE = 'give-way';

export const MAX_LEVEL = 999;

export const DIRS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  right: Object.freeze({ x: 1, y: 0 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
});
const DIR_NAMES = Object.freeze(['up', 'right', 'down', 'left']);


/* ---- Seeded randomness ------------------------------------------------- */

/* cyrb53 string hash; the low 32 bits seed mulberry32. */
export function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFor(level) {
  return hashString(`${SEED_NAMESPACE}:v${GENERATOR_VERSION}:${level}`);
}

/* Integer in [lo, hi], inclusive. */
function randInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function shuffle(rng, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(rng, 0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}


/* ---- Difficulty curve -------------------------------------------------- */

/* [level, width, height]. Sizes are interpolated between anchors with integer
   arithmetic, and held at the last anchor beyond it. Boards are generated
   portrait (taller than wide); the UI turns them a quarter turn on landscape
   screens, which changes nothing about the puzzle or its solution. */
const SIZE_ANCHORS = Object.freeze([
  [1, 8, 12],
  [5, 8, 12],
  [6, 9, 13],
  [15, 9, 14],
  [16, 10, 15],
  [35, 11, 16],
  [60, 12, 18],
]);

/* [up to level, min arrow length, max arrow length, fill target] */
const BANDS = Object.freeze([
  [3, 2, 4, 0.7],
  [10, 2, 5, 0.75],
  [30, 2, 6, 0.8],
  [Infinity, 2, 8, 0.88],
]);

export function isValidLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL;
}

export function difficulty(level) {
  let W;
  let H;
  const last = SIZE_ANCHORS[SIZE_ANCHORS.length - 1];
  if (level >= last[0]) {
    [, W, H] = last;
  } else {
    for (let i = 0; i < SIZE_ANCHORS.length - 1; i++) {
      const [l0, w0, h0] = SIZE_ANCHORS[i];
      const [l1, w1, h1] = SIZE_ANCHORS[i + 1];
      if (level >= l0 && level <= l1) {
        W = w0 + Math.floor(((w1 - w0) * (level - l0)) / (l1 - l0));
        H = h0 + Math.floor(((h1 - h0) * (level - l0)) / (l1 - l0));
        break;
      }
    }
  }
  const [, minLen, maxLen, fill] = BANDS.find(([upTo]) => level <= upTo);
  return { W, H, minLen, maxLen, fill };
}


/* ---- Board geometry and rules ------------------------------------------ */

export function head(arrow) {
  return arrow.cells[arrow.cells.length - 1];
}

/* Cells from just past the head to the edge of the board, in order. */
export function rayCells(W, H, arrow) {
  const d = DIRS[arrow.dir];
  const out = [];
  const h = head(arrow);
  for (let x = h.x + d.x, y = h.y + d.y; x >= 0 && y >= 0 && x < W && y < H; x += d.x, y += d.y) {
    out.push({ x, y });
  }
  return out;
}

/* A position is a board plus what is still on it. The grid maps each cell to
   the id of the arrow occupying it, or -1. */
export function createPosition(board) {
  const { W, H } = board;
  const grid = new Int32Array(W * H).fill(-1);
  const byId = new Map();
  for (const arrow of board.arrows) {
    byId.set(arrow.id, arrow);
    for (const c of arrow.cells) grid[c.y * W + c.x] = arrow.id;
  }
  return { W, H, grid, byId, remaining: new Set(byId.keys()) };
}

export function arrowAtCell(pos, x, y) {
  if (x < 0 || y < 0 || x >= pos.W || y >= pos.H) return -1;
  return pos.grid[y * pos.W + x];
}

export function canExit(pos, id) {
  const arrow = pos.byId.get(id);
  for (const c of rayCells(pos.W, pos.H, arrow)) {
    const other = pos.grid[c.y * pos.W + c.x];
    if (other !== -1 && other !== id) return false;
  }
  return true;
}

/* Ids of every arrow that can exit right now, ordered by head position (top
   to bottom, then left to right) so that callers such as the hint are stable. */
export function exitableIds(pos) {
  const ids = [];
  for (const id of pos.remaining) if (canExit(pos, id)) ids.push(id);
  return ids.sort((a, b) => {
    const ha = head(pos.byId.get(a));
    const hb = head(pos.byId.get(b));
    return ha.y - hb.y || ha.x - hb.x || a - b;
  });
}

/* Removing an arrow only ever frees cells, so it can turn other arrows'
   canExit from false to true but never the reverse. That is why play order
   cannot create a deadlock on a solvable board. */
export function removeArrow(pos, id) {
  if (!pos.remaining.delete(id)) return false;
  for (const c of pos.byId.get(id).cells) pos.grid[c.y * pos.W + c.x] = -1;
  return true;
}

/* Greedy check: repeatedly remove any arrow that can exit. Order does not
   matter (see removeArrow), so failing here means the board has no solution. */
export function isSolvable(board) {
  const pos = createPosition(board);
  let progress = true;
  while (pos.remaining.size && progress) {
    progress = false;
    for (const id of [...pos.remaining]) {
      if (canExit(pos, id)) {
        removeArrow(pos, id);
        progress = true;
      }
    }
  }
  return pos.remaining.size === 0;
}


/* ---- Generation -------------------------------------------------------- */

/* Candidates drawn per placement, and how they are scored. The winner is the
   one that blocks the most arrows that could otherwise exit straight away,
   with a lean towards long rays (arrows pointing across the board, which later
   arrows are likely to block). This deepens the chains of "this must go
   before that" and keeps the opening from being a free-for-all. Tuned on
   levels 1-200: about 39% of arrows can exit at the start (51% with 6 plain
   candidates), and a greedy clear needs about 7.6 rounds (5.0). */
const CANDIDATES = 20;
const SCORE_BLOCKED = 12;
const SCORE_RAY = 2;

/* Draws one candidate arrow, or null if the random pick does not fit. The
   head's ray must be clear of every arrow placed so far, and the body never
   steps onto that ray, so the arrow can always exit once later arrows are gone. */
function drawCandidate(rng, ctx) {
  const { W, grid, inBounds, empties, minLen, maxLen } = ctx;
  const start = empties[randInt(rng, 0, empties.length - 1)];
  const hx = start % W;
  const hy = Math.floor(start / W);
  const dirName = DIR_NAMES[randInt(rng, 0, 3)];
  const d = DIRS[dirName];

  const ray = [];
  for (let x = hx + d.x, y = hy + d.y; inBounds(x, y); x += d.x, y += d.y) {
    const i = y * W + x;
    if (grid[i] !== -1) return null;
    ray.push(i);
  }
  const onRay = new Set(ray);

  // The first body cell sits directly behind the head, so the last segment
  // always agrees with dir.
  const bx = hx - d.x;
  const by = hy - d.y;
  if (!inBounds(bx, by) || grid[by * W + bx] !== -1) return null;

  const body = [start, by * W + bx];
  const own = new Set(body);
  const targetLen = randInt(rng, minLen, maxLen);
  while (body.length < targetLen) {
    const cur = body[body.length - 1];
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    let next = -1;
    for (const name of shuffle(rng, [...DIR_NAMES])) {
      const nx = cx + DIRS[name].x;
      const ny = cy + DIRS[name].y;
      if (!inBounds(nx, ny)) continue;
      const ni = ny * W + nx;
      if (grid[ni] === -1 && !own.has(ni) && !onRay.has(ni)) {
        next = ni;
        break;
      }
    }
    if (next === -1) break;
    body.push(next);
    own.add(next);
  }
  return { dirName, body, ray }; // body runs head -> tail
}

/* Reverse construction: arrows are placed one at a time, and each must be
   able to exit when only the arrows placed before it exist. Removing them in
   reverse placement order therefore always clears the board. Which candidate
   is chosen at each step only affects difficulty, never solvability. */
export function generate(level) {
  if (!isValidLevel(level)) throw new RangeError(`Invalid level: ${level}`);

  const rng = mulberry32(seedFor(level));
  const { W, H, minLen, maxLen, fill } = difficulty(level);
  const size = W * H;
  const grid = new Int32Array(size).fill(-1);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const placed = [];
  const rayOwners = Array.from({ length: size }, () => []); // cell -> arrows whose ray crosses it
  const open = []; // open[j]: nothing placed since sits on arrow j's ray
  let filled = 0;
  const ctx = { W, grid, inBounds, empties: [...grid.keys()], minLen, maxLen };

  const blocks = (cand) => {
    const hit = new Set();
    for (const i of cand.body) for (const j of rayOwners[i]) if (open[j]) hit.add(j);
    return hit.size;
  };

  const maxAttempts = size * 40;
  let attempt = 0;
  while (attempt < maxAttempts && filled < fill * size && ctx.empties.length) {
    let best = null;
    let bestScore = -1;
    for (let k = 0; k < CANDIDATES && attempt < maxAttempts; k++, attempt++) {
      const cand = drawCandidate(rng, ctx);
      if (!cand || cand.body.length < 2) continue;
      const score = blocks(cand) * SCORE_BLOCKED + cand.ray.length * SCORE_RAY + cand.body.length;
      if (score > bestScore) {
        best = cand;
        bestScore = score;
      }
    }
    if (!best) continue;

    const index = placed.length;
    for (const i of best.body) {
      grid[i] = index;
      for (const j of rayOwners[i]) open[j] = false;
    }
    for (const i of best.ray) rayOwners[i].push(index);
    open.push(true);
    const cells = [...best.body].reverse().map((i) => ({ x: i % W, y: Math.floor(i / W) }));
    placed.push({ dir: best.dirName, cells });
    filled += cells.length;
    ctx.empties = ctx.empties.filter((i) => grid[i] === -1);
  }

  // Shuffle so that ids do not leak the solution order.
  const arrows = shuffle(rng, placed).map((a, id) =>
    Object.freeze({ id, dir: a.dir, cells: Object.freeze(a.cells.map((c) => Object.freeze(c))) })
  );
  const board = Object.freeze({ level, W, H, arrows: Object.freeze(arrows) });

  if (!isSolvable(board)) {
    throw new Error(`Generator bug: level ${level} is not solvable`);
  }
  return board;
}


/* ---- Difficulty measurement --------------------------------------------- */

/* How hard a board is, in numbers:
     open0    share of arrows that can exit at the start
     open20   share of remaining arrows that can exit once 20% have been removed
     open50   the same once 50% have been removed
   Lower is harder: fewer free moves means more reading ahead. Removal follows
   random legal play (only arrows that can exit are removed), averaged over
   `samples` seeded runs so the result is deterministic. */
export function difficultyStats(board, { samples = 20, seed = 1 } = {}) {
  const n = board.arrows.length;
  const share = (pos) => exitableIds(pos).length / pos.remaining.size;
  const checkpoints = [0.2, 0.5];
  const sums = [0, 0];
  const rng = mulberry32(seed);
  for (let s = 0; s < samples; s++) {
    const pos = createPosition(board);
    let removed = 0;
    for (const [k, frac] of checkpoints.entries()) {
      const target = Math.round(n * frac);
      while (removed < target) {
        const ids = exitableIds(pos);
        removeArrow(pos, ids[randInt(rng, 0, ids.length - 1)]);
        removed++;
      }
      sums[k] += share(pos);
    }
  }
  return {
    W: board.W,
    H: board.H,
    arrows: n,
    open0: share(createPosition(board)),
    open20: sums[0] / samples,
    open50: sums[1] / samples,
  };
}
