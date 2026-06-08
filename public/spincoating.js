// Spin coating film thickness calculator.
//
// Empirical thickness model (Emslie-Bonner-Peck / Meyerhofer family):
//   h = k * eta^alpha / omega^beta
//
//   h     : film thickness        [nm]
//   eta   : solution viscosity    [cP = mPa·s]
//   omega : spin speed            [rpm]
//   k     : calibration constant  (depends on solvent, evaporation, solids)
//   alpha : viscosity exponent    (~0.5 for Newtonian fluids)
//   beta  : spin-speed exponent   (~0.5, the classic h ∝ 1/sqrt(rpm) rule)

// Compute film thickness [nm] for a given viscosity and spin speed.
function computeThickness(viscosity, rpm, k, alpha, beta) {
  if (!(rpm > 0)) throw new Error("Spin speed must be greater than 0 rpm");
  return k * Math.pow(viscosity, alpha) / Math.pow(rpm, beta);
}

// Spin speeds to tabulate (rpm).
const RPM_RANGE = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 6000];

function calculate() {
  const viscosity = parseFloat(document.getElementById("viscosity").value);
  const rpm = parseFloat(document.getElementById("rpm").value);
  const k = parseFloat(document.getElementById("kconst").value);
  const alpha = parseFloat(document.getElementById("alpha").value);
  const beta = parseFloat(document.getElementById("beta").value);

  if (!(viscosity >= 0) || !(rpm > 0) || !(k >= 0)) {
    alert("점도와 보정 상수는 0 이상, 회전 속도는 0보다 큰 숫자여야 합니다.");
    return;
  }

  const h = computeThickness(viscosity, rpm, k, alpha, beta);
  document.getElementById("thickness").textContent =
    `η = ${viscosity} cP, ${rpm} rpm  →  ${h.toFixed(1)} nm  (${(h / 1000).toFixed(3)} µm)`;

  const body = document.getElementById("result-body");
  body.innerHTML = "";
  for (const r of RPM_RANGE) {
    const t = computeThickness(viscosity, r, k, alpha, beta);
    addRow(body, r.toLocaleString(), t.toFixed(1), (t / 1000).toFixed(3));
  }

  document.getElementById("result").hidden = false;

  drawChart({ viscosity, k, alpha, beta, selectedRpm: rpm });
}

function addRow(body, rpm, nm, um) {
  const tr = document.createElement("tr");
  for (const text of [rpm, nm, um]) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  body.appendChild(tr);
}

// --- Chart: film thickness vs. spin speed -----------------------------------

const CHART_RPM_MIN = 500;
const CHART_RPM_MAX = 6500;

const CHART_COLORS = {
  bg: "#11152a",
  grid: "#2a3050",
  axis: "#9aa3c0",
  text: "#9aa3c0",
  curve: "#6c8cff",
  marker: "#e8ebf5",
};

// Round a value up to a "nice" axis maximum (1/2/5 * 10^n).
function niceCeil(value) {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const frac = value / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * base;
}

// Draw the thickness-vs-rpm curve on the #chart canvas.
function drawChart({ viscosity, k, alpha, beta, selectedRpm }) {
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

  const padL = 62, padR = 18, padT = 18, padB = 46;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  // Sample the curve.
  const N = 160;
  const pts = [];
  let maxT = 0;
  for (let i = 0; i <= N; i++) {
    const rpm = CHART_RPM_MIN + (CHART_RPM_MAX - CHART_RPM_MIN) * (i / N);
    const t = computeThickness(viscosity, rpm, k, alpha, beta);
    pts.push({ rpm, t });
    if (t > maxT) maxT = t;
  }
  const yMax = niceCeil(maxT);

  const mapX = (rpm) =>
    padL + ((rpm - CHART_RPM_MIN) / (CHART_RPM_MAX - CHART_RPM_MIN)) * plotW;
  const mapY = (t) => padT + (1 - t / yMax) * plotH;

  // Gridlines + axis labels.
  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = CHART_COLORS.text;
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;

  // Y ticks (thickness, nm).
  const yTicks = 5;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= yTicks; i++) {
    const val = (yMax / yTicks) * i;
    const y = mapY(val);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(Math.round(val).toString(), padL - 8, y);
  }

  // X ticks (spin speed, rpm).
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let rpm = 1000; rpm <= CHART_RPM_MAX; rpm += 1000) {
    const x = mapX(rpm);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText((rpm / 1000) + "k", x, padT + plotH + 8);
  }

  // Axis titles.
  ctx.fillStyle = CHART_COLORS.axis;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("Spin speed (rpm)", padL + plotW / 2, cssH - 4);
  ctx.save();
  ctx.translate(14, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText("Thickness (nm)", 0, 0);
  ctx.restore();

  // Selected-rpm guide + marker.
  if (selectedRpm >= CHART_RPM_MIN && selectedRpm <= CHART_RPM_MAX) {
    const tSel = computeThickness(viscosity, selectedRpm, k, alpha, beta);
    const mx = mapX(selectedRpm);
    const my = mapY(tSel);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = CHART_COLORS.marker;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(mx, padT + plotH);
    ctx.lineTo(mx, my);
    ctx.lineTo(padL, my);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Curve.
  ctx.strokeStyle = CHART_COLORS.curve;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = mapX(p.rpm);
    const y = mapY(p.t);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Marker dot on top.
  if (selectedRpm >= CHART_RPM_MIN && selectedRpm <= CHART_RPM_MAX) {
    const tSel = computeThickness(viscosity, selectedRpm, k, alpha, beta);
    const mx = mapX(selectedRpm);
    const my = mapY(tSel);
    ctx.fillStyle = CHART_COLORS.marker;
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = CHART_COLORS.curve;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// --- Browser wiring ---------------------------------------------------------
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    // Draw an initial curve from the default inputs.
    if (document.getElementById("chart")) calculate();
  });
  // Keep the canvas crisp / rescaled on viewport changes.
  window.addEventListener("resize", () => {
    if (document.getElementById("chart")) calculate();
  });
}

// Export for Node-based reuse/testing if available.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeThickness, RPM_RANGE, niceCeil };
}
