/* Give Way — item registry for items mode.
 *
 * HARD RULE: an item may only REMOVE arrows. It must never add, move, extend
 * or turn one. Removing arrows only frees cells, so a solvable board stays
 * solvable after any item (see removeArrow in generator.js). An item that
 * breaks this rule needs its own no-deadlock argument before it ships.
 *
 * Items never touch the board themselves. affected(board, target) is a pure
 * function returning the ids to remove; the rules engine does the removal.
 * `board` is { W, H, arrows } holding only the arrows still in play.
 *
 * To add an item, add an entry here. targeting is 'cell' when the player picks
 * a cell first, or 'none' when the item applies immediately.
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

export const ITEMS = Object.freeze({
  bomb: Object.freeze({
    id: 'bomb',
    name: 'Bomb',
    perLevel: 1,
    targeting: 'cell',
    radius: BOMB_RADIUS,
    /* Any arrow with at least one cell in range is removed whole. Cutting an
       arrow in two would leave pieces whose direction is ambiguous. */
    affected(board, target) {
      const a = bombArea(board, target, BOMB_RADIUS);
      return board.arrows
        .filter((arrow) =>
          arrow.cells.some((c) => c.x >= a.x0 && c.x <= a.x1 && c.y >= a.y0 && c.y <= a.y1)
        )
        .map((arrow) => arrow.id);
    },
  }),
});

export const ITEM_IDS = Object.freeze(Object.keys(ITEMS));
