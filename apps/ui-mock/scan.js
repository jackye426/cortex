/**
 * Cortex data-verse scan — canvas grid, cortex contours, ticking metadata.
 * Deterministic PRNG so reloads stay stable.
 */

const RNG_SEED = 0xc0a7e5 ^ 0x1a2b3c4d;

function mulberry32(a) {
  return function next() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = document.getElementById("scan");
const ctx = canvas.getContext("2d", { alpha: false });

const els = {
  mode: document.getElementById("mode-label"),
  plane: document.getElementById("plane-label"),
  sliceIdx: document.getElementById("slice-idx"),
  sliceMax: document.getElementById("slice-max"),
  tValue: document.getElementById("t-value"),
  xyValue: document.getElementById("xy-value"),
  zValue: document.getElementById("z-value"),
  pointCount: document.getElementById("point-count"),
  idxStream: document.getElementById("idx-stream"),
  edgeNumerals: document.getElementById("edge-numerals"),
  askMirror: document.getElementById("ask-mirror"),
  viewport: document.getElementById("viewport"),
};

const SLICE_MAX = 128;
const state = {
  plane: "AXIAL", // AXIAL | SAGITTAL
  slice: 24,
  t0: performance.now(),
  cursor: { nx: 0, ny: 0 },
  points: 0,
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  dpr: 1,
  w: 0,
  h: 0,
  idxBuf: [],
  edgeLines: [],
};

els.sliceMax.textContent = String(SLICE_MAX).padStart(3, "0");

function hexFrag(rand, len = 8) {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += Math.floor(rand() * 16).toString(16);
  }
  return s;
}

function seedIdxStream() {
  const rand = mulberry32(RNG_SEED + 17);
  state.idxBuf = [];
  for (let i = 0; i < 8; i++) {
    state.idxBuf.push(
      `${hexFrag(rand, 4)}-${hexFrag(rand, 4)} · ${String(
        Math.floor(rand() * 9000 + 1000)
      )}`
    );
  }
  renderIdxStream();
}

function pushIdx() {
  const rand = mulberry32(
    (RNG_SEED + state.slice * 997 + Math.floor(performance.now() / 1000)) >>> 0
  );
  state.idxBuf.unshift(
    `${hexFrag(rand, 4)}-${hexFrag(rand, 4)} · ${String(
      Math.floor(rand() * 9000 + 1000)
    )}`
  );
  if (state.idxBuf.length > 8) state.idxBuf.length = 8;
  renderIdxStream();
}

function renderIdxStream() {
  els.idxStream.innerHTML = state.idxBuf
    .map((line) => `<li>${line}</li>`)
    .join("");
}

function formatTSimple(ms) {
  const total = Math.max(0, ms) / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const milli = Math.floor(((ms % 1000) + 1000) % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    s
  ).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

function fmtSigned(n, digits = 3) {
  const sign = n >= 0 ? "+" : "-";
  return sign + Math.abs(n).toFixed(digits);
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.w = window.innerWidth;
  state.h = window.innerHeight;
  canvas.width = Math.floor(state.w * state.dpr);
  canvas.height = Math.floor(state.h * state.dpr);
  canvas.style.width = `${state.w}px`;
  canvas.style.height = `${state.h}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
}

/** Map normalized [-1,1] to screen */
function toScreen(nx, ny) {
  const cx = state.w * 0.5;
  const cy = state.h * 0.5;
  const scale = Math.min(state.w, state.h) * 0.38;
  return { x: cx + nx * scale, y: cy + ny * scale, scale };
}

function drawGrid() {
  const { w, h } = state;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.5;
  const scale = Math.min(w, h) * 0.38;

  // Major grid (every 0.25 in norm space across expanded field)
  ctx.lineWidth = 1;
  const major = 0.25;
  const extent = 2.2;

  for (let v = -extent; v <= extent + 1e-9; v += major) {
    const isAxis = Math.abs(v) < 1e-9;
    const isUnit = Math.abs(Math.abs(v) - 1) < 1e-9;
    ctx.strokeStyle = isAxis
      ? "rgba(255,255,255,0.18)"
      : isUnit
        ? "rgba(255,255,255,0.10)"
        : "rgba(255,255,255,0.055)";

    // vertical
    const x = cx + v * scale;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();

    // horizontal
    const y = cy + v * scale;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Fine subdivision near center
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  for (let v = -1; v <= 1 + 1e-9; v += 0.05) {
    if (Math.abs(v % 0.25) < 1e-9 || Math.abs((v % 0.25) - 0.25) < 1e-9)
      continue;
    const x = cx + v * scale;
    const y = cy + v * scale;
    ctx.beginPath();
    ctx.moveTo(x, cy - scale * 1.05);
    ctx.lineTo(x, cy + scale * 1.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - scale * 1.05, y);
    ctx.lineTo(cx + scale * 1.05, y);
    ctx.stroke();
  }

  // Tick labels along bottom of plot region
  ctx.font = "9px IBM Plex Mono, ui-monospace, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let v = -1; v <= 1 + 1e-9; v += 0.5) {
    const { x } = toScreen(v, 1);
    const label = (v >= 0 ? "+" : "") + v.toFixed(1);
    ctx.fillText(label, x, cy + scale + 8);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = -1; v <= 1 + 1e-9; v += 0.5) {
    const { y } = toScreen(-1, v);
    const label = (v >= 0 ? "+" : "") + v.toFixed(1);
    ctx.fillText(label, cx - scale - 8, y);
  }

  // Corner frame marks
  const m = Math.min(w, h) * 0.08;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  // TL
  ctx.moveTo(m, m + 18);
  ctx.lineTo(m, m);
  ctx.lineTo(m + 18, m);
  // TR
  ctx.moveTo(w - m - 18, m);
  ctx.lineTo(w - m, m);
  ctx.lineTo(w - m, m + 18);
  // BL
  ctx.moveTo(m, h - m - 18);
  ctx.lineTo(m, h - m);
  ctx.lineTo(m + 18, h - m);
  // BR
  ctx.moveTo(w - m - 18, h - m);
  ctx.lineTo(w - m, h - m);
  ctx.lineTo(w - m, h - m - 18);
  ctx.stroke();
}

/**
 * Stylized cortex contours in normalized space.
 * plane: AXIAL (top-down oval + folds) | SAGITTAL (side profile)
 */
function buildContours(plane, slice, rand) {
  const z = (slice / (SLICE_MAX - 1)) * 2 - 1; // -1..1
  const contours = [];
  const points = [];

  if (plane === "AXIAL") {
    const rx = 0.72 + z * 0.04;
    const ry = 0.58 - Math.abs(z) * 0.08;
    // Outer cortex outline (two hemispheres)
    for (const side of [-1, 1]) {
      const poly = [];
      const n = 96;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI - Math.PI / 2;
        const fold =
          0.04 * Math.sin(a * 7 + z * 3) +
          0.025 * Math.sin(a * 13 + side) +
          0.015 * Math.sin(a * 19 + slice * 0.1);
        const x = side * (0.04 + Math.cos(a) * (rx * 0.5 + fold));
        const y = Math.sin(a) * (ry + fold * 0.6) * (side === 1 ? 1 : 1);
        // mirror y for full oval using parametric with midline notch
        poly.push([x, y * (0.92 + 0.08 * Math.cos(a * 2))]);
      }
      // reopen as closed hemisphere lobe via second pass lower
      contours.push(poly);
    }

    // Full outer envelope with clearer interhemispheric fissure
    const outer = [];
    const n = 180;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const fold =
        0.045 * Math.sin(a * 8 + z * 2) +
        0.03 * Math.sin(a * 14) +
        0.02 * Math.sin(a * 22 + slice);
      // pinch along left-right midline for bilobed axial shape
      const fissure = Math.exp(-Math.pow(Math.sin(a), 2) / 0.04) * 0.22;
      const xx = Math.cos(a) * (rx + fold) * (1 - fissure);
      const yy = Math.sin(a) * (ry + fold * 0.7);
      outer.push([xx, yy]);
    }
    contours.push(outer);

    // Inner rings (ventricle-ish / white-matter boundary)
    for (const k of [0.35, 0.52, 0.68]) {
      const ring = [];
      for (let i = 0; i <= 80; i++) {
        const a = (i / 80) * Math.PI * 2;
        const wobble = 0.02 * Math.sin(a * 5 + z * 4 + k * 9);
        ring.push([
          Math.cos(a) * rx * k * 0.85 + wobble,
          Math.sin(a) * ry * k * 0.75 + wobble * 0.5,
        ]);
      }
      contours.push(ring);
    }

    // Gyral polyline fragments
    for (let g = 0; g < 18; g++) {
      const poly = [];
      const baseA = (g / 18) * Math.PI * 2 + z;
      const len = 8 + Math.floor(rand() * 10);
      for (let i = 0; i < len; i++) {
        const a = baseA + i * 0.07 * (g % 2 === 0 ? 1 : -1);
        const r = rx * (0.55 + 0.35 * rand()) + 0.03 * Math.sin(i + g);
        poly.push([Math.cos(a) * r, Math.sin(a) * r * (ry / rx)]);
      }
      contours.push(poly);
    }
  } else {
    // SAGITTAL — classic left-facing side profile (control points, closed)
    const zShift = z * 0.03;
    const key = [
      [-0.55, 0.15], // frontal pole
      [-0.62, -0.05],
      [-0.58, -0.35],
      [-0.35, -0.62], // superior frontal
      [-0.05, -0.72],
      [0.25, -0.68], // superior parietal
      [0.48, -0.52],
      [0.62, -0.28], // occipital
      [0.68, -0.02],
      [0.58, 0.22],
      [0.55, 0.38], // cerebellum bulge
      [0.42, 0.52],
      [0.22, 0.55],
      [0.08, 0.48],
      [0.02, 0.62], // brainstem drop
      [-0.05, 0.78],
      [-0.12, 0.72],
      [-0.08, 0.48],
      [-0.18, 0.32], // ventral frontal
      [-0.38, 0.28],
      [-0.52, 0.22],
    ];

    function densify(pts, folds) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const steps = 8;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          let x = a[0] + (b[0] - a[0]) * t;
          let y = a[1] + (b[1] - a[1]) * t;
          if (folds) {
            const nrm = Math.sin(t * Math.PI);
            x += 0.018 * nrm * Math.sin(i * 2.3 + slice * 0.07 + z);
            y += 0.014 * nrm * Math.sin(i * 3.1 + z * 2);
          }
          out.push([x, y + zShift]);
        }
      }
      return out;
    }

    const profile = densify(key, true);
    contours.push(profile);

    // Parallel inner cortex ribbons (offset toward centroid)
    for (const sc of [0.82, 0.64, 0.48]) {
      const inner = profile.map(([x, y]) => [x * sc - 0.02, y * sc + 0.02]);
      contours.push(inner);
    }

    // Corpus callosum
    const cc = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const x = -0.42 + t * 0.88;
      const y =
        -0.02 +
        0.14 * Math.sin(t * Math.PI) -
        0.05 * (t - 0.5) ** 2 +
        zShift;
      cc.push([x, y]);
    }
    contours.push(cc);
    // lower CC lip
    contours.push(
      cc.map(([x, y], i) => [x + 0.01, y + 0.06 + 0.01 * Math.sin(i * 0.4)])
    );

    // Ventricle slit
    const vent = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      vent.push([-0.15 + t * 0.35, 0.06 + 0.04 * Math.sin(t * Math.PI) + zShift]);
    }
    contours.push(vent);

    // Cerebellum folia (posterior-inferior)
    for (let c = 0; c < 9; c++) {
      const poly = [];
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const x = 0.28 + t * 0.32 + 0.015 * Math.sin(c * 1.7);
        const y =
          0.28 +
          c * 0.035 +
          0.028 * Math.sin(t * Math.PI * 4 + c) +
          Math.abs(z) * 0.015;
        poly.push([x, y]);
      }
      contours.push(poly);
    }

    // Cortical fold ticks along superior surface
    for (let g = 0; g < 14; g++) {
      const t = g / 13;
      const x0 = -0.5 + t * 1.05;
      const y0 = -0.55 - 0.12 * Math.sin(t * Math.PI) + zShift;
      const poly = [];
      for (let i = 0; i < 6; i++) {
        poly.push([
          x0 + i * 0.01,
          y0 + i * 0.035 + 0.02 * Math.sin(g + i + slice * 0.05),
        ]);
      }
      contours.push(poly);
    }
  }

  // Sparse point cloud along contours
  for (const poly of contours) {
    for (let i = 0; i < poly.length; i += 3) {
      if (rand() > 0.55) continue;
      const [x, y] = poly[i];
      points.push([
        x + (rand() - 0.5) * 0.02,
        y + (rand() - 0.5) * 0.02,
      ]);
    }
  }

  // Extra scatter field
  for (let i = 0; i < 180; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.2 + rand() * 0.75;
    const x = Math.cos(a) * r * (plane === "AXIAL" ? 0.85 : 0.9);
    const y = Math.sin(a) * r * 0.7;
    if (x * x + y * y * 1.4 < 0.95) points.push([x, y]);
  }

  return { contours, points };
}

function drawCortex(time) {
  const rand = mulberry32(
    (RNG_SEED + state.slice * 131 + (state.plane === "AXIAL" ? 0 : 99991)) >>> 0
  );
  const { contours, points } = buildContours(state.plane, state.slice, rand);
  state.points = points.length + contours.reduce((n, p) => n + p.length, 0);

  const cx = state.w * 0.5;
  const cy = state.h * 0.5;
  const scale = Math.min(state.w, state.h) * 0.38;

  // Soft hatch fill (very low opacity) inside outer contour
  if (contours[0] && contours[0].length > 2) {
    ctx.save();
    ctx.beginPath();
    const outer =
      state.plane === "AXIAL"
        ? contours.find((c) => c.length > 100) || contours[0]
        : contours[0];
    outer.forEach(([nx, ny], i) => {
      const x = cx + nx * scale;
      const y = cy + ny * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    const step = 7;
    for (let x = cx - scale; x < cx + scale; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, cy - scale);
      ctx.lineTo(x + scale * 0.3, cy + scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Contour strokes
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  contours.forEach((poly, idx) => {
    const isOuter =
      (state.plane === "SAGITTAL" && idx === 0) ||
      (state.plane === "AXIAL" && poly.length > 100) ||
      idx === 0;
    ctx.strokeStyle = isOuter
      ? "rgba(255,255,255,0.78)"
      : idx < 5
        ? "rgba(255,255,255,0.4)"
        : "rgba(255,255,255,0.2)";
    ctx.lineWidth = isOuter ? 1.15 : 0.7;
    ctx.beginPath();
    poly.forEach(([nx, ny], i) => {
      const x = cx + nx * scale;
      const y = cy + ny * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (state.plane === "SAGITTAL" ? idx < 4 : poly.length > 40) ctx.closePath();
    ctx.stroke();
  });

  // Points
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (const [nx, ny] of points) {
    const x = cx + nx * scale;
    const y = cy + ny * scale;
    ctx.fillRect(x, y, 1, 1);
  }

  // Scan column highlight — vertical band that follows time
  if (!state.reducedMotion) {
    const band = ((time * 0.00008) % 2) - 1; // -1..1
    const bx = cx + band * scale;
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(bx - 14, cy - scale * 1.1, 28, scale * 2.2);
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.moveTo(bx, cy - scale * 1.1);
    ctx.lineTo(bx, cy + scale * 1.1);
    ctx.stroke();
  }

  // Midline
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  if (state.plane === "AXIAL") {
    ctx.moveTo(cx, cy - scale);
    ctx.lineTo(cx, cy + scale);
  } else {
    ctx.moveTo(cx - scale * 0.2, cy - scale * 0.85);
    ctx.lineTo(cx + scale * 0.15, cy + scale * 0.9);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function updateEdgeNumerals(time) {
  const rand = mulberry32(
    (RNG_SEED + Math.floor(time / 180) * 13 + state.slice) >>> 0
  );
  const lines = [];
  const count = 42;
  for (let i = 0; i < count; i++) {
    const n = Math.floor(rand() * 1e8)
      .toString(2)
      .padStart(12, "0")
      .slice(0, 12);
    const hex = hexFrag(rand, 6);
    lines.push(i % 3 === 0 ? hex : n.replace(/(.{4})/g, "$1 ").trim());
  }
  // scroll offset via CSS-like slice
  const offset = state.reducedMotion ? 0 : Math.floor((time / 80) % 10);
  const rotated = lines.slice(offset).concat(lines.slice(0, offset));
  els.edgeNumerals.textContent = rotated.join("\n");
}

function updateHud(time) {
  els.mode.textContent = state.plane;
  els.plane.textContent = state.plane;
  els.sliceIdx.textContent = String(state.slice).padStart(3, "0");
  els.tValue.textContent = formatTSimple(time - state.t0);
  els.xyValue.textContent = `${fmtSigned(state.cursor.nx)},${fmtSigned(
    state.cursor.ny
  )}`;
  const z = (state.slice / (SLICE_MAX - 1)) * 2 - 1;
  els.zValue.textContent = fmtSigned(z);
  els.pointCount.textContent = String(state.points).padStart(4, "0");
}

function frame(now) {
  drawGrid();
  drawCortex(now);
  updateHud(now);
  updateEdgeNumerals(now);
  requestAnimationFrame(frame);
}

function onPointer(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const cx = state.w * 0.5;
  const cy = state.h * 0.5;
  const scale = Math.min(state.w, state.h) * 0.38;
  state.cursor.nx = (x - cx) / scale;
  state.cursor.ny = (y - cy) / scale;
}

function cyclePlane() {
  state.plane = state.plane === "AXIAL" ? "SAGITTAL" : "AXIAL";
}

function stepSlice(delta) {
  state.slice = (state.slice + delta + SLICE_MAX) % SLICE_MAX;
  pushIdx();
}

els.viewport.addEventListener("pointermove", onPointer);
els.viewport.addEventListener("click", (e) => {
  if (e.target.closest(".hairline-ctrl")) return;
  cyclePlane();
  pushIdx();
});

els.askMirror.addEventListener("click", (e) => {
  e.stopPropagation();
  pushIdx();
  // Visual ack: briefly flash border via class
  els.askMirror.style.borderColor = "rgba(255,255,255,1)";
  els.askMirror.style.color = "rgba(255,255,255,1)";
  setTimeout(() => {
    els.askMirror.style.borderColor = "";
    els.askMirror.style.color = "";
  }, 180);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "a" || e.key === "A" || e.key === " ") {
    e.preventDefault();
    cyclePlane();
  } else if (e.key === "ArrowUp" || e.key === "]") {
    stepSlice(1);
  } else if (e.key === "ArrowDown" || e.key === "[") {
    stepSlice(-1);
  }
});

window.addEventListener("resize", resize);

// Auto slice step
if (!state.reducedMotion) {
  setInterval(() => {
    stepSlice(1);
  }, 3200);
} else {
  setInterval(() => {
    pushIdx();
  }, 4000);
}

seedIdxStream();
resize();
state.t0 = performance.now();
requestAnimationFrame(frame);
