/* Give Way — logic tests. No dependencies:
 *
 *   node tests/give-way/generator.test.mjs
 *
 * Covers the 100 stored levels (format, solvability, structure, size, fill,
 * difficulty), the generator itself, the no-deadlock guarantee under random
 * play with and without items, and the rules, item and save modules. The UI is
 * not tested here.
 */

import assert from 'node:assert/strict';
import {
  difficulty, isSolvable, createPosition, canExit, exitableIds, removeArrow, rayCells, head,
  mulberry32, hashString, customSeed, DIRS, MAX_LEVEL, BANDS, difficultyStats, targetMiss, coverage,
  searchBoard, encodeBoard, decodeBoard, shapeStats, MAX_CHAIN,
} from '../../games/give-way/generator.js';
import { ITEMS, bombArea } from '../../games/give-way/items.js';
import * as rules from '../../games/give-way/rules.js';
import * as saves from '../../games/give-way/save.js';
import { loadLevel, LEVEL_COUNT, LEVELS_VERSION } from '../../games/give-way/levels.js';

let failures = 0;
let count = 0;
function test(name, fn) {
  count++;
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${String(err.stack || err).split('\n').slice(0, 4).join('\n        ')}`);
  }
}

const levels = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const boards = new Map();
const board = (n) => {
  if (!boards.has(n)) boards.set(n, loadLevel(n));
  return boards.get(n);
};

/* A board drawn by hand: { W, H, arrows } with ids in order. */
function handBoard(W, H, arrows) {
  return { level: 0, W, H, arrows: arrows.map((a, id) => ({ id, ...a })) };
}

/* Plays a board to the end, picking uniformly among exitable arrows (and, in
   items mode, sometimes firing a bomb at a random cell). Returns the number of
   steps, or throws on a deadlock. */
function randomPlay(b, rng, { items = false } = {}) {
  const game = rules.createGame(b, items ? 'items' : 'basic');
  let t = 0;
  let steps = 0;
  while (rules.remainingCount(game) > 0) {
    if (++steps > 10000) throw new Error('runaway simulation');
    t += 5000; // past any red cool-down
    if (items && game.items.bomb > 0 && rng() < 0.15) {
      const cell = { x: Math.floor(rng() * b.W), y: Math.floor(rng() * b.H) };
      const ev = rules.useItem(game, 'bomb', cell, t);
      assert.ok(['used', 'empty'].includes(ev.type), `unexpected item event ${ev.type}`);
    } else {
      const ids = exitableIds(game.pos);
      if (!ids.length) {
        throw new Error(`deadlock on level ${b.level}: ${JSON.stringify(rules.boardView(game))}`);
      }
      const ev = rules.tap(game, ids[Math.floor(rng() * ids.length)], t);
      assert.equal(ev.type, 'exit');
    }
    assert.equal(rules.isDeadlocked(game), false, `deadlock on level ${b.level}`);
  }
  assert.equal(game.status, 'won');
  return steps;
}


console.log('\nStored levels');

test('1. format: every stored level decodes and re-encodes to the same text', () => {
  assert.equal(LEVEL_COUNT, MAX_LEVEL, 'levels.js holds every level');
  for (const n of levels(1, MAX_LEVEL)) {
    const b = board(n);
    assert.equal(decodeBoard(encodeBoard(b), n).arrows.length, b.arrows.length);
    assert.equal(encodeBoard(decodeBoard(encodeBoard(b), n)), encodeBoard(b), `level ${n}`);
  }
});

test('1b. pinned: the stored levels only change on purpose', () => {
  const r = mulberry32(12345);
  assert.deepEqual([r(), r(), r()].map((x) => x.toFixed(10)), ['0.9797282678', '0.3067522645', '0.4842054215']);
  // Fingerprint of all 100 boards. If you regenerated levels.js on purpose,
  // bump LEVELS_VERSION in tools/give-way-levels.mjs and update this number.
  assert.equal(LEVELS_VERSION, 1);
  const all = levels(1, MAX_LEVEL).map((n) => encodeBoard(board(n))).join('|');
  assert.equal(hashString(all), 4269016526);
});

test('2. solvable: every level clears greedily', () => {
  for (const n of levels(1, MAX_LEVEL)) assert.ok(isSolvable(board(n)), `level ${n}`);
});

test('2b. no deadlock: levels 1-100, 20 random play orders each', () => {
  const rng = mulberry32(2024);
  for (const n of levels(1, 100)) for (let i = 0; i < 20; i++) randomPlay(board(n), rng);
});

test('2d. no deadlock in items mode: levels 1-100, 20 random games each', () => {
  const rng = mulberry32(777);
  for (const n of levels(1, 100)) for (let i = 0; i < 20; i++) randomPlay(board(n), rng, { items: true });
});

test('3. structure: every arrow on every level is well formed', () => {
  for (const n of levels(1, MAX_LEVEL)) {
    const b = board(n);
    const seen = new Set();
    for (const a of b.arrows) {
      const where = `level ${n} arrow ${a.id}`;
      assert.ok(a.cells.length >= 2, `${where}: too short`);
      const own = new Set();
      for (const [i, c] of a.cells.entries()) {
        assert.ok(c.x >= 0 && c.y >= 0 && c.x < b.W && c.y < b.H, `${where}: off board`);
        const key = `${c.x},${c.y}`;
        assert.ok(!own.has(key), `${where}: crosses itself`);
        assert.ok(!seen.has(key), `${where}: overlaps another arrow`);
        own.add(key);
        seen.add(key);
        if (i) {
          const p = a.cells[i - 1];
          assert.equal(Math.abs(c.x - p.x) + Math.abs(c.y - p.y), 1, `${where}: not 4-connected`);
        }
      }
      const h = head(a);
      const prev = a.cells[a.cells.length - 2];
      assert.deepEqual({ x: h.x - prev.x, y: h.y - prev.y }, { ...DIRS[a.dir] }, `${where}: head disagrees with dir`);
      for (const c of rayCells(b.W, b.H, a)) assert.ok(!own.has(`${c.x},${c.y}`), `${where}: blocks itself`);
    }
    assert.deepEqual(b.arrows.map((a) => a.id), b.arrows.map((_, i) => i), `level ${n}: ids`);
  }
});

test('4. performance: every level loads in under 20 ms', () => {
  let worst = 0;
  for (const n of levels(1, MAX_LEVEL)) {
    const t0 = performance.now();
    loadLevel(n);
    worst = Math.max(worst, performance.now() - t0);
  }
  console.log(`        worst ${worst.toFixed(2)} ms`);
  assert.ok(worst < 20, `slowest level took ${worst.toFixed(1)} ms`);
});

test('5. sizes: 8x12 to level 20, 18x26 to 50, 22x30 to 100', () => {
  assert.equal(MAX_LEVEL, 100);
  for (const n of levels(1, MAX_LEVEL)) {
    const want = n <= 20 ? [8, 12] : n <= 50 ? [18, 26] : [22, 30];
    assert.deepEqual([board(n).W, board(n).H], want, `level ${n}`);
    assert.deepEqual([difficulty(n).W, difficulty(n).H], want, `level ${n} band`);
  }
});

test('5b. fill: every level covers at least 90% of the board', () => {
  const low = levels(1, MAX_LEVEL).filter((n) => coverage(board(n)) < 0.9);
  assert.deepEqual(low, [], 'under 90% filled (rerun tools/give-way-levels.mjs)');
  const fills = levels(1, MAX_LEVEL).map((n) => coverage(board(n)));
  console.log(`        fill ${Math.round(100 * Math.min(...fills))}%-${Math.round(100 * Math.max(...fills))}%`);
});

test('5c. shape: arrows are long and almost never point straight at a tail', () => {
  const report = new Map();
  for (const n of levels(1, MAX_LEVEL)) {
    const sh = shapeStats(board(n));
    const band = difficulty(n);
    assert.ok(sh.avgLen >= band.minAvgLen, `level ${n}: mean length ${sh.avgLen.toFixed(1)} < ${band.minAvgLen}`);
    assert.ok(sh.chain <= MAX_CHAIN, `level ${n}: ${Math.round(100 * sh.chain)}% head to tail`);
    const r = report.get(band.band) ?? { len: 0, chain: 0, n: 0 };
    report.set(band.band, { len: r.len + sh.avgLen, chain: r.chain + sh.chain, n: r.n + 1 });
  }
  for (const [band, r] of report) {
    console.log(`        ${band.padEnd(6)} mean length ${(r.len / r.n).toFixed(1)}, head to tail ${(100 * r.chain / r.n).toFixed(1)}%`);
  }
});

test('6. difficulty: every level lands inside its band targets', () => {
  const pct = (x) => `${Math.round(100 * x)}%`.padStart(5);
  console.log('        level   size  arrows  open0 open20 open50');
  const misses = [];
  for (const n of levels(1, MAX_LEVEL)) {
    const d = difficultyStats(board(n));
    if (targetMiss(d, difficulty(n).targets) > 0) misses.push(n);
    if ([1, 5, 6, 20, 21, 50, 51, 100].includes(n) || misses.at(-1) === n) {
      console.log(`        ${String(n).padStart(5)} ${`${d.W}x${d.H}`.padStart(6)} ${String(d.arrows).padStart(7)} ${pct(d.open0)}  ${pct(d.open20)}  ${pct(d.open50)}`);
    }
  }
  assert.deepEqual(misses, [], 'outside targets (rerun tools/give-way-levels.mjs)');
  assert.deepEqual(difficultyStats(board(7)), difficultyStats(board(7)), 'deterministic');
});


console.log('\nGenerator');

test('7. custom boards: every band generates a solvable board that meets its targets', () => {
  for (const band of BANDS) {
    const params = difficulty(band.id);
    const t0 = performance.now();
    const found = searchBoard(params, (v) => customSeed('test', v), { maxVariants: 3000 });
    const ms = performance.now() - t0;
    console.log(`        ${band.id.padEnd(6)} ${params.W}x${params.H}  ${found.tried} tries  ${(ms / 1000).toFixed(1)} s`);
    assert.equal(found.miss, 0, `${band.id}: no board met the targets`);
    assert.ok(isSolvable(found.board), `${band.id}: unsolvable`);
    assert.ok(coverage(found.board) >= params.minFill, `${band.id}: under-filled`);
  }
});

test('7b. custom boards are reproducible from their key', () => {
  const params = difficulty('easy');
  const a = searchBoard(params, (v) => customSeed('abc', v), { maxVariants: 500 });
  const b = searchBoard(params, (v) => customSeed('abc', v), { maxVariants: 500 });
  assert.equal(encodeBoard(a.board), encodeBoard(b.board));
});


console.log('\nRules');

/* 5x5:  arrow 0 points right along row 2 into arrow 1, which points up and out.
         arrow 2 sits alone at the bottom pointing left. */
const small = () =>
  handBoard(5, 5, [
    { dir: 'right', cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }] },
    { dir: 'up', cells: [{ x: 3, y: 3 }, { x: 3, y: 2 }] },
    { dir: 'left', cells: [{ x: 4, y: 4 }, { x: 3, y: 4 }] },
  ]);

test('2c. canExit follows the ray and frees up after removals', () => {
  const pos = createPosition(small());
  assert.equal(canExit(pos, 0), false);
  assert.equal(canExit(pos, 1), true);
  assert.equal(canExit(pos, 2), true);
  removeArrow(pos, 1);
  assert.equal(canExit(pos, 0), true);
  assert.deepEqual(exitableIds(pos), [0, 2]);
});

test('2c. a blocked tap costs a life and leaves the board unchanged', () => {
  const g = rules.createGame(small());
  const ev = rules.tap(g, 0, 0);
  assert.equal(ev.type, 'blocked');
  assert.equal(g.lives, 2);
  assert.equal(rules.remainingCount(g), 3);
});

test('2c. repeat taps during the red second cost nothing', () => {
  const g = rules.createGame(small());
  rules.tap(g, 0, 0);
  assert.equal(rules.tap(g, 0, 500).type, 'ignored');
  assert.equal(rules.tap(g, 0, 999).type, 'ignored');
  assert.equal(g.lives, 2);
  assert.equal(rules.tap(g, 0, 1000).type, 'blocked');
  assert.equal(g.lives, 1);
});

test('2c. the third mistake loses the level, and then nothing responds', () => {
  const g = rules.createGame(small());
  rules.tap(g, 0, 0);
  rules.tap(g, 0, 2000);
  const ev = rules.tap(g, 0, 4000);
  assert.equal(ev.lost, true);
  assert.equal(g.status, 'lost');
  assert.equal(rules.tap(g, 1, 9000).type, 'ignored');
  assert.equal(rules.useHint(g, 9000).type, 'ignored');
});

test('2c. clearing the board wins and stops the clock', () => {
  const g = rules.createGame(small());
  assert.equal(rules.elapsedMs(g, 5000), 0, 'clock waits for the first action');
  rules.tap(g, 1, 1000);
  rules.tap(g, 2, 2000);
  const ev = rules.tap(g, 0, 4500);
  assert.equal(ev.won, true);
  assert.equal(g.status, 'won');
  assert.equal(rules.elapsedMs(g, 99999), 3500);
  assert.deepEqual(rules.result(g), { livesLeft: 3, hintsUsed: 0, timeSec: 3 });
});

test('2c. hints: three per level, stable choice, cleared by a tap, 0 disables', () => {
  const g = rules.createGame(small());
  const h1 = rules.useHint(g, 0);
  assert.deepEqual(h1, { type: 'hint', id: 1 }, 'topmost exitable head first');
  assert.equal(rules.useHint(g, 100).type, 'ignored', 'no charge while a hint is showing');
  assert.equal(g.hintsLeft, 2);
  const ev = rules.tap(g, 2, 200);
  assert.equal(ev.hintCleared, true);
  assert.equal(g.hint, null);
  assert.equal(rules.useHint(g, 300).type, 'hint');
  assert.equal(rules.useHint(g, 3300 + 1).type, 'hint', 'expires after 3 s');
  assert.equal(g.hintsLeft, 0);
  assert.equal(rules.useHint(g, 99999).type, 'none-left');
  assert.equal(g.hintsUsed, 3);
  assert.equal(g.lives, 3, 'hints never cost lives');
});

test('2c. restarting means a fresh game: lives and hints restored', () => {
  const b = small();
  const g = rules.createGame(b);
  rules.tap(g, 0, 0);
  rules.useHint(g, 0);
  const again = rules.createGame(b);
  assert.equal(again.lives, rules.LIVES);
  assert.equal(again.hintsLeft, rules.HINTS);
});


console.log('\nItems');

test('2e. bomb covers a clipped 3x3 square', () => {
  const b = { W: 5, H: 5 };
  assert.deepEqual(bombArea(b, { x: 2, y: 2 }), { x0: 1, y0: 1, x1: 3, y1: 3 });
  assert.deepEqual(bombArea(b, { x: 0, y: 0 }), { x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.deepEqual(bombArea(b, { x: 4, y: 4 }), { x0: 3, y0: 3, x1: 4, y1: 4 });
});

test('2e. one cell in range removes the whole arrow; the rest are untouched', () => {
  const b = handBoard(6, 6, [
    { dir: 'right', cells: [{ x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }] },
    { dir: 'up', cells: [{ x: 5, y: 1 }, { x: 5, y: 0 }] },
    { dir: 'down', cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }] },
  ]);
  assert.deepEqual(ITEMS.bomb.affected(b, { x: 4, y: 4 }), [0]);
  assert.deepEqual(ITEMS.bomb.affected(b, { x: 5, y: 0 }), [1]);
  assert.deepEqual(ITEMS.bomb.affected(b, { x: 0, y: 0 }), [2]);
  assert.deepEqual(ITEMS.bomb.affected(b, { x: 2, y: 2 }), []);
});

test('2e. affected() does not modify the board it is given', () => {
  const b = loadLevel(12);
  const plain = JSON.parse(JSON.stringify(b));
  const view = JSON.parse(JSON.stringify(b)); // unfrozen copy, so a write would stick
  for (let y = 0; y < b.H; y++) for (let x = 0; x < b.W; x++) ITEMS.bomb.affected(view, { x, y });
  assert.deepEqual(view, plain);
});

test('2e. an empty blast is free; a real one is charged and never costs a life', () => {
  const g = rules.createGame(
    handBoard(7, 7, [{ dir: 'up', cells: [{ x: 6, y: 1 }, { x: 6, y: 0 }] }]),
    'items'
  );
  assert.equal(rules.useItem(g, 'bomb', { x: 1, y: 5 }, 0).type, 'empty');
  assert.equal(g.items.bomb, 1, 'not charged');
  const ev = rules.useItem(g, 'bomb', { x: 5, y: 1 }, 10);
  assert.equal(ev.type, 'used');
  assert.deepEqual(ev.ids, [0]);
  assert.equal(ev.won, true, 'clearing the board with a bomb wins');
  assert.equal(g.items.bomb, 0);
  assert.equal(g.lives, rules.LIVES);
});

test('2e. bombing the hinted or red arrow clears that state', () => {
  const g = rules.createGame(small(), 'items');
  rules.tap(g, 0, 0); // arrow 0 turns red
  rules.useHint(g, 10); // hints arrow 1
  const ev = rules.useItem(g, 'bomb', { x: 2, y: 2 }, 20); // covers both
  assert.deepEqual(ev.ids.sort(), [0, 1]);
  assert.equal(ev.hintCleared, true);
  assert.equal(g.errorUntil.size, 0);
  assert.equal(g.hint, null);
});

test('2e. items do nothing in basic mode', () => {
  const g = rules.createGame(small(), 'basic');
  assert.equal(rules.useItem(g, 'bomb', { x: 2, y: 2 }, 0).type, 'ignored');
  assert.equal(rules.remainingCount(g), 3);
});


console.log('\nSaves');

test('garbage in storage falls back to defaults', () => {
  for (const raw of [null, '', '{', '[]', '"x"', '42', '{"currentLevel":"7"}']) {
    assert.deepEqual(saves.parseSave(raw).save, saves.defaultSave(), String(raw));
  }
});

test('fields are validated one by one', () => {
  const { save } = saves.parseSave(
    JSON.stringify({
      currentLevel: 7, maxUnlocked: 8, mode: 'items',
      completed: { basic: { 1: { livesLeft: 3, hintsUsed: 0, bestTimeSec: 41 }, x: {}, 2: { livesLeft: 9 } } },
    })
  );
  assert.equal(save.currentLevel, 7);
  assert.equal(save.maxUnlocked, 8);
  assert.equal(save.mode, 'items');
  assert.deepEqual(save.completed.basic, { 1: { livesLeft: 3, hintsUsed: 0, bestTimeSec: 41 } });
});

test('an old flat "completed" map migrates to basic mode', () => {
  const { save } = saves.parseSave(JSON.stringify({ completed: { 3: { livesLeft: 2, hintsUsed: 1 } } }));
  assert.deepEqual(save.completed, { basic: { 3: { livesLeft: 2, hintsUsed: 1 } }, items: {} });
});

test('a change to the stored levels is reported', () => {
  assert.equal(saves.parseSave(JSON.stringify({ levelsVersion: LEVELS_VERSION })).levelsChanged, false);
  assert.equal(saves.parseSave(JSON.stringify({ levelsVersion: LEVELS_VERSION + 1 })).levelsChanged, true);
});

test('wins keep the best record, the best time separately, and unlock N+1', () => {
  let s = saves.defaultSave();
  let out = saves.recordWin(s, 'basic', 5, { livesLeft: 2, hintsUsed: 0, timeSec: 40 });
  s = out.save;
  assert.equal(s.maxUnlocked, 6);
  assert.equal(out.newBestTime, false, 'a first clear is not a "new best"');
  out = saves.recordWin(s, 'basic', 5, { livesLeft: 1, hintsUsed: 0, timeSec: 30 });
  s = out.save;
  assert.equal(out.newBestTime, true);
  assert.deepEqual(s.completed.basic[5], { livesLeft: 2, hintsUsed: 0, bestTimeSec: 30 });
  s = saves.recordWin(s, 'basic', 5, { livesLeft: 2, hintsUsed: 0, timeSec: 50 }).save;
  assert.equal(s.completed.basic[5].bestTimeSec, 30);
  s = saves.recordWin(s, 'items', 2, { livesLeft: 3, hintsUsed: 0, itemsUsed: 1, timeSec: 9 }).save;
  assert.equal(s.maxUnlocked, 6, 'modes share maxUnlocked');
  assert.deepEqual(s.completed.items[2], { livesLeft: 3, hintsUsed: 0, itemsUsed: 1, bestTimeSec: 9 });
});

test('two tabs: merging keeps the better of both, and this tab\'s place', () => {
  const a = saves.defaultSave();
  a.maxUnlocked = 9;
  a.currentLevel = 8;
  a.completed.basic = { 3: { livesLeft: 3, hintsUsed: 0, bestTimeSec: 50 }, 5: { livesLeft: 1, hintsUsed: 2 } };
  const b = saves.defaultSave();
  b.maxUnlocked = 4;
  b.currentLevel = 2;
  b.mode = 'items';
  b.completed.basic = { 3: { livesLeft: 2, hintsUsed: 0, bestTimeSec: 40 } };
  const m = saves.mergeSaves(a, b); // a is in storage, b is this tab
  assert.equal(m.maxUnlocked, 9);
  assert.equal(m.currentLevel, 2);
  assert.equal(m.mode, 'items');
  assert.deepEqual(m.completed.basic[3], { livesLeft: 3, hintsUsed: 0, bestTimeSec: 40 });
  assert.deepEqual(m.completed.basic[5], { livesLeft: 1, hintsUsed: 2 });
});

test('perfect is basic mode, all lives, no hints', () => {
  assert.equal(saves.isPerfect('basic', { livesLeft: 3, hintsUsed: 0 }), true);
  assert.equal(saves.isPerfect('basic', { livesLeft: 3, hintsUsed: 1 }), false);
  assert.equal(saves.isPerfect('items', { livesLeft: 3, hintsUsed: 0 }), false);
});

test('?level= parsing', () => {
  assert.equal(saves.parseLevelParam('20'), 20);
  for (const bad of [null, '', '0', '-3', '2.5', '1e3', 'abc', String(MAX_LEVEL + 1), '00012345']) {
    assert.equal(saves.parseLevelParam(bad), null, String(bad));
  }
});

test('time formatting', () => {
  assert.equal(saves.formatTime(0), '0:00');
  assert.equal(saves.formatTime(9.9), '0:09');
  assert.equal(saves.formatTime(83), '1:23');
  assert.equal(saves.formatTime(3600), '60:00');
});


console.log(`\n${count - failures}/${count} passed`);
process.exitCode = failures ? 1 : 0;
