/* ============================================================
   NEON FLAP — script.js
   Reyy Game | Full Flappy Bird Clone with SFX & Cyberpunk Theme
   ============================================================ */

"use strict";

/* ====================================================
   AUDIO ENGINE
   Uses Web Audio API to generate synthetic SFX.
   No external files needed — all sounds are procedurally generated!
   Users can swap these with real .mp3/.wav files if desired.
   ==================================================== */
const AudioEngine = (() => {
  let ctx = null;
  let muted = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Resume if suspended (browser policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Generic tone generator
  function playTone(opts) {
    if (muted) return;
    try {
      const ac = getCtx();
      const { freq = 440, type = 'sine', duration = 0.1, vol = 0.3,
              freqEnd = null, attack = 0.01, decay = 0.05 } = opts;

      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      if (freqEnd !== null)
        osc.frequency.exponentialRampToValueAtTime(freqEnd, ac.currentTime + duration);

      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(vol, ac.currentTime + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);

      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + duration + 0.01);
    } catch (e) { /* silently ignore */ }
  }

  /* ---- Flap / Jump SFX ---- */
  function playFlap() {
    playTone({ freq: 320, freqEnd: 580, type: 'square', duration: 0.1, vol: 0.18, attack: 0.005 });
    playTone({ freq: 800, freqEnd: 1200, type: 'triangle', duration: 0.07, vol: 0.1, attack: 0.005 });
  }

  /* ---- Score SFX ---- */
  function playScore() {
    [0, 60, 120].forEach(delay => {
      setTimeout(() => {
        playTone({ freq: 660, freqEnd: 880, type: 'triangle', duration: 0.12, vol: 0.22, attack: 0.01 });
      }, delay);
    });
  }

  /* ---- Hit / Crash SFX ---- */
  function playHit() {
    // Low boom
    playTone({ freq: 180, freqEnd: 50, type: 'sawtooth', duration: 0.35, vol: 0.4, attack: 0.005 });
    // High crunch
    playTone({ freq: 900, freqEnd: 200, type: 'square', duration: 0.25, vol: 0.2, attack: 0.005 });
  }

  function setMuted(val) { muted = val; }
  function isMuted() { return muted; }

  /* Swap these URLs if you have real audio files:
     Example: const flapAudio = new Audio('sounds/flap.mp3');
     Then call flapAudio.play() instead of playTone. */

  return { playFlap, playScore, playHit, setMuted, isMuted, getCtx };
})();

/* ====================================================
   BACKGROUND PARTICLES (DOM)
   ==================================================== */
(function spawnParticles() {
  const container = document.getElementById('bgParticles');
  const colors = ['#00f5ff', '#ff00aa', '#ffe600', '#39ff14'];
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 2 + Math.random() * 4;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random()*100}%;
      bottom:${-10}%;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      animation-duration:${8 + Math.random()*14}s;
      animation-delay:${Math.random()*12}s;
      box-shadow:0 0 6px currentColor;
    `;
    container.appendChild(p);
  }
})();

/* ====================================================
   CANVAS SETUP & RESIZE
   ==================================================== */
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const wrapper = document.getElementById('gameWrapper');

function resizeCanvas() {
  // Maintain 400×600 ratio, fit inside viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight - (window.innerWidth <= 480 ? 130 : 20);
  const ratio = 400 / 600;
  let w, h;

  if (vw / vh > ratio) {
    h = Math.min(vh, 660);
    w = h * ratio;
  } else {
    w = Math.min(vw - 10, 420);
    h = w / ratio;
  }

  w = Math.floor(w);
  h = Math.floor(h);

  canvas.width  = w;
  canvas.height = h;
  wrapper.style.width  = w + 'px';
  wrapper.style.height = h + 'px';

  // Rescale game constants
  G.SCALE = w / 400;
}

window.addEventListener('resize', () => { resizeCanvas(); });

/* ====================================================
   GAME CONSTANTS (scaled dynamically)
   ==================================================== */
const G = {
  SCALE: 1,         // set by resizeCanvas
  GRAVITY:     0,   // pixels/frame² (scaled)
  JUMP_VEL:    0,   // pixels/frame  (scaled)
  PIPE_W:      0,
  PIPE_GAP:    0,
  PIPE_SPEED:  0,
  BIRD_X:      0,
  BIRD_R:      0,
  GROUND_H:    0,
};

function updateConstants() {
  const s = G.SCALE;
  G.GRAVITY    = 0.45 * s;
  G.JUMP_VEL   = -8.5 * s;
  G.PIPE_W     = 62  * s;
  G.PIPE_GAP   = 155 * s;
  G.PIPE_SPEED = 2.6 * s;
  G.BIRD_X     = 90  * s;
  G.BIRD_R     = 16  * s;
  G.GROUND_H   = 70  * s;
}

/* ====================================================
   GAME STATE
   ==================================================== */
const State = {
  START:    'start',
  PLAYING:  'playing',
  PAUSED:   'paused',
  GAMEOVER: 'gameover',
};

let gameState = State.START;
let score     = 0;
let bestScore = parseInt(localStorage.getItem('neonFlap_best') || '0', 10);
let animId    = null;

/* ====================================================
   BIRD OBJECT
   ==================================================== */
const bird = {
  x: 0, y: 0,
  vy: 0,       // vertical velocity
  angle: 0,    // rotation in radians for visual tilt
  trail: [],   // for neon trail effect

  reset() {
    this.x = G.BIRD_X;
    this.y = canvas.height / 2;
    this.vy = 0;
    this.angle = 0;
    this.trail = [];
  },

  // Apply physics every frame
  update() {
    this.vy += G.GRAVITY;         // Gravity pulls down
    this.y  += this.vy;

    // Tilt bird toward velocity direction (visual feedback)
    const targetAngle = Math.min(Math.max(this.vy * 0.06, -0.45), 1.2);
    this.angle += (targetAngle - this.angle) * 0.18;

    // Store trail positions (last 8 frames)
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 8) this.trail.shift();
  },

  // Jump: give upward velocity
  jump() {
    this.vy = G.JUMP_VEL;
    AudioEngine.playFlap();
  },

  draw() {
    const r = G.BIRD_R;
    ctx.save();

    // === Neon trail ===
    for (let i = 0; i < this.trail.length - 1; i++) {
      const t = this.trail[i];
      const alpha = (i / this.trail.length) * 0.35;
      const radius = r * 0.5 * (i / this.trail.length);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#00f5ff';
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // === Bird body: translate & rotate ===
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Outer glow
    const grd = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.6);
    grd.addColorStop(0, 'rgba(0,245,255,0.5)');
    grd.addColorStop(1, 'rgba(0,245,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const bodyGrd = ctx.createRadialGradient(-r*0.2, -r*0.2, r*0.1, 0, 0, r);
    bodyGrd.addColorStop(0, '#a0fff8');
    bodyGrd.addColorStop(0.5, '#00c8d4');
    bodyGrd.addColorStop(1, '#0055aa');
    ctx.fillStyle = bodyGrd;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Neon ring
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 2 * G.SCALE;
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur  = 10;
    ctx.stroke();

    // Eye
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(r * 0.38, -r * 0.22, r * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#001a33';
    ctx.beginPath();
    ctx.arc(r * 0.44, -r * 0.2, r * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // Wing
    ctx.fillStyle = 'rgba(0,200,220,0.6)';
    ctx.beginPath();
    ctx.ellipse(-r*0.1, r*0.3, r*0.55, r*0.22, 0.4, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  },
};

/* ====================================================
   PIPES
   ==================================================== */
const pipes = {
  list: [],     // [{x, topH, scored}]
  spawnTimer: 0,
  SPAWN_RATE: 90, // frames between spawns

  reset() {
    this.list = [];
    this.spawnTimer = 0;
  },

  update() {
    this.spawnTimer++;
    if (this.spawnTimer >= this.SPAWN_RATE) {
      this.spawnTimer = 0;
      this.spawn();
    }

    for (const p of this.list) {
      p.x -= G.PIPE_SPEED;

      // Score: bird passed the pipe
      if (!p.scored && p.x + G.PIPE_W < bird.x) {
        p.scored = true;
        score++;
        AudioEngine.playScore();
        spawnScorePopup(bird.x, bird.y - 30);
        updateHudScore();
      }
    }

    // Remove off-screen pipes
    this.list = this.list.filter(p => p.x + G.PIPE_W > -10);
  },

  spawn() {
    const h = canvas.height;
    const minH = h * 0.12;
    const maxH = h - G.GROUND_H - G.PIPE_GAP - minH;
    const topH = minH + Math.random() * (maxH - minH);
    this.list.push({ x: canvas.width + 10, topH, scored: false });
  },

  draw() {
    for (const p of this.list) {
      const bottomY = p.topH + G.PIPE_GAP;
      const bottomH = canvas.height - G.GROUND_H - bottomY;
      drawPipe(p.x, 0, G.PIPE_W, p.topH, true);
      drawPipe(p.x, bottomY, G.PIPE_W, bottomH, false);
    }
  },
};

/* Draw a single pipe segment with cyberpunk style */
function drawPipe(x, y, w, h, isTop) {
  const capH = 20 * G.SCALE;
  const capW = w + 10 * G.SCALE;
  const capX = x - 5 * G.SCALE;

  // Body gradient
  const grd = ctx.createLinearGradient(x, 0, x + w, 0);
  grd.addColorStop(0,   '#0d3b1f');
  grd.addColorStop(0.3, '#1a7a3c');
  grd.addColorStop(0.6, '#0d3b1f');
  grd.addColorStop(1,   '#051809');

  ctx.fillStyle = grd;
  ctx.fillRect(x, y, w, h);

  // Neon edge lines
  ctx.strokeStyle = '#39ff14';
  ctx.lineWidth = 1.5 * G.SCALE;
  ctx.shadowColor = '#39ff14';
  ctx.shadowBlur  = 8;
  ctx.strokeRect(x, y, w, h);

  // Cap
  const capY = isTop ? h - capH : y - capH;
  const capGrd = ctx.createLinearGradient(capX, 0, capX + capW, 0);
  capGrd.addColorStop(0,   '#0d4a22');
  capGrd.addColorStop(0.3, '#22aa55');
  capGrd.addColorStop(0.6, '#0d4a22');
  capGrd.addColorStop(1,   '#051f0e');

  ctx.fillStyle = capGrd;
  ctx.fillRect(capX, capY, capW, capH);

  ctx.strokeStyle = '#39ff14';
  ctx.strokeRect(capX, capY, capW, capH);
  ctx.shadowBlur = 0;
}

/* ====================================================
   GROUND
   ==================================================== */
function drawGround() {
  const y = canvas.height - G.GROUND_H;
  const w = canvas.width;
  const h = G.GROUND_H;

  // Ground body
  const grd = ctx.createLinearGradient(0, y, 0, canvas.height);
  grd.addColorStop(0, '#0a0e20');
  grd.addColorStop(1, '#000508');
  ctx.fillStyle = grd;
  ctx.fillRect(0, y, w, h);

  // Neon top line
  ctx.strokeStyle = '#00f5ff';
  ctx.lineWidth = 2 * G.SCALE;
  ctx.shadowColor = '#00f5ff';
  ctx.shadowBlur  = 10;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Subtle horizontal scan-lines in ground
  for (let i = 1; i < 5; i++) {
    ctx.strokeStyle = `rgba(0,245,255,${0.04 + i * 0.01})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + i * (h / 5));
    ctx.lineTo(w, y + i * (h / 5));
    ctx.stroke();
  }
}

/* ====================================================
   BACKGROUND (starfield + scan lines)
   ==================================================== */
const stars = (() => {
  const arr = [];
  for (let i = 0; i < 55; i++) {
    arr.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.5 + Math.random() * 1.5,
      a: 0.3 + Math.random() * 0.7,
      twinkle: Math.random() * Math.PI * 2,
    });
  }
  return arr;
})();

let scanOffset = 0;

function drawBackground() {
  // Deep space gradient
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, '#020818');
  bg.addColorStop(1, '#010510');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle horizon glow
  const horizon = ctx.createRadialGradient(
    canvas.width/2, canvas.height * 0.6,
    0,
    canvas.width/2, canvas.height * 0.6,
    canvas.width * 0.8
  );
  horizon.addColorStop(0, 'rgba(255,0,170,0.06)');
  horizon.addColorStop(1, 'transparent');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Stars
  const now = Date.now() / 1000;
  for (const s of stars) {
    const twinkled = s.a * (0.6 + 0.4 * Math.sin(now * 2 + s.twinkle));
    ctx.globalAlpha = twinkled;
    ctx.fillStyle = '#e0f7ff';
    ctx.beginPath();
    ctx.arc(s.x * canvas.width, s.y * (canvas.height - G.GROUND_H), s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Moving horizontal scan-line
  scanOffset = (scanOffset + 0.5) % canvas.height;
  const scanGrd = ctx.createLinearGradient(0, scanOffset - 12, 0, scanOffset + 12);
  scanGrd.addColorStop(0, 'transparent');
  scanGrd.addColorStop(0.5, 'rgba(0,245,255,0.04)');
  scanGrd.addColorStop(1, 'transparent');
  ctx.fillStyle = scanGrd;
  ctx.fillRect(0, scanOffset - 12, canvas.width, 24);
}

/* ====================================================
   SCORE POPUPS (floating "+1" text on canvas)
   ==================================================== */
const scorePopups = [];

function spawnScorePopup(x, y) {
  scorePopups.push({ x, y, alpha: 1, vy: -1.5 * G.SCALE, life: 0 });
}

function updateAndDrawScorePopups() {
  for (let i = scorePopups.length - 1; i >= 0; i--) {
    const p = scorePopups[i];
    p.y += p.vy;
    p.life++;
    p.alpha = Math.max(0, 1 - p.life / 55);

    if (p.alpha <= 0) { scorePopups.splice(i, 1); continue; }

    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.font = `bold ${18 * G.SCALE}px 'Orbitron', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe600';
    ctx.shadowColor = '#ffe600';
    ctx.shadowBlur = 10;
    ctx.fillText('+1', p.x, p.y);
    ctx.restore();
  }
}

/* ====================================================
   COLLISION DETECTION
   Axis-Aligned Bounding Box (AABB) with circle approximation for bird
   ==================================================== */
function checkCollision() {
  const bx = bird.x;
  const by = bird.y;
  const br = G.BIRD_R * 0.78; // slightly smaller hitbox for fairness

  // Ground collision
  if (by + br >= canvas.height - G.GROUND_H) return true;
  // Ceiling collision
  if (by - br <= 0) return true;

  // Pipe collisions
  for (const p of pipes.list) {
    const px = p.x, pw = G.PIPE_W;
    const capW = pw + 10 * G.SCALE;
    const capX = px - 5 * G.SCALE;

    // Only check pipes near the bird
    if (bx + br < capX || bx - br > capX + capW) continue;

    // Top pipe (include cap width)
    const topBottom = p.topH;
    if (by - br < topBottom) return true;

    // Bottom pipe
    const botTop = p.topH + G.PIPE_GAP;
    if (by + br > botTop) return true;
  }

  return false;
}

/* ====================================================
   HUD
   ==================================================== */
function updateHudScore() {
  document.getElementById('hudScore').textContent = score;
}

/* ====================================================
   SCREENS
   ==================================================== */
function showScreen(id) {
  ['startScreen','gameOverScreen','pauseScreen'].forEach(s => {
    document.getElementById(s).classList.add('hidden');
  });
  if (id) document.getElementById(id).classList.remove('hidden');
}

function showHud(show) {
  document.getElementById('hud').classList.toggle('hidden', !show);
}

function updateStartBest() {
  document.getElementById('startBestScore').textContent = bestScore;
}

function updateGameOverScreen() {
  document.getElementById('finalScore').textContent = score;
  document.getElementById('bestScore').textContent  = bestScore;
}

/* ====================================================
   GAME LOOP (requestAnimationFrame)
   ==================================================== */
let lastTime = 0;

function gameLoop(ts) {
  if (gameState !== State.PLAYING) return;
  animId = requestAnimationFrame(gameLoop);

  // --- Update ---
  updateConstants();   // keep constants in sync after resize
  bird.update();
  pipes.update();

  // Collision detection
  if (checkCollision()) {
    triggerGameOver();
    return;
  }

  // --- Draw ---
  drawBackground();
  pipes.draw();
  drawGround();
  bird.draw();
  updateAndDrawScorePopups();
}

/* ====================================================
   GAME ACTIONS
   ==================================================== */
function startGame() {
  score = 0;
  updateHudScore();
  bird.reset();
  pipes.reset();
  showScreen(null);
  showHud(true);
  gameState = State.PLAYING;
  animId = requestAnimationFrame(gameLoop);
}

function triggerGameOver() {
  gameState = State.GAMEOVER;
  AudioEngine.playHit();
  cancelAnimationFrame(animId);

  // Save best score to localStorage
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('neonFlap_best', bestScore);
  }

  // Draw last frame with game-over flash
  flashScreen();
  setTimeout(() => {
    showHud(false);
    updateGameOverScreen();
    showScreen('gameOverScreen');
  }, 350);
}

function flashScreen() {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 0, 100, 0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function pauseGame() {
  if (gameState !== State.PLAYING) return;
  gameState = State.PAUSED;
  cancelAnimationFrame(animId);
  showScreen('pauseScreen');
}

function resumeGame() {
  if (gameState !== State.PAUSED) return;
  gameState = State.PLAYING;
  showScreen(null);
  animId = requestAnimationFrame(gameLoop);
}

/* ====================================================
   INPUT HANDLING
   ==================================================== */
function handleJump() {
  if (gameState === State.PLAYING) {
    bird.jump();
  } else if (gameState === State.START) {
    // Quick-start on first tap
    // (or use the button — both work)
  }
}

// Keyboard: Spacebar
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (gameState === State.PAUSED) { resumeGame(); return; }
    handleJump();
  }
  if (e.code === 'KeyP') {
    if (gameState === State.PLAYING) pauseGame();
    else if (gameState === State.PAUSED) resumeGame();
  }
});

// Mouse click on canvas
canvas.addEventListener('click', () => {
  if (gameState === State.PLAYING) handleJump();
});

// Touch on canvas (mobile)
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (gameState === State.PLAYING) handleJump();
}, { passive: false });

// Jump button (mobile)
document.getElementById('jumpBtn').addEventListener('touchstart', (e) => {
  e.preventDefault();
  e.stopPropagation();
  handleJump();
}, { passive: false });
document.getElementById('jumpBtn').addEventListener('click', handleJump);

// Start button
document.getElementById('startBtn').addEventListener('click', () => {
  AudioEngine.getCtx(); // unlock audio context on user gesture
  startGame();
});

// Restart button
document.getElementById('restartBtn').addEventListener('click', () => {
  AudioEngine.getCtx();
  startGame();
});

// Pause button (HUD)
document.getElementById('pauseBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (gameState === State.PLAYING) pauseGame();
});

// Resume button
document.getElementById('resumeBtn').addEventListener('click', resumeGame);

// Mute button
const muteBtn = document.getElementById('muteBtn');
muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const nowMuted = !AudioEngine.isMuted();
  AudioEngine.setMuted(nowMuted);
  document.getElementById('muteIcon').textContent = nowMuted ? '🔇' : '🔊';
  muteBtn.style.opacity = nowMuted ? '0.5' : '1';
});

/* ====================================================
   MOBILE: Show jump button if touch device
   ==================================================== */
function detectMobile() {
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.querySelector('.mobile-jump-zone').style.display = 'flex';
  }
}
detectMobile();

/* ====================================================
   INIT
   ==================================================== */
resizeCanvas();
updateConstants();
bird.reset();
updateStartBest();
showScreen('startScreen');
showHud(false);

// Draw a static background on start screen so canvas isn't blank
(function drawStaticBg() {
  if (gameState === State.START) {
    updateConstants();
    drawBackground();
    drawGround();

    // Draw idle bird
    bird.x = G.BIRD_X;
    bird.y = canvas.height / 2;
    bird.angle = -0.15;
    bird.trail = [];
    bird.draw();

    // Idle float animation
    bird.y = canvas.height / 2 + Math.sin(Date.now() / 400) * 8 * G.SCALE;
    requestAnimationFrame(drawStaticBg);
  }
})();
