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

import { LEVEL_VARIANTS } from './levels.js';

/* Bump when the generator changes in any way that alters existing levels.
   The save file records it, and the game tells players when it changes. */
export const GENERATOR_VERSION = 1;

/* Part of every seed. Deliberately NOT derived from the game's display name:
   renaming the game must not regenerate every level. */
const SEED_NAMESPACE = 'give-way';

/* Levels 1-100 are designed (see LEVEL_BANDS); what comes after is undecided. */
export const MAX_LEVEL = 100;

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

/* `variant` > 0 picks an alternative layout for the same level (see
   generate); variant 0 is the level's primary seed. */
export function seedFor(level, variant = 0) {
  const base = `${SEED_NAMESPACE}:v${GENERATOR_VERSION}:${level}`;
  return hashString(variant ? `${base}:${variant}` : base);
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

/* One row per band of levels; a level uses the first row whose upTo it does
   not exceed.
     size      [width, height]. Boards are generated portrait; the UI turns
               them a quarter turn on landscape screens, which changes nothing
               about the puzzle or its solution.
     len       [min, max] arrow length in cells
     fill      share of cells the generator tries to cover
     search    how each placement is chosen (see buildBoard):
                 candidates  drawn per placement
                 blocked     score weight for each free arrow a candidate blocks
                 ray         score weight for ray length
                 targeted    share of candidates grown from a free arrow's ray
                 lane        share of candidates headed down a free arrow's lane
                 minRay      shortest ray allowed; 0 lets arrows point straight
                             off the edge, where nothing can ever block them
     targets   [low, high] for each difficultyStats share: free at the start,
               after 20% of arrows are gone, after 50%. Every level must land
               inside its band's ranges; see levels.js. */
const EASY_SEARCH = Object.freeze({ candidates: 20, blocked: 12, ray: 2 });
const HARD_SEARCH = Object.freeze({
  candidates: 40, blocked: 20, ray: 2, targeted: 0.8, lane: 0.5, minRay: 1,
});

const LEVEL_BANDS = Object.freeze([
  {
    upTo: 5, size: [8, 12], len: [2, 4], fill: 0.7, search: EASY_SEARCH,
    targets: { open0: [0.2, 0.4], open20: [0.2, 0.4], open50: [0.3, 0.5] },
  },
  {
    upTo: 20, size: [8, 12], len: [2, 5], fill: 0.75, search: EASY_SEARCH,
    targets: { open0: [0.15, 0.25], open20: [0.2, 0.3], open50: [0.25, 0.35] },
  },
  {
    upTo: 50, size: [12, 18], len: [2, 5], fill: 0.88, search: HARD_SEARCH,
    targets: { open0: [0.1, 0.2], open20: [0.15, 0.25], open50: [0.15, 0.25] },
  },
  {
    upTo: 100, size: [12, 18], len: [2, 5], fill: 0.88, search: HARD_SEARCH,
    targets: { open0: [0.05, 0.15], open20: [0.05, 0.15], open50: [0.1, 0.2] },
  },
].map((band) => Object.freeze(band)));

export function isValidLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL;
}

export function difficulty(level) {
  const band = LEVEL_BANDS.find((b) => level <= b.upTo);
  const [W, H] = band.size;
  const [minLen, maxLen] = band.len;
  return { W, H, minLen, maxLen, fill: band.fill, search: band.search, targets: band.targets };
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


/* Draws one candidate arrow, or null if the random pick does not fit. The
   head's ray must be clear of every arrow placed so far, and the body never
   steps onto that ray, so the arrow can always exit once later arrows are gone. */
function drawCandidate(rng, ctx, fixed = null) {
  const { W, grid, inBounds, empties, minLen, maxLen } = ctx;
  const start = fixed ? fixed.head : empties[randInt(rng, 0, empties.length - 1)];
  const hx = start % W;
  const hy = Math.floor(start / W);
  const dirName = fixed ? fixed.dirName : DIR_NAMES[randInt(rng, 0, 3)];
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

/* Draws a candidate whose body passes through `start`, an empty cell on the
   ray of an arrow that can currently exit, so placing it blocks that arrow.
   A short walk is grown from `start`, then either end may become the head,
   subject to the same ray rules as drawCandidate. */
function drawTargeted(rng, ctx, start) {
  const { W, grid, inBounds, minLen, maxLen } = ctx;
  const walk = [start];
  const own = new Set(walk);
  const targetLen = randInt(rng, minLen, maxLen);
  while (walk.length < targetLen) {
    const cur = walk[walk.length - 1];
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    let next = -1;
    for (const name of shuffle(rng, [...DIR_NAMES])) {
      const nx = cx + DIRS[name].x;
      const ny = cy + DIRS[name].y;
      if (!inBounds(nx, ny)) continue;
      const ni = ny * W + nx;
      if (grid[ni] === -1 && !own.has(ni)) {
        next = ni;
        break;
      }
    }
    if (next === -1) break;
    walk.push(next);
    own.add(next);
  }
  if (walk.length < 2) return null;

  // Try both ends as the head, in random order. body runs head -> tail.
  const options = rng() < 0.5 ? [[...walk].reverse(), walk] : [walk, [...walk].reverse()];
  for (const body of options) {
    const h = body[0];
    const p = body[1];
    const dx = (h % W) - (p % W);
    const dy = Math.floor(h / W) - Math.floor(p / W);
    const dirName = DIR_NAMES.find((n) => DIRS[n].x === dx && DIRS[n].y === dy);
    const ray = [];
    let ok = true;
    for (let x = (h % W) + dx, y = Math.floor(h / W) + dy; inBounds(x, y); x += dx, y += dy) {
      const i = y * W + x;
      if (grid[i] !== -1 || own.has(i)) {
        ok = false;
        break;
      }
      ray.push(i);
    }
    if (ok) return { dirName, body, ray };
  }
  return null;
}

/* Reverse construction: arrows are placed one at a time, and each must be
   able to exit when only the arrows placed before it exist. Removing them in
   reverse placement order therefore always clears the board. Which candidate
   is chosen at each step only affects difficulty, never solvability.

   Each level has many possible layouts, one per seed variant. Which one is
   used is decided offline by tools/give-way-levels.mjs, which searches for a
   variant whose difficultyStats land inside the band's targets and records
   it in levels.js. At runtime that layout is simply built: one pass, however
   demanding the targets. */
export function generate(level) {
  if (!isValidLevel(level)) throw new RangeError(`Invalid level: ${level}`);
  return buildBoard(level, LEVEL_VARIANTS[level - 1] ?? 0, difficulty(level));
}

/* Offline search, used by tools/give-way-levels.mjs. Tries variants in order
   and keeps the one inside every target range and closest to their middles,
   stopping early once one is within `goodEnough` of the middle (as a fraction
   of each range's half-width). The opening share is exact and cheap, so a
   variant that misses it is ranked on that alone and skips the sampled stats. */
export function searchVariant(level, { maxVariants = 4000, goodEnough = 0.5 } = {}) {
  const params = difficulty(level);
  const range0 = params.targets.open0;
  let best = null;
  let tried = 0;
  for (let variant = 0; variant < maxVariants; variant++) {
    tried++;
    const board = buildBoard(level, variant, params);
    const open0 = exitableIds(createPosition(board)).length / board.arrows.length;
    let miss;
    let off = Infinity;
    let stats = null;
    if (open0 < range0[0] || open0 > range0[1]) {
      miss = 1 + targetMiss({ open0 }, { open0: range0 }); // behind anything that passed
    } else {
      stats = difficultyStats(board);
      miss = targetMiss(stats, params.targets);
      off = targetOffCentre(stats, params.targets);
    }
    if (!best || miss < best.miss || (miss === best.miss && off < best.off)) {
      best = { variant, miss, off, stats };
      if (miss === 0 && off <= goodEnough) break;
    }
  }
  return { ...best, tried };
}

/* The largest distance of any stat from the middle of its target range, as a
   fraction of that range's half-width: 0 is dead centre, 1 is on the edge. */
export function targetOffCentre(stats, targets) {
  let worst = 0;
  for (const [key, [lo, hi]] of Object.entries(targets)) {
    worst = Math.max(worst, Math.abs(stats[key] - (lo + hi) / 2) / ((hi - lo) / 2));
  }
  return worst;
}

/* How far stats fall outside the target ranges, summed; 0 means all inside. */
export function targetMiss(stats, targets) {
  let miss = 0;
  for (const [key, [lo, hi]] of Object.entries(targets)) {
    const v = stats[key];
    if (v < lo) miss += lo - v;
    else if (v > hi) miss += v - hi;
  }
  return miss;
}

/* Each placement draws search.candidates candidates and keeps the one that
   blocks the most arrows which could otherwise exit straight away, leaning
   towards long rays (arrows pointing across the board, which later arrows
   are likely to block). This deepens the chains of "this must go before
   that" and keeps the opening from being a free-for-all. */
export function buildBoard(level, variant, { W, H, minLen, maxLen, fill, search }) {
  const rng = mulberry32(seedFor(level, variant));
  const size = W * H;
  const grid = new Int32Array(size).fill(-1);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const placed = [];
  const rayOwners = Array.from({ length: size }, () => []); // cell -> arrows whose ray crosses it
  const open = []; // open[j]: nothing placed since sits on arrow j's ray
  const rays = []; // rays[j]: arrow j's ray cells, from the head outwards
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
    // Empty cells on the rays of arrows that can still exit: where a targeted
    // candidate starts. Only computed (and rng only consumed) when the band
    // asks for targeted candidates, so other bands are unaffected.
    let openCells = null;
    let lanes = null;
    if (search.targeted) {
      openCells = [];
      for (const i of ctx.empties) if (rayOwners[i].some((j) => open[j])) openCells.push(i);
    }
    if (search.lane) {
      // A free arrow's ray is an empty lane to the edge. An arrow headed the
      // same way from inside the lane always has a clear ray, and its body
      // sits on the lane, so it always blocks the free arrow.
      lanes = [];
      for (let j = 0; j < placed.length; j++) if (open[j] && rays[j].length >= 2) lanes.push(j);
    }
    for (let k = 0; k < search.candidates && attempt < maxAttempts; k++, attempt++) {
      let cand;
      if (lanes && lanes.length && rng() < search.lane) {
        const j = lanes[randInt(rng, 0, lanes.length - 1)];
        const t = randInt(rng, 1, rays[j].length - 1);
        cand = drawCandidate(rng, ctx, { head: rays[j][t], dirName: placed[j].dir });
      } else if (openCells && openCells.length && rng() < search.targeted) {
        cand = drawTargeted(rng, ctx, openCells[randInt(rng, 0, openCells.length - 1)]);
      } else {
        cand = drawCandidate(rng, ctx);
      }
      if (!cand || cand.body.length < 2 || cand.ray.length < (search.minRay ?? 0)) continue;
      const score = blocks(cand) * search.blocked + cand.ray.length * search.ray + cand.body.length;
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
    rays.push(best.ray);
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
  // Unsorted, unlike exitableIds: the order only has to be deterministic.
  const free = (pos) => {
    const ids = [];
    for (const id of pos.remaining) if (canExit(pos, id)) ids.push(id);
    return ids;
  };
  const share = (pos) => free(pos).length / pos.remaining.size;
  const checkpoints = [0.2, 0.5];
  const sums = [0, 0];
  const rng = mulberry32(seed);
  for (let s = 0; s < samples; s++) {
    const pos = createPosition(board);
    let removed = 0;
    for (const [k, frac] of checkpoints.entries()) {
      const target = Math.round(n * frac);
      while (removed < target) {
        const ids = free(pos);
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
