// Canvas fireworks engine: a starry background canvas plus an additive
// particle canvas, driven by a single requestAnimationFrame loop.

const TAU = Math.PI * 2;

export const rand = (min, max) => Math.random() * (max - min) + min;
export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function hslHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

const RAINBOW = Array.from({ length: 24 }, (_, i) => hslHex(i * 15, 95, 68));

// Soft radial glow sprites, cached per color so drawing a glow is one drawImage.
const sprites = new Map();
function glowSprite(color) {
  let sprite = sprites.get(color);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const g = sprite.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, withAlpha(color, 1));
    grad.addColorStop(0.2, withAlpha(color, 0.45));
    grad.addColorStop(0.5, withAlpha(color, 0.12));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sprites.set(color, sprite);
  }
  return sprite;
}

// Shape outlines, as points normalized to roughly [-1, 1].
function heartPoints(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push([x / 17, y / 17 + 0.1]);
  }
  return pts;
}

function starPoints(n) {
  const corners = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2;
    const r = i % 2 ? 0.42 : 1;
    corners.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const pts = [];
  const perEdge = Math.max(3, Math.round(n / 10));
  for (let i = 0; i < 10; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 10];
    for (let j = 0; j < perEdge; j++) {
      const t = j / perEdge;
      pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  return pts;
}

// Rasterize text offscreen and sample its pixels, so a burst can spell it.
const textCache = new Map();
function textPoints(text, max = 260) {
  if (textCache.has(text)) return textCache.get(text);
  const size = 120;
  const font = `700 ${size}px "Outfit", "Segoe UI", system-ui, sans-serif`;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 20;
  const h = Math.ceil(size * 1.3);
  canvas.width = w;
  canvas.height = h;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(text, w / 2, h / 2);

  const data = g.getImageData(0, 0, w, h).data;
  let pts = [];
  for (let y = 0; y < h; y += 5) {
    for (let x = 0; x < w; x += 5) {
      if (data[(y * w + x) * 4 + 3] > 128) pts.push([x - w / 2, y - h / 2]);
    }
  }
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]];
  }
  const half = Math.max(w, h) / 2;
  pts = pts.slice(0, max).map(([x, y]) => [x / half, y / half]);
  textCache.set(text, pts);
  return pts;
}

export class Sky {
  constructor(bgCanvas, fxCanvas) {
    this.bgCanvas = bgCanvas;
    this.fxCanvas = fxCanvas;
    this.bg = bgCanvas.getContext('2d');
    this.fx = fxCanvas.getContext('2d');

    this.rockets = [];
    this.particles = [];
    this.flashes = [];
    this.lights = [];
    this.stars = [];
    this.meteor = null;
    this.nextMeteor = rand(4, 9);

    // Screen rect the director keeps bursts away from (the name).
    this.exclusion = null;
    this.onFrame = null;
    this.onBurst = null;
    this.onLaunch = null;

    this.time = 0;
    this.raf = 0;
    this.last = 0;
    this.calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.frame = this.frame.bind(this);
    this.resize();
    this.makeStars();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    for (const [canvas, ctx] of [
      [this.bgCanvas, this.bg],
      [this.fxCanvas, this.fx],
    ]) {
      canvas.width = Math.round(this.width * dpr);
      canvas.height = Math.round(this.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.scale = clamp(Math.min(this.width, this.height) / 760, 0.5, 1.35);
    this.maxParticles = this.width * this.height < 600 * 900 ? 1600 : 3200;
  }

  // Stars are stored in normalized coordinates so resizes never reshuffle them.
  makeStars() {
    const count = clamp(Math.round((this.width * this.height) / 5200), 90, 320);
    const tints = ['#ffffff', '#fff4e0', '#dfe8ff', '#ffe9f4'];
    this.stars = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random() ** 1.4 * 0.92,
      r: Math.random() < 0.08 ? rand(1.4, 2.2) : rand(0.5, 1.3),
      base: rand(0.25, 0.8),
      amp: rand(0.1, 0.35),
      speed: rand(0.6, 2.2),
      phase: rand(0, TAU),
      tint: pick(tints),
    })).sort((a, b) => (a.tint < b.tint ? -1 : 1));
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  clear() {
    this.rockets.length = 0;
    this.particles.length = 0;
    this.flashes.length = 0;
    this.lights.length = 0;
  }

  frame(now) {
    // Clamp dt so a backgrounded tab pauses the show instead of skipping it.
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.time += dt;
    this.onFrame?.(dt);
    this.update(dt);
    this.drawSky();
    this.drawFx();
    this.raf = requestAnimationFrame(this.frame);
  }

  // A rocket rises from below the horizon and peaks exactly at (tx, ty).
  launch({ x, tx, ty, payload, g = 0.13, color = '#ffe8c2' }) {
    const gs = g * this.scale;
    const y = this.height + 6;
    const h = Math.max(60, y - ty);
    const vy = -Math.sqrt(2 * gs * h);
    const frames = -vy / gs;
    this.rockets.push({ x, y, tx: x, ty: y, vx: (tx - x) / frames, vy, g: gs, payload, color });
    this.onLaunch?.({ duration: frames / 60, x });
  }

  spark(x, y, vx, vy, o, extra) {
    const life = rand(1.0, 1.6) * o.life * (extra?.lifeMul ?? 1);
    const p = {
      x,
      y,
      tx: x,
      ty: y,
      vx,
      vy,
      drag: 0.955,
      g: 0.035 * this.scale,
      life,
      max: life,
      size: rand(1.3, 2.3) * clamp(this.scale, 0.8, 1.15),
      lag: 0.3,
      color: o.colors[0],
      color2: null,
      glow: Math.random() < 0.12,
      flicker: 0,
      seed: rand(0, TAU),
      ember: 0,
      emberColor: null,
      split: false,
      lifeMul: 1,
    };
    if (extra) Object.assign(p, extra);
    this.particles.push(p);
    return p;
  }

  ember(x, y, color) {
    if (this.particles.length >= this.maxParticles) return;
    const life = rand(0.2, 0.45);
    this.particles.push({
      x, y, tx: x, ty: y,
      vx: rand(-0.3, 0.3), vy: rand(0.2, 1),
      drag: 0.92, g: 0.03 * this.scale,
      life, max: life,
      size: rand(0.6, 1.1), lag: 0.5,
      color, color2: null, glow: false, flicker: 0, seed: 0,
      ember: 0, emberColor: null, split: false, lifeMul: 1,
    });
  }

  burst(x, y, payload = {}) {
    const scale = payload.scale ?? 1;
    const room = this.maxParticles - this.particles.length;
    const o = {
      colors: payload.colors?.length ? payload.colors : ['#ffffff'],
      scale,
      life: payload.life ?? 1,
      R: 150 * this.scale * scale,
      n: Math.max(8, Math.min(Math.round(85 * scale * (payload.density ?? 1)), Math.floor(room * 0.7))),
      text: payload.text,
    };
    (PATTERNS[payload.pattern] || PATTERNS.peony).call(this, x, y, o);

    const flashSize = o.R * (this.calm ? 0.35 : 0.6);
    this.flashes.push({ x, y, size: flashSize, life: 0.22, max: 0.22, color: o.colors[0] });
    if (this.lights.length < 6) {
      const r = o.R * 2.6;
      this.lights.push({ x, y, r, color: o.colors[0], alpha: Math.min(0.12, 0.07 * scale) * (this.calm ? 0.5 : 1), life: 0.9, max: 0.9 });
    }
    this.onBurst?.({ x, y, scale, color: o.colors[0], pattern: payload.pattern });
  }

  shape(x, y, pts, o, R, colorFor) {
    const drag = 0.9;
    const k = 1 - drag;
    const room = this.maxParticles - this.particles.length;
    const step = pts.length > room ? Math.ceil(pts.length / Math.max(room, 1)) : 1;
    for (let i = 0; i < pts.length; i += step) {
      const [px, py] = pts[i];
      this.spark(x, y, px * R * k * rand(0.98, 1.02), py * R * k * rand(0.98, 1.02), o, {
        drag,
        g: 0.004 * this.scale,
        lag: 0.35,
        color: colorFor(i),
        size: rand(1.8, 2.6),
        glow: Math.random() < 0.3,
        lifeMul: 1.5,
      });
    }
  }

  ring(x, y, o, v, n, color, tilt, rot, extra) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const dx = Math.cos(a);
      const dy = Math.sin(a) * tilt;
      const s = v * rand(0.98, 1.02);
      this.spark(x, y, (dx * cos - dy * sin) * s, (dx * sin + dy * cos) * s, o, {
        color,
        glow: Math.random() < 0.25,
        lifeMul: 1.1,
        ...extra,
      });
    }
  }

  // Spherical burst projected to 2D, so particles crowd toward the rim.
  sphere(x, y, o, v, n, colorFor, extra) {
    for (let i = 0; i < n; i++) {
      const u = rand(-1, 1);
      const th = rand(0, TAU);
      const m = Math.sqrt(1 - u * u) * rand(0.9, 1.05);
      this.spark(x, y, Math.cos(th) * m * v, Math.sin(th) * m * v, o, { color: colorFor(i, th), ...extra });
    }
  }

  split(p) {
    const rot = rand(0, TAU);
    for (let i = 0; i < 4; i++) {
      if (this.particles.length >= this.maxParticles) return;
      const a = rot + (i * Math.PI) / 2;
      const v = 3.2 * this.scale;
      const life = rand(0.5, 0.8);
      this.particles.push({
        x: p.x, y: p.y, tx: p.x, ty: p.y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        drag: 0.94, g: 0.03 * this.scale,
        life, max: life,
        size: 1.6, lag: 0.3,
        color: p.color2 || p.color, color2: null, glow: true, flicker: 0, seed: 0,
        ember: 0, emberColor: null, split: false, lifeMul: 1,
      });
    }
  }

  update(dt) {
    const k = dt * 60;

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.vy += r.g * k;
      r.x += r.vx * k;
      r.y += r.vy * k;
      const f = 1 - Math.pow(1 - 0.22, k);
      r.tx += (r.x - r.tx) * f;
      r.ty += (r.y - r.ty) * f;
      if (Math.random() < 0.5 * k) this.ember(r.x, r.y, r.color);
      if (r.vy >= -0.3) {
        this.rockets[i] = this.rockets[this.rockets.length - 1];
        this.rockets.pop();
        this.burst(r.x, r.y, r.payload);
      }
    }

    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        if (p.split) this.split(p);
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      const d = Math.pow(p.drag, k);
      p.vx *= d;
      p.vy = p.vy * d + p.g * k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      // The tail chases the head, which draws a natural streak behind it.
      const f = 1 - Math.pow(1 - p.lag, k);
      p.tx += (p.x - p.tx) * f;
      p.ty += (p.y - p.ty) * f;
      if (p.ember && Math.random() < p.ember * k) this.ember(p.x, p.y, p.emberColor || p.color);
    }

    for (const list of [this.flashes, this.lights]) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].life -= dt;
        if (list[i].life <= 0) list.splice(i, 1);
      }
    }

    if (this.meteor) {
      const m = this.meteor;
      m.x += m.vx * k;
      m.y += m.vy * k;
      m.life -= dt;
      if (m.life <= 0) this.meteor = null;
    } else if (!this.calm) {
      this.nextMeteor -= dt;
      if (this.nextMeteor <= 0) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        const life = rand(0.7, 1.1);
        this.meteor = {
          x: rand(0.15, 0.85) * this.width,
          y: rand(0.03, 0.3) * this.height,
          vx: dir * rand(9, 14) * this.scale,
          vy: rand(3, 5) * this.scale,
          life,
          max: life,
        };
        this.nextMeteor = rand(7, 15);
      }
    }
  }

  drawSky() {
    const { bg, width: w, height: h } = this;
    bg.clearRect(0, 0, w, h);

    for (const l of this.lights) {
      const a = l.alpha * (l.life / l.max);
      const g = bg.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, withAlpha(l.color, a));
      g.addColorStop(1, withAlpha(l.color, 0));
      bg.fillStyle = g;
      bg.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }

    let tint = '';
    for (const s of this.stars) {
      const a = clamp(s.base + Math.sin(this.time * s.speed + s.phase) * s.amp, 0.05, 1);
      const x = s.x * w;
      const y = s.y * h;
      if (s.r > 1.4) {
        bg.globalAlpha = a * 0.5;
        bg.drawImage(glowSprite(s.tint), x - 6, y - 6, 12, 12);
      }
      if (s.tint !== tint) {
        tint = s.tint;
        bg.fillStyle = tint;
      }
      bg.globalAlpha = a;
      bg.fillRect(x, y, s.r, s.r);
    }
    bg.globalAlpha = 1;

    if (this.meteor) {
      const m = this.meteor;
      const a = Math.sin((m.life / m.max) * Math.PI);
      const tx = m.x - m.vx * 9;
      const ty = m.y - m.vy * 9;
      const g = bg.createLinearGradient(tx, ty, m.x, m.y);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, `rgba(255,255,255,${0.8 * a})`);
      bg.strokeStyle = g;
      bg.lineWidth = 1.4;
      bg.lineCap = 'round';
      bg.beginPath();
      bg.moveTo(tx, ty);
      bg.lineTo(m.x, m.y);
      bg.stroke();
    }
  }

  drawFx() {
    const { fx, width: w, height: h } = this;
    fx.clearRect(0, 0, w, h);
    fx.globalCompositeOperation = 'lighter';
    fx.lineCap = 'round';

    for (const f of this.flashes) {
      const r = f.life / f.max;
      const s = f.size * (1.3 - r * 0.3);
      fx.globalAlpha = r * 0.5;
      fx.drawImage(glowSprite('#fff6e8'), f.x - s / 2, f.y - s / 2, s, s);
      fx.globalAlpha = r * 0.35;
      fx.drawImage(glowSprite(f.color), f.x - s, f.y - s, s * 2, s * 2);
    }

    for (const r of this.rockets) {
      fx.globalAlpha = 1;
      fx.strokeStyle = r.color;
      fx.lineWidth = 2;
      fx.beginPath();
      fx.moveTo(r.tx, r.ty);
      fx.lineTo(r.x, r.y + 0.01);
      fx.stroke();
      fx.globalAlpha = 0.7;
      fx.drawImage(glowSprite(r.color), r.x - 8, r.y - 8, 16, 16);
    }

    for (const p of this.particles) {
      const r = p.life / p.max;
      let a = r < 0.6 ? r / 0.6 : 1;
      if (p.flicker && Math.sin(this.time * p.flicker + p.seed) < 0.2) a *= 0.12;
      if (a < 0.02) continue;
      const color = p.color2 && r < 0.45 ? p.color2 : p.color;
      fx.globalAlpha = a;
      fx.strokeStyle = color;
      fx.lineWidth = p.size * (0.5 + 0.5 * r);
      fx.beginPath();
      fx.moveTo(p.tx, p.ty);
      fx.lineTo(p.x + 0.01, p.y);
      fx.stroke();
      if (p.glow && a > 0.15) {
        const s = p.size * 9;
        fx.globalAlpha = a * 0.5;
        fx.drawImage(glowSprite(color), p.x - s / 2, p.y - s / 2, s, s);
      }
    }

    fx.globalAlpha = 1;
    fx.globalCompositeOperation = 'source-over';
  }
}

// Explosion patterns. Each runs with `this` bound to the Sky.
// With drag d, a particle launched at speed v travels v / (1 - d) pixels,
// so speeds are derived from the desired burst radius R.
const PATTERNS = {
  peony(x, y, o) {
    const [c0, c1 = '#fff3d6'] = o.colors;
    const twoTone = o.colors.length > 1 && Math.random() < 0.5;
    this.sphere(x, y, o, o.R * 0.045, o.n, (i) => (twoTone && i % 2 ? c1 : c0), twoTone ? null : { color2: c1 });
  },

  ring(x, y, o) {
    this.ring(x, y, o, o.R * 0.045, Math.round(o.n * 0.7), o.colors[0], rand(0.3, 1), rand(0, TAU));
  },

  doubleRing(x, y, o) {
    const tilt = rand(0.35, 1);
    const rot = rand(0, TAU);
    this.ring(x, y, o, o.R * 0.045, Math.round(o.n * 0.55), o.colors[0], tilt, rot);
    this.ring(x, y, o, o.R * 0.027, Math.round(o.n * 0.4), o.colors[1] || '#ffffff', tilt, rot);
  },

  saturn(x, y, o) {
    this.ring(x, y, o, o.R * 0.05, Math.round(o.n * 0.6), o.colors[0], rand(0.18, 0.32), rand(-0.5, 0.5));
    this.sphere(x, y, o, o.R * 0.02, Math.round(o.n * 0.45), () => o.colors[1] || '#ffffff', { glow: Math.random() < 0.3 });
  },

  pistil(x, y, o) {
    this.sphere(x, y, o, o.R * 0.045, o.n, () => o.colors[0]);
    this.sphere(x, y, o, o.R * 0.018, Math.round(o.n * 0.35), () => o.colors[1] || '#fff6e0', { glow: true, size: 2.2 });
  },

  chrysanthemum(x, y, o) {
    const [c0, c1 = '#ffe2a8'] = o.colors;
    this.sphere(x, y, o, o.R * 0.045, o.n, () => c0, { lag: 0.14, ember: 0.12, emberColor: c1, lifeMul: 1.25 });
  },

  willow(x, y, o) {
    const c0 = o.colors[0];
    this.sphere(x, y, o, o.R * 0.035, Math.round(o.n * 0.75), () => c0, {
      drag: 0.965,
      g: 0.05 * this.scale,
      lag: 0.07,
      size: 1.6,
      ember: 0.1,
      emberColor: c0,
      lifeMul: 2.1,
    });
  },

  kamuro(x, y, o) {
    const c0 = o.colors[0];
    this.sphere(x, y, o, o.R * 0.038, Math.round(o.n * 0.9), () => c0, {
      drag: 0.962,
      g: 0.045 * this.scale,
      lag: 0.08,
      size: 1.8,
      glow: Math.random() < 0.4,
      ember: 0.12,
      emberColor: '#fff1c9',
      lifeMul: 2.2,
    });
  },

  palm(x, y, o) {
    const arms = Math.floor(rand(6, 10));
    const v = o.R * 0.045;
    const rot = rand(0, TAU);
    for (let a = 0; a < arms; a++) {
      const ang = rot + (a / arms) * TAU + rand(-0.08, 0.08);
      for (let j = 0; j < 6; j++) {
        const s = v * (1 - j * 0.1);
        const head = j === 0;
        this.spark(x, y, Math.cos(ang) * s, Math.sin(ang) * s, o, {
          color: head ? o.colors[0] : o.colors[1] || o.colors[0],
          size: head ? 3.2 : 1.8,
          lag: head ? 0.1 : 0.25,
          ember: head ? 0.6 : 0,
          glow: head,
          lifeMul: 1.3,
        });
      }
    }
  },

  crossette(x, y, o) {
    const m = Math.floor(rand(10, 15));
    const v = o.R * 0.038;
    const rot = rand(0, TAU);
    for (let i = 0; i < m; i++) {
      const a = rot + (i / m) * TAU;
      this.spark(x, y, Math.cos(a) * v, Math.sin(a) * v, o, {
        color: o.colors[0],
        color2: o.colors[1] || '#ffffff',
        size: 2.4,
        lag: 0.2,
        glow: true,
        split: true,
        lifeMul: 0.6,
      });
    }
  },

  glitter(x, y, o) {
    const color = Math.random() < 0.5 ? '#fff7e0' : o.colors[0];
    this.sphere(x, y, o, o.R * 0.042, Math.round(o.n * 0.8), () => color, {
      flicker: rand(18, 30),
      size: 1.5,
      lifeMul: 1.3,
      glow: Math.random() < 0.2,
    });
  },

  rainbow(x, y, o) {
    this.sphere(x, y, o, o.R * 0.045, o.n, (i, th) => RAINBOW[Math.floor((th / TAU) * 24) % 24], {
      glow: Math.random() < 0.18,
    });
  },

  spiral(x, y, o) {
    const arms = 5;
    const per = Math.max(6, Math.round(o.n / arms));
    const v = o.R * 0.045;
    const rot = rand(0, TAU);
    for (let arm = 0; arm < arms; arm++) {
      for (let j = 0; j < per; j++) {
        const t = j / per;
        const a = rot + (arm / arms) * TAU + t * 1.6;
        const s = v * (0.25 + 0.75 * t);
        this.spark(x, y, Math.cos(a) * s, Math.sin(a) * s, o, {
          color: arm % 2 ? o.colors[1] || o.colors[0] : o.colors[0],
          size: 1.8,
          lag: 0.2,
          glow: Math.random() < 0.2,
        });
      }
    }
  },

  heart(x, y, o) {
    const color = o.colors[0];
    this.shape(x, y, heartPoints(Math.max(60, Math.round(o.n * 0.9))), o, o.R * 0.85, () => color);
  },

  star(x, y, o) {
    const color = o.colors[0];
    this.shape(x, y, starPoints(Math.max(60, Math.round(o.n * 0.9))), o, o.R * 0.9, () => color);
  },

  text(x, y, o) {
    const [c0, c1 = c0] = o.colors;
    this.shape(x, y, textPoints(o.text || '★'), o, o.R, (i) => (i % 3 ? c0 : c1));
    this.ring(x, y, o, o.R * 0.06, 36, c1, 1, 0, { flicker: 22, size: 1.4 });
  },
};
