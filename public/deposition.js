// Glovebox N2 purge / partial-pressure calculator.
//
// Well-mixed (perfectly stirred) purge model at constant volume, temperature
// and total pressure. Pure N2 flows in at volumetric rate Q while the same
// volume of mixed gas leaves. The original atmosphere (air) is treated as a
// tracer whose fraction decays exponentially:
//
//   phi(t) = exp(-Q*t / V)                    fraction of original air remaining
//   y_N2(t) = 1 - (1 - y0) * exp(-t/tau)      N2 mole fraction,  tau = V / Q
//   P_N2(t) = y_N2(t) * P_total
//
//   V       : glovebox volume        [L]
//   Q       : N2 flow rate           [L/min]
//   t       : elapsed time           [min]
//   tau     : time constant V/Q      [min]  (one volume exchange)
//   y0      : initial N2 fraction    [0..1] (~0.781 for air)
//   P_total : total pressure         [kPa]

// N2 mole fraction [0..1] after purging for time t.
function n2Fraction(t, V, Q, y0) {
  if (!(V > 0)) throw new Error("Volume must be greater than 0 L");
  const tau = V / Q;
  const remaining = Q > 0 ? Math.exp(-t / tau) : 1; // fraction of original air left
  return 1 - (1 - y0) * remaining;
}

// N2 partial pressure [kPa] after purging for time t.
function n2PartialPressure(t, V, Q, y0, pTotal) {
  return n2Fraction(t, V, Q, y0) * pTotal;
}

function calculate() {
  const V = parseFloat(document.getElementById("volume").value);
  const Q = parseFloat(document.getElementById("flow").value);
  const t = parseFloat(document.getElementById("time").value);
  const pTotal = parseFloat(document.getElementById("ptotal").value);
  const y0 = parseFloat(document.getElementById("y0").value) / 100;

  if (!(V > 0) || !(Q >= 0) || !(t >= 0) || !(pTotal >= 0) || !(y0 >= 0) || y0 > 1) {
    alert("부피는 0보다 커야 하고, 유량·시간·압력은 0 이상, 초기 N₂ 분율은 0~100% 여야 합니다.");
    return;
  }

  const tau = V / Q;
  const yN2 = n2Fraction(t, V, Q, y0);
  const pN2 = yN2 * pTotal;
  const purgeVols = Q > 0 ? t / tau : 0;
  const impurityPpm = (1 - yN2) * 1e6;

  const tauText = Q > 0 ? `${tau.toFixed(1)} min` : "∞ (유량 0)";
  document.getElementById("summary").innerHTML =
    `τ = V/Q = ${tauText} &nbsp;|&nbsp; ${t} min 후 (${purgeVols.toFixed(2)} 부피 교환)<br>` +
    `N₂ 분율 = ${(yN2 * 100).toFixed(3)} % &nbsp;→&nbsp; ` +
    `P<sub>N₂</sub> = ${pN2.toFixed(3)} kPa ` +
    `(${(pN2 / 101.325).toFixed(4)} atm, ${(pN2 * 10).toFixed(1)} mbar)<br>` +
    `잔류 불순물 ≈ ${impurityPpm.toFixed(0).toLocaleString()} ppm`;

  // Tabulate at multiples of the time constant.
  const body = document.getElementById("result-body");
  body.innerHTML = "";
  const rows = Q > 0
    ? [0, 0.5, 1, 2, 3, 4, 5].map((n) => n * tau)
    : [0];
  for (const rt of rows) {
    const y = n2Fraction(rt, V, Q, y0);
    addRow(
      body,
      rt.toFixed(0),
      Q > 0 ? (rt / tau).toFixed(1) : "—",
      (y * 100).toFixed(3),
      (y * pTotal).toFixed(3),
      ((1 - y) * 1e6).toFixed(0).toLocaleString()
    );
  }
  document.getElementById("result").hidden = false;

  drawChart({ V, Q, y0, pTotal, selectedT: t });
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

// --- Chart: N2 partial pressure vs. time ------------------------------------

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

// Draw the P_N2-vs-time curve on the #chart canvas.
function drawChart({ V, Q, y0, pTotal, selectedT }) {
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

  // Time axis: 0 .. 5 tau (or include the selected time if it is larger).
  const tau = Q > 0 ? V / Q : 0;
  let tMax = tau > 0 ? 5 * tau : Math.max(selectedT, 1);
  if (selectedT > tMax) tMax = selectedT;
  if (!(tMax > 0)) tMax = 1;

  const yMax = niceCeil(pTotal);

  // Sample the curve.
  const N = 160;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = tMax * (i / N);
    pts.push({ t, p: n2PartialPressure(t, V, Q, y0, pTotal) });
  }

  const mapX = (t) => padL + (t / tMax) * plotW;
  const mapY = (p) => padT + (1 - p / yMax) * plotH;

  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = CHART_COLORS.text;
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;

  // Y ticks (partial pressure, kPa).
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
    ctx.fillText(val.toFixed(0), padL - 8, y);
  }

  // X ticks (time, min).
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = 5;
  for (let i = 0; i <= xTicks; i++) {
    const val = (tMax / xTicks) * i;
    const x = mapX(val);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText(val.toFixed(0), x, padT + plotH + 8);
  }

  // Axis titles.
  ctx.fillStyle = CHART_COLORS.axis;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("Time (min)", padL + plotW / 2, cssH - 4);
  ctx.save();
  ctx.translate(14, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText("N₂ partial pressure (kPa)", 0, 0);
  ctx.restore();

  // Selected-time guide + marker.
  if (selectedT >= 0 && selectedT <= tMax) {
    const pSel = n2PartialPressure(selectedT, V, Q, y0, pTotal);
    const mx = mapX(selectedT);
    const my = mapY(pSel);
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
    const x = mapX(p.t);
    const y = mapY(p.p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Marker dot on top.
  if (selectedT >= 0 && selectedT <= tMax) {
    const pSel = n2PartialPressure(selectedT, V, Q, y0, pTotal);
    const mx = mapX(selectedT);
    const my = mapY(pSel);
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
    if (document.getElementById("chart")) calculate();
  });
  window.addEventListener("resize", () => {
    if (document.getElementById("chart")) calculate();
  });
}

// Export for Node-based reuse/testing if available.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { n2Fraction, n2PartialPressure, niceCeil };
}
