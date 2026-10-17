// ロングトーン（のばす練習）の時間割。画面にも音にも触れない。
// 数える（3・2・1）→ ゴー → ダウン（もと→さき）→ ひと息 → アップ（さき→もと）→ …
// 弓の向きも音の質もマイクでは測れないので、これは時間とお手本の音のための割り付け。
export const COUNT_STEP_MS = 800;
export const GO_MS = 500;
export const TURN_MS = 700;
export const SECONDS_CHOICES = Object.freeze([2, 3, 4, 5, 6]);
export const DEFAULT_SECONDS = 4;
export const TRIPS_CHOICES = Object.freeze([1, 2, 3]);

export function buildTimeline({seconds = DEFAULT_SECONDS, trips = 1, turnMs = TURN_MS, countFrom = 3} = {}) {
  if (!(seconds > 0) || !Number.isInteger(trips) || trips < 1) throw new RangeError('bad timeline');
  const segs = [];
  let t = 0;
  const push = (kind, ms, extra = {}) => { segs.push({kind, t0: t, t1: t + ms, ...extra}); t += ms; };
  for (let n = countFrom; n >= 1; n--) push('count', COUNT_STEP_MS, {n});
  push('go', GO_MS);
  const holdMs = seconds * 1000;
  for (let i = 0; i < trips; i++) {
    push('down', holdMs, {trip: i});
    push('turn', turnMs, {trip: i, at: 'goal'});
    push('up', holdMs, {trip: i});
    if (i < trips - 1) push('turn', turnMs, {trip: i, at: 'start'});
  }
  return {segments: segs, total: t, seconds, trips};
}

// ms 時点の状態。x は走る位置（0=もと側・左、1=さき側・右）
export function stateAt(timeline, ms) {
  const segs = timeline.segments;
  if (ms >= timeline.total) return {phase: 'done', seg: null, progress: 1, x: 0, dir: 0, trip: timeline.trips - 1};
  const seg = segs.find(s => ms >= s.t0 && ms < s.t1) || segs[0];
  const progress = Math.max(0, Math.min(1, (ms - seg.t0) / (seg.t1 - seg.t0)));
  let x = 0, dir = 0;
  switch (seg.kind) {
    case 'down': x = progress; dir = 1; break;
    case 'up': x = 1 - progress; dir = -1; break;
    case 'turn': x = seg.at === 'goal' ? 1 : 0; dir = 0; break;
    default: x = 0; dir = 0;
  }
  return {phase: seg.kind, seg, progress, x, dir, trip: seg.trip ?? 0, n: seg.n};
}

// お手本の音を鳴らす区間（ダウンとアップのそれぞれ）
export function toneWindows(timeline) {
  return timeline.segments.filter(s => s.kind === 'down' || s.kind === 'up').map(s => ({t0: s.t0, t1: s.t1, kind: s.kind, trip: s.trip}));
}
