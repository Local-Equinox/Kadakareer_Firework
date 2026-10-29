import { Sky, rand, pick } from './fireworks.js';

const SHOW_LENGTH = 60;
const LAUNCH_CUTOFF = 57.5;
const COLORS = ['#ffd27a', '#ff7ac6', '#62c8ff', '#b388ff', '#7ef0b4', '#ff4d5e', '#ffffff', '#ffb547'];
const PATTERNS = ['peony', 'ring', 'doubleRing', 'chrysanthemum', 'willow', 'palm', 'crossette', 'glitter', 'rainbow', 'spiral', 'pistil'];

const form = document.getElementById('name-form');
const input = document.getElementById('name-input');
const error = document.getElementById('name-error');
const nameEl = document.getElementById('sky-name');

const sky = new Sky(document.getElementById('stars'), document.getElementById('sky'));

let show = null;

function payload(scale, pattern = pick(PATTERNS)) {
  return { pattern, colors: [pick(COLORS), pick(COLORS)], scale };
}

// Pick a burst point in the upper sky that stays clear of the name.
function target() {
  const w = sky.width;
  const h = sky.height;
  const ex = sky.exclusion;
  for (let i = 0; i < 8; i++) {
    const x = rand(0.08, 0.92) * w;
    const y = rand(0.08, 0.62) * h;
    if (!ex || x < ex.left - 40 || x > ex.right + 40 || y < ex.top - 40 || y > ex.bottom + 40) return { x, y };
  }
  return { x: Math.random() < 0.5 ? rand(0.06, 0.2) * w : rand(0.8, 0.94) * w, y: rand(0.1, 0.6) * sky.height };
}

function fire(x, y, p) {
  const fromX = Math.min(sky.width * 0.96, Math.max(sky.width * 0.04, x + rand(-0.12, 0.12) * sky.width));
  sky.launch({ x: fromX, tx: x, ty: y, payload: p });
}

// Intensity ramps up over the minute, ending in a dense finale.
function phase(t) {
  if (t < 5) return { gap: 1.3, scale: [0.55, 0.75], multi: 0 };
  if (t < 20) return { gap: 0.85, scale: [0.7, 1.0], multi: 0.15 };
  if (t < 40) return { gap: 0.6, scale: [0.8, 1.2], multi: 0.3 };
  if (t < 50) return { gap: 0.48, scale: [0.9, 1.35], multi: 0.35 };
  return { gap: 0.22, scale: [0.9, 1.5], multi: 0.5 };
}

function startShow(name) {
  nameEl.textContent = name;
  fitName();
  nameEl.classList.add('is-shown');
  form.classList.add('is-hidden');
  show = { t: 0, next: 0.8, letterDone: false };
}

function endShow() {
  show = null;
  nameEl.classList.remove('is-shown');
  form.classList.remove('is-hidden');
  input.value = '';
  input.focus({ preventScroll: true });
}

sky.onFrame = (dt) => {
  if (!show) return;
  show.t += dt;
  const t = show.t;

  if (t >= show.next && t < LAUNCH_CUTOFF) {
    const ph = phase(t);
    const count = Math.random() < ph.multi ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const { x, y } = target();
      fire(x, y, payload(rand(...ph.scale), t < 5 ? pick(['peony', 'ring']) : undefined));
    }
    show.next = t + ph.gap * rand(0.6, 1.4);
  }

  // Grand finale: the first letter of the name, flanked by big bursts.
  if (!show.letterDone && t >= 55) {
    show.letterDone = true;
    const ex = sky.exclusion;
    const y = Math.min(sky.height * 0.66, (ex ? ex.bottom : sky.height * 0.35) + 150 * sky.scale);
    fire(sky.width / 2, y, { pattern: 'text', text: Array.from(nameEl.textContent)[0].toUpperCase(), colors: ['#ffd27a', '#ffffff'], scale: 1.1 });
    for (let i = 0; i < 6; i++) {
      fire(sky.width * (0.1 + i * 0.16), rand(0.1, 0.3) * sky.height, payload(1.5));
    }
  }

  // Leave a few seconds after the last launch so particles fade naturally.
  if (t >= SHOW_LENGTH) endShow();
};

function fitName() {
  nameEl.style.fontSize = '';
  nameEl.classList.remove('is-wrapping');
  const maxW = window.innerWidth * 0.92;
  const natural = nameEl.scrollWidth;
  if (natural > maxW) {
    let size = (parseFloat(getComputedStyle(nameEl).fontSize) * maxW) / natural;
    if (size < 30) {
      size = 30;
      nameEl.classList.add('is-wrapping');
    }
    nameEl.style.fontSize = `${Math.floor(size)}px`;
  }
  const r = nameEl.getBoundingClientRect();
  sky.exclusion = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}

window.addEventListener('resize', () => {
  if (show) fitName();
});
document.fonts?.addEventListener('loadingdone', () => {
  if (show) fitName();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) {
    error.textContent = 'Please write your name first.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  error.textContent = '';
  input.removeAttribute('aria-invalid');
  input.blur();
  startShow(name);
});

input.addEventListener('input', () => {
  error.textContent = '';
  input.removeAttribute('aria-invalid');
});

sky.start();
input.focus({ preventScroll: true });
