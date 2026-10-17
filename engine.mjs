// 判定エンジン。
// 「ゆびいろ」（~/Shortcuts/アプリ開発/yubi-iro/index.html）の TOL・detect・judge・保持ループを移植した。
// 「いろとゆび」は ±150¢・オクターブ違いも正解・60ms で通すので緩すぎた。ここでは
// ゆびいろの組み合わせをひとまとまりで使う: 保持時間 + ゆれ幅 + 最近傍候補 + 全4弦を候補にする。
import {midiToHz} from './shapes.mjs?v=20261017d';

// 保持（hold）＝この長さ途切れず鳴らせたら判定する。spread＝窓のなかで許すゆれ（セント、85パーセンタイル）。
// tol＝目標からこの幅以内なら無条件で正解。conf＝音程推定の確からしさの下限。
export const TOL = Object.freeze({
  loose: Object.freeze({label: 'とてもゆるい', hold: 225, spread: 170, tol: 90, conf: 0.22}),
  mid:   Object.freeze({label: 'ゆるい',       hold: 300, spread: 130, tol: 70, conf: 0.30}),
  tight: Object.freeze({label: 'ふつう',       hold: 400, spread: 90,  tol: 45, conf: 0.38})
});
export const DEFAULT_TOL = 'loose';

// マイクの拾い率。音程の厳しさとは別。小さな音の子でも拾えるよう既定は「超高め」（2026-10-10 に本人が決めた値）。
// 拾い率を上げるほど雑音も拾うので、音らしさ（minConf）の下限も段階ごとに足す（いろとゆびも同じ作り）。
// 「ふつう」は ゆびいろ のまま（TOL の conf だけ）。
export const PICKUP = Object.freeze({
  normal: Object.freeze({label: 'ふつう',   minRms: 0.0035, minConf: 0}),
  high:   Object.freeze({label: '高め',     minRms: 0.0015, minConf: 0.40}),
  ultra:  Object.freeze({label: '超高め',   minRms: 0.0005, minConf: 0.45})
});
export const DEFAULT_PICKUP = 'ultra';

export const A4_CHOICES = Object.freeze([440, 441, 442, 443]);
export const DEFAULT_A4 = 442;

export const centsFrom = (f, midi, a4 = DEFAULT_A4) => 1200 * Math.log2(f / midiToHz(midi, a4));
const median = a => {
  const b = a.slice().sort((x, y) => x - y), n = b.length;
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
};

// ---- ピッチ検出（YIN / CMND）。ゆびいろの detect をそのまま移した ----
const YIN_TH = 0.20;
export function detect(x, sr, minRms = PICKUP[DEFAULT_PICKUP].minRms) {
  const tauMin = Math.max(2, Math.floor(sr / 1500));
  const tauMax = Math.min(Math.floor(sr / 150), x.length - 1200);
  const W = Math.min(1024, x.length - tauMax - 1);
  if (W < 256) return {f: -1, conf: 0, rms: 0};
  let e = 0;
  for (let i = 0; i < W; i++) e += x[i] * x[i];
  const rms = Math.sqrt(e / W);
  if (rms < minRms) return {f: -1, conf: 0, rms};

  const cm = new Float32Array(tauMax + 1);
  let run = 0, best = -1, bestV = 1e9;
  for (let t = tauMin; t <= tauMax; t++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const dd = x[j] - x[j + t]; s += dd * dd; }
    run += s;
    cm[t] = run > 0 ? s * (t - tauMin + 1) / run : 1;
    if (cm[t] < bestV) { bestV = cm[t]; best = t; }
    // 最初に閾値を割った谷の底まで下ってそこで確定（オクターブ上への誤検出を防ぐ）
    if (cm[t] < YIN_TH && t > tauMin && cm[t] > cm[t - 1]) { best = t - 1; bestV = cm[t - 1]; break; }
  }
  if (best < 0) return {f: -1, conf: 0, rms};
  // 放物線補間
  let tau = best;
  if (best > tauMin && best < tauMax) {
    const a = cm[best - 1], b = cm[best], c = cm[best + 1], den = 2 * (2 * b - a - c);
    if (den !== 0) tau = best + (c - a) / den;
  }
  return {f: sr / tau, conf: Math.max(0, Math.min(1, 1 - bestV)), rms};
}

// ---- 判定（ゆびいろの judge）----
// candidates は 4本の弦 × 0〜4 の全部（弦を1本に絞ると、となりの開放弦を弾いても正解になる実バグがある）。
export function judgePitch(f, targetMidi, candidates, tolKey = DEFAULT_TOL, a4 = DEFAULT_A4) {
  const cfg = TOL[tolKey] || TOL[DEFAULT_TOL];
  const cand = [];
  // 同じ高さが複数あるとき（レ線の4＝ラ線の0 など）は音では区別できない。指の少ない方を代表にする。
  [...candidates].sort((a, b) => a.finger - b.finger).forEach(p => { if (!cand.some(c => c.midi === p.midi)) cand.push(p); });
  const cents = m => 1200 * Math.log2(f / midiToHz(m, a4));
  const dist = (m, allowOct) => {
    let best = cents(m);
    if (allowOct) [-1, 1, 2].forEach(o => { const c = cents(m + 12 * o); if (Math.abs(c) < Math.abs(best)) best = c; });
    return best;
  };
  const cT = cents(targetMidi);

  // A) 目標から tol 以内なら無条件で正解
  if (Math.abs(cT) <= cfg.tol) return {ok: true, cents: cT, rule: 'A'};
  // B) 候補のなかでいちばん近いのが目標なら正解
  let near = cand[0], nearC = dist(cand[0].midi, false);
  cand.forEach(c => { const d = dist(c.midi, false); if (Math.abs(d) < Math.abs(nearC)) { near = c; nearC = d; } });
  if (near.midi === targetMidi) return {ok: true, cents: cT, rule: 'B'};
  // C) 倍音／オクターブ違いの救済（tol 以内に限る）
  let nearH = cand[0], nearHC = dist(cand[0].midi, true);
  cand.forEach(c => { const d = dist(c.midi, true); if (Math.abs(d) < Math.abs(nearHC)) { nearH = c; nearHC = d; } });
  if (nearH.midi === targetMidi && Math.abs(nearHC) <= cfg.tol) return {ok: true, cents: nearHC, oct: true, rule: 'C'};

  // 外れの報告は「実際に鳴っていた高さ」を優先する（倍音救済用の距離は使わない）
  if (Math.abs(nearC) <= 250) return {ok: false, heard: near, cents: nearC};
  return {ok: false, heard: nearH, cents: nearHC};
}

// ---- 保持ループ（ゆびいろの hold / held / lastVoiced）----
// push() は解析1回ぶん。音が tol.hold ミリ秒つづいてゆれが小さければ commit に中央値の周波数を返す。
export class HoldTracker {
  constructor(tolKey = DEFAULT_TOL, minConf = 0) { this.setTol(tolKey); this.minConf = minConf; this.reset(); }
  setTol(tolKey) { this.cfg = TOL[tolKey] || TOL[DEFAULT_TOL]; }
  reset() { this.hold = []; this.lastVoiced = 0; this.progress = 0; }
  isVoiced(reading) { return reading.f > 0 && reading.conf > Math.max(this.cfg.conf, this.minConf); }
  push(now, reading) {
    const cfg = this.cfg;
    if (!this.isVoiced(reading)) {
      if (this.hold.length && now - this.lastVoiced > 220) { this.hold = []; this.progress = 0; }
      return {voiced: false, progress: this.progress, commit: null};
    }
    this.lastVoiced = now;
    this.hold.push({t: now, f: reading.f});
    while (this.hold.length && now - this.hold[0].t > cfg.hold * 2.2) this.hold.shift();
    // held＝途切れずに鳴らせている時間。窓の中のいちばん古いサンプルまでで測ると cfg.hold に構造的に届かない。
    const win = this.hold.filter(h => now - h.t <= cfg.hold);
    const held = now - this.hold[0].t;
    this.progress = Math.min(1, held / cfg.hold);
    let commit = null;
    if (win.length >= 4 && held >= cfg.hold) {
      const med = median(win.map(h => h.f));
      // ゆれ幅は最大値でなく85パーセンタイルで見る（初心者の音は倍音を1〜2フレームだけ拾う）
      const devs = win.map(h => Math.abs(1200 * Math.log2(h.f / med))).sort((a, b) => a - b);
      const spread = devs[Math.max(0, Math.ceil(devs.length * 0.85) - 1)];
      // 規定の倍まで鳴らしても通らないときは、黙って止まらずに判定へ回す（無反応がいちばん心を折る）
      if (spread <= cfg.spread || held >= cfg.hold * 2) commit = med;
    }
    return {voiced: true, progress: this.progress, commit};
  }
}

// ---- 弾き直しの合図 ----
// 同じ高さがつづく曲（2・2・2）では、鳴らしっぱなしの音が次の音を勝手に正解にしてしまう。
// 判定のあとは、無音がしばらくつづくか、音の高さが変わるまで、次の判定をしない。
export class Rearm {
  constructor() { this.armed = true; }
  disarm(now, freq, maxWaitMs = 1500) {
    this.armed = false; this.ref = freq; this.since = now; this.maxWait = maxWaitMs; this.silentSince = null; this.moved = 0;
  }
  update(now, voiced, f) {
    if (this.armed) return true;
    if (!voiced) {
      if (this.silentSince === null) this.silentSince = now;
      if (now - this.silentSince >= 100) this.armed = true;
    } else {
      this.silentSince = null;
      const c = Math.abs(1200 * Math.log2(f / this.ref));
      if (c >= 60) { this.moved++; if (this.moved >= 3) this.armed = true; } else this.moved = 0;
    }
    if (!this.armed && now - this.since >= this.maxWait) this.armed = true;
    return this.armed;
  }
}
