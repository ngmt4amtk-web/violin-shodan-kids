import test from 'node:test';
import assert from 'node:assert/strict';
import {judgePitch, HoldTracker, Rearm} from '../engine.mjs';
import {buildSong, candidatePool, midiToHz} from '../shapes.mjs';
import {PlaySession, SUCCESS_MS, ERROR_WAIT_MS} from '../session.mjs';
import {buildTimeline, stateAt, toneWindows, COUNT_STEP_MS, GO_MS, TURN_MS} from '../longtone.mjs';
import * as store from '../rewards.mjs';

const POOL = candidatePool();
const hz = (m, c = 0) => midiToHz(m) * 2 ** (c / 1200);
const DT = 1000 / 60;

// app.js の loop / onCommit と同じ手順を、合成した「ひと息ごとの高さ」で回す
function simulate(song, scenario, {maxMs = 120000, tol = 'loose'} = {}) {
  const session = new PlaySession(song), tracker = new HoldTracker(tol), rearm = new Rearm();
  let mutedUntil = 0, finished = false;
  const log = [];
  for (let now = 0; now < maxMs && !finished; now += DT) {
    if (session.deadline !== null && now >= session.deadline) { if (session.advance(now) === 'finished') { finished = true; break; } tracker.reset(); }
    if (now < mutedUntil) { tracker.reset(); continue; }
    const f = scenario(now, session);
    const reading = f > 0 ? {f, conf: 0.95, rms: 0.05} : {f: -1, conf: 0, rms: 0};
    const voiced = tracker.isVoiced(reading);
    if (!rearm.update(now, voiced, reading.f)) { tracker.reset(); continue; }
    const r = tracker.push(now, reading);
    if (r.commit !== null && session.result !== 'correct') {
      const res = judgePitch(r.commit, session.current.midi, POOL, tol, 442);
      tracker.reset();
      if (res.ok) { session.correct(now); mutedUntil = now + 500; rearm.disarm(now, r.commit, 1500); log.push({now, ok: true, i: session.index}); }
      else { session.wrong(now); rearm.disarm(now, r.commit, 2500); log.push({now, ok: false, heard: res.heard.name, i: session.index}); }
    }
  }
  return {session, finished, log};
}
// 音を ms 鳴らして、gap だけ無音にする弾き方
function player(plan) {
  const state = {phase: 'play', since: 0, idx: -1};
  return (now, session) => {
    if (session.index !== state.idx) { state.idx = session.index; state.phase = 'gapWait'; state.since = now; }
    const note = session.current;
    const f = plan.freq ? plan.freq(note, session) : hz(note.midi);
    if (state.phase === 'gapWait') { if (now - state.since < (plan.gap ?? 300)) return -1; state.phase = 'play'; state.since = now; }
    return f;
  };
}

test('メリーさん赤版を、全部の音を正しく弾くと、全部「1回目で正解」で終わる', () => {
  const song = buildSong('mary', 'A');
  const {session, finished} = simulate(song, player({}));
  assert.equal(finished, true);
  assert.deepEqual(session.results, Array(26).fill('first'));
  assert.equal(session.stars, 3);
  assert.equal(session.bestCombo, 26);
});

test('弦ごとの版（青・オレンジ・緑）も、同じ指の関係値で最後まで進む', () => {
  for (const home of ['G', 'D', 'E']) {
    const {session, finished} = simulate(buildSong('mary', home), player({}));
    assert.equal(finished, true, home);
    assert.ok(session.results.every(r => r === 'first'), home);
  }
});

test('きらきらぼし赤版（弦をまたぐ）を最後まで弾くと42音で終わる', () => {
  const {session, finished} = simulate(buildSong('twinkle', 'A'), player({}));
  assert.equal(finished, true);
  assert.equal(session.results.length, 42);
  assert.ok(session.results.every(r => r === 'first'));
});

test('少しずれた音（+60¢）でも通る。半音ずれた音は通らない', () => {
  const ok = simulate(buildSong('mary', 'A', 'front'), player({freq: n => hz(n.midi, 60)}));
  assert.equal(ok.finished, true);
  assert.ok(ok.session.results.every(r => r === 'first'));
  // 2と3のとり違い: ド♯(2)の所をレ(3)で弾き続ける → 最初の音は外れのまま時間切れで「つぎ」へ
  const bad = simulate(buildSong('mary', 'A', 'front'), player({freq: (n, s) => s.index === 0 ? hz(n.midi + 1) : hz(n.midi)}), {maxMs: 9000});
  assert.equal(bad.session.results[0], 'passed');
  assert.ok(bad.log.some(l => l.ok === false && l.heard === 'レ'), '外れの音が「レ」と返る');
  assert.ok(!bad.log.some(l => l.ok === true && l.i === 0), '半音ずれた音で最初の音が正解にならない');
});

test('同じ高さが続く（2・2・2）とき、鳴らしっぱなしでは勝手に進まない', () => {
  const song = buildSong('mary', 'A', 'front');   // 2 1 0 1 | 2 2 2 | ...
  // 2番めの小節の頭（index 4）まで進めてから、同じ高さを鳴らしっぱなしにする
  const session = new PlaySession(song);
  session.index = 4;                              // ド♯ ド♯ ド♯ の始まり
  const tracker = new HoldTracker('loose'), rearm = new Rearm();
  const f = hz(session.current.midi);
  let accepted = null;
  for (let now = 0; now < 4000; now += DT) {
    if (!rearm.update(now, true, f)) { tracker.reset(); continue; }
    const r = tracker.push(now, {f, conf: 0.95, rms: 0.05});
    if (r.commit !== null && session.result !== 'correct') {
      session.correct(now); rearm.disarm(now, r.commit, 1500); tracker.reset();
      if (accepted === null) accepted = now; else { assert.ok(now - accepted >= 1450, `2回目の正解まで ${now - accepted}ms`); session.advance(now, true); break; }
      session.advance(now, true);
    }
  }
  assert.ok(accepted !== null && accepted < 400, '1音めは225msほどで通る');
});

test('別の弦（ミ）を弾いて外し、そのあと正しい音で「やり直して正解」になる', () => {
  const song = buildSong('mary', 'A', 'front');
  let phase = 0, since = 0;
  const scenario = (now, session) => {
    if (session.index > 0) return -1;
    if (phase === 0) { if (now > 600) { phase = 1; since = now; } return hz(76); }               // 緑の開放を弾いてしまう
    if (phase === 1) { if (now - since > 400) { phase = 2; since = now; } return -1; }           // 一度止まる
    return hz(session.current.midi);                                                              // 正しく弾く
  };
  const {session, log} = simulate(song, (n, s) => s.index > 0 ? hz(s.current.midi) : scenario(n, s), {maxMs: 3500});
  assert.equal(log[0].ok, false); assert.equal(log[0].heard, 'ミ');
  assert.equal(session.results[0], 'retry');
});

test('PlaySession: 星は1回目の正解の割合（85%以上で3つ・55%以上で2つ・それ以外も1つ）', () => {
  const song = buildSong('mary', 'A', 'front');
  const s = new PlaySession(song);
  let now = 0;
  for (let i = 0; i < 13; i++) {
    if (i < 3) { s.wrong(now); s.correct(now + 10); } else s.correct(now);
    s.advance(now + 5000, true); now += 6000;
  }
  assert.equal(s.firstCount, 10);
  assert.equal(s.stars, 2);   // 10/13 = 77%
  const t = new PlaySession(song);
  for (let i = 0; i < 13; i++) t.advance(0, true);
  assert.equal(t.stars, 1);   // ぜんぶ「つぎ」でも星は1つ
  assert.ok(SUCCESS_MS < ERROR_WAIT_MS);
});

test('ロングトーン: 数える3・2・1 → ゴー → ダウン4秒 → 向きを変える → アップ4秒', () => {
  const tl = buildTimeline({seconds: 4, trips: 1});
  assert.equal(tl.total, 3 * COUNT_STEP_MS + GO_MS + 4000 + TURN_MS + 4000);
  const s0 = 3 * COUNT_STEP_MS + GO_MS;
  assert.equal(stateAt(tl, 0).phase, 'count');
  assert.equal(stateAt(tl, 0).n, 3);
  assert.equal(stateAt(tl, s0 - 1).phase, 'go');
  const down0 = stateAt(tl, s0), downMid = stateAt(tl, s0 + 2000), downEnd = stateAt(tl, s0 + 3999);
  assert.equal(down0.phase, 'down'); assert.equal(down0.x, 0);
  assert.ok(Math.abs(downMid.x - 0.5) < 0.001);
  assert.ok(downEnd.x > 0.999, 'ゲージが100%近くまで届く');
  const turn = stateAt(tl, s0 + 4000 + 100);
  assert.equal(turn.phase, 'turn'); assert.equal(turn.x, 1);
  const upMid = stateAt(tl, s0 + 4000 + TURN_MS + 2000);
  assert.equal(upMid.phase, 'up'); assert.ok(Math.abs(upMid.x - 0.5) < 0.001);
  assert.ok(stateAt(tl, tl.total - 1).x < 0.001, '戻ってきて0に着く');
  assert.equal(stateAt(tl, tl.total).phase, 'done');
});

test('ロングトーン: 往復の数・秒数を変えても、お手本の音はダウンとアップの区間だけ', () => {
  for (const [seconds, trips] of [[2, 1], [3, 2], [6, 3]]) {
    const tl = buildTimeline({seconds, trips});
    const w = toneWindows(tl);
    assert.equal(w.length, trips * 2);
    assert.ok(w.every(x => x.t1 - x.t0 === seconds * 1000));
    assert.deepEqual(w.map(x => x.kind), Array(trips).fill(['down', 'up']).flat());
  }
  assert.throws(() => buildTimeline({seconds: 0}));
  assert.throws(() => buildTimeline({trips: 0}));
});

test('保存: 初段の保存キーと混ぜない・壊れた値は既定に戻す・シールは15枠だけ', () => {
  assert.equal(store.STORAGE_KEY, 'shodan-kids:v1');
  assert.ok(!store.STORAGE_KEY.startsWith('violin-shodan'));
  const bad = store.normalize({tol: 'xx', pickup: 3, a4: 500, volume: 9999, buddy: 'cat', stickers: {'mary-A': {n: 2, stars: 3, at: '2026-10-17'}, 'twinkle-E': {n: 1}, 'zzz': {}}});
  assert.equal(bad.tol, 'loose'); assert.equal(bad.pickup, 'ultra'); assert.equal(bad.a4, 442); assert.equal(bad.volume, 100); assert.equal(bad.buddy, 'fluffy');
  assert.deepEqual(Object.keys(bad.stickers), ['mary-A']);
  const mem = new Map(), storage = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
  const r1 = store.awardSticker(store.load(storage), 'long-A', 2, '2026-10-17');
  assert.equal(r1.isNew, true);
  store.save(storage, r1.state);
  const r2 = store.awardSticker(store.load(storage), 'long-A', 3, '2026-10-18');
  assert.equal(r2.isNew, false);
  assert.equal(r2.state.stickers['long-A'].stars, 3);
  assert.equal(r2.state.stickers['long-A'].at, '2026-10-17');
  assert.equal(store.stickerTotal(), 15);
  assert.throws(() => store.awardSticker(store.load(storage), 'twinkle-E', 3, ''));
  assert.deepEqual(store.load({getItem() { throw new Error('blocked'); }}).stickers, {});
  assert.equal(store.save({setItem() { throw new Error('blocked'); }}, r1.state), false);
});
