// Multilayer perovskite photoluminescence (PL) spectrum estimator.
//
// Each layer emits a Gaussian PL band centred at a material-dependent peak
// wavelength (set by the band gap), with an amplitude proportional to the
// amount of emitter (film thickness x precursor concentration). The total
// spectrum is the sum over layers, normalised so its maximum is 1 a.u.
//
//   I(lambda) = sum_i A_i * exp[ -(lambda - peak_i)^2 / (2 sigma_i^2) ]
//   A_i  proportional to  thickness_i * concentration_i
//   sigma_i = FWHM_i / (2*sqrt(2*ln2))
//
// Reabsorption, interlayer energy transfer, optical interference and the
// excitation absorption profile are all neglected -- this is a qualitative
// tool meant to show *where* the PL peaks sit and their relative size.

// Representative room-temperature MAPbX3 emission parameters.
//   peak : PL peak wavelength [nm]   (from the optical band gap)
//   fwhm : full width at half maximum [nm]
const MATERIALS = {
  MAPbI3:  { label: "MAPbI₃",  peak: 770, fwhm: 45, color: "#ff5d6c" },
  MAPbBr3: { label: "MAPbBr₃", peak: 540, fwhm: 25, color: "#46d17a" },
  MAPbCl3: { label: "MAPbCl₃", peak: 405, fwhm: 15, color: "#6c8cff" },
};

const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2)); // ~0.4247

// Gaussian PL contribution of one layer at wavelength lambda [nm].
function layerEmission(lambda, peak, fwhm, amp) {
  const sigma = fwhm * FWHM_TO_SIGMA;
  const z = (lambda - peak) / sigma;
  return amp * Math.exp(-0.5 * z * z);
}

// Build the layer list from the form (material key, thickness, concentration).
function readLayers() {
  const layers = [];
  for (let i = 1; i <= 3; i++) {
    const key = document.getElementById("mat" + i).value;
    const d = parseFloat(document.getElementById("d" + i).value);
    const c = parseFloat(document.getElementById("c" + i).value);
    const m = MATERIALS[key];
    if (!m || !(d > 0) || !(c > 0)) continue;
    layers.push({ key, ...m, thickness: d, conc: c, amp: d * c });
  }
  return layers;
}

// Total (un-normalised) PL intensity at wavelength lambda for a layer list.
function totalEmission(lambda, layers) {
  let sum = 0;
  for (const L of layers) sum += layerEmission(lambda, L.peak, L.fwhm, L.amp);
  return sum;
}

const LAMBDA_MIN = 380; // nm
const LAMBDA_MAX = 860; // nm

// Peak total intensity across the plotted range, for a.u. normalisation.
function peakIntensity(layers) {
  let max = 0;
  for (let lambda = LAMBDA_MIN; lambda <= LAMBDA_MAX; lambda += 0.5) {
    const v = totalEmission(lambda, layers);
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

  const norm = peakIntensity(layers);

  // Combine layers of the same material into one emission band for the summary.
  const byMat = new Map();
  for (const L of layers) {
    const cur = byMat.get(L.key);
    if (cur) cur.amp += L.amp;
    else byMat.set(L.key, { ...L });
  }
  const bands = [...byMat.values()].sort((a, b) => a.peak - b.peak);

  document.getElementById("summary").innerHTML =
    bands
      .map(
        (b) =>
          `${b.label}: ${b.peak} nm @ ${(b.amp / norm).toFixed(3)} a.u.`
      )
      .join(" &nbsp;|&nbsp; ");

  const body = document.getElementById("result-body");
  body.innerHTML = "";
  for (const b of bands) {
    addRow(body, b.label, b.peak, b.fwhm, (b.amp / norm).toFixed(3));
  }
  document.getElementById("result").hidden = false;

  drawChart({ layers, norm });
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
  total: "#e8ebf5",
};

function drawChart({ layers, norm }) {
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

  const yMax = 1.05; // a.u. (normalised so total peaks at 1.0)

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
  for (let lambda = 400; lambda <= LAMBDA_MAX; lambda += 100) {
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

  const N = 240;
  const sample = (fn) => {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const lambda = LAMBDA_MIN + ((LAMBDA_MAX - LAMBDA_MIN) * i) / N;
      pts.push({ x: mapX(lambda), y: mapY(fn(lambda) / norm) });
    }
    return pts;
  };
  const stroke = (pts, color, width, dash) => {
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Per-material contributions (combine same-material layers).
  const byMat = new Map();
  for (const L of layers) {
    const cur = byMat.get(L.key);
    if (cur) cur.amp += L.amp;
    else byMat.set(L.key, { ...L });
  }
  for (const b of byMat.values()) {
    stroke(
      sample((lambda) => layerEmission(lambda, b.peak, b.fwhm, b.amp)),
      b.color,
      1.5,
      [5, 4]
    );
  }

  // Total spectrum on top.
  stroke(sample((lambda) => totalEmission(lambda, layers)), CHART_COLORS.total, 2.5);

  // Peak labels.
  ctx.fillStyle = CHART_COLORS.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const b of byMat.values()) {
    const x = mapX(b.peak);
    const y = mapY(totalEmission(b.peak, layers) / norm);
    ctx.fillStyle = b.color;
    ctx.fillText(`${b.label} ${b.peak}nm`, x, y - 6);
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
  module.exports = { MATERIALS, layerEmission, totalEmission };
}
