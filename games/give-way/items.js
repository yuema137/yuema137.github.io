/* Give Way — item registry for items mode.
 *
 * HARD RULE: an item may only REMOVE arrows. It must never add, move, extend
 * or turn one. Removing arrows only frees cells, so a solvable board stays
 * solvable after any item (see removeArrow in generator.js). An item that
 * breaks this rule needs its own no-deadlock argument before it ships.
 *
 * Items never touch the board themselves. Each is a set of pure functions of
 * `board` ({ W, H, arrows } holding only the arrows still in play) and a
 * target, in board coordinates:
 *   affected(board, target)  ids of the arrows the item would remove
 *   area(board, target)      the cells it covers, { x0, y0, x1, y1 }, for the
 *                            aiming preview
 * The rules engine does the removal. Any arrow touched is removed whole:
 * cutting an arrow in two would leave pieces whose direction is ambiguous.
 *
 * targeting says what the player picks: 'cell' (target = { x, y }) or 'line'
 * (target = { x, y, axis }, axis 'row' or 'col', the line through that cell).
 *
 * To add an item, add an entry here; the UI builds its button from it.
 */

const BOMB_RADIUS = 1;

/* The square covered by a bomb at target, clipped to the board. */
export function bombArea(board, target, radius = BOMB_RADIUS) {
  return {
    x0: Math.max(0, target.x - radius),
    y0: Math.max(0, target.y - radius),
    x1: Math.min(board.W - 1, target.x + radius),
    y1: Math.min(board.H - 1, target.y + radius),
  };
}

/* The row or column through target. */
export function lineArea(board, target) {
  return target.axis === 'col'
    ? { x0: target.x, y0: 0, x1: target.x, y1: board.H - 1 }
    : { x0: 0, y0: target.y, x1: board.W - 1, y1: target.y };
}

const touching = (board, a) =>
  board.arrows
    .filter((arrow) => arrow.cells.some((c) => c.x >= a.x0 && c.x <= a.x1 && c.y >= a.y0 && c.y <= a.y1))
    .map((arrow) => arrow.id);

export const ITEMS = Object.freeze({
  bomb: Object.freeze({
    id: 'bomb',
    name: 'Bomb',
    perLevel: 1,
    targeting: 'cell',
    radius: BOMB_RADIUS,
    aimHint: 'Pick a spot. Every arrow touching the 3×3 square is removed.',
    emptyHint: 'Nothing to hit here. Pick a spot with arrows in it.',
    area: (board, target) => bombArea(board, target),
    affected: (board, target) => touching(board, bombArea(board, target)),
  }),
  scissors: Object.freeze({
    id: 'scissors',
    name: 'Scissors',
    perLevel: 1,
    targeting: 'cell',
    aimHint: 'Pick an arrow to cut. It is removed whole.',
    emptyHint: 'Nothing to cut here. Pick an arrow.',
    area: (board, target) => ({ x0: target.x, y0: target.y, x1: target.x, y1: target.y }),
    affected: (board, target) => touching(board, { x0: target.x, y0: target.y, x1: target.x, y1: target.y }),
  }),
  sweep: Object.freeze({
    id: 'sweep',
    name: 'Sweep',
    perLevel: 1,
    targeting: 'line',
    aimHint: 'Pick a line. Every arrow crossing it is removed.',
    emptyHint: 'No arrows in that line. Pick another.',
    area: (board, target) => lineArea(board, target),
    affected: (board, target) => touching(board, lineArea(board, target)),
  }),
});

export const ITEM_IDS = Object.freeze(Object.keys(ITEMS));
