// テスト用の合成音。倍音つきの音を作り、ゆびいろ方式の detect に通す。
export function makeTone(freq, sr, {n = 4096, harmonics = [1, 0.5, 0.3, 0.2], amp = 0.2, noise = 0, seed = 1, phase = 0} = {}) {
  const x = new Float32Array(n);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const norm = harmonics.reduce((a, b) => a + Math.abs(b), 0);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 0; k < harmonics.length; k++) v += harmonics[k] * Math.sin(2 * Math.PI * freq * (k + 1) * i / sr + phase * (k + 1));
    x[i] = amp * v / norm + noise * rnd();
  }
  return x;
}
export const tail = x => x.subarray(x.length - 2048);
export const centsUp = (f, c) => f * 2 ** (c / 1200);
export const hzOf = (midi, a4 = 442) => a4 * 2 ** ((midi - 69) / 12);
export const centsBetween = (f, g) => 1200 * Math.log2(f / g);

// 同じ音を fps で ms 続けて流したときの解析結果を HoldTracker に入れる
export function runTracker(tracker, freq, {ms = 600, fps = 60, start = 0, voiced = true, conf = 0.95, rms = 0.05, jitter = () => 0} = {}) {
  const out = [];
  const dt = 1000 / fps;
  for (let t = 0; t <= ms; t += dt) {
    const now = start + t;
    const reading = voiced ? {f: freq * 2 ** (jitter(t) / 1200), conf, rms} : {f: -1, conf: 0, rms: 0};
    out.push({now, ...tracker.push(now, reading)});
  }
  return out;
}
