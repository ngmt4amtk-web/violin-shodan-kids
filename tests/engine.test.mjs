import test from 'node:test';
import assert from 'node:assert/strict';
import {detect, judgePitch, HoldTracker, Rearm, TOL, PICKUP} from '../engine.mjs';
import {candidatePool, midiToHz} from '../shapes.mjs';
import {makeTone, tail, centsBetween, runTracker} from './helpers.mjs';

const POOL = candidatePool();
const hz = (m, c = 0) => midiToHz(m) * 2 ** (c / 1200);
const judge = (f, target, tol = 'loose') => judgePitch(f, target, POOL, tol, 442);

test('TOL は ゆびいろ と同じ値（保持225/300/400ms・ゆれ170/130/90¢・±90/70/45¢）', () => {
  assert.deepEqual({...TOL.loose}, {label: 'とてもゆるい', hold: 225, spread: 170, tol: 90, conf: 0.22});
  assert.deepEqual({...TOL.mid}, {label: 'ゆるい', hold: 300, spread: 130, tol: 70, conf: 0.30});
  assert.deepEqual({...TOL.tight}, {label: 'ふつう', hold: 400, spread: 90, tol: 45, conf: 0.38});
});

test('detect: 17の高さを 44.1k/48k で 15¢ 以内に当てる', () => {
  for (const sr of [44100, 48000]) {
    for (const p of POOL) {
      const f = hz(p.midi);
      const r = detect(tail(makeTone(f, sr, {noise: 0.004})), sr, PICKUP.ultra.minRms);
      assert.ok(r.f > 0, `${p.name}(${p.midi}) sr=${sr}: 検出できない`);
      assert.ok(Math.abs(centsBetween(r.f, f)) < 15, `${p.name}(${p.midi}) sr=${sr}: ${r.f.toFixed(1)}Hz vs ${f.toFixed(1)}Hz`);
      assert.ok(r.conf > 0.7, `${p.name} conf=${r.conf}`);
    }
  }
});

test('detect: 無音・拾い率より小さい音は「音なし」、小さくても拾い率より大きければ検出する', () => {
  const sr = 48000;
  assert.equal(detect(tail(new Float32Array(4096)), sr).f, -1);
  assert.equal(detect(tail(makeTone(440, sr, {amp: 0.0003})), sr, PICKUP.ultra.minRms).f, -1);
  const quiet = detect(tail(makeTone(440, sr, {amp: 0.002})), sr, PICKUP.ultra.minRms);
  assert.ok(quiet.f > 0 && Math.abs(centsBetween(quiet.f, 440)) < 20);
  // 「ふつう」の拾い率（0.0035）では同じ音は拾わない
  assert.equal(detect(tail(makeTone(440, sr, {amp: 0.002})), sr, PICKUP.normal.minRms).f, -1);
});

test('detect: 2倍音が強い音でも、判定は目標を正解にする（オクターブ救済）', () => {
  const sr = 48000, f = hz(69);
  const r = detect(tail(makeTone(f, sr, {harmonics: [0.25, 1, 0.5, 0.2], amp: 0.2})), sr, PICKUP.ultra.minRms);
  assert.ok(r.f > 0);
  assert.equal(judge(r.f, 69).ok, true, `検出 ${r.f.toFixed(1)}Hz`);
});

test('判定: 目標を弾けば正解、±80¢まで正解（loose）', () => {
  for (const c of [0, 30, 60, 80, -80]) assert.equal(judge(hz(73, c), 73).ok, true, `${c}¢`);
});

test('判定: 2と3のとり違い（半音）は外れ。何に聞こえたかを返す', () => {
  const a = judge(hz(74), 73);      // ド♯を弾くはずがレ
  assert.equal(a.ok, false);
  assert.equal(a.heard.midi, 74); assert.equal(a.heard.name, 'レ');
  const b = judge(hz(73), 74);      // レを弾くはずがド♯
  assert.equal(b.ok, false);
  assert.equal(b.heard.midi, 73);
  // レに近づいた音（+120¢）もレに聞こえる
  const c = judge(hz(73, 120), 73);
  assert.equal(c.ok, false); assert.equal(c.heard.midi, 74);
});

test('判定: 別の弦・別の指は外れ（いろとゆびでは通ってしまう ±150¢ でも）', () => {
  assert.equal(judge(hz(76), 69).ok, false);          // ラを弾くはずがミ（緑の開放）
  assert.equal(judge(hz(71), 69).ok, false);          // ラを弾くはずがシ
  assert.equal(judge(hz(69, -120), 69).ok, false);    // 低すぎ（ソに近い）
  assert.equal(judge(hz(69, 130), 69).ok, false);     // 高すぎ（シに近い）
  const r = judge(hz(76), 69);
  assert.equal(r.heard.stringId, 'E'); assert.equal(r.heard.finger, 0);   // 同じ高さは開放弦を代表にする
});

test('判定: オクターブ違いは tol 以内だけ救済する（ゆびいろの規則C）', () => {
  assert.equal(judge(hz(81), 69).ok, true);
  assert.equal(judge(hz(81, 150), 69).ok, false);
});

test('判定: 3段階。ふつう は くっつく2本の判定が締まる', () => {
  // ド♯ に +80¢ は レ に近い。loose は rule A（±90）で通すが、tight（±45）は通さない
  assert.equal(judge(hz(73, 80), 73, 'loose').ok, true);
  assert.equal(judge(hz(73, 80), 73, 'tight').ok, false);
  assert.equal(judge(hz(73, 60), 73, 'mid').ok, true);     // ゆるい は ±70¢ まで
  assert.equal(judge(hz(73, 75), 73, 'mid').ok, false);
  assert.equal(judge(hz(73, 40), 73, 'tight').ok, true);   // ふつう は ±45¢ まで
  assert.equal(judge(hz(73, 55), 73, 'tight').ok, false);
});

test('HoldTracker: 安定した音は225ms前後で確定し、中央値の周波数を返す', () => {
  const t = new HoldTracker('loose');
  const rows = runTracker(t, 440, {ms: 600});
  const first = rows.find(r => r.commit !== null);
  assert.ok(first, '確定しない');
  assert.ok(first.now >= 200 && first.now <= 300, `確定 ${first.now}ms`);
  assert.ok(Math.abs(centsBetween(first.commit, 440)) < 1);
  assert.equal(rows.at(-1).progress, 1);
});

test('HoldTracker: 短いかすれ（100ms）では確定しない・途切れが220msを超えたらやり直し', () => {
  const t = new HoldTracker('loose');
  const blip = runTracker(t, 440, {ms: 100});
  assert.ok(blip.every(r => r.commit === null));
  runTracker(t, 440, {ms: 400, start: 100, voiced: false});
  assert.equal(t.progress, 0);
  const again = runTracker(t, 440, {ms: 600, start: 600});
  const first = again.find(r => r.commit !== null);
  assert.ok(first.now - 600 >= 200, `途切れの後は225msかけ直す（${first.now - 600}ms）`);
});

test('HoldTracker: ゆれが大きい音は、規定の2倍（450ms）まで待ってから判定へ回す', () => {
  const t = new HoldTracker('loose');
  const rows = runTracker(t, 440, {ms: 800, jitter: tt => (Math.round(tt / (1000 / 60)) % 2 ? 250 : -250)});
  const first = rows.find(r => r.commit !== null);
  assert.ok(first && first.now >= 440 && first.now <= 520, `確定 ${first && first.now}ms`);
});

test('HoldTracker: 3段階の保持時間（225/300/400ms）', () => {
  for (const [tol, lo, hi] of [['loose', 200, 300], ['mid', 280, 360], ['tight', 380, 460]]) {
    const first = runTracker(new HoldTracker(tol), 440, {ms: 700}).find(r => r.commit !== null);
    assert.ok(first.now >= lo && first.now <= hi, `${tol}: ${first.now}ms`);
  }
});

test('Rearm: 鳴らしっぱなしの同じ高さでは、時間切れまで次の判定をしない', () => {
  const r = new Rearm(); r.disarm(0, 440, 1500);
  for (let t = 0; t < 1450; t += 16.7) assert.equal(r.update(t, true, 440), false, `${t}ms`);
  assert.equal(r.update(1500, true, 440), true);
});

test('Rearm: 無音が100ms続くか、高さが変わると、次の判定へ進める', () => {
  const a = new Rearm(); a.disarm(0, 440, 1500);
  assert.equal(a.update(10, false, -1), false);
  assert.equal(a.update(109, false, -1), false);
  assert.equal(a.update(111, false, -1), true);
  const b = new Rearm(); b.disarm(0, 440, 1500);
  const up = hz(71); // 別の高さ
  assert.equal(b.update(20, true, up), false);
  assert.equal(b.update(40, true, up), false);
  assert.equal(b.update(60, true, up), true);
  const c = new Rearm(); c.disarm(0, 440, 1500);   // ビブラート程度（±30¢）では進まない
  for (let t = 0; t < 1000; t += 16.7) assert.equal(c.update(t, true, 440 * 2 ** ((Math.round(t / 16.7) % 2 ? 30 : -30) / 1200)), false);
});
