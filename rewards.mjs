// 端末の中だけに残す設定と、ごほうびシールの記録。名前・成績を外へ送らない。
import {allEditions} from './shapes.mjs?v=20261017a';
import {TOL, DEFAULT_TOL, PICKUP, DEFAULT_PICKUP, A4_CHOICES, DEFAULT_A4} from './engine.mjs?v=20261017a';
import {SECONDS_CHOICES, DEFAULT_SECONDS, TRIPS_CHOICES} from './longtone.mjs?v=20261017a';

// 初段の保存キー（violin-shodan-v1）とは別の頭にする。同じドメインに並ぶため。
export const STORAGE_KEY = 'shodan-kids:v1';
export const BUDDIES = Object.freeze(['fluffy', 'dino', 'dog']);

export const DEFAULTS = Object.freeze({
  v: 1,
  name: '',
  buddy: 'fluffy',
  tol: DEFAULT_TOL,
  pickup: DEFAULT_PICKUP,
  a4: DEFAULT_A4,
  volume: 85,
  autoRef: true,       // 外れたあとにお手本を1回鳴らす
  mic: true,           // false のときはマイクなし（「できた」を押して進む）
  guide: true,         // ロングトーンのお手本の音
  seconds: DEFAULT_SECONDS,
  trips: 1,
  stickers: {}
});

export function normalize(raw) {
  const s = {...DEFAULTS, stickers: {}};
  if (!raw || typeof raw !== 'object') return s;
  if (typeof raw.name === 'string') s.name = raw.name.slice(0, 20);
  if (BUDDIES.includes(raw.buddy)) s.buddy = raw.buddy;
  if (Object.prototype.hasOwnProperty.call(TOL, raw.tol)) s.tol = raw.tol;
  if (Object.prototype.hasOwnProperty.call(PICKUP, raw.pickup)) s.pickup = raw.pickup;
  if (A4_CHOICES.includes(raw.a4)) s.a4 = raw.a4;
  if (Number.isFinite(raw.volume)) s.volume = Math.max(20, Math.min(100, Math.round(raw.volume)));
  if (typeof raw.autoRef === 'boolean') s.autoRef = raw.autoRef;
  if (typeof raw.mic === 'boolean') s.mic = raw.mic;
  if (typeof raw.guide === 'boolean') s.guide = raw.guide;
  if (SECONDS_CHOICES.includes(raw.seconds)) s.seconds = raw.seconds;
  if (TRIPS_CHOICES.includes(raw.trips)) s.trips = raw.trips;
  const valid = new Set(allEditions().map(e => e.key));
  if (raw.stickers && typeof raw.stickers === 'object') {
    for (const [key, v] of Object.entries(raw.stickers)) {
      if (!valid.has(key) || !v || typeof v !== 'object') continue;
      s.stickers[key] = {
        n: Number.isInteger(v.n) && v.n > 0 ? Math.min(v.n, 9999) : 1,
        stars: [1, 2, 3].includes(v.stars) ? v.stars : 1,
        at: typeof v.at === 'string' ? v.at.slice(0, 10) : ''
      };
    }
  }
  return s;
}

export function load(storage) {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return normalize(text ? JSON.parse(text) : null);
  } catch { return normalize(null); }
}
export function save(storage, state) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

// シールをはる。初めてなら isNew=true。星は多い方を残す。
export function awardSticker(state, key, stars, dateText) {
  const valid = allEditions().some(e => e.key === key);
  if (!valid) throw new RangeError(`unknown edition: ${key}`);
  const prev = state.stickers[key];
  const next = {n: (prev?.n || 0) + 1, stars: Math.max(prev?.stars || 1, stars), at: prev?.at || dateText};
  return {isNew: !prev, state: {...state, stickers: {...state.stickers, [key]: next}}};
}
export const stickerCount = state => Object.keys(state.stickers).length;
export const stickerTotal = () => allEditions().length;
