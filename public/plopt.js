// Wavelength-targeted PL optimizer for a 3-layer perovskite stack:
//   MAPbI3 (top cap) / EMITTER (middle) / MAPbI3 (bottom)
//
// Port of the reference Python optimizer. Given a TARGET wavelength it
//   1. picks the emitter composition (mixed-halide MAPb(I[1-x]Br[x])3) whose
//      emission peak matches the target, via a bowing-parameter band gap model;
//   2. optimizes emitter thickness and concentration to maximise the detected
//      (front) intensity at the target, accounting for self-absorption in the
//      emitter and reabsorption by the top MAPbI3 cap (Beer-Lambert).
//
// Representative absorption coefficients are used -- replace with measured
// alpha(lambda) for accuracy.

const HC_EV_NM = 1239.841984; // H_EV * C * 1e9  [eV*nm]
function nmToEV(nm) { return HC_EV_NM / nm; }
function eVtoNm(eV) { return HC_EV_NM / eV; }

// --- Emitter: mixed-halide MAPb(I[1-x]Br[x])3 ------------------------------
const EMITTER = {
  EgI: 1.60,     // eV, MAPbI3 band gap
  EgBr: 2.30,    // eV, MAPbBr3 band gap
  bowing: 0.33,  // eV, optical bowing parameter
  stokes: 0.05,  // eV, emission red-shift vs band gap
};

// Band gap [eV] vs Br fraction x in [0,1].
function emitterEg(x, em) {
  return (1 - x) * em.EgI + x * em.EgBr - em.bowing * x * (1 - x);
}

// Emission wavelength [nm] vs Br fraction x.
function emissionNm(x, em) {
  return eVtoNm(emitterEg(x, em) - em.stokes);
}

// Composition-dependent linewidth [nm]: alloy disorder broadens mid-x.
function fwhmNm(x) {
  const base = 25 + 20 * x;          // I-rich broader than Br-rich (rough)
  const disorder = 30 * x * (1 - x); // alloy scattering peaks at x = 0.5
  return base + disorder;
}

// Bisection root finder for a monotonic function on [lo, hi].
function bisect(f, lo, hi, iters) {
  let flo = f(lo);
  for (let i = 0; i < (iters || 100); i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-10) return mid;
    if ((flo < 0) === (fm < 0)) { lo = mid; flo = fm; }
    else { hi = mid; }
  }
  return (lo + hi) / 2;
}

// Br fraction x that emits at target wavelength (clamped to endpoints within
// tol_nm; null if far outside the achievable range).
function xForWavelength(targetNm, em, tolNm) {
  const tol = tolNm === undefined ? 20.0 : tolNm;
  const lo = emissionNm(1.0, em); // bluest (pure MAPbBr3) ~551 nm
  const hi = emissionNm(0.0, em); // reddest (pure MAPbI3)  ~800 nm
  if (targetNm < lo - tol || targetNm > hi + tol) return null;
  if (targetNm <= lo) return 1.0;
  if (targetNm >= hi) return 0.0;
  return bisect((x) => emissionNm(x, em) - targetNm, 0.0, 1.0); // decreasing
}

// --- Optical (Beer-Lambert) model ------------------------------------------
const OPTICS = {
  alphaSelf: 1.2e4, // emitter self-absorption at its own emission [cm^-1]
  alphaPump: 8.0e4, // emitter absorption of the pump [cm^-1]
  Cref: 0.9,        // reference concentration [M]
  tCapMin: 10.0,    // nm, thin cap when it reabsorbs the target
  tCapMax: 120.0,   // nm, free cap when transparent at the target
};

const CONC_GRID = [0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4];

// Top MAPbI3 cap absorption at the target wavelength [cm^-1]:
// strong above the MAPbI3 gap, ~0 below it.
function capAbsorption(targetNm, em) {
  const E = nmToEV(targetNm);
  const EgCap = em.EgI;
  if (E <= EgCap) return 0.0; // below MAPbI3 gap -> transparent
  return 1.0e5 * Math.tanh((E - EgCap) / 0.3);
}

// Detected (front) intensity at the target wavelength (a.u.).
function detected(tCapNm, tEmitNm, concM, targetNm, em, opt) {
  const cf = concM / opt.Cref;
  const tEmit = tEmitNm * 1e-7; // cm
  const tCap = tCapNm * 1e-7;   // cm
  const aPump = opt.alphaPump * cf;
  const aSelf = opt.alphaSelf * cf;
  const aCap = capAbsorption(targetNm, em) * cf;

  const gen = 1.0 - Math.exp(-aPump * tEmit);
  const ast = aSelf * tEmit;
  const escape = ast < 1e-9 ? 1.0 : (1.0 - Math.exp(-ast)) / ast;
  const transCap = Math.exp(-aCap * tCap);
  return gen * escape * transCap;
}

// Golden-section maximiser on [a, b].
function goldenMax(f, a, b, iters) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < (iters || 100); i++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

// Emitter thickness [nm] that maximises gen*escape (ignores the cap).
function optimalEmitterThickness(concM, opt) {
  const cf = concM / opt.Cref;
  const f = (tNm) => {
    const t = tNm * 1e-7;
    const gen = 1.0 - Math.exp(-opt.alphaPump * cf * t);
    const ast = opt.alphaSelf * cf * t;
    const esc = ast < 1e-12 ? 1.0 : (1.0 - Math.exp(-ast)) / ast;
    return gen * esc;
  };
  return goldenMax(f, 30, 3000);
}

// Best stack design for a target wavelength (null if out of range).
function optimize(targetNm, em, opt) {
  const x = xForWavelength(targetNm, em);
  if (x === null) return null;

  const aCap = capAbsorption(targetNm, em);
  // Thin cap if it absorbs the target; free (thick) if transparent.
  const tCap = aCap > 1.0 ? opt.tCapMin : opt.tCapMax;

  let best = null;
  for (const c of CONC_GRID) {
    const tEmit = optimalEmitterThickness(c, opt);
    const sig = detected(tCap, tEmit, c, targetNm, em, opt);
    if (!best || sig > best.signal) {
      best = {
        targetNm,
        xBr: x,
        emitterEmissionNm: emissionNm(x, em),
        fwhmNm: fwhmNm(x),
        capNm: tCap,
        emitterNm: tEmit,
        concM: c,
        capAbsorbsTarget: aCap > 1.0,
        signal: sig,
      };
    }
  }
  return best;
}

function compositionLabel(x) {
  if (x < 0.02) return "MAPbI₃ (pure)";
  if (x > 0.98) return "MAPbBr₃ (pure)";
  return `MAPb(I${(1 - x).toFixed(2)}Br${x.toFixed(2)})₃ (mixed halide)`;
}

// --- Page wiring ------------------------------------------------------------
function calculate() {
  const em = {
    EgI: EMITTER.EgI,
    EgBr: EMITTER.EgBr,
    bowing: numOr("bowing", EMITTER.bowing),
    stokes: numOr("stokes", EMITTER.stokes),
  };
  const opt = { ...OPTICS };
  const target = numOr("target", 540);
  const capConc = numOr("capconc", 0.9);

  const design = optimize(target, em, opt);

  const summary = document.getElementById("summary");
  const detail = document.getElementById("design-body");
  const chartWrap = document.getElementById("charts");
  const scanWrap = document.getElementById("scan-result");
  const stackWrap = document.getElementById("stack");

  if (!design) {
    const range = `${emissionNm(1.0, em).toFixed(0)}–${emissionNm(0.0, em).toFixed(0)} nm`;
    summary.textContent =
      `타겟 ${target.toFixed(0)} nm 은 MAPb(I,Br)₃ 발광 범위(${range}) 밖입니다.`;
    if (detail) detail.parentElement.parentElement.hidden = true;
    if (chartWrap) chartWrap.hidden = true;
    if (stackWrap) stackWrap.hidden = true;
    drawScan(em, opt);
    return;
  }

  summary.innerHTML =
    `${compositionLabel(design.xBr)} &nbsp;|&nbsp; ` +
    `Br 분율 x = ${design.xBr.toFixed(3)} &nbsp;|&nbsp; ` +
    `상대 피크 신호 = <strong>${design.signal.toFixed(3)}</strong>`;

  // Per-layer breakdown (M and thickness) for MAPbI3 / Emitter / MAPbI3.
  const layers = buildLayers(design, capConc, opt);
  if (stackWrap) stackWrap.hidden = false;
  renderStackTable(layers);
  drawStackDiagram(layers);

  // Design detail table.
  detail.innerHTML = "";
  const rows = [
    ["타겟 파장 (Target)", `${design.targetNm.toFixed(0)} nm`],
    ["Emitter 조성 (Composition)", `${compositionLabel(design.xBr)}  (x = ${design.xBr.toFixed(3)})`],
    ["Emitter 피크 / FWHM", `${design.emitterEmissionNm.toFixed(0)} nm / ${design.fwhmNm.toFixed(0)} nm`],
    ["상단 MAPbI₃ 캡 (Cap)", `${design.capNm.toFixed(0)} nm  (${design.capAbsorbsTarget ? "thin — 타겟 재흡수" : "free — 타겟에 투명"})`],
    ["Emitter 두께 (Thickness)", `${design.emitterNm.toFixed(0)} nm`],
    ["Emitter 농도 (Conc.)", `${design.concM.toFixed(1)} M`],
    ["상대 피크 신호 (Signal)", design.signal.toFixed(3)],
  ];
  for (const [kk, vv] of rows) addRow(detail, kk, vv);
  detail.parentElement.parentElement.hidden = false;

  if (chartWrap) chartWrap.hidden = false;
  drawEmissionChart(design, target);
  drawThicknessChart(design, target, em, opt);
  drawScan(em, opt);
  if (scanWrap) scanWrap.hidden = false;
}

function numOr(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}

function addRow(body, ...cells) {
  const tr = document.createElement("tr");
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  body.appendChild(tr);
}

// Short composition name (no trailing descriptor).
function compositionShort(x) {
  if (x < 0.02) return "MAPbI₃";
  if (x > 0.98) return "MAPbBr₃";
  return `MAPb(I${(1 - x).toFixed(2)}Br${x.toFixed(2)})₃`;
}

// Build the 3-layer stack (top -> bottom) with per-layer M and thickness.
function buildLayers(design, capConc, opt) {
  const emitColor = lerpHex("#8e44ad", "#27ae60", design.xBr); // MAPbI3 -> MAPbBr3
  return [
    {
      role: "Top cap",
      material: "MAPbI₃",
      color: "#8e44ad",
      concM: capConc,
      thicknessNm: design.capNm,
      note: design.capAbsorbsTarget ? "thin — 타겟 재흡수 최소화" : "free — 타겟에 투명",
    },
    {
      role: "Emitter (middle)",
      material: compositionShort(design.xBr),
      color: emitColor,
      concM: design.concM,
      thicknessNm: design.emitterNm,
      note: "두께·농도 최적화",
    },
    {
      role: "Bottom",
      material: "MAPbI₃",
      color: "#8e44ad",
      concM: capConc,
      thicknessNm: opt.tCapMax,
      note: "free — 전면 발광에 무관(구조층)",
    },
  ];
}

function renderStackTable(layers) {
  const body = document.getElementById("stack-body");
  if (!body) return;
  body.innerHTML = "";
  for (const L of layers) {
    addRow(body, L.role, L.material, L.concM.toFixed(2), L.thicknessNm.toFixed(0), L.note);
  }
}

// Linear interpolation between two #rrggbb colors.
function lerpHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// Cross-section diagram: full-width bands stacked top->bottom, height ~ thickness.
function drawStackDiagram(layers) {
  const canvas = document.getElementById("chart-stack");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = 340;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 16, padR = 16, padT = 34, padB = 16;
  const bandW = cssW - padL - padR;
  const availH = cssH - padT - padB;

  // Heights: proportional to thickness, but each band gets a minimum so thin
  // caps stay readable. Remaining height is shared by thickness.
  const minH = 30;
  const total = layers.reduce((s, L) => s + L.thicknessNm, 0) || 1;
  const extra = Math.max(0, availH - minH * layers.length);
  const heights = layers.map((L) => minH + (extra * L.thicknessNm) / total);

  // Title.
  ctx.font = "13px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#9aa3c0";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Layer stack (top → bottom) — 높이 ∝ 두께", padL, 22);

  let y = padT;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const h = heights[i];

    ctx.fillStyle = L.color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(padL, y, bandW, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#0f1220";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(padL, y, bandW, h);

    // Left label: role · material. Right label: thickness · concentration.
    ctx.fillStyle = "#ffffff";
    ctx.font = "13px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${L.role} · ${L.material}`, padL + 12, y + h / 2);
    ctx.textAlign = "right";
    ctx.fillText(`${L.thicknessNm.toFixed(0)} nm · ${L.concM.toFixed(2)} M`, padL + bandW - 12, y + h / 2);

    y += h;
  }
}

// Quick scan over several common targets.
function drawScan(em, opt) {
  const body = document.getElementById("scan-body");
  if (!body) return;
  body.innerHTML = "";
  for (const tw of [540, 580, 620, 660, 700, 740, 775]) {
    const d = optimize(tw, em, opt);
    if (!d) continue;
    addRow(
      body,
      tw.toFixed(0),
      d.xBr.toFixed(3),
      d.emitterEmissionNm.toFixed(0),
      d.capNm.toFixed(0),
      d.concM.toFixed(1),
      d.signal.toFixed(3)
    );
  }
}

// --- Charts -----------------------------------------------------------------
const COL = {
  grid: "#2a3050",
  axis: "#9aa3c0",
  text: "#9aa3c0",
  emit: "#e74c5e",
  target: "#2980b9",
  marker: "#e8ebf5",
};
const LINE_COLORS = ["#6c8cff", "#27ae60", "#e0a13a"];

function setupCanvas(id) {
  const canvas = document.getElementById(id);
  if (!canvas || !canvas.getContext) return null;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = 320;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return { ctx, cssW, cssH };
}

function drawAxes(ctx, geom, opts) {
  const { padL, padT, plotW, plotH, cssH } = geom;
  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = COL.text;
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 1;

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 5; i++) {
    const val = (opts.yMax / 5) * i;
    const y = padT + (1 - val / opts.yMax) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(opts.yfmt(val), padL - 8, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let j = 0; j <= opts.xTicks; j++) {
    const val = opts.xMin + ((opts.xMax - opts.xMin) / opts.xTicks) * j;
    const x = padL + ((val - opts.xMin) / (opts.xMax - opts.xMin)) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText(opts.xfmt(val), x, padT + plotH + 8);
  }

  ctx.fillStyle = COL.axis;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(opts.xLabel, padL + plotW / 2, cssH - 4);
  ctx.save();
  ctx.translate(13, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText(opts.yLabel, 0, 0);
  ctx.restore();
}

// (a) Optimized emission spectrum with the target marker.
function drawEmissionChart(design, target) {
  const s = setupCanvas("chart-emission");
  if (!s) return;
  const { ctx, cssW, cssH } = s;
  const padL = 52, padR = 16, padT = 16, padB = 42;
  const geom = { padL, padT, plotW: cssW - padL - padR, plotH: cssH - padT - padB, cssH };
  const xMin = 450, xMax = 900;

  drawAxes(ctx, geom, {
    yMax: 1.05, yfmt: (v) => v.toFixed(1),
    xMin, xMax, xTicks: 5, xfmt: (v) => v.toFixed(0),
    xLabel: "Wavelength (nm)", yLabel: "PL intensity (a.u.)",
  });

  const mapX = (w) => padL + ((w - xMin) / (xMax - xMin)) * geom.plotW;
  const mapY = (v) => padT + (1 - v / 1.05) * geom.plotH;
  const sigma = design.fwhmNm / 2.35482;
  const pk = design.emitterEmissionNm;

  // Target marker.
  if (target >= xMin && target <= xMax) {
    const tx = mapX(target);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COL.target;
    ctx.beginPath();
    ctx.moveTo(tx, padT);
    ctx.lineTo(tx, padT + geom.plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COL.target;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`target ${target.toFixed(0)}nm`, tx + 4, padT + 2);
  }

  // Gaussian emission + fill.
  const pts = [];
  const N = 240;
  for (let i = 0; i <= N; i++) {
    const w = xMin + ((xMax - xMin) * i) / N;
    const z = (w - pk) / sigma;
    pts.push({ x: mapX(w), y: mapY(Math.exp(-0.5 * z * z)) });
  }
  ctx.fillStyle = "rgba(231,76,94,0.10)";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, mapY(0));
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, mapY(0));
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = COL.emit;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

// (b) Detected signal vs emitter thickness for a few concentrations.
function drawThicknessChart(design, target, em, opt) {
  const s = setupCanvas("chart-thickness");
  if (!s) return;
  const { ctx, cssW, cssH } = s;
  const padL = 52, padR = 16, padT = 16, padB = 42;
  const geom = { padL, padT, plotW: cssW - padL - padR, plotH: cssH - padT - padB, cssH };
  const xMin = 30, xMax = 1500;

  drawAxes(ctx, geom, {
    yMax: 1.05, yfmt: (v) => v.toFixed(1),
    xMin, xMax, xTicks: 5, xfmt: (v) => v.toFixed(0),
    xLabel: "Emitter thickness (nm)", yLabel: "Relative signal (a.u.)",
  });

  const mapX = (t) => padL + ((t - xMin) / (xMax - xMin)) * geom.plotW;
  const mapY = (v) => padT + (1 - v / 1.05) * geom.plotH;

  const concs = [0.6, 0.9, 1.2];
  const N = 240;
  let ly = padT + 6;
  concs.forEach((c, ci) => {
    const ys = [];
    let mx = 0;
    for (let i = 0; i <= N; i++) {
      const t = xMin + ((xMax - xMin) * i) / N;
      const v = detected(design.capNm, t, c, target, em, opt);
      ys.push(v);
      if (v > mx) mx = v;
    }
    ctx.strokeStyle = LINE_COLORS[ci % LINE_COLORS.length];
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = xMin + ((xMax - xMin) * i) / N;
      const x = mapX(t);
      const y = mapY(mx > 0 ? ys[i] / mx : 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Legend.
    ctx.strokeStyle = LINE_COLORS[ci % LINE_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(padL + geom.plotW - 70, ly);
    ctx.lineTo(padL + geom.plotW - 44, ly);
    ctx.stroke();
    ctx.fillStyle = COL.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${c} M`, padL + geom.plotW - 40, ly);
    ly += 16;
  });

  // Optimal-thickness guide.
  if (design.emitterNm >= xMin && design.emitterNm <= xMax) {
    const gx = mapX(design.emitterNm);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COL.marker;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(gx, padT);
    ctx.lineTo(gx, padT + geom.plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

// --- Browser wiring ---------------------------------------------------------
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("chart-emission")) calculate();
  });
  window.addEventListener("resize", () => {
    if (document.getElementById("chart-emission")) calculate();
  });
}

// Export for Node-based reuse/testing if available.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    EMITTER, OPTICS, emitterEg, emissionNm, fwhmNm,
    xForWavelength, capAbsorption, detected, optimalEmitterThickness, optimize,
    buildLayers, compositionShort,
  };
}
