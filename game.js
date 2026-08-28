"use strict";

const GAME_W = 420;
const GAME_H = 680;
const DPR = Math.min(window.devicePixelRatio || 1, 2);

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = GAME_W * DPR;
canvas.height = GAME_H * DPR;
ctx.scale(DPR, DPR);

const elScore = document.getElementById("score");
const elLevel = document.getElementById("level");
const elLives = document.getElementById("lives");
const elTarget = document.getElementById("target");
const elBestStart = document.getElementById("best-start");
const elBestOver = document.getElementById("best-over");
const elFinalScore = document.getElementById("final-score");
const elBanner = document.getElementById("banner-level");

const screenStart = document.getElementById("screen-start");
const screenPause = document.getElementById("screen-pause");
const screenOver = document.getElementById("screen-over");

const FRUITS = [
  { emoji: "🍎", size: 40, points: 10, color: "#ff6b6b", weight: 24 },
  { emoji: "🍌", size: 44, points: 15, color: "#feca57", weight: 22 },
  { emoji: "🍒", size: 38, points: 20, color: "#e84393", weight: 18 },
  { emoji: "🍇", size: 44, points: 25, color: "#8854d0", weight: 14 }
];
const STAR = { emoji: "⭐", size: 38, points: 50, color: "#ffd32a", weight: 6 };
const BOMB = { emoji: "💣", size: 42, isBomb: true };

let best = loadBest();
function loadBest() {
  try {
    return parseInt(localStorage.getItem("fm-best") || "0", 10) || 0;
  } catch (e) {
    return 0;
  }
}
function saveBest() {
  try {
    localStorage.setItem("fm-best", String(best));
  } catch (e) {}
}

const Sound = {
  ctx: null,
  muted: (function () {
    try {
      return localStorage.getItem("fm-muted") === "1";
    } catch (e) {
      return false;
    }
  })(),
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  tone(freq, dur, type, vol, delay) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol || 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur);
  },
  catch_(steps) {
    this.tone(523, 0.08, "square", 0.18);
    this.tone(659, 0.09, "square", 0.18, 0.07);
    if (steps >= 3) this.tone(784, 0.1, "square", 0.16, 0.14);
    if (steps >= 5) this.tone(1046, 0.14, "square", 0.16, 0.21);
  },
  star() {
    [660, 880, 1180, 1568].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.22, i * 0.07));
  },
  bomb() {
    if (this.muted || !this.ctx) return;
    const dur = 0.4;
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    src.connect(f);
    f.connect(g);
    g.connect(this.ctx.destination);
    src.start(t);
    this.tone(100, 0.2, "sawtooth", 0.28);
  },
  miss_() {
    this.tone(220, 0.14, "sine", 0.16);
  },
  levelUp() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, "triangle", 0.22, i * 0.09));
  },
  gameOver() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, "sine", 0.2, i * 0.17));
  },
  toggle() {
    this.muted = !this.muted;
    try {
      localStorage.setItem("fm-muted", this.muted ? "1" : "0");
    } catch (e) {}
    return this.muted;
  }
};

let state = "start";
let score = 0;
let lives = 3;
let level = 1;
let combo = 0;
let nextLevelAt = 200;
let target = null;
let targetTimer = 0;

const basket = {
  x: GAME_W / 2,
  y: GAME_H - 74,
  halfW: 46,
  halfH: 28,
  glow: 0,
  squash: 0
};

let fruits = [];
let particles = [];
let floaters = [];
let spawnTimer = 1;
let shakeTime = 0;
let shakeMag = 0;
let flash = 0;
let time = 0;
let bannerTimer = 0;

const clouds = [
  { x: 60, y: 70, s: 1, sp: 6 },
  { x: 300, y: 120, s: 0.7, sp: 9 },
  { x: 190, y: 40, s: 0.5, sp: 12 }
];

const input = { dir: 0, targetX: null, txAbs: null };

function pickWeighted() {
  const list = FRUITS.concat(STAR);
  let total = 0;
  for (const f of list) total += f.weight;
  let r = Math.random() * total;
  for (const f of list) {
    r -= f.weight;
    if (r <= 0) return f;
  }
  return FRUITS[0];
}

function spawnFruit() {
  let kind;
  const bombChance = Math.min(0.26, 0.05 + level * 0.03);
  if (Math.random() < bombChance) {
    kind = BOMB;
  } else {
    kind = pickWeighted();
  }
  const speedBase = 90 + (level - 1) * 26;
  fruits.push({
    kind,
    x: 44 + Math.random() * (GAME_W - 88),
    y: -40,
    vy: speedBase + Math.random() * 55,
    size: kind.size,
    phase: Math.random() * Math.PI * 2,
    wobble: Math.random() * Math.PI * 2
  });
  return kind.isBomb;
}

function spawnInterval() {
  return Math.max(0.5, 1.35 - level * 0.085) * (0.82 + Math.random() * 0.4);
}

function resetGame() {
  score = 0;
  lives = 3;
  level = 1;
  combo = 0;
  nextLevelAt = 200;
  fruits = [];
  particles = [];
  floaters = [];
  spawnTimer = 0.8;
  basket.x = GAME_W / 2;
  basket.glow = 0;
  shakeTime = 0;
  flash = 0;
  bannerTimer = 0;
  input.dir = 0;
  input.targetX = null;
  setTarget();
  setHud();
}

function setTarget() {
  const list = FRUITS.concat(STAR);
  target = list[Math.floor(Math.random() * list.length)];
  targetTimer = 0;
  elTarget.textContent = "🎯" + target.emoji;
}

function setHud() {
  elScore.textContent = score;
  elLevel.textContent = level;
  const hearts = "❤️".repeat(Math.max(0, lives)) + "🖤".repeat(Math.max(0, 3 - lives));
  elLives.textContent = hearts;
}

function addFloater(x, y, text, color, big) {
  floaters.push({ x, y, text, color, life: 1, big: !!big });
}

function burst(x, y, color, n, power) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (power || 120) * (0.3 + Math.random() * 0.9);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 40,
      life: 0.5 + Math.random() * 0.4,
      size: 3 + Math.random() * 5,
      color
    });
  }
}

function catchItem(f) {
  basket.glow = 0.25;
  basket.squash = 1;
  if (f.kind.isBomb) {
    lives--;
    combo = 0;
    shakeTime = 0.4;
    shakeMag = 9;
    flash = 0.5;
    burst(f.x, f.y, "#ff6b35", 26, 220);
    burst(f.x, f.y, "#ffd700", 16, 180);
    Sound.bomb();
    if (lives > 0) addFloater(f.x, f.y - 20, "¡OUCH! -1 vida", "#ff7675", true);
    else gameOver();
  } else {
    combo++;
    const isTarget = target && f.kind.emoji === target.emoji;
    const mult = 1 + Math.max(0, combo - 1) * 0.1;
    const gained = Math.round(f.kind.points * mult * (isTarget ? 2 : 1));
    score += gained;
    if (isTarget) {
      addFloater(f.x, f.y - 20, "+" + gained + " ¡OBJETIVO x2!", "#ffe66d", true);
      targetTimer = 0;
    } else {
      addFloater(f.x, f.y - 20, "+" + gained, isTarget ? "#ffe66d" : "#fff", combo >= 5);
    }
    burst(f.x, f.y, f.kind.color, 10, 140);
    if (f.kind.isStar) {
      Sound.star();
      burst(f.x, f.y, "#ffe66d", 24, 200);
      shakeTime = 0.12;
      shakeMag = 3;
    } else {
      Sound.catch_(combo);
    }
    if (score >= nextLevelAt) {
      levelUp();
    }
  }
  setHud();
}

function missItem(f) {
  combo = 0;
  Sound.miss_();
  setHud();
  if (bannerTimer > 0) return;
}

function levelUp() {
  level++;
  nextLevelAt = Math.round(nextLevelAt * 1.5);
  if (lives < 3) lives++;
  setTarget();
  bannerTimer = 2.2;
  elBanner.textContent = "⭐ ¡NIVEL " + level + "! ⭐";
  elBanner.classList.add("show");
  setTimeout(() => {
    if (bannerTimer <= 0) elBanner.classList.remove("show");
  }, 2200);
  Sound.levelUp();
  setHud();
}

function gameOver() {
  state = "gameover";
  shakeTime = 0.5;
  shakeMag = 12;
  Sound.gameOver();
  if (score > best) {
    best = score;
    saveBest();
  }
  elFinalScore.textContent = "Tu puntuación: " + score;
  elBestOver.textContent = score >= best && score > 0 ? "🏆 ¡Nuevo récord! " + best : "Récord: " + best;
  screenOver.classList.remove("hidden");
}

function toLogicalX(clientX) {
  const r = canvas.getBoundingClientRect();
  return ((clientX - r.left) / r.width) * GAME_W;
}

canvas.addEventListener("pointerdown", (e) => {
  Sound.ensure();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (err) {}
  input.targetX = toLogicalX(e.clientX);
});

canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch" || e.buttons > 0) {
    input.targetX = toLogicalX(e.clientX);
  }
});

canvas.addEventListener("pointerup", () => {
  input.targetX = null;
  input.dir = 0;
});

window.addEventListener("keydown", (e) => {
  Sound.ensure();
  const k = e.key;
  if (k === "ArrowLeft" || k === "a" || k === "A") input.dir = -1;
  else if (k === "ArrowRight" || k === "d" || k === "D") input.dir = 1;
  else if (k === "ArrowDown" || k === "s" || k === "S") input.dir = 0;
  else if ((k === " " || k === "Enter") && state === "start") startGame();
  else if ((k === " " || k === "Enter") && state === "gameover") startGame();
  else if ((k === "p" || k === "P" || k === " ") && state === "playing") pauseGame();
  else if (k === "p" || k === "P") {
    if (state === "paused") resumeGame();
  }
});

function startGame() {
  Sound.ensure();
  resetGame();
  screenStart.classList.add("hidden");
  screenPause.classList.add("hidden");
  screenOver.classList.add("hidden");
  state = "playing";
}

function pauseGame() {
  if (state !== "playing") return;
  state = "paused";
  screenPause.classList.remove("hidden");
}

function resumeGame() {
  Sound.ensure();
  state = "playing";
  screenPause.classList.add("hidden");
}

function toMenu() {
  state = "start";
  screenPause.classList.add("hidden");
  screenOver.classList.add("hidden");
  elBestStart.textContent = best > 0 ? "🏆 Récord: " + best : "";
  screenStart.classList.remove("hidden");
}

document.getElementById("btn-start").addEventListener("click", startGame);
document.getElementById("btn-restart").addEventListener("click", startGame);
document.getElementById("btn-resume").addEventListener("click", resumeGame);
document.getElementById("btn-pause").addEventListener("click", pauseGame);
document.getElementById("btn-pause-home").addEventListener("click", toMenu);
document.getElementById("btn-over-home").addEventListener("click", toMenu);

const btnSound = document.getElementById("btn-sound");
function paintSoundBtn() {
  btnSound.textContent = Sound.muted ? "🔇" : "🔊";
}
btnSound.addEventListener("click", () => {
  Sound.ensure();
  Sound.toggle();
  paintSoundBtn();
});
paintSoundBtn();

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "playing") pauseGame();
});

function update(dt) {
  time += dt;
  if (state !== "playing") return;

  if (input.targetX !== null) {
    basket.x += (input.targetX - basket.x) * Math.min(1, 9 * dt);
  }
  if (input.dir !== 0) {
    basket.x += input.dir * 370 * dt;
  }
  basket.x = Math.max(basket.halfW + 6, Math.min(GAME_W - basket.halfW - 6, basket.x));

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnFruit();
    spawnTimer = spawnInterval();
  }

  basket.glow = Math.max(0, basket.glow - dt * 0.6);
  basket.squash = Math.max(0, basket.squash - dt * 4);

  for (let i = fruits.length - 1; i >= 0; i--) {
    const f = fruits[i];
    f.y += f.vy * dt;
    f.phase += dt * 3;
    f.wobble += dt * (f.kind.isBomb ? 9 : 5);
    const hit =
      Math.abs(f.x - basket.x) < basket.halfW + f.size * 0.32 &&
      Math.abs(f.y - basket.y) < basket.halfH + f.size * 0.32;
    if (hit) {
      catchItem(f);
      fruits.splice(i, 1);
      continue;
    }
    if (f.y > GAME_H + 30) {
      missItem(f);
      fruits.splice(i, 1);
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 300 * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  for (let i = floaters.length - 1; i >= 0; i--) {
    const t = floaters[i];
    t.y -= 42 * dt;
    t.life -= dt * 1.1;
    if (t.life <= 0) floaters.splice(i, 1);
  }

  shakeTime = Math.max(0, shakeTime - dt);
  flash = Math.max(0, flash - dt * 1.4);
  bannerTimer = Math.max(0, bannerTimer - dt);
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, GAME_H);
  g.addColorStop(0, "#8edcff");
  g.addColorStop(0.6, "#bfefff");
  g.addColorStop(1, "#d9fad6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  ctx.save();
  ctx.fillStyle = "#ffe66d";
  ctx.beginPath();
  ctx.arc(348, 78, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(348, 78, 30, 0, Math.PI * 2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(348 + Math.cos(a) * 46, 78 + Math.sin(a) * 46, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  for (const c of clouds) {
    const cx = ((c.x + time * c.sp) % (GAME_W + 160)) - 80;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, c.y, 22 * c.s, 0, Math.PI * 2);
    ctx.arc(cx + 24 * c.s, c.y - 6 * c.s, 18 * c.s, 0, Math.PI * 2);
    ctx.arc(cx + 48 * c.s, c.y, 20 * c.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = "#8ed67c";
  ctx.beginPath();
  ctx.ellipse(40, GAME_H - 10, 190, 90, 0, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(GAME_W - 30, GAME_H - 6, 200, 100, 0, Math.PI, 0);
  ctx.fill();

  const gg = ctx.createLinearGradient(0, GAME_H - 90, 0, GAME_H);
  gg.addColorStop(0, "#a8e063");
  gg.addColorStop(1, "#6cc24a");
  ctx.fillStyle = gg;
  ctx.fillRect(0, GAME_H - 88, GAME_W, 88);
  ctx.fillStyle = "#8fd866";
  ctx.fillRect(0, GAME_H - 88, GAME_W, 8);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "rgba(30,90,50,0.55)";
  ctx.fillText("✿ ✿ ✿ ✿ ✿", GAME_W / 2, GAME_H - 30);
}

function drawBasket() {
  const s = 1 + basket.squash * 0.12;
  ctx.save();
  ctx.globalAlpha = basket.glow;
  ctx.fillStyle = "#ffe66d";
  ctx.beginPath();
  ctx.arc(basket.x, basket.y, 62 * basket.glow * 4 + 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(basket.x, basket.y);
  ctx.scale(s, 2 - s);
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.font = basket.halfH * 2.4 + "px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🧺", 0, 4);
  ctx.restore();
}

function drawFruit(f) {
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(Math.sin(f.wobble) * (f.kind.isBomb ? 0.25 : 0.18));
  const pulse = 1 + Math.sin(f.phase) * 0.05;
  ctx.scale(pulse, pulse);
  if (f.kind.isStar) {
    ctx.shadowColor = "#ffe66d";
    ctx.shadowBlur = 18;
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.2)";
    ctx.shadowBlur = 6;
  }
  ctx.font = f.size + "px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(f.kind.emoji, 0, 2);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, GAME_W, GAME_H);
  drawBackground();

  ctx.save();
  if (shakeTime > 0) {
    const m = shakeMag * (shakeTime / 0.4);
    ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }

  for (const f of fruits) drawFruit(f);

  if (combo >= 3) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = "#ff6b6b";
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 4;
    ctx.fillText("🔥 Racha x" + Math.round(combo), basket.x, basket.y - 58);
    ctx.shadowBlur = 0;
  }

  drawBasket();

  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const t of floaters) {
    ctx.globalAlpha = Math.max(0, t.life);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold " + (t.big ? 26 : 20) + "px sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillText(t.text, t.x + 2, t.y + 2);
    ctx.fillStyle = t.color || "#fff";
    ctx.fillText(t.text, t.x, t.y);
  }

  ctx.restore();
  ctx.globalAlpha = 1;

  if (flash > 0) {
    ctx.fillStyle = "rgba(255,60,60," + flash * 0.5 + ")";
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

elBestStart.textContent = best > 0 ? "🏆 Récord: " + best : "";
requestAnimationFrame(loop);