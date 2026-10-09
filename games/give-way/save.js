/* Give Way — save-file format, validation and migration.
 *
 * Pure: takes and returns plain objects. Reading and writing localStorage is
 * the UI's job (and is wrapped in try/catch there). Anything malformed is
 * replaced with defaults rather than allowed to break the page.
 */

import { MAX_LEVEL, isValidLevel } from './generator.js';
import { LEVELS_VERSION } from './levels.js';
import { LIVES, MODES } from './rules.js';

export const SAVE_KEY = 'give-way:save';
export const SAVE_VERSION = 1;

export function defaultSave() {
  return {
    version: SAVE_VERSION,
    levelsVersion: LEVELS_VERSION,
    currentLevel: 1,
    maxUnlocked: 1,
    mode: 'basic',
    completed: { basic: {}, items: {} },
  };
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v, max = Infinity) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);

function cleanRecord(raw, mode) {
  if (!isObject(raw)) return null;
  const livesLeft = count(raw.livesLeft, LIVES);
  const hintsUsed = count(raw.hintsUsed);
  if (!livesLeft || hintsUsed === null) return null;
  const rec = { livesLeft, hintsUsed };
  if (mode === 'items') rec.itemsUsed = count(raw.itemsUsed) ?? 0;
  const best = count(raw.bestTimeSec);
  if (best !== null) rec.bestTimeSec = best;
  return rec;
}

function cleanRecords(raw, mode) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const level = Number(key);
    const rec = cleanRecord(value, mode);
    if (isValidLevel(level) && String(level) === key && rec) out[key] = rec;
  }
  return out;
}

/* Never throws. Returns { save, levelsChanged }. */
export function parseSave(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { save: defaultSave(), levelsChanged: false };
  }
  if (!isObject(raw)) return { save: defaultSave(), levelsChanged: false };

  const save = defaultSave();
  if (isValidLevel(raw.currentLevel)) save.currentLevel = raw.currentLevel;
  if (isValidLevel(raw.maxUnlocked)) save.maxUnlocked = raw.maxUnlocked;
  if (MODES.includes(raw.mode)) save.mode = raw.mode;

  const c = raw.completed;
  if (isObject(c) && (isObject(c.basic) || isObject(c.items))) {
    save.completed.basic = cleanRecords(c.basic, 'basic');
    save.completed.items = cleanRecords(c.items, 'items');
  } else if (isObject(c)) {
    // Older format: one flat map of level -> record. It predates items mode.
    save.completed.basic = cleanRecords(c, 'basic');
  }

  const levelsChanged = Number.isInteger(raw.levelsVersion) && raw.levelsVersion !== LEVELS_VERSION;
  return { save, levelsChanged };
}

/* More lives left wins; on a tie, fewer hints. */
export function isBetter(a, b) {
  if (!b) return true;
  return a.livesLeft > b.livesLeft || (a.livesLeft === b.livesLeft && a.hintsUsed < b.hintsUsed);
}

/* Perfect clears are only awarded in basic mode. */
export function isPerfect(mode, rec) {
  return mode === 'basic' && !!rec && rec.livesLeft === LIVES && rec.hintsUsed === 0;
}

/* Returns { save, newBestTime }. Both modes share maxUnlocked; records are
   per mode. The record keeps the best result by lives and hints, and,
   separately, the fastest time of any clear. */
export function recordWin(save, mode, level, result) {
  const next = structuredClone(save);
  next.maxUnlocked = Math.min(MAX_LEVEL, Math.max(next.maxUnlocked, level + 1));
  const prev = next.completed[mode][level];
  const { timeSec, ...rec } = result;
  const prevBest = prev?.bestTimeSec;
  const newBestTime = Number.isInteger(timeSec) && (prevBest === undefined || timeSec < prevBest);
  const kept = isBetter(rec, prev) ? { ...rec } : { ...prev };
  if (newBestTime) kept.bestTimeSec = timeSec;
  else if (prevBest !== undefined) kept.bestTimeSec = prevBest;
  next.completed[mode][level] = kept;
  return { save: next, newBestTime: newBestTime && prevBest !== undefined };
}

/* 83 -> "1:23" */
export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* `?level=` value -> level number, or null if it is not a valid level. */
export function parseLevelParam(value) {
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value)) return null;
  const n = Number(value);
  return isValidLevel(n) ? n : null;
}
