// 音の出し方。お手本・ロングトーンの案内音・効果音。録音も送信もしない。
// 倍音は sine を足し合わせる（のこぎり波の重ね合わせは低い音でブザーのようになる: みみクエストの教訓）。
export const SOFT = [[1, 1], [2, 0.42], [3, 0.2], [4, 0.09]];
export const BOWED = [[1, 1], [2, 0.55], [3, 0.35], [4, 0.22], [5, 0.14], [6, 0.08]];
const LADDER = [784, 880, 988, 1175, 1319, 1568];   // れんぞくが続くほど高くなる

export class Sound {
  constructor() { this.ctx = null; this.master = null; this.volume = 0.85; this.live = new Set(); }
  ensure() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!this.ctx || this.ctx.state === 'closed') {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      const p = this.ctx.resume && this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
      return this.ctx;
    } catch { return null; }
  }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = this.volume; }

  // 1つの音。when は ctx の時刻（秒）。戻り値の stop() で途中でも止められる（クリックが出ないよう短く減衰）
  tone(freq, {when = 0, dur = 1, gain = 0.22, attack = 0.03, release = 0.12, partials = SOFT, lp = 0} = {}) {
    const ctx = this.ensure();
    if (!ctx) return {stop() {}};
    const t = Math.max(ctx.currentTime, when || ctx.currentTime);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, Math.max(t + attack, t + dur - release));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; g.connect(f); out = f; }
    out.connect(this.master);
    const oscs = partials.map(([h, a]) => {
      const o = ctx.createOscillator(), pg = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq * h; pg.gain.value = a;
      o.connect(pg); pg.connect(g); o.start(t); o.stop(t + dur + 0.05);
      return o;
    });
    const voice = {
      stop: () => {
        const n = ctx.currentTime;
        try { g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), n); g.gain.linearRampToValueAtTime(0.0001, n + 0.05); } catch {}
        oscs.forEach(o => { try { o.stop(n + 0.08); } catch {} });
        this.live.delete(voice);
      }
    };
    oscs[0].onended = () => { this.live.delete(voice); try { out.disconnect(); } catch {} };
    this.live.add(voice);
    return voice;
  }
  stopAll() { for (const v of [...this.live]) v.stop(); }

  // お手本（目標の高さ）
  ref(freq) { this.tone(freq, {dur: 1.0, gain: 0.26}); return 1.0; }
  // ロングトーンの案内音（弓の音のように倍音をふくらませて、少しやわらげる）
  guide(freq, when, dur) { return this.tone(freq, {when, dur, gain: 0.17, attack: 0.09, release: 0.18, partials: BOWED, lp: 3800}); }
  // 合ったとき。れんぞくで音が上がる（たまった感じ）
  pon(combo = 0) {
    const f = LADDER[Math.max(0, Math.min(LADDER.length - 1, combo - 1))] || LADDER[0], t = this.now + 0.01;
    this.tone(f, {when: t, dur: 0.16, gain: 0.2});
    this.tone(f * 1.5, {when: t + 0.1, dur: 0.24, gain: 0.2});
    return 0.4;
  }
  // 外れたとき。責めない、やわらかい下がり
  boing() {
    const ctx = this.ensure(); if (!ctx) return 0.2;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(360, t); o.frequency.exponentialRampToValueAtTime(240, t + 0.16);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.linearRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.22);
    return 0.25;
  }
  tick() { this.tone(660, {dur: 0.1, gain: 0.16, attack: 0.01, release: 0.05}); }
  go() { const t = this.now + 0.01; this.tone(990, {when: t, dur: 0.18, gain: 0.2}); this.tone(1319, {when: t + 0.08, dur: 0.3, gain: 0.2}); }
  ding() { const t = this.now + 0.01; this.tone(1047, {when: t, dur: 0.14, gain: 0.18}); this.tone(1568, {when: t + 0.09, dur: 0.3, gain: 0.18}); }
  // 1小節おわったとき
  bar() { const t = this.now + 0.01; [523, 659, 784].forEach((f, i) => this.tone(f, {when: t + i * 0.07, dur: 0.22, gain: 0.16})); return 0.45; }
  // ぜんぶおわったとき
  fanfare() {
    const t = this.now + 0.02;
    [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.38]].forEach(([f, d]) => this.tone(f, {when: t + d, dur: 0.3, gain: 0.2}));
    [523, 659, 784, 1047].forEach(f => this.tone(f, {when: t + 0.62, dur: 0.9, gain: 0.1}));
    return 1.6;
  }
  sticker() { const t = this.now + 0.01; [1319, 1568, 1976, 2349].forEach((f, i) => this.tone(f, {when: t + i * 0.06, dur: 0.18, gain: 0.12})); return 0.5; }
}
