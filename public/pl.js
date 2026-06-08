// Multilayer perovskite photoluminescence (PL) spectrum estimator.
//
// Port of the reference Python model. Each material emits a Gaussian band
// centred at a wavelength set by its optical band gap (lambda = hc/Eg). Two
// spectra are produced:
//
//   (1) Idealized : sum of Gaussians weighted by  volume * PLQY
//   (2) Realistic : same, but each band is scaled by an escape fraction
//                   (green MAPbBr3 photons are reabsorbed -- "funnelled" --
//                   by the lower-gap MAPbI3 layers) PLUS a broad mixed-halide
//                   shoulder from interdiffusion at the interfaces.
//
// Each spectrum is normalised to its own maximum (a.u.).
//
// Reference baseline: a 500 nm, 0.9 M layer contributes unit volume. Layer
// volume scales linearly with thickness/500 nm and concentration/0.9 M, so
// the default MAPbI3/MAPbBr3/MAPbI3 (500/500/500 nm, 0.9 M) stack reproduces
// the Python volumes (MAPbI3 = 2.0, MAPbBr3 = 1.0).

// hc in [eV*nm]: H_EV(4.135667696e-15 eV*s) * C(2.99792458e8 m/s) * 1e9.
const HC_EV_NM = 1239.841984;
const REF_THICKNESS_NM = 500;
const REF_CONC_M = 0.9;
const FWHM_TO_SIGMA = 1 / 2.35482;

// Convert photon energy [eV] to wavelength [nm].
function eVtoNm(Eg) {
  return HC_EV_NM / Eg;
}

// Normalised-shape Gaussian (peak = 1).
function gaussian(x, x0, sigma) {
  const z = (x - x0) / sigma;
  return Math.exp(-0.5 * z * z);
}

// Representative room-temperature MAPbX3 emission parameters.
//   Eg     : optical band gap / emission energy [eV]
//   fwhm   : emission FWHM [nm]
//   plqy   : relative radiative efficiency (0..1)
//   escape : realistic-case escape fraction (1 - reabsorbed)
const MATERIALS = {
  MAPbI3:  { label: "MAPbI₃",  Eg: 1.60, fwhm: 45, plqy: 1.0, escape: 1.0,  color: "#8e44ad" },
  MAPbBr3: { label: "MAPbBr₃", Eg: 2.30, fwhm: 25, plqy: 0.7, escape: 0.25, color: "#27ae60" },
  MAPbCl3: { label: "MAPbCl₃", Eg: 3.00, fwhm: 15, plqy: 0.5, escape: 0.5,  color: "#2980b9" },
};

const LAMBDA_MIN = 450; // nm
const LAMBDA_MAX = 900; // nm

// Read the layer stack from the form (material key, thickness, concentration).
function readLayers() {
  const layers = [];
  for (let i = 1; i <= 3; i++) {
    const key = document.getElementById("mat" + i).value;
    const d = parseFloat(document.getElementById("d" + i).value);
    const c = parseFloat(document.getElementById("c" + i).value);
    const m = MATERIALS[key];
    if (!m || !(d > 0) || !(c > 0)) continue;
    const volume = (d / REF_THICKNESS_NM) * (c / REF_CONC_M);
    layers.push({ key, ...m, thickness: d, conc: c, volume });
  }
  return layers;
}

// Read the realistic-case mixed-halide shoulder parameters.
function readMix() {
  return {
    peak: parseFloat(document.getElementById("mixPeak").value),
    fwhm: parseFloat(document.getElementById("mixFwhm").value),
    amp: parseFloat(document.getElementById("mixAmp").value),
  };
}

// Collapse same-material layers into one band; sum their volumes.
function bandsFromLayers(layers) {
  const byMat = new Map();
  for (const L of layers) {
    const cur = byMat.get(L.key);
    if (cur) cur.volume += L.volume;
    else byMat.set(L.key, { ...L });
  }
  return [...byMat.values()].sort((a, b) => a.Eg - b.Eg); // red -> blue
}

// Un-normalised PL intensity at wavelength lambda.
//   realistic=false : ideal (volume * plqy)
//   realistic=true  : * escape fraction, plus the mixed-halide shoulder
function rawSpectrum(lambda, bands, mix, realistic) {
  let total = 0;
  for (const b of bands) {
    let amp = b.volume * b.plqy;
    if (realistic) amp *= b.escape;
    total += amp * gaussian(lambda, eVtoNm(b.Eg), b.fwhm * FWHM_TO_SIGMA);
  }
  if (realistic && mix && mix.amp > 0) {
    total += mix.amp * gaussian(lambda, mix.peak, mix.fwhm * FWHM_TO_SIGMA);
  }
  return total;
}

// Peak of the raw spectrum across the plotted range (for a.u. normalisation).
function peakOf(bands, mix, realistic) {
  let max = 0;
  for (let lambda = LAMBDA_MIN; lambda <= LAMBDA_MAX; lambda += 0.5) {
    const v = rawSpectrum(lambda, bands, mix, realistic);
    if (v > max) max = v;
  }
  return max || 1;
}

function calculate() {
  const layers = readLayers();
  if (layers.length === 0) {
    alert("최소 한 층 이상에서 두께와 농도가 0보다 커야 합니다.");
    return;
  }
  const mix = readMix();
  const bands = bandsFromLayers(layers);

  const normIdeal = peakOf(bands, mix, false);
  const normReal = peakOf(bands, mix, true);

  document.getElementById("summary").innerHTML =
    bands
      .map((b) => `${b.label}: ${eVtoNm(b.Eg).toFixed(1)} nm (E<sub>g</sub> ${b.Eg.toFixed(2)} eV)`)
      .join(" &nbsp;|&nbsp; ") +
    (mix.amp > 0
      ? ` &nbsp;|&nbsp; mixed-halide shoulder: ${mix.peak.toFixed(0)} nm`
      : "");

  // Per-band table: ideal vs realistic relative weight (peak-normalised).
  const body = document.getElementById("result-body");
  body.innerHTML = "";
  for (const b of bands) {
    const wIdeal = (b.volume * b.plqy) / normIdeal;
    const wReal = (b.volume * b.plqy * b.escape) / normReal;
    addRow(
      body,
      b.label,
      eVtoNm(b.Eg).toFixed(1),
      b.fwhm,
      b.plqy.toFixed(2),
      b.escape.toFixed(2),
      wIdeal.toFixed(3),
      wReal.toFixed(3)
    );
  }
  document.getElementById("result").hidden = false;

  drawChart({ bands, mix, normIdeal, normReal });
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

// --- Chart: PL intensity vs. wavelength -------------------------------------

const CHART_COLORS = {
  grid: "#2a3050",
  axis: "#9aa3c0",
  text: "#9aa3c0",
  ideal: "#9aa3c0",
  real: "#e74c5e",
  fill: "rgba(231, 76, 94, 0.10)",
};

function drawChart({ bands, mix, normIdeal, normReal }) {
  const canvas = document.getElementById("chart");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = 360;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 56, padR = 18, padT = 18, padB = 46;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;
  const yMax = 1.05;

  const mapX = (lambda) =>
    padL + ((lambda - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN)) * plotW;
  const mapY = (v) => padT + (1 - v / yMax) * plotH;

  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = CHART_COLORS.text;
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;

  // Y ticks (intensity, a.u.).
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 5; i++) {
    const val = (1.0 / 5) * i;
    const y = mapY(val);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(1), padL - 8, y);
  }

  // X ticks (wavelength, nm).
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let lambda = 500; lambda <= LAMBDA_MAX; lambda += 100) {
    const x = mapX(lambda);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText(String(lambda), x, padT + plotH + 8);
  }

  // Axis titles.
  ctx.fillStyle = CHART_COLORS.axis;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("Wavelength (nm)", padL + plotW / 2, cssH - 4);
  ctx.save();
  ctx.translate(13, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText("PL intensity (a.u.)", 0, 0);
  ctx.restore();

  const N = 300;
  const sample = (realistic, norm) => {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const lambda = LAMBDA_MIN + ((LAMBDA_MAX - LAMBDA_MIN) * i) / N;
      pts.push({ x: mapX(lambda), y: mapY(rawSpectrum(lambda, bands, mix, realistic) / norm) });
    }
    return pts;
  };

  const realPts = sample(true, normReal);
  const idealPts = sample(false, normIdeal);

  // Fill under the realistic curve.
  ctx.fillStyle = CHART_COLORS.fill;
  ctx.beginPath();
  ctx.moveTo(realPts[0].x, mapY(0));
  realPts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(realPts[realPts.length - 1].x, mapY(0));
  ctx.closePath();
  ctx.fill();

  // Band peak guides + labels.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const b of bands) {
    const x = mapX(eVtoNm(b.Eg));
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = b.color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = b.color;
    ctx.fillText(`${b.label} ~${eVtoNm(b.Eg).toFixed(0)}nm`, x, padT + 2);
  }

  // Idealized curve (dashed, grey).
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = CHART_COLORS.ideal;
  ctx.lineWidth = 2;
  ctx.beginPath();
  idealPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);

  // Realistic curve (solid, red).
  ctx.strokeStyle = CHART_COLORS.real;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  realPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  // Legend (top-right).
  const lx = padL + plotW - 210;
  let ly = padT + 6;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const legend = [
    { c: CHART_COLORS.ideal, dash: true, t: "Idealized (no reabsorption)" },
    { c: CHART_COLORS.real, dash: false, t: "Realistic (funneling + interdiff.)" },
  ];
  for (const item of legend) {
    ctx.strokeStyle = item.c;
    ctx.lineWidth = item.dash ? 2 : 2.5;
    ctx.setLineDash(item.dash ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + 26, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = CHART_COLORS.text;
    ctx.fillText(item.t, lx + 32, ly);
    ly += 16;
  }
}

// --- Browser wiring ---------------------------------------------------------
function populateMaterialSelects() {
  const defaults = ["MAPbI3", "MAPbBr3", "MAPbI3"]; // bottom, mid, top
  for (let i = 1; i <= 3; i++) {
    const sel = document.getElementById("mat" + i);
    if (!sel) continue;
    sel.innerHTML = "";
    for (const [key, m] of Object.entries(MATERIALS)) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = m.label;
      sel.appendChild(opt);
    }
    sel.value = defaults[i - 1];
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("chart")) {
      populateMaterialSelects();
      calculate();
    }
  });
  window.addEventListener("resize", () => {
    if (document.getElementById("chart")) calculate();
  });
}

// Export for Node-based reuse/testing if available.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MATERIALS, eVtoNm, gaussian, rawSpectrum, bandsFromLayers };
}
