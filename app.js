import {STRINGS, stringById, SONGS, availableHomes, buildSong, candidatePool, fingerOffsets, gluedPairs, midiToHz, allEditions, noteFor} from './shapes.mjs?v=20261017a';
import {TOL, PICKUP, detect, judgePitch, HoldTracker, Rearm} from './engine.mjs?v=20261017a';
import {PlaySession} from './session.mjs?v=20261017a';
import {buildTimeline, stateAt, toneWindows} from './longtone.mjs?v=20261017a';
import {Sound} from './audio.mjs?v=20261017a';
import * as store from './rewards.mjs?v=20261017a';

const $ = id => document.getElementById(id);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
const TEST = new URLSearchParams(location.search).has('test');
const SCREENS = ['home', 'pick', 'play', 'long', 'finish', 'album'];
const NAMES = {fluffy: 'ふわふわ', dino: 'きょうりゅう', dog: 'いぬ'};
const STICKER_ART = {long: 'sneaker', mary: 'lamb', twinkle: 'star', fingers: 'violin'};
const STICKER_LABEL = {long: 'のばす', mary: 'メリーさん', twinkle: 'きらきら', fingers: 'ゆび'};
const HOME_ORDER = ['A', 'E', 'D', 'G'];   // レッスンで使う順: 赤・緑・オレンジ・青
const CHEERS = ['やったー！', 'いいね！', 'できた！', 'さいこう！', 'すごい！'];
const PART_LABEL = {mary: {all: 'ぜんぶ', front: 'まえ', back: 'あと'}, twinkle: {all: 'ぜんぶ', one: '１', two: '２', three: '３'}, fingers: {all: 'ぜんぶ'}};
const PART_SEGS = {mary: {all: [1, 1], front: [1, 0], back: [0, 1]}, twinkle: {all: [1, 1, 1], one: [1, 0, 0], two: [0, 1, 0], three: [0, 0, 1]}};
const POOL = candidatePool();

const sound = new Sound();
let S = store.load(safeStorage());
function safeStorage() { try { return window.localStorage; } catch { return null; } }
const persist = () => store.save(safeStorage(), S);
sound.setVolume(S.volume / 100);

let PK = {kind: 'song', songId: 'mary', home: 'A', part: 'all'};
let P = null, L = null, mic = null, ticket = 0, testReading = {f: -1, conf: 0, rms: 0};

// ---------- 画面 ----------
function show(name) {
  for (const id of SCREENS) $(id).hidden = id !== name;
  window.scrollTo(0, 0);
}
function art(kind, stage = 1, happy = false) {
  return `<div class="companion-dog" data-kind="${kind}" data-stage="${stage}"><div class="dog-portrait" data-mood="${happy ? 'happy' : 'idle'}"></div></div>`;
}
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const localDate = () => { try { return new Date().toLocaleDateString('sv-SE'); } catch { return ''; } };

function confetti(big = false) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const layer = $('confetti'); layer.replaceChildren();
  const colors = ['#f7ba21', '#ed4678', '#27a776', '#5781ef', '#e76c31'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < (big ? 130 : 32); i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--drift', `${Math.random() * 220 - 110}px`);
    p.style.setProperty('--delay', `${Math.random() * (big ? 1.4 : 0.25)}s`);
    p.style.setProperty('--dur', `${(big ? 3 : 1.6) + Math.random()}s`);
    p.style.setProperty('--rot', `${360 + Math.random() * 720}deg`);
    p.style.background = colors[i % colors.length];
    if (big) p.className = 'big';
    p.addEventListener('animationend', () => p.remove(), {once: true});
    frag.append(p);
  }
  layer.append(frag);
}

// ---------- ホーム ----------
function renderHome() {
  document.body.dataset.buddy = S.buddy;
  $('heroBuddy').innerHTML = art(S.buddy);
  setText($('greet'), S.name ? `${S.name}、いっしょに ひこう！` : 'いっしょに ひこう！');
  $('buddies').innerHTML = store.BUDDIES.map(b => `<button class="buddy" type="button" data-buddy="${b}" aria-pressed="${b === S.buddy}" aria-label="${NAMES[b]}">${art(b)}</button>`).join('');
  setText($('albumCount'), `${store.stickerCount(S)}/${store.stickerTotal()}`);
  syncSettings();
}
function syncSettings() {
  $('nameInput').value = S.name;
  for (const seg of qsa('.seg')) {
    const key = seg.dataset.key, v = S[key], cur = String(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    qsa('button', seg).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === cur)));
  }
  $('volume').value = S.volume;
  setText($('volOut'), `${S.volume}%`);
}
$('buddies').addEventListener('click', e => {
  const b = e.target.closest('[data-buddy]'); if (!b) return;
  S = {...S, buddy: b.dataset.buddy}; persist(); renderHome();
});
for (const seg of qsa('.seg')) seg.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const key = seg.dataset.key, raw = b.dataset.val;
  const value = ['mic', 'autoRef', 'guide'].includes(key) ? raw === '1' : ['a4', 'seconds'].includes(key) ? Number(raw) : raw;
  S = store.normalize({...S, [key]: value}); persist(); syncSettings();
  if (P?.tracker && key === 'tol') P.tracker.setTol(S.tol);
});
$('nameInput').addEventListener('input', () => { S = {...S, name: $('nameInput').value.slice(0, 20)}; persist(); setText($('greet'), S.name ? `${S.name}、いっしょに ひこう！` : 'いっしょに ひこう！'); });
$('volume').addEventListener('input', () => { S = {...S, volume: Number($('volume').value)}; sound.setVolume(S.volume / 100); setText($('volOut'), `${S.volume}%`); persist(); });
$('resetBtn').addEventListener('click', () => {
  if (window.confirm('シールを ぜんぶ けします。よいですか？')) { S = {...S, stickers: {}}; persist(); renderHome(); }
});
$('gear').addEventListener('click', () => { const d = $('settings'); d.open = !d.open; if (d.open) d.scrollIntoView({behavior: 'smooth', block: 'start'}); });
qsa('[data-go]').forEach(b => b.addEventListener('click', () => openPick(b.dataset.go === 'long' ? 'long' : 'song', b.dataset.go)));
$('albumBtn').addEventListener('click', () => { renderAlbum(); show('album'); });
$('albumBack').addEventListener('click', () => { renderHome(); show('home'); });

// ---------- えらぶ ----------
const editionKey = () => PK.kind === 'long' ? `long-${PK.home}` : `${PK.songId}-${PK.home}`;
function openPick(kind, id) {
  PK.kind = kind;
  if (kind === 'long') { PK.songId = 'long'; if (!PK.home) PK.home = 'A'; }
  else {
    PK.songId = id; PK.part = 'all';
    const homes = availableHomes(id);
    if (!homes.includes(PK.home)) PK.home = homes.includes('A') ? 'A' : homes[0];
  }
  renderPick(); show('pick');
}
function renderPick() {
  const isLong = PK.kind === 'long';
  setText($('pickTitle'), isLong ? 'のばす' : SONGS[PK.songId].title);
  const homes = isLong ? STRINGS.map(s => s.id) : availableHomes(PK.songId);
  $('homes').innerHTML = HOME_ORDER.map(id => {
    const s = stringById(id), ok = homes.includes(id), key = isLong ? `long-${id}` : `${PK.songId}-${id}`;
    return `<button class="home-tile" type="button" data-c="${s.color}" data-home="${id}" aria-pressed="${id === PK.home}" ${ok ? '' : 'disabled'} aria-label="${s.kana}のげん ${s.colorName}"><span class="kana">${s.kana}</span><span class="cname">${s.colorName}</span>${S.stickers[key] ? '<span class="got" aria-hidden="true">⭐</span>' : ''}</button>`;
  }).join('');
  $('partsWrap').hidden = isLong || PK.songId === 'fingers';
  $('tripsWrap').hidden = !isLong;
  setText($('homesQ'), isLong ? 'どの げんで のばす？' : 'どの いろで ひく？');
  if (!isLong && PK.songId !== 'fingers') {
    const parts = SONGS[PK.songId].parts;
    $('parts').innerHTML = parts.map(p => `<button class="part" type="button" data-part="${p.id}" aria-pressed="${p.id === PK.part}"><span class="segs">${PART_SEGS[PK.songId][p.id].map(on => `<i class="${on ? 'on' : ''}"></i>`).join('')}</span><span>${PART_LABEL[PK.songId][p.id]}</span></button>`).join('');
  }
  if (isLong) {
    $('trips').innerHTML = [1, 2, 3].map(n => `<button class="part" type="button" data-trips="${n}" aria-pressed="${n === S.trips}"><span style="font-size:1.8rem">${n}</span><span>かい</span></button>`).join('');
  }
  // 見本: はじめの8つの指の数字（先生用の目安）
  if (isLong) $('preview').innerHTML = '';
  else {
    const song = buildSong(PK.songId, PK.home, PK.part);
    $('preview').dataset.c = stringById(PK.home).color;
    $('preview').innerHTML = song.notes.slice(0, 8).map(n => `<span class="pv" data-c="${n.color}">${n.finger}</span>`).join('') + (song.notes.length > 8 ? '<span class="pv" style="background:#cfc7b6">…</span>' : '');
  }
  $('pickNote').textContent = (!isLong && PK.songId === 'twinkle') ? 'ミ（みどり）の げんは、となりの たかい げんが ないので、きらきらぼしは あか・オレンジ・あおの 3つです。' : (isLong ? '4びょうで「もと」から「さき」まで ゆみを うごかします（先生の設定で2〜6びょう）。' : '');
}
$('homes').addEventListener('click', e => { const b = e.target.closest('[data-home]'); if (!b || b.disabled) return; PK.home = b.dataset.home; renderPick(); });
$('parts').addEventListener('click', e => { const b = e.target.closest('[data-part]'); if (!b) return; PK.part = b.dataset.part; renderPick(); });
$('trips').addEventListener('click', e => { const b = e.target.closest('[data-trips]'); if (!b) return; S = {...S, trips: Number(b.dataset.trips)}; persist(); renderPick(); });
$('pickBack').addEventListener('click', () => { renderHome(); show('home'); });
$('go').addEventListener('click', () => PK.kind === 'long' ? startLong() : startSong());

// ---------- マイク ----------
async function openMic() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
  const ctx = sound.ensure(); if (!ctx) throw new Error('unsupported');
  const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, autoGainControl: false, noiseSuppression: false, channelCount: 1}, video: false});
  if (ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
  const src = ctx.createMediaStreamSource(stream), hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.707;
  const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0;
  const silent = ctx.createGain(); silent.gain.value = 0;
  src.connect(hp); hp.connect(an); an.connect(silent); silent.connect(ctx.destination);
  mic = {stream, src, hp, an, silent, buf: new Float32Array(an.fftSize)};
  stream.getAudioTracks().forEach(t => { t.onended = () => { if (P?.running) pausePlay('マイクが とまったよ'); }; });
}
function closeMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
  for (const n of [mic.src, mic.hp, mic.an, mic.silent]) { try { n.disconnect(); } catch {} }
  mic = null;
}
function readPitch() {
  if (TEST) return testReading;
  if (!mic) return {f: -1, conf: 0, rms: 0};
  mic.an.getFloatTimeDomainData(mic.buf);
  return detect(mic.buf.subarray(mic.buf.length - 2048), sound.ctx.sampleRate, PICKUP[S.pickup].minRms);
}

// ---------- 曲をひく ----------
const stageOf = n => Math.min(4, n.pos % 4 + 1);
function startSong() {
  stopAll();
  const song = buildSong(PK.songId, PK.home, PK.part);
  P = {song, session: new PlaySession(song), tracker: new HoldTracker(S.tol), rearm: new Rearm(), running: false, useMic: false, mutedUntil: 0, raf: 0, id: ++ticket, lastF: 440};
  show('play');
  renderNote();
  beginPlay(true);
}
async function beginPlay(fresh) {
  const id = P.id;
  setText($('pauseBtn'), 'やすむ');
  if (TEST) { P.useMic = true; setTapMode(false); P.running = true; setText($('status'), 'テスト（マイクなし）'); loop(); return; }
  sound.ensure();    // ボタンを押した直後に音を使えるようにする（iPhone）
  if (!S.mic) { P.useMic = false; setTapMode(true); P.running = true; loop(); return; }
  setText($('status'), 'マイクを じゅんびしています');
  try {
    await openMic();
    if (!P || P.id !== id) { closeMic(); return; }
    P.useMic = true; setTapMode(false); setText($('status'), 'おとを きいているよ');
  } catch (err) {
    if (!P || P.id !== id) return;
    P.useMic = false; setTapMode(true);
    const denied = ['NotAllowedError', 'PermissionDeniedError'].includes(err.name);
    setText($('status'), denied ? 'マイクが つかえません。「できた！」を おして すすもう' : 'マイクなしで つづけます。「できた！」を おして すすもう');
  }
  P.running = true; P.tracker.reset(); loop();
}
function setTapMode(on) { $('doneBtn').hidden = !on; $('meterWrap').hidden = on; }

function renderNote() {
  const s = P.session, n = s.current;
  $('play').dataset.c = n.color;
  setText($('finger'), String(n.finger));
  setText($('noteName'), n.name);
  $('strChip').innerHTML = `<i></i>${n.kana}の げん`;
  $('card').classList.remove('celebrating', 'shake');
  $('heard').hidden = true;
  $('companion').innerHTML = art(S.buddy, stageOf(n), false);
  $('companion').className = 'companion entering';
  $('reaction').className = 'reaction';
  setText($('reaction'), 'ひいてみよう');
  renderStrip(); renderRelation(n);
  $('pfill').style.width = `${Math.round(s.index / s.total * 100)}%`;
  setText($('combo'), s.combo >= 2 ? `れんぞく ${s.combo}！` : '');
  P.tracker.reset(); $('meter').style.width = '0%';
}
function renderStrip() {
  const s = P.session, n = s.current, bar = P.song.bars[n.bar];
  $('barStrip').innerHTML = bar.map(x => {
    const cur = x.index === s.index, done = x.index < s.index, good = s.results[x.index] === 'first' || s.results[x.index] === 'retry' || (cur && s.result === 'correct');
    return `<div class="cell ${cur ? 'current' : done ? 'done' : ''} ${good ? 'good' : ''}" data-c="${x.color}" ${cur ? 'aria-current="step"' : ''}><strong>${x.finger}</strong><span>${x.name}</span></div>`;
  }).join('');
}
// 指の関係値の図: 指のあいだの半音の数で位置を決める。2と3が近い（くっつく）のが見える。
function renderRelation(n) {
  const offs = fingerOffsets('23').slice(0, 4), xs = offs.map(o => 36 + o / 5 * 230), y = 32;
  let html = '<line class="nut" x1="12" y1="10" x2="12" y2="54"/>';
  for (const [a, b] of gluedPairs('23')) if (b <= 3) html += `<rect class="glue" x="${xs[a] - 24}" y="${y - 24}" width="${xs[b] - xs[a] + 48}" height="48" rx="24"/>`;
  offs.forEach((_, f) => { html += `<g class="${f === n.finger ? 'cur' : ''}"><circle cx="${xs[f]}" cy="${y}" r="${f === n.finger ? 21 : 16}"/><text x="${xs[f]}" y="${y + 1}">${f}</text></g>`; });
  $('relation').innerHTML = html;
}
function showHeard(h) {
  const el = $('heard');
  el.innerHTML = `いまは <span data-c="${h.color}" style="display:inline-flex;align-items:center;gap:6px"><i></i><b>${h.finger}</b></span> ${h.name} に きこえたよ`;
  el.hidden = false;
  const card = $('card'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  setText($('reaction'), 'もういちど ひいてみよう');
}
function celebrate(c) {
  const n = P.session.current;
  $('companion').innerHTML = art(S.buddy, stageOf(n), true);
  $('companion').className = 'companion cheering';
  $('card').classList.add('celebrating');
  $('reaction').className = 'reaction happy';
  setText($('reaction'), CHEERS[(P.session.index + (c.combo || 0)) % CHEERS.length]);
  setText($('combo'), P.session.combo >= 2 ? `れんぞく ${P.session.combo}！` : '');
  $('heard').hidden = true;
  const dur = sound.pon(Math.max(1, c.combo || 1));
  P.mutedUntil = performance.now() + dur * 1000 + 200;
  confetti(false);
  renderStrip();
}
function refTone() {
  if (!P) return;
  sound.ensure();
  const dur = sound.ref(midiToHz(P.session.current.midi, S.a4));
  P.mutedUntil = performance.now() + dur * 1000 + 450;
  P.tracker.reset();
  setText($('status'), 'この おとだよ。いっしょに ひいてみよう');
}
function loop() {
  if (!P || !P.running) return;
  cancelAnimationFrame(P.raf);
  P.raf = requestAnimationFrame(loop);
  const now = performance.now(), s = P.session;
  if (!TEST && P.useMic && sound.ctx && sound.ctx.state !== 'running') { pausePlay('「つづける」で つづけよう'); return; }
  if (s.deadline !== null && now >= s.deadline) { nextNote(false); if (!P || !P.running) return; }
  if (!P.useMic) return;
  if (now < P.mutedUntil) { P.tracker.reset(); return; }
  const reading = readPitch();
  if (reading.f > 0) P.lastF = reading.f;
  const voiced = P.tracker.isVoiced(reading);
  if (!P.rearm.update(now, voiced, reading.f)) { P.tracker.reset(); $('meter').style.width = '0%'; return; }
  const r = P.tracker.push(now, reading);
  $('meter').style.width = `${Math.round(r.progress * 100)}%`;
  if (r.commit !== null && s.result !== 'correct') onCommit(r.commit, now);
}
function onCommit(freq, now) {
  const s = P.session, note = s.current;
  const res = judgePitch(freq, note.midi, POOL, S.tol, S.a4);
  P.tracker.reset(); $('meter').style.width = '0%';
  if (res.ok) {
    const c = s.correct(now);
    if (c) celebrate(c);
    P.rearm.disarm(now, freq, 1500);
  } else {
    s.wrong(now);
    showHeard(res.heard);
    P.rearm.disarm(now, freq, 2500);
    if (s.attempts === 1 && S.autoRef) setTimeout(() => { if (P && P.running && P.session === s && s.result !== 'correct') refTone(); }, 450);
    else P.mutedUntil = performance.now() + sound.boing() * 1000 + 150;
  }
}
function nextNote(force) {
  const now = performance.now();
  const out = P.session.advance(now, force);
  if (!out) return;
  if (out === 'finished') { finishSong(); return; }
  const prevBar = P.song.notes[P.session.index - 1]?.bar;
  renderNote();
  if (force) { P.rearm.disarm(now, P.lastF, 800); }
  if (prevBar !== undefined && prevBar !== P.session.current.bar) { const d = sound.bar(); P.mutedUntil = Math.max(P.mutedUntil, performance.now() + d * 1000); }
}
function pausePlay(msg = 'ひとやすみ') {
  if (!P) return;
  P.running = false; cancelAnimationFrame(P.raf); sound.stopAll(); closeMic();
  setText($('pauseBtn'), 'つづける'); setText($('reaction'), msg); setText($('status'), 'マイクは おやすみ中');
  if (P.session.result === 'correct') { const out = P.session.advance(performance.now(), true); if (out === 'finished') { finishSong(); return; } renderNote(); setText($('reaction'), msg); }
  else P.session.resumeNote();
}
$('pauseBtn').addEventListener('click', () => {
  if (!P) return;
  if (P.running) pausePlay(); else { P.rearm = new Rearm(); beginPlay(false); }
});
$('refBtn').addEventListener('click', refTone);
$('nextBtn').addEventListener('click', () => { if (P) { sound.ensure(); nextNote(true); } });
$('doneBtn').addEventListener('click', () => {
  if (!P || !P.running) return;
  sound.ensure();
  const c = P.session.correct(performance.now()); if (c) celebrate(c);
});
$('playBack').addEventListener('click', () => { stopAll(); renderPick(); show('pick'); });

function stopAll() {
  ticket++;
  if (P) { P.running = false; cancelAnimationFrame(P.raf); }
  if (L) { cancelAnimationFrame(L.raf); L.voices.forEach(v => v.stop()); L = null; }
  sound.stopAll(); closeMic(); P = null;
}

function finishScreen({stars, detail, key, kindArt}) {
  const r = store.awardSticker(S, key, stars, localDate());
  S = r.state; persist();
  $('stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= stars ? '' : 'off'}" style="animation-delay:${0.15 * i}s">★</span>`).join('');
  $('finBuddy').innerHTML = art(S.buddy, 5, true);
  const ns = $('newSticker');
  if (r.isNew) {
    const home = stringById(key.split('-')[1]);
    ns.hidden = false; ns.dataset.c = home.color;
    $('stickerImg').src = `./assets/stickers/${STICKER_ART[kindArt]}.webp`;
  } else ns.hidden = true;
  setText($('finDetail'), `${detail}　シール ${store.stickerCount(S)}/${store.stickerTotal()}`);
  show('finish');
  const d = sound.fanfare(); if (r.isNew) setTimeout(() => sound.sticker(), 900);
  confetti(true);
  $('finTitle').focus({preventScroll: true});
}
function finishSong() {
  const s = P.session, total = s.total, stars = s.stars, song = P.song;
  P.running = false; cancelAnimationFrame(P.raf); sound.stopAll(); closeMic();
  const all = s.results.every(r => r === 'first' || r === 'retry');
  setText($('finTitle'), all ? 'ぜんぶ できた！' : 'さいごまで できた！');
  const keyDone = `${song.songId}-${song.homeId}`;
  P = null;
  finishScreen({stars, detail: `${total}おん おしまい！`, key: keyDone, kindArt: song.songId});
}
$('again').addEventListener('click', () => { PK.kind === 'long' ? startLong() : startSong(); });
$('other').addEventListener('click', () => { renderPick(); show('pick'); });
$('toHome').addEventListener('click', () => { renderHome(); show('home'); });

// ---------- のばす（ロングトーン）----------
function startLong() {
  stopAll();
  const home = stringById(PK.home), timeline = buildTimeline({seconds: S.seconds, trips: S.trips});
  L = {timeline, home, startAt: 0, raf: 0, lastPhase: '', lastCount: null, voices: [], guide: S.guide, lastKind: ''};
  $('long').dataset.c = home.color;
  setText($('longMid'), `${home.kana}の げん`);
  $('count').textContent = ''; $('fill').style.width = '0'; $('bigfill').style.width = '0';
  $('runner').classList.add('still'); $('runner').classList.remove('flip');
  show('long');
  const scene = $('scene'); $('runner').style.setProperty('--rh', `${Math.round(scene.clientHeight * 0.36)}px`);
  const ctx = sound.ensure();
  L.base = (ctx ? ctx.currentTime : 0) + 0.08; L.startAt = performance.now() + 80;
  syncGuideButton();
  if (ctx && L.guide) scheduleGuide(0);
  L.raf = requestAnimationFrame(longTick);
}
function scheduleGuide(fromMs) {
  const f = midiToHz(L.home.midi, S.a4);
  for (const w of toneWindows(L.timeline)) {
    if (w.t1 <= fromMs + 50) continue;
    const t0 = Math.max(w.t0, fromMs);
    L.voices.push(sound.guide(f, L.base + t0 / 1000, (w.t1 - t0) / 1000));
  }
}
function syncGuideButton() { if (!L) return; setText($('guideBtn'), L.guide ? 'おてほんの おと：なる' : 'おてほんの おと：きる'); }
$('guideBtn').addEventListener('click', () => {
  if (!L) return;
  L.guide = !L.guide; syncGuideButton();
  if (!L.guide) { L.voices.forEach(v => v.stop()); L.voices = []; }
  else { sound.ensure(); L.base = sound.now - (performance.now() - L.startAt) / 1000; scheduleGuide(Math.max(0, performance.now() - L.startAt)); }
});
function longTick() {
  if (!L) return;
  const ms = performance.now() - L.startAt;
  const st = stateAt(L.timeline, Math.max(0, ms));
  if (st.phase === 'done') { finishLong(); return; }
  const lane = $('lane'), runner = $('runner'), sprite = $('sprite');
  const laneW = lane.clientWidth, rw = sprite.offsetWidth;
  runner.style.transform = `translateX(${(st.x * laneW - rw / 2).toFixed(1)}px)`;
  $('fill').style.width = `${(st.x * 100).toFixed(1)}%`;
  $('bigfill').style.width = `${(st.x * 100).toFixed(1)}%`;
  const running = st.phase === 'down' || st.phase === 'up';
  runner.classList.toggle('still', !running);
  runner.classList.toggle('flip', st.phase === 'up' || (st.phase === 'turn' && st.seg.at === 'goal'));
  const chip = $('dirChip');
  chip.className = 'dirchip' + (st.phase === 'down' ? ' down' : st.phase === 'up' ? ' up' : '');
  setText(chip, st.phase === 'down' ? '▶ ダウン（もと → さき）' : st.phase === 'up' ? '◀ アップ（さき → もと）' : st.phase === 'turn' ? 'ゆみを かえよう' : 'じゅんび…');
  const key = st.phase + (st.n || '') + (st.seg ? st.seg.t0 : '');
  if (key !== L.lastPhase) {
    L.lastPhase = key;
    const cnt = $('count');
    if (st.phase === 'count') { setText(cnt, String(st.n)); cnt.classList.remove('pop'); void cnt.offsetWidth; cnt.classList.add('pop'); sound.tick(); }
    else if (st.phase === 'go') { setText(cnt, 'ゴー！'); cnt.classList.remove('pop'); void cnt.offsetWidth; cnt.classList.add('pop'); sound.go(); }
    else { setText(cnt, ''); }
    if (st.phase === 'turn') { sound.ding(); confetti(false); }
  }
  L.raf = requestAnimationFrame(longTick);
}
function finishLong() {
  const home = L.home;
  L.voices.forEach(v => v.stop()); cancelAnimationFrame(L.raf);
  const trips = L.timeline.trips, secs = L.timeline.seconds;
  L = null;
  setText($('finTitle'), 'のばせた！');
  finishScreen({stars: 3, detail: `${secs}びょう × ${trips}かい いきかえり`, key: `long-${home.id}`, kindArt: 'long'});
}
$('longBack').addEventListener('click', () => { stopAll(); renderPick(); show('pick'); });
$('longStop').addEventListener('click', () => { stopAll(); renderPick(); show('pick'); });

// ---------- シールちょう ----------
function renderAlbum() {
  const eds = allEditions();
  $('albumGrid').innerHTML = eds.map(e => {
    const s = stringById(e.homeId), got = S.stickers[e.key], kind = e.kind === 'long' ? 'long' : e.songId;
    const label = `${s.kana} ${STICKER_LABEL[kind]}`;
    return `<figure class="slot ${got ? '' : 'empty'}" data-c="${s.color}" style="margin:0"><img src="./assets/stickers/${STICKER_ART[kind]}.webp" alt="${got ? label : 'まだ'}">${got ? `<span class="st">${'★'.repeat(got.stars)}</span>` : ''}<small>${label}</small></figure>`;
  }).join('');
  const n = store.stickerCount(S), total = store.stickerTotal();
  setText($('albumNote'), n >= total ? 'ぜんぶ そろったよ！ バイオリン初段 ようちえん ごうかく！' : `あと ${total - n}まい。ひくと シールが ふえるよ。`);
}

// ---------- 画面を離れたら止める ----------
document.addEventListener('visibilitychange', () => {
  if (TEST || !document.hidden) return;
  if (P && P.running) pausePlay('ひとやすみ');
  if (L) { stopAll(); renderPick(); show('pick'); }
});
window.addEventListener('pagehide', () => { sound.stopAll(); closeMic(); });

// ---------- テスト用の入口（?test=1 のときだけ）----------
if (TEST) {
  window.__kids = {
    feed(f, conf = 0.95, rms = 0.05) { testReading = {f, conf, rms}; },
    silence() { testReading = {f: -1, conf: 0, rms: 0}; },
    hz: (midi) => midiToHz(midi, S.a4),
    get P() { return P; }, get L() { return L; }, get S() { return S; }
  };
}

renderHome();
show('home');
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
