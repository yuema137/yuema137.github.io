/* Give Way — generates a custom board off the main thread.
 *
 * Message in:  { band, key }   band id from BANDS, key = any short string
 * Messages out: { type: 'progress', tried }  every 25 layouts tried
 *               { type: 'done', text, met }   the board in text format, and
 *                                             whether it met the band's targets
 *
 * The same band and key always give the same board, so a custom board can be
 * shared as a link and rebuilt by whoever opens it.
 */

import { difficulty, customSeed, searchBoard, encodeBoard } from './generator.js';

self.onmessage = (e) => {
  const { band, key } = e.data;
  const found = searchBoard(difficulty(band), (v) => customSeed(key, v), {
    maxVariants: 20000,
    goodEnough: 1, // any board inside the targets will do; no need to centre it
    onProgress: (tried) => self.postMessage({ type: 'progress', tried }),
  });
  self.postMessage({ type: 'done', text: encodeBoard(found.board), met: found.miss === 0 });
};
