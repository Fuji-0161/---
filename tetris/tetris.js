'use strict';

// ============================================================
// 定数
// ============================================================

const COLS       = 10;
const ROWS       = 20;
const CELL       = 30;
const NEXT_CELL  = 24;

const LEVEL_SPEEDS = [800, 650, 500, 380, 280, 200, 150, 110, 80, 60];
const LINE_SCORES  = [0, 100, 300, 500, 800];
const GARBAGE_THRESHOLDS = [Infinity, 10, 8, 7, 6, 5, 4, 3, 2, 2, 1];

const TETROMINOES = {
  I: { color: '#00e5ff', cells: [[1,0],[1,1],[1,2],[1,3]] },
  O: { color: '#ffe600', cells: [[0,1],[0,2],[1,1],[1,2]] },
  T: { color: '#cc00ff', cells: [[0,1],[1,0],[1,1],[1,2]] },
  S: { color: '#00e676', cells: [[0,1],[0,2],[1,0],[1,1]] },
  Z: { color: '#ff1744', cells: [[0,0],[0,1],[1,1],[1,2]] },
  J: { color: '#2979ff', cells: [[0,0],[1,0],[1,1],[1,2]] },
  L: { color: '#ff6d00', cells: [[0,2],[1,0],[1,1],[1,2]] },
};

const TETROMINO_KEYS = Object.keys(TETROMINOES);
const GARBAGE_COLOR  = '#444455';

// ============================================================
// ユーティリティ
// ============================================================

function randomKey() {
  return TETROMINO_KEYS[Math.floor(Math.random() * TETROMINO_KEYS.length)];
}

function createField() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

// ============================================================
// AudioEngine
// Web Audio API を使い、外部ファイルなしで全音を生成する。
// ============================================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.bgm = null;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  playTone(freq, type, duration, gainPeak, startOffset = 0, freqRamp = null) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + startOffset;

    const osc  = this.ctx.createOscillator();
    osc.type   = type;
    osc.frequency.setValueAtTime(freqRamp ? freqRamp[0] : freq, now);
    if (freqRamp) {
      osc.frequency.linearRampToValueAtTime(freqRamp[1], now + duration);
    }

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  // ---- 効果音 ----

  playMove() {
    this.playTone(440, 'square', 0.05, 0.08);
  }

  playRotate() {
    this.playTone(600, 'square', 0.07, 0.1);
  }

  playLock() {
    this.playTone(0, 'square', 0.12, 0.15, 0, [220, 100]);
  }

  playClear(lines) {
    if (!this.ctx) return;
    if (lines === 4) {
      [261, 329, 392, 523, 659].forEach((f, i) => {
        this.playTone(f, 'sawtooth', 0.3, 0.2, i * 0.06);
      });
    } else {
      const base = 300 + lines * 80;
      this.playTone(base,       'sawtooth', 0.2, 0.2);
      this.playTone(base * 1.5, 'sawtooth', 0.2, 0.15, 0.08);
    }
  }

  playHardDrop() {
    this.playTone(0, 'sawtooth', 0.15, 0.2, 0, [800, 200]);
  }

  playGarbage() {
    this.playTone(0, 'sawtooth', 0.3, 0.25, 0,    [150, 80]);
    this.playTone(0, 'square',   0.3, 0.1,  0.05, [120, 60]);
  }

  playGameOver() {
    if (!this.ctx) return;
    [523, 440, 349, 261, 196].forEach((f, i) => {
      this.playTone(f, 'sawtooth', 0.4, 0.2, i * 0.12);
    });
  }

  // ---- BGM ----

  startBGM() {
    if (!this.ctx) return;
    this.stopBGM();

    const BPM      = 160;
    const BEAT     = 60 / BPM;
    const NOTE_GAP = 0.02;

    const N = {
      E4:329.6, D4:293.7, C4:261.6, B3:246.9, A3:220.0,
      G3:196.0, F3:174.6, E3:164.8, D3:146.8, C3:130.8,
      A4:440.0, G4:392.0, F4:349.2, B4:493.9,
      _: 0,
    };

    const melody = [
      [N.E4,2],[N.B3,1],[N.C4,1],[N.D4,2],[N.C4,1],[N.B3,1],
      [N.A3,2],[N.A3,1],[N.C4,1],[N.E4,2],[N.D4,1],[N.C4,1],
      [N.B3,3],[N.C4,1],[N.D4,2],[N.E4,2],
      [N.C4,2],[N.A3,2],[N.A3,4],
      [N._,1],[N.D4,2],[N.F4,1],[N.A4,2],[N.G4,1],[N.F4,1],
      [N.E4,3],[N.C4,1],[N.E4,2],[N.D4,1],[N.C4,1],
      [N.B3,2],[N.B3,1],[N.C4,1],[N.D4,2],[N.E4,2],
      [N.C4,2],[N.A3,2],[N.A3,4],
    ];

    this.bgm = { active: true, nodes: [], timer: null };

    const scheduleLoop = (startTime) => {
      if (!this.bgm || !this.bgm.active) return;
      let t = startTime;

      for (const [freq, beats] of melody) {
        const dur = beats * BEAT;
        if (freq > 0) {
          const osc  = this.ctx.createOscillator();
          osc.type   = 'square';
          osc.frequency.setValueAtTime(freq, t);

          const gain = this.ctx.createGain();
          gain.gain.setValueAtTime(0.06, t);
          gain.gain.setValueAtTime(0.06, t + dur - NOTE_GAP);
          gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(t);
          osc.stop(t + dur);
          this.bgm.nodes.push(osc, gain);
        }
        t += dur;
      }

      const loopDuration = t - startTime;
      this.bgm.timer = setTimeout(() => {
        scheduleLoop(startTime + loopDuration);
      }, loopDuration * 1000 - 200);
    };

    scheduleLoop(this.ctx.currentTime + 0.1);
  }

  stopBGM() {
    if (!this.bgm) return;
    this.bgm.active = false;
    clearTimeout(this.bgm.timer);
    for (const node of this.bgm.nodes) {
      try { node.disconnect(); } catch (_) {}
    }
    this.bgm = null;
  }
}

// ============================================================
// Piece クラス
// ============================================================

class Piece {
  constructor(key) {
    this.key       = key;
    this.color     = TETROMINOES[key].color;
    this.cells     = TETROMINOES[key].cells.map(([r, c]) => [r, c]);
    this.offsetRow = 0;
    this.offsetCol = Math.floor((COLS - 4) / 2);
  }

  absoluteCells() {
    return this.cells.map(([r, c]) => [r + this.offsetRow, c + this.offsetCol]);
  }

  // 時計回り90度回転: (r,c) -> (c, 3-r)
  rotatedCells() {
    return this.cells.map(([r, c]) => [c, 3 - r]);
  }
}

// ============================================================
// TetrisGame クラス
// ============================================================

class TetrisGame {
  constructor() {
    this.boardCanvas  = document.getElementById('board');
    this.boardCtx     = this.boardCanvas.getContext('2d');
    this.nextCanvas   = document.getElementById('next-canvas');
    this.nextCtx      = this.nextCanvas.getContext('2d');

    this.scoreEl      = document.getElementById('score');
    this.levelEl      = document.getElementById('level');
    this.linesEl      = document.getElementById('lines');
    this.overlay      = document.getElementById('overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlaySub   = document.getElementById('overlay-sub');
    this.boardWrapper = document.getElementById('board-wrapper');

    this.field        = createField();
    this.piece        = null;
    this.nextKey      = randomKey();
    this.score        = 0;
    this.level        = 1;
    this.lines        = 0;
    this.linesInLevel = 0;
    this.garbageAccum = 0;
    this.isRunning    = false;
    this.isGameOver   = false;
    this.dropTimer    = null;

    this.audio = new AudioEngine();

    document.addEventListener('keydown', (e) => this.handleKey(e));

    this.drawBoard();
    this.drawNext();
  }

  // ---- ゲーム制御 ----

  start() {
    this.audio.init();
    this.audio.startBGM();

    this.field        = createField();
    this.score        = 0;
    this.level        = 1;
    this.lines        = 0;
    this.linesInLevel = 0;
    this.garbageAccum = 0;
    this.isGameOver   = false;
    this.nextKey      = randomKey();
    this.updateUI();
    this.hideOverlay();
    this.spawnPiece();
    this.startDropTimer();
    this.isRunning = true;
  }

  startDropTimer() {
    if (this.dropTimer) clearInterval(this.dropTimer);
    const speed = LEVEL_SPEEDS[Math.min(this.level - 1, LEVEL_SPEEDS.length - 1)];
    this.dropTimer = setInterval(() => this.softDrop(false), speed);
  }

  gameOver() {
    this.isRunning  = false;
    this.isGameOver = true;
    clearInterval(this.dropTimer);
    this.audio.stopBGM();
    this.audio.playGameOver();
    this.showOverlay('GAME OVER', 'Press ENTER to Retry');
  }

  // ---- ピース管理 ----

  spawnPiece() {
    this.piece   = new Piece(this.nextKey);
    this.nextKey = randomKey();
    this.drawNext();
    if (this.collides(this.piece, 0, 0)) {
      this.drawBoard();
      this.gameOver();
    }
  }

  collides(piece, dr, dc, overrideCells = null) {
    const cells = overrideCells
      ? overrideCells.map(([r, c]) => [r + piece.offsetRow, c + piece.offsetCol])
      : piece.absoluteCells();
    for (const [r, c] of cells) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return true;
      if (this.field[nr][nc] !== null) return true;
    }
    return false;
  }

  lockPiece() {
    for (const [r, c] of this.piece.absoluteCells()) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        this.field[r][c] = this.piece.color;
      }
    }
    this.audio.playLock();
    this.clearLines();
    this.spawnPiece();
  }

  // ---- ライン消去・スコア・ガベージ ----

  clearLines() {
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; ) {
      if (this.field[r].every(cell => cell !== null)) {
        this.field.splice(r, 1);
        this.field.unshift(Array(COLS).fill(null));
        cleared++;
      } else {
        r--;
      }
    }
    if (cleared > 0) {
      this.audio.playClear(cleared);
      this.score += LINE_SCORES[cleared] * this.level;
      this.lines += cleared;
      this.linesInLevel += cleared;
      const newLevel = Math.floor(this.lines / 10) + 1;
      if (newLevel !== this.level) {
        this.level = newLevel;
        this.startDropTimer();
      }
      this.checkGarbage(cleared);
      this.updateUI();
    }
  }

  checkGarbage(cleared) {
    const threshold = GARBAGE_THRESHOLDS[Math.min(this.level, GARBAGE_THRESHOLDS.length - 1)];
    if (threshold === Infinity) return;
    this.garbageAccum += cleared;
    while (this.garbageAccum >= threshold) {
      this.garbageAccum -= threshold;
      this.addGarbageLine();
    }
  }

  addGarbageLine() {
    this.field.shift();
    const hole = Math.floor(Math.random() * COLS);
    this.field.push(Array.from({ length: COLS }, (_, c) =>
      c === hole ? null : GARBAGE_COLOR
    ));
    this.audio.playGarbage();
    this.flashGarbage();
  }

  flashGarbage() {
    this.boardWrapper.classList.remove('garbage-flash');
    void this.boardWrapper.offsetWidth;
    this.boardWrapper.classList.add('garbage-flash');
  }

  // ---- 入力処理 ----

  handleKey(e) {
    if (e.code === 'Enter' && !this.isRunning) { this.start(); return; }
    if (!this.isRunning) return;
    switch (e.code) {
      case 'ArrowLeft':  e.preventDefault(); this.moveHorizontal(-1); break;
      case 'ArrowRight': e.preventDefault(); this.moveHorizontal(1);  break;
      case 'ArrowDown':  e.preventDefault(); this.softDrop(true);     break;
      case 'ArrowUp':    e.preventDefault(); this.rotate();           break;
      case 'Space':      e.preventDefault(); this.hardDrop();         break;
    }
  }

  moveHorizontal(dc) {
    if (!this.collides(this.piece, 0, dc)) {
      this.piece.offsetCol += dc;
      this.audio.playMove();
      this.drawBoard();
    }
  }

  softDrop(manual) {
    if (!this.collides(this.piece, 1, 0)) {
      this.piece.offsetRow += 1;
      if (manual) this.score += 1;
      this.updateUI();
    } else {
      this.lockPiece();
    }
    this.drawBoard();
  }

  hardDrop() {
    let dropped = 0;
    while (!this.collides(this.piece, 1, 0)) {
      this.piece.offsetRow += 1;
      dropped++;
    }
    this.score += dropped * 2;
    this.audio.playHardDrop();
    this.updateUI();
    this.lockPiece();
    this.drawBoard();
  }

  rotate() {
    const rotated = this.piece.rotatedCells();
    if (!this.collides(this.piece, 0, 0, rotated)) {
      this.piece.cells = rotated;
      this.audio.playRotate();
      this.drawBoard();
      return;
    }
    for (const dc of [1, -1, 2, -2]) {
      if (!this.collides(this.piece, 0, dc, rotated)) {
        this.piece.cells    = rotated;
        this.piece.offsetCol += dc;
        this.audio.playRotate();
        this.drawBoard();
        return;
      }
    }
  }

  // ---- 描画 ----

  drawCell(ctx, x, y, color, size) {
    const m = 1;
    ctx.fillStyle = color;
    ctx.fillRect(x+m, y+m, size-m*2, size-m*2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x+m, y+m, size-m*2, 3);
    ctx.fillRect(x+m, y+m, 3, size-m*2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x+m, y+size-m-3, size-m*2, 3);
    ctx.fillRect(x+size-m-3, y+m, 3, size-m*2);
  }

  getGhostCells() {
    let ghostRow = this.piece.offsetRow;
    while (!this.collides(
      { ...this.piece, offsetRow: ghostRow+1, absoluteCells: () =>
        this.piece.cells.map(([r,c]) => [r+ghostRow+1, c+this.piece.offsetCol]) },
      0, 0
    )) { ghostRow++; }
    return this.piece.cells.map(([r,c]) => [r+ghostRow, c+this.piece.offsetCol]);
  }

  drawBoard() {
    const ctx = this.boardCtx;
    const W = COLS * CELL, H = ROWS * CELL;

    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let r = 0; r <= ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(0, r*CELL); ctx.lineTo(W, r*CELL); ctx.stroke();
    }
    for (let c = 0; c <= COLS; c++) {
      ctx.beginPath(); ctx.moveTo(c*CELL, 0); ctx.lineTo(c*CELL, H); ctx.stroke();
    }

    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (this.field[r][c]) this.drawCell(ctx, c*CELL, r*CELL, this.field[r][c], CELL);

    if (!this.piece) return;

    const ghost = this.getGhostCells();
    ctx.globalAlpha = 0.2;
    for (const [r,c] of ghost) this.drawCell(ctx, c*CELL, r*CELL, this.piece.color, CELL);
    ctx.globalAlpha = 1.0;

    for (const [r,c] of this.piece.absoluteCells())
      if (r >= 0) this.drawCell(ctx, c*CELL, r*CELL, this.piece.color, CELL);
  }

  drawNext() {
    const ctx = this.nextCtx, size = this.nextCanvas.width;
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, size, size);
    if (!this.nextKey) return;

    const def = TETROMINOES[this.nextKey], cells = def.cells;
    const minR = Math.min(...cells.map(([r])=>r));
    const maxR = Math.max(...cells.map(([r])=>r));
    const minC = Math.min(...cells.map(([,c])=>c));
    const maxC = Math.max(...cells.map(([,c])=>c));
    const sx = Math.floor((size-(maxC-minC+1)*NEXT_CELL)/2) - minC*NEXT_CELL;
    const sy = Math.floor((size-(maxR-minR+1)*NEXT_CELL)/2) - minR*NEXT_CELL;
    for (const [r,c] of cells)
      this.drawCell(ctx, sx+c*NEXT_CELL, sy+r*NEXT_CELL, def.color, NEXT_CELL);
  }

  // ---- UI更新 ----

  updateUI() {
    this.scoreEl.textContent = this.score.toLocaleString();
    this.levelEl.textContent = this.level;
    this.linesEl.textContent = this.lines;
  }

  showOverlay(title, sub) {
    this.overlayTitle.textContent = title;
    this.overlaySub.textContent   = sub;
    this.overlay.classList.add('active');
  }

  hideOverlay() {
    this.overlay.classList.remove('active');
  }
}

// ============================================================
// 起動
// ============================================================

const game = new TetrisGame();
