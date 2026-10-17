// 1回の演奏（曲の1つの版）の進み方。画面にもマイクにも触れない。
export const SUCCESS_MS = 850;      // 正解の演出が終わるまで
export const ERROR_WAIT_MS = 4000;  // 外れたあと、弾き直しを待ってから次へ進むまで

export class PlaySession {
  constructor(song) {
    if (!song || !song.notes || !song.notes.length) throw new RangeError('song has no notes');
    this.song = song;
    this.notes = song.notes;
    this.index = 0;
    this.results = [];   // 'first'（1回目で正解）| 'retry'（外したあとで正解）| 'passed'（つぎへ・時間切れ）
    this.combo = 0;
    this.bestCombo = 0;
    this.done = false;
    this.resetNote();
  }
  get current() { return this.notes[this.index]; }
  get total() { return this.notes.length; }
  resetNote() { this.deadline = null; this.result = null; this.attempts = 0; }

  // 外れたとき。このおんで最初の外れなら true（お手本・外れ表示を出す合図）
  wrong(now) {
    if (this.done || this.result === 'correct') return false;
    this.attempts++;
    this.combo = 0;
    if (this.deadline === null) { this.deadline = now + ERROR_WAIT_MS; this.result = 'waiting'; }
    return true;
  }
  // 合ったとき。{first, combo} を返す。すでに正解済みなら null
  correct(now) {
    if (this.done || this.result === 'correct') return null;
    const first = this.attempts === 0;
    this.result = 'correct';
    this.deadline = now + SUCCESS_MS;
    this.combo = first ? this.combo + 1 : 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    return {first, combo: this.combo};
  }
  // 期限が来たか force なら次へ。'next' | 'finished' | null
  advance(now, force = false) {
    if (this.done) return null;
    if (!force && (this.deadline === null || now < this.deadline)) return null;
    let result;
    if (this.result === 'correct') result = this.attempts === 0 ? 'first' : 'retry';
    else { result = 'passed'; this.combo = 0; }
    this.results.push(result);
    if (this.index + 1 >= this.notes.length) { this.done = true; return 'finished'; }
    this.index++;
    this.resetNote();
    return 'next';
  }
  // 休憩から戻ったときなど、いまの音をやり直す
  resumeNote() { if (this.result !== 'correct') this.resetNote(); }

  get firstCount() { return this.results.filter(r => r === 'first').length; }
  get stars() {
    const n = this.results.length || 1, ratio = this.firstCount / n;
    return ratio >= 0.85 ? 3 : ratio >= 0.55 ? 2 : 1;   // どんなときも星は1つ以上
  }
}
