// 指の関係値（形）・弦・色・音名・曲データ。調の名前は持たない。
// 初段の考え方: 音の高さは「弦」と「指のあいだの半音の数（形）」で決まる。
// 形23 = 0→1が2半音、1→2が2半音、2→3が1半音（2と3がくっつく）、3→4が2半音。

export const STRINGS = Object.freeze([
  {id:'G', kana:'ソ', color:'blue',   colorName:'あお',     midi:55},
  {id:'D', kana:'レ', color:'orange', colorName:'オレンジ', midi:62},
  {id:'A', kana:'ラ', color:'red',    colorName:'あか',     midi:69},
  {id:'E', kana:'ミ', color:'green',  colorName:'みどり',   midi:76}
]);
export const stringById = id => STRINGS.find(s => s.id === id) || null;
// 左へ行くほど低い弦。となりの高い弦（4の指と同じ高さの開放弦がある弦）
export const upperStringOf = id => {
  const i = STRINGS.findIndex(s => s.id === id);
  return i >= 0 && i < STRINGS.length - 1 ? STRINGS[i + 1] : null;
};

// となりの指との半音の数。[0→1, 1→2, 2→3, 3→4]
export const SHAPES = Object.freeze({
  '23': Object.freeze([2, 2, 1, 2]),
  '12': Object.freeze([2, 1, 2, 2]),
  '34': Object.freeze([2, 2, 2, 1])
});
export const DEFAULT_SHAPE = '23';
export function fingerOffsets(shape = DEFAULT_SHAPE) {
  const gaps = SHAPES[shape];
  if (!gaps) throw new RangeError(`unknown shape: ${shape}`);
  const out = [0];
  for (const g of gaps) out.push(out[out.length - 1] + g);
  return out;
}
// くっつく指（半音で隣り合う組）。例: 形23 → [[2,3]]
export function gluedPairs(shape = DEFAULT_SHAPE) {
  return SHAPES[shape].flatMap((g, i) => (g === 1 ? [[i, i + 1]] : []));
}

const NAT = {0:'ド', 2:'レ', 4:'ミ', 5:'ファ', 7:'ソ', 9:'ラ', 11:'シ'};
const SHARP = {1:'ド♯', 3:'レ♯', 6:'ファ♯', 8:'ソ♯', 10:'ラ♯'};
export const noteName = midi => {
  const pc = ((midi % 12) + 12) % 12;
  return NAT[pc] ?? SHARP[pc];
};
export const midiToHz = (midi, a4 = 442) => a4 * 2 ** ((midi - 69) / 12);

export function noteFor(stringId, finger, shape = DEFAULT_SHAPE) {
  const s = stringById(stringId);
  if (!s) throw new RangeError(`unknown string: ${stringId}`);
  const offsets = fingerOffsets(shape);
  if (!Number.isInteger(finger) || finger < 0 || finger >= offsets.length) throw new RangeError(`unknown finger: ${finger}`);
  const midi = s.midi + offsets[finger];
  return {stringId: s.id, color: s.color, kana: s.kana, finger, midi, name: noteName(midi)};
}

// 判定の候補: 4本の弦すべての 0〜4。同じ高さが複数あるときは指の少ない方（開放弦）を代表にする。
export function candidatePool(shape = DEFAULT_SHAPE) {
  const out = [];
  for (let finger = 0; finger <= 4; finger++) {
    for (const s of STRINGS) {
      const n = noteFor(s.id, finger, shape);
      if (!out.some(o => o.midi === n.midi)) out.push(n);
    }
  }
  return out;
}

// ---- 曲 ----
// 各音は「指の数字」。ホーム弦の音は数字だけ、となりの高い弦の音は u を付ける（きらきら星の ミ側）。
// 小節は | で区切る。
export const SONGS = Object.freeze({
  mary: {
    id: 'mary',
    title: 'メリーさんの ひつじ',
    // 2026-10-12 のレッスンで使った版: 0・1・2の3本だけ（ソをミに置き換えた形）
    bars: '2 1 0 1 | 2 2 2 | 1 1 1 | 2 2 2 | 2 1 0 1 | 2 2 2 2 | 1 1 2 1 | 0',
    parts: [
      {id: 'all', from: 0, to: 8},
      {id: 'front', from: 0, to: 4},
      {id: 'back', from: 4, to: 8}
    ],
    needsUpper: false
  },
  twinkle: {
    id: 'twinkle',
    title: 'きらきらぼし',
    bars: '0 0 u0 u0 | u1 u1 u0 | 3 3 2 2 | 1 1 0 | u0 u0 3 3 | 2 2 1 | u0 u0 3 3 | 2 2 1 | 0 0 u0 u0 | u1 u1 u0 | 3 3 2 2 | 1 1 0',
    parts: [
      {id: 'all', from: 0, to: 12},
      {id: 'one', from: 0, to: 4},
      {id: 'two', from: 4, to: 8},
      {id: 'three', from: 8, to: 12}
    ],
    needsUpper: true
  },
  fingers: {
    id: 'fingers',
    title: 'ゆびたいそう',
    // 形23の0・1・2・3を、のぼってもどる
    bars: '0 1 2 3 | 2 1 0 | 0 1 2 3 | 2 1 0',
    parts: [{id: 'all', from: 0, to: 4}],
    needsUpper: false
  }
});

export function availableHomes(songId) {
  const song = SONGS[songId];
  if (!song) throw new RangeError(`unknown song: ${songId}`);
  return STRINGS.filter(s => !song.needsUpper || upperStringOf(s.id)).map(s => s.id);
}

export function parseBars(text) {
  return text.split('|').map(bar => bar.trim().split(/\s+/).map(tok => {
    const m = /^(u?)(\d)$/.exec(tok);
    if (!m) throw new SyntaxError(`bad token: ${tok}`);
    return {upper: m[1] === 'u', finger: Number(m[2])};
  }));
}

// 1つの版（曲 × ホーム弦）の音の列。bars は表示用に小節ごとにも持つ。
export function buildSong(songId, homeId, partId = 'all', shape = DEFAULT_SHAPE) {
  const song = SONGS[songId];
  if (!song) throw new RangeError(`unknown song: ${songId}`);
  if (!availableHomes(songId).includes(homeId)) throw new RangeError(`${songId} has no ${homeId} edition`);
  const part = song.parts.find(p => p.id === partId);
  if (!part) throw new RangeError(`unknown part: ${partId}`);
  const home = stringById(homeId), upper = upperStringOf(homeId);
  const parsed = parseBars(song.bars).slice(part.from, part.to);
  const bars = parsed.map((bar, b) => bar.map((tok, i) => {
    const stringId = tok.upper ? upper.id : home.id;
    return {...noteFor(stringId, tok.finger, shape), bar: b, pos: i, last: i === bar.length - 1};
  }));
  const notes = bars.flat().map((n, index) => ({...n, index}));
  // bars の要素も index 付きの同じ並びにそろえる
  let k = 0;
  const barsIndexed = bars.map(bar => bar.map(() => notes[k++]));
  return {songId, homeId, partId, shape, title: song.title, notes, bars: barsIndexed};
}

// ロングトーン用の開放弦
export function openString(stringId) {
  return noteFor(stringId, 0);
}

// 全部の版（曲 × ホーム弦）の一覧。ごほうびシールの枠と、テストで使う。
export function allEditions() {
  const out = [];
  for (const s of STRINGS) out.push({kind: 'long', songId: 'long', homeId: s.id, key: `long-${s.id}`});
  for (const songId of Object.keys(SONGS)) {
    for (const homeId of availableHomes(songId)) out.push({kind: 'song', songId, homeId, key: `${songId}-${homeId}`});
  }
  return out;
}
