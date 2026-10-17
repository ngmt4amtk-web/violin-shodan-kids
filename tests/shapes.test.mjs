import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRINGS, SHAPES, fingerOffsets, gluedPairs, noteFor, noteName, candidatePool,
  SONGS, availableHomes, parseBars, buildSong, upperStringOf, allEditions
} from '../shapes.mjs';

test('弦の色と音名は ゆびいろ と同じ（ソ=青 / レ=オレンジ / ラ=赤 / ミ=緑）', () => {
  assert.deepEqual(STRINGS.map(s => [s.id, s.kana, s.color, s.midi]), [
    ['G', 'ソ', 'blue', 55], ['D', 'レ', 'orange', 62], ['A', 'ラ', 'red', 69], ['E', 'ミ', 'green', 76]
  ]);
});

test('指の関係値: 形23は 2・2・1・2 半音で、2と3がくっつく', () => {
  assert.deepEqual([...SHAPES['23']], [2, 2, 1, 2]);
  assert.deepEqual(fingerOffsets('23'), [0, 2, 4, 5, 7]);
  assert.deepEqual(gluedPairs('23'), [[2, 3]]);
  assert.deepEqual(gluedPairs('12'), [[1, 2]]);
  assert.deepEqual(gluedPairs('34'), [[3, 4]]);
  // 4の指は必ずとなりの開放弦と同じ高さ（1ポジションの定義）
  for (const shape of Object.keys(SHAPES)) assert.equal(fingerOffsets(shape)[4], 7);
});

test('形23で4本の弦に同じ運指を置く（調の名前を使わずに音が決まる）', () => {
  // ラ線: ラ シ ド♯ レ ミ / ソ線: ソ ラ シ ド レ / レ線: レ ミ ファ♯ ソ ラ / ミ線: ミ ファ♯ ソ♯ ラ シ
  const names = id => [0, 1, 2, 3, 4].map(f => noteFor(id, f).name);
  assert.deepEqual(names('A'), ['ラ', 'シ', 'ド♯', 'レ', 'ミ']);
  assert.deepEqual(names('G'), ['ソ', 'ラ', 'シ', 'ド', 'レ']);
  assert.deepEqual(names('D'), ['レ', 'ミ', 'ファ♯', 'ソ', 'ラ']);
  assert.deepEqual(names('E'), ['ミ', 'ファ♯', 'ソ♯', 'ラ', 'シ']);
  assert.equal(noteName(61), 'ド♯');
  assert.throws(() => noteFor('X', 0));
  assert.throws(() => noteFor('A', 5));
});

test('判定の候補は4本すべての0〜4（17の高さ）で、同じ高さは指の少ない方（開放弦）', () => {
  const pool = candidatePool('23');
  assert.equal(pool.length, 17);
  assert.equal(new Set(pool.map(p => p.midi)).size, 17);
  for (const midi of [62, 69, 76]) {
    const p = pool.find(x => x.midi === midi);
    assert.equal(p.finger, 0, `${midi} は開放弦を代表にする`);
  }
});

test('メリーさん: 2026-10-12のレッスンの運指（0・1・2だけ）を弦ごとに', () => {
  const fingers = '2 1 0 1 2 2 2 1 1 1 2 2 2 2 1 0 1 2 2 2 2 1 1 2 1 0'.split(' ').map(Number);
  for (const home of ['A', 'E', 'D', 'G']) {
    const song = buildSong('mary', home);
    assert.deepEqual(song.notes.map(n => n.finger), fingers, `${home}版の運指`);
    assert.equal(song.notes.length, 26);
    assert.ok(song.notes.every(n => n.stringId === home), '弦をまたがない');
    assert.ok(song.notes.every(n => n.finger <= 2), '3と4は使わない');
  }
  const red = buildSong('mary', 'A');
  assert.deepEqual(red.notes.slice(0, 4).map(n => n.name), ['ド♯', 'シ', 'ラ', 'シ']);
  assert.deepEqual(red.bars.map(b => b.length), [4, 3, 3, 3, 4, 4, 4, 1]);
  const first = (id) => buildSong('mary', id).notes[0];
  assert.equal(first('G').midi, 59);   // ソ線の2＝シ
  assert.equal(first('D').midi, 66);   // レ線の2＝ファ♯
  assert.equal(first('E').midi, 80);   // ミ線の2＝ソ♯
});

test('きらきら星: ホーム弦の0〜3 ＋ となりの高い弦の0〜1（レッスンの赤版と同じ形）', () => {
  assert.deepEqual(availableHomes('twinkle'), ['G', 'D', 'A']);   // ミ線にはとなりの高い弦が無い
  assert.equal(upperStringOf('E'), null);
  assert.throws(() => buildSong('twinkle', 'E'), /no E edition/);
  const red = buildSong('twinkle', 'A');
  assert.equal(red.notes.length, 42);
  // 赤0 赤0 緑0 緑0 | 緑1 緑1 緑0 | 赤3 赤3 赤2 赤2 | 赤1 赤1 赤0
  const firstLine = red.notes.slice(0, 14).map(n => `${n.color}${n.finger}`);
  assert.deepEqual(firstLine, ['red0', 'red0', 'green0', 'green0', 'green1', 'green1', 'green0', 'red3', 'red3', 'red2', 'red2', 'red1', 'red1', 'red0']);
  assert.deepEqual(red.notes.slice(0, 14).map(n => n.name), ['ラ', 'ラ', 'ミ', 'ミ', 'ファ♯', 'ファ♯', 'ミ', 'レ', 'レ', 'ド♯', 'ド♯', 'シ', 'シ', 'ラ']);
  // 同じ関係値を弦だけ変えて: ソ線版は ソ ソ レ レ ミ ミ レ | ド ド シ シ ラ ラ ソ
  const blue = buildSong('twinkle', 'G');
  assert.deepEqual(blue.notes.slice(0, 14).map(n => n.name), ['ソ', 'ソ', 'レ', 'レ', 'ミ', 'ミ', 'レ', 'ド', 'ド', 'シ', 'シ', 'ラ', 'ラ', 'ソ']);
  const orange = buildSong('twinkle', 'D');
  assert.deepEqual(orange.notes.slice(0, 14).map(n => n.name), ['レ', 'レ', 'ラ', 'ラ', 'シ', 'シ', 'ラ', 'ソ', 'ソ', 'ファ♯', 'ファ♯', 'ミ', 'ミ', 'レ']);
  assert.deepEqual(red.bars.map(b => b.length), [4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3]);
});

test('ゆびたいそう: 形23の 0・1・2・3 をのぼってもどる', () => {
  for (const home of ['G', 'D', 'A', 'E']) {
    const s = buildSong('fingers', home);
    assert.deepEqual(s.notes.map(n => n.finger), [0, 1, 2, 3, 2, 1, 0, 0, 1, 2, 3, 2, 1, 0]);
  }
  assert.deepEqual(availableHomes('fingers'), ['G', 'D', 'A', 'E']);
});

test('部分（まえ・あと・1だんめ…）は小節で区切る', () => {
  assert.equal(buildSong('mary', 'A', 'front').notes.length, 13);
  assert.equal(buildSong('mary', 'A', 'back').notes.length, 13);
  assert.equal(buildSong('twinkle', 'A', 'one').notes.length, 14);
  assert.equal(buildSong('twinkle', 'A', 'two').notes.length, 14);
  assert.equal(buildSong('twinkle', 'A', 'three').notes.length, 14);
  assert.throws(() => buildSong('mary', 'A', 'nope'), /unknown part/);
  const back = buildSong('mary', 'A', 'back');
  assert.deepEqual(back.notes.map(n => n.index), [...back.notes.keys()]);
  assert.ok(back.notes.every((n, i) => back.bars.flat()[i] === n), 'bars と notes は同じ音の並び');
});

test('曲データの書き方の誤りを拒む', () => {
  assert.throws(() => parseBars('2 1 x'), /bad token/);
  assert.equal(parseBars('2 1 | u0').length, 2);
  for (const song of Object.values(SONGS)) {
    const total = parseBars(song.bars).length;
    for (const p of song.parts) assert.ok(p.from >= 0 && p.to <= total && p.from < p.to, `${song.id}/${p.id}`);
  }
});

test('版の一覧: ロングトーン4 + メリーさん4 + きらきら星3 + ゆびたいそう4 = 15（シールの枠）', () => {
  const ed = allEditions();
  assert.equal(ed.length, 15);
  assert.equal(new Set(ed.map(e => e.key)).size, 15);
  assert.ok(!ed.some(e => e.key === 'twinkle-E'));
});
