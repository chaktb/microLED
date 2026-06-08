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

// Export for Node-based reuse/testing if available.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeThickness, RPM_RANGE };
}
