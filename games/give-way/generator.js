/* Give Way — board rules, level generation, and the board text format.
 *
 * Pure logic: no DOM, no timers, no Math.random(), no Date. Generation flows
 * from the seeded PRNG below, so a seed always gives the same board.
 *
 * The 100 levels are NOT generated in the browser. tools/give-way-levels.mjs
 * generates them offline (as slowly as it likes) and stores the boards in
 * levels.js in the compact text format at the end of this file; the game only
 * decodes them. The generator also runs in the browser for custom boards.
 *
 * Coordinates: (x, y) with (0, 0) at the top left. An arrow is
 *   { id, dir, cells: [{x, y}, ...] }
 * where cells[0] is the tail and the last cell is the head, and dir is the
 * direction the head points ('up' | 'right' | 'down' | 'left').
 */

/* Part of every seed. Deliberately NOT derived from the game's display name:
   renaming the game must not change what a seed produces. */
const SEED_NAMESPACE = 'give-way';

/* Levels 1-100 are designed (see BANDS); what comes after is undecided. */
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

/* Seeds for the offline level search and for custom boards. Each tries
   variants 0, 1, 2, ... until one meets its targets (see searchBoard). */
export function levelSeed(level, variant) {
  return hashString(`${SEED_NAMESPACE}:level:${level}:${variant}`);
}
export function customSeed(key, variant) {
  return hashString(`${SEED_NAMESPACE}:custom:${key}:${variant}`);
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
   not exceed. Custom boards use a band by its id.
     size      [width, height]. Boards are generated portrait; the UI turns
               them a quarter turn on landscape screens, which changes nothing
               about the puzzle or its solution.
     len       [min, max] arrow length when placed, before tails grow
     fill      share of the interior the placement phase tries to cover
     search    how each placement is chosen (see buildBoard):
                 candidates  drawn per placement
                 blocked     score weight for each free arrow a candidate blocks
                 ray         score weight for ray length
                 targeted    share of candidates grown from a free arrow's ray
                 growTails   once placed, tails grow into leftover space up to
                             this many cells per arrow (see growTails)
                 frame       chance that each rim segment is laid; 0 or absent
                             means no frame (see placeFrame)
     minFill   share of cells every board must cover
     minAvgLen shortest acceptable mean arrow length (see shapeStats)
     targets   [low, high] for each difficultyStats share: free at the start,
               after 20% of arrows are gone, after 50%. Every board must land
               inside its band's ranges. */
const MIN_FILL = 0.9;
/* At most this share of arrows may point straight at another's tail. */
export const MAX_CHAIN = 0.05;

export const BANDS = Object.freeze([
  {
    id: 'easy', name: 'Easy', upTo: 5, size: [8, 12], len: [5, 14], fill: 0.85,
    search: { candidates: 20, blocked: 12, ray: 2, growTails: 40 },
    minFill: MIN_FILL, minAvgLen: 8,
    targets: { open0: [0.2, 0.4], open20: [0.2, 0.4], open50: [0.3, 0.5] },
  },
  {
    id: 'medium', name: 'Medium', upTo: 20, size: [8, 12], len: [5, 14], fill: 0.85,
    search: { candidates: 30, blocked: 16, ray: 2, targeted: 0.6, growTails: 40 },
    minFill: MIN_FILL, minAvgLen: 8,
    targets: { open0: [0.15, 0.25], open20: [0.2, 0.3], open50: [0.25, 0.35] },
  },
  {
    id: 'hard', name: 'Hard', upTo: 50, size: [18, 26], len: [8, 24], fill: 0.9,
    search: { candidates: 40, blocked: 20, ray: 2, targeted: 0.6, growTails: 60, frame: 1 },
    minFill: MIN_FILL, minAvgLen: 12,
    targets: { open0: [0.1, 0.2], open20: [0.15, 0.25], open50: [0.15, 0.25] },
  },
  {
    id: 'expert', name: 'Expert', upTo: 100, size: [22, 30], len: [6, 18], fill: 0.9,
    search: { candidates: 40, blocked: 20, ray: 2, targeted: 0.8, growTails: 60, frame: 1 },
    minFill: MIN_FILL, minAvgLen: 12,
    targets: { open0: [0.05, 0.15], open20: [0.05, 0.15], open50: [0.1, 0.2] },
  },
].map((band) => Object.freeze(band)));

export function isValidLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL;
}

/* Generation parameters for a band (by id) or for a level (by number). */
export function difficulty(levelOrBand) {
  const band =
    typeof levelOrBand === 'string'
      ? BANDS.find((b) => b.id === levelOrBand)
      : BANDS.find((b) => levelOrBand <= b.upTo);
  const [W, H] = band.size;
  const [minLen, maxLen] = band.len;
  return {
    band: band.id, W, H, minLen, maxLen, fill: band.fill, search: band.search,
    minFill: band.minFill, minAvgLen: band.minAvgLen, targets: band.targets,
  };
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

/* Grid value for the two outer rings while they are held back for the frame
   (see placeFrame). Bodies cannot use them; rays pass through them. */
const RESERVED = -2;

/* Grows a path from `start` through free cells (empty and not in `avoid`),
   up to `len` cells. With probability `straight` it carries straight on;
   otherwise it takes the free neighbour with the fewest free neighbours of its
   own, which hugs what is already placed and strands fewer single cells. */
function walk(rng, ctx, start, len, avoid, straight) {
  const { W, grid, inBounds } = ctx;
  const path = [start];
  const own = new Set(path);
  const free = (i) => grid[i] === -1 && !own.has(i) && !avoid.has(i);
  const freeNeighbours = (i) => {
    let n = 0;
    for (const d of DIR_NAMES) {
      const x = (i % W) + DIRS[d].x;
      const y = Math.floor(i / W) + DIRS[d].y;
      if (inBounds(x, y) && free(y * W + x)) n++;
    }
    return n;
  };
  let last = null;
  while (path.length < len) {
    const cur = path[path.length - 1];
    const options = [];
    for (const d of shuffle(rng, [...DIR_NAMES])) {
      const x = (cur % W) + DIRS[d].x;
      const y = Math.floor(cur / W) + DIRS[d].y;
      if (inBounds(x, y) && free(y * W + x)) options.push({ d, i: y * W + x });
    }
    if (!options.length) break;
    let pick = last && rng() < straight ? options.find((o) => o.d === last) : null;
    if (!pick) {
      let fewest = Infinity;
      for (const o of options) {
        const n = freeNeighbours(o.i);
        if (n < fewest) {
          fewest = n;
          pick = o;
        }
      }
    }
    path.push(pick.i);
    own.add(pick.i);
    last = pick.d;
  }
  return path;
}

/* The ray of a head at cell h pointing (dx, dy), or null if a placed arrow
   (or one of `own`) is in the way. Reserved cells do not block. */
function clearRay(ctx, h, dx, dy, own) {
  const { W, grid, inBounds } = ctx;
  const ray = [];
  for (let x = (h % W) + dx, y = Math.floor(h / W) + dy; inBounds(x, y); x += dx, y += dy) {
    const i = y * W + x;
    if (grid[i] >= 0 || own.has(i)) return null;
    ray.push(i);
  }
  return ray;
}

/* Trims a body (head -> tail) so its tail is not the cell straight in front
   of another arrow's head: two arrows meeting head to tail read as one
   broken line and give the order away. */
function untangle(body, front) {
  while (body.length > 2 && front.has(body[body.length - 1])) body.pop();
  return front.has(body[body.length - 1]) ? null : body;
}

/* A candidate with its head at a random free cell, pointing a random way:
   its ray must be clear of everything placed so far, and the body walks away
   from behind the head without touching that ray, so it can never block
   itself and can always leave once later arrows are gone. */
function drawCandidate(rng, ctx) {
  const { W, grid, inBounds, empties, minLen, maxLen, front, straight } = ctx;
  const h = empties[randInt(rng, 0, empties.length - 1)];
  const dirName = DIR_NAMES[randInt(rng, 0, 3)];
  const d = DIRS[dirName];
  const ray = clearRay(ctx, h, d.x, d.y, new Set([h]));
  if (!ray) return null;
  const bx = (h % W) - d.x;
  const by = Math.floor(h / W) - d.y;
  if (!inBounds(bx, by) || grid[by * W + bx] !== -1) return null;
  const rest = walk(rng, ctx, by * W + bx, randInt(rng, minLen, maxLen) - 1, new Set([h, ...ray]), straight);
  const body = untangle([h, ...rest], front);
  return body && { dirName, body, ray };
}

/* A candidate grown through `start`, an empty cell on the ray of an arrow
   that can currently leave, so placing it blocks that arrow. Either end of
   the walk may become the head, if its ray is clear. */
function drawTargeted(rng, ctx, start) {
  const { W, minLen, maxLen, front, straight } = ctx;
  const path = walk(rng, ctx, start, randInt(rng, minLen, maxLen), new Set(), straight);
  if (path.length < 2) return null;
  const ends = rng() < 0.5 ? [path, [...path].reverse()] : [[...path].reverse(), path];
  for (const order of ends) {
    const h = order[0];
    const p = order[1];
    const dx = (h % W) - (p % W);
    const dy = Math.floor(h / W) - Math.floor(p / W);
    const ray = clearRay(ctx, h, dx, dy, new Set(order));
    if (!ray) continue;
    const body = untangle([...order], front);
    if (!body) continue;
    const dirName = DIR_NAMES.find((n) => DIRS[n].x === dx && DIRS[n].y === dy);
    return { dirName, body, ray };
  }
  return null;
}

/* Fills leftover space by lengthening tails. Arrow k (k = placement order)
   may take an empty cell into its tail as long as the cell is not on k's own
   ray and not on the ray of any arrow placed after k: those leave first and
   need their rays clear. Covering the ray of an arrow placed before k is
   fine — it only means that arrow waits for k, which it already did. So
   solvability is untouched, and every growth can only block more arrows.
   Cells straight in front of a head are left alone, so no tail ends there.

   Repeats rounds over all arrows (in a seeded order) until no tail can grow
   or `maxLen` caps them. Prefers the neighbour with the fewest empty
   neighbours, so narrow gaps are filled before they become isolated holes. */
function growTails(rng, { W, grid, inBounds, placed, rayOwners, rays, front }, maxLen) {
  const onOwnRay = placed.map((_, k) => new Set(rays[k]));
  const emptyNeighbours = (i) => {
    let n = 0;
    for (const name of DIR_NAMES) {
      const x = (i % W) + DIRS[name].x;
      const y = Math.floor(i / W) + DIRS[name].y;
      if (inBounds(x, y) && grid[y * W + x] === -1) n++;
    }
    return n;
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const k of shuffle(rng, [...placed.keys()])) {
      const cells = placed[k].cells;
      if (cells.length >= maxLen) continue;
      const tail = cells[0];
      let best = -1;
      let bestScore = Infinity;
      for (const name of DIR_NAMES) {
        const x = tail.x + DIRS[name].x;
        const y = tail.y + DIRS[name].y;
        if (!inBounds(x, y)) continue;
        const i = y * W + x;
        if (grid[i] !== -1 || onOwnRay[k].has(i) || front.has(i)) continue;
        if (rayOwners[i].some((j) => j > k)) continue;
        const score = emptyNeighbours(i);
        if (score < bestScore) {
          best = i;
          bestScore = score;
        }
      }
      if (best === -1) continue;
      grid[best] = k;
      cells.unshift({ x: best % W, y: Math.floor(best / W) });
      grew = true;
    }
  }
}

/* Lays arrows along the two outer rings, which were held back while the
   interior was built. Each side runs one way and is cut into segments. A
   segment is a hairpin: its tail runs back along the inner ring, steps out to
   the edge, and its head runs forward along the edge. So the head of one
   segment points into the side of the next one, never at its tail. A
   segment's ray runs over the segments ahead of it, so on each side only the
   one at the end can leave first and the rest queue behind it; and since the
   frame covers the rim, it blocks every interior arrow that points outward.

   Solvability: frame arrows are placed after every interior arrow, so lying
   on interior rays is allowed. Within a side, segments are placed from the
   far end towards the end they point at, so each ray only crosses segments
   placed later. A ray that runs off a side's end continues into the next
   side's corner; sides are placed left, bottom, right, top, which always puts
   that corner's owner later, so there is no cycle.

   search.frame is the chance that each segment is laid at all; skipped
   segments leave gaps through which interior arrows can see out. */
function placeFrame(rng, { W, H, grid, placed, front }, search) {
  const [minLen, maxLen] = search.frameLen ?? [4, 10];
  const at = (x, y) => y * W + x;
  const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k);
  // Edge cells of each side in increasing order, each with its inward
  // neighbour on the inner ring when that neighbour belongs to this side.
  const sides = [
    { dirs: ['down', 'up'], cells: range(1, H - 2).map((y) => ({ e: at(0, y), i: y >= 2 && y <= H - 3 ? at(1, y) : -1 })) },
    { dirs: ['right', 'left'], cells: range(0, W - 2).map((x) => ({ e: at(x, H - 1), i: x >= 1 ? at(x, H - 2) : -1 })) },
    { dirs: ['down', 'up'], cells: range(1, H - 1).map((y) => ({ e: at(W - 1, y), i: y >= 2 && y <= H - 3 ? at(W - 2, y) : -1 })) },
    { dirs: ['right', 'left'], cells: range(0, W - 1).map((x) => ({ e: at(x, 0), i: x >= 1 && x <= W - 2 ? at(x, 1) : -1 })) },
  ];
  for (const side of sides) for (const c of side.cells) {
    grid[c.e] = -1;
    if (c.i >= 0) grid[c.i] = -1;
  }
  for (const side of sides) {
    const dirName = side.dirs[randInt(rng, 0, 1)];
    const run = dirName === side.dirs[0] ? side.cells : [...side.cells].reverse();
    for (let start = 0; start < run.length; ) {
      let n = Math.min(randInt(rng, minLen, maxLen), run.length - start);
      if (run.length - start - n === 1) n++; // never leave a single cell behind
      const seg = run.slice(start, start + n);
      start += n;
      if (rng() >= search.frame) continue;
      const first = seg.findIndex((c) => c.i >= 0);
      if (first === -1) continue;
      // Head -> tail: back along the edge to the first paired cell, step in,
      // then forward along the inner ring.
      const edge = seg.slice(first).map((c) => c.e);
      const inner = seg.slice(first).filter((c) => c.i >= 0).map((c) => c.i);
      const body = untangle([...edge].reverse().concat(inner), front);
      if (!body || body.length < 2) continue;
      const index = placed.length;
      for (const i of body) grid[i] = index;
      placed.push({ dir: dirName, cells: [...body].reverse().map((i) => ({ x: i % W, y: Math.floor(i / W) })) });
    }
  }
}

/* Reverse construction: arrows are placed one at a time, and each must be
   able to exit when only the arrows placed before it exist. Removing them in
   reverse placement order therefore always clears the board. Which candidate
   is chosen at each step only affects difficulty, never solvability.

   A seed gives one layout, which may or may not meet the band's targets, so
   searchBoard tries a sequence of seeds until one does. */

/* Tries seeds seedOf(0), seedOf(1), ... and keeps the board inside every
   target range and closest to their middles, stopping early once one is
   within `goodEnough` of the middle (as a fraction of each range's
   half-width). A board must also cover minFill of the board, have arrows
   minAvgLen long on average, and keep head-to-tail chains under MAX_CHAIN.
   Those and the opening share are exact and cheap, so a board that misses
   any of them is ranked on that alone and skips the sampled stats. `onProgress(tried)` is called
   every 25 tries, for UIs. */
export function searchBoard(params, seedOf, { maxVariants = 4000, goodEnough = 0.5, level = 0, onProgress } = {}) {
  const range0 = params.targets.open0;
  let best = null;
  let tried = 0;
  for (let variant = 0; variant < maxVariants; variant++) {
    tried++;
    if (onProgress && tried % 25 === 0) onProgress(tried);
    const board = buildBoard(seedOf(variant), params, level);
    const fill = coverage(board);
    const shape = shapeStats(board);
    const open0 = exitableIds(createPosition(board)).length / board.arrows.length;
    let miss;
    let off = Infinity;
    let stats = null;
    const shortBy = Math.max(0, (params.minAvgLen ?? 0) - shape.avgLen) / 10 + Math.max(0, shape.chain - MAX_CHAIN);
    if (fill < params.minFill || shortBy > 0) {
      miss = 2 + Math.max(0, params.minFill - fill) + shortBy; // behind any well-formed board
    } else if (open0 < range0[0] || open0 > range0[1]) {
      miss = 1 + targetMiss({ open0 }, { open0: range0 }); // behind anything that passed
    } else {
      stats = difficultyStats(board);
      miss = targetMiss(stats, params.targets);
      off = targetOffCentre(stats, params.targets);
    }
    if (!best || miss < best.miss || (miss === best.miss && off < best.off)) {
      best = { board, variant, miss, off, stats, fill, shape };
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

/* Share of the board's cells covered by arrows. */
export function coverage(board) {
  return board.arrows.reduce((n, a) => n + a.cells.length, 0) / (board.W * board.H);
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
   are likely to block) and long bodies. Then tails grow into what is left,
   and the frame closes the rim. */
export function buildBoard(seed, { W, H, minLen, maxLen, fill, search }, level = 0) {
  const rng = mulberry32(seed);
  const size = W * H;
  const grid = new Int32Array(size).fill(-1);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const placed = [];
  const rayOwners = Array.from({ length: size }, () => []); // cell -> arrows whose ray crosses it
  const open = []; // open[j]: nothing placed since sits on arrow j's ray
  const rays = []; // rays[j]: arrow j's ray cells, from the head outwards
  const front = new Set(); // the cell straight in front of each head
  let filled = 0;
  if (search.frame) {
    for (let i = 0; i < size; i++) {
      const x = i % W;
      const y = Math.floor(i / W);
      if (Math.min(x, y, W - 1 - x, H - 1 - y) <= 1) grid[i] = RESERVED;
    }
  }
  const ctx = {
    W, grid, inBounds, minLen, maxLen, front, straight: search.straight ?? 0.3,
    empties: [...grid.keys()].filter((i) => grid[i] === -1),
  };
  const area = ctx.empties.length;

  const blocks = (cand) => {
    const hit = new Set();
    for (const i of cand.body) for (const j of rayOwners[i]) if (open[j]) hit.add(j);
    return hit.size;
  };

  const maxAttempts = size * 40;
  let attempt = 0;
  while (attempt < maxAttempts && filled < fill * area && ctx.empties.length) {
    let best = null;
    let bestScore = -Infinity;
    // Empty cells on the rays of arrows that can still leave: where targeted
    // candidates start.
    let openCells = null;
    if (search.targeted) {
      openCells = [];
      for (const i of ctx.empties) if (rayOwners[i].some((j) => open[j])) openCells.push(i);
    }
    for (let k = 0; k < search.candidates && attempt < maxAttempts; k++, attempt++) {
      const cand =
        openCells && openCells.length && rng() < search.targeted
          ? drawTargeted(rng, ctx, openCells[randInt(rng, 0, openCells.length - 1)])
          : drawCandidate(rng, ctx);
      if (!cand || cand.body.length < 2 || cand.ray.length < (search.minRay ?? 0)) continue;
      const score =
        blocks(cand) * search.blocked + cand.ray.length * search.ray + cand.body.length * (search.length ?? 1);
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
    if (best.ray.length) front.add(best.ray[0]);
    open.push(true);
    rays.push(best.ray);
    placed.push({ dir: best.dirName, cells: [...best.body].reverse().map((i) => ({ x: i % W, y: Math.floor(i / W) })) });
    filled += best.body.length;
    ctx.empties = ctx.empties.filter((i) => grid[i] === -1);
  }

  if (search.growTails) growTails(rng, { W, grid, inBounds, placed, rayOwners, rays, front }, search.growTails);
  if (search.frame) placeFrame(rng, { W, H, grid, placed, front }, search);

  // Shuffle so that ids do not leak the solution order.
  const arrows = shuffle(rng, placed).map((a, id) =>
    Object.freeze({ id, dir: a.dir, cells: Object.freeze(a.cells.map((c) => Object.freeze(c))) })
  );
  const board = Object.freeze({ level, W, H, arrows: Object.freeze(arrows) });

  if (!isSolvable(board)) {
    throw new Error(`Generator bug: seed ${seed} (level ${level}) is not solvable`);
  }
  return board;
}


/* ---- Shape measurement -------------------------------------------------- */

/* How the arrows look, in numbers:
     avgLen     mean arrow length in cells
     chain      share of arrows whose head points straight at another arrow's
                tail, which reads as one broken line and gives the order away */
export function shapeStats(board) {
  const { W, H } = board;
  const tails = new Set(board.arrows.map((a) => a.cells[0].y * W + a.cells[0].x));
  let cells = 0;
  let chained = 0;
  for (const a of board.arrows) {
    cells += a.cells.length;
    const h = head(a);
    const d = DIRS[a.dir];
    const x = h.x + d.x;
    const y = h.y + d.y;
    if (x >= 0 && y >= 0 && x < W && y < H && tails.has(y * W + x)) chained++;
  }
  return { avgLen: cells / board.arrows.length, chain: chained / board.arrows.length };
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


/* ---- Board text format -------------------------------------------------- */

/* A board as one short line of text, used to store the 100 levels:

     "8x12:2kRRD 1cUUL ..."

   width x height, then one word per arrow in id order: the tail's cell index
   (y * width + x) in base 36, then one letter per step from the tail towards
   the head (U R D L). The head's direction is the last step. */
const STEP = Object.freeze({ U: 'up', R: 'right', D: 'down', L: 'left' });
const LETTER = Object.freeze({ up: 'U', right: 'R', down: 'D', left: 'L' });

export function encodeBoard(board) {
  const words = board.arrows.map((arrow) => {
    const tail = arrow.cells[0];
    let word = (tail.y * board.W + tail.x).toString(36);
    for (let i = 1; i < arrow.cells.length; i++) {
      const dx = arrow.cells[i].x - arrow.cells[i - 1].x;
      const dy = arrow.cells[i].y - arrow.cells[i - 1].y;
      word += LETTER[DIR_NAMES.find((n) => DIRS[n].x === dx && DIRS[n].y === dy)];
    }
    return word;
  });
  return `${board.W}x${board.H}:${words.join(' ')}`;
}

export function decodeBoard(text, level = 0) {
  const m = /^(\d+)x(\d+):(.*)$/.exec(text);
  if (!m) throw new Error(`Bad board text for level ${level}`);
  const W = Number(m[1]);
  const H = Number(m[2]);
  const arrows = m[3].split(' ').map((word, id) => {
    const w = /^([0-9a-z]+)([URDL]+)$/.exec(word);
    if (!w) throw new Error(`Bad arrow "${word}" in level ${level}`);
    const t = parseInt(w[1], 36);
    const cells = [{ x: t % W, y: Math.floor(t / W) }];
    for (const letter of w[2]) {
      const d = DIRS[STEP[letter]];
      const p = cells[cells.length - 1];
      cells.push({ x: p.x + d.x, y: p.y + d.y });
    }
    return Object.freeze({
      id,
      dir: STEP[w[2][w[2].length - 1]],
      cells: Object.freeze(cells.map((c) => Object.freeze(c))),
    });
  });
  return Object.freeze({ level, W, H, arrows: Object.freeze(arrows) });
}
