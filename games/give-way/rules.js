/* Give Way — the in-level state machine.
 *
 * Pure logic: no DOM and no timers. Anything time-dependent takes `now` (ms,
 * any monotonic clock) as an argument, so tests can drive it directly. The UI
 * owns animation and colour; this module owns what is true.
 *
 * Every action returns an event object describing what happened, and mutates
 * the game state in place.
 */

import { createPosition, arrowAtCell, canExit, exitableIds, removeArrow } from './generator.js';
import { ITEMS, ITEM_IDS } from './items.js';

export const LIVES = 3;
export const HINTS = 3;
export const ERROR_MS = 1000; // how long a blocked arrow stays red and ignores taps
export const HINT_MS = 3000; // longest a hint stays highlighted
export const MODES = Object.freeze(['basic', 'items']);

export function createGame(board, mode = 'basic') {
  return {
    board,
    mode,
    pos: createPosition(board),
    lives: LIVES,
    hintsLeft: HINTS,
    hintsUsed: 0,
    items: mode === 'items' ? Object.fromEntries(ITEM_IDS.map((id) => [id, ITEMS[id].perLevel])) : {},
    itemsUsed: 0,
    status: 'playing', // 'playing' | 'won' | 'lost'
    errorUntil: new Map(), // arrow id -> time its red state ends
    hint: null, // { id, until }
    actions: 0, // taps, hints and items so far; > 0 means the level is in progress
    startedAt: null, // the clock starts at the first action, not when the board appears
    finishedAt: null,
  };
}

export function arrowAt(game, x, y) {
  return arrowAtCell(game.pos, x, y);
}

export function remainingCount(game) {
  return game.pos.remaining.size;
}

/* The board as items see it: only the arrows still in play. */
export function boardView(game) {
  const { W, H, byId, remaining } = game.pos;
  return { W, H, arrows: [...remaining].sort((a, b) => a - b).map((id) => byId.get(id)) };
}

/* True when arrows remain but none can exit. With a correct generator this
   never happens; the UI logs it loudly if it does. */
export function isDeadlocked(game) {
  return game.pos.remaining.size > 0 && exitableIds(game.pos).length === 0;
}

function act(game, now) {
  game.actions++;
  if (game.startedAt === null) game.startedAt = now;
}

/* Milliseconds on the clock: 0 before the first action, frozen once won. */
export function elapsedMs(game, now) {
  if (game.startedAt === null) return 0;
  return Math.max(0, (game.finishedAt ?? now) - game.startedAt);
}

function afterRemoval(game, now) {
  if (game.pos.remaining.size === 0) {
    game.status = 'won';
    game.finishedAt = now;
    return { won: true, deadlock: false };
  }
  return { won: false, deadlock: isDeadlocked(game) };
}

/* The player tapped arrow `id`. */
export function tap(game, id, now) {
  if (game.status !== 'playing') return { type: 'ignored', reason: 'over' };
  if (!game.pos.remaining.has(id)) return { type: 'ignored', reason: 'gone' };

  // Tapping any arrow ends a hint.
  const hadHint = game.hint !== null;
  game.hint = null;

  const until = game.errorUntil.get(id);
  if (until !== undefined && now < until) {
    return { type: 'ignored', reason: 'cooling', id, hintCleared: hadHint };
  }
  game.errorUntil.delete(id);
  act(game, now);

  if (canExit(game.pos, id)) {
    removeArrow(game.pos, id);
    return { type: 'exit', id, hintCleared: hadHint, ...afterRemoval(game, now) };
  }

  // Blocked: the board does not change, so a mistake cannot cause a deadlock.
  game.lives--;
  game.errorUntil.set(id, now + ERROR_MS);
  if (game.lives <= 0) game.status = 'lost';
  return { type: 'blocked', id, livesLeft: game.lives, lost: game.status === 'lost', hintCleared: hadHint };
}

export function hintActive(game, now) {
  return game.hint !== null && now < game.hint.until && game.pos.remaining.has(game.hint.id);
}

export function useHint(game, now) {
  if (game.status !== 'playing') return { type: 'ignored', reason: 'over' };
  if (hintActive(game, now)) return { type: 'ignored', reason: 'active' };
  if (game.hintsLeft <= 0) return { type: 'none-left' };
  const ids = exitableIds(game.pos);
  if (!ids.length) return { type: 'deadlock' }; // not charged
  game.hintsLeft--;
  game.hintsUsed++;
  act(game, now);
  game.hint = { id: ids[0], until: now + HINT_MS };
  return { type: 'hint', id: ids[0] };
}

export function clearHint(game) {
  game.hint = null;
}

/* Ids an item would remove at target, without using it. */
export function previewItem(game, itemId, target) {
  const item = ITEMS[itemId];
  if (!item || game.mode !== 'items') return [];
  return item.affected(boardView(game), target);
}

export function useItem(game, itemId, target, now) {
  if (game.status !== 'playing') return { type: 'ignored', reason: 'over' };
  const item = ITEMS[itemId];
  if (!item || game.mode !== 'items') return { type: 'ignored', reason: 'unavailable' };
  if (!(game.items[itemId] > 0)) return { type: 'none-left' };

  const ids = item.affected(boardView(game), target);
  if (!ids.length) return { type: 'empty' }; // not charged

  let hintCleared = false;
  for (const id of ids) {
    removeArrow(game.pos, id);
    game.errorUntil.delete(id);
    if (game.hint && game.hint.id === id) {
      game.hint = null;
      hintCleared = true;
    }
  }
  game.items[itemId]--;
  game.itemsUsed++;
  act(game, now);
  return { type: 'used', ids, hintCleared, ...afterRemoval(game, now) };
}

/* What gets recorded when the level is won. Time is in whole seconds. */
export function result(game) {
  const r = {
    livesLeft: game.lives,
    hintsUsed: game.hintsUsed,
    timeSec: Math.floor(elapsedMs(game, game.finishedAt ?? 0) / 1000),
  };
  if (game.mode === 'items') r.itemsUsed = game.itemsUsed;
  return r;
}
