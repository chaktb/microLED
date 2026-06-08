// Solution Synthesis calculator for perovskite precursor solutions.
//
// Reaction (per mole of perovskite, solvent: DMSO):
//   MAPbI3            <-  PbI2  + MAI
//   MAPbBr3           <-  PbBr2 + MABr
//   MAPb(I[1-x]Br[x])3 <- (1-x)(PbI2 + MAI) + x(PbBr2 + MABr)
//
// Each precursor carries a stoichiometric coefficient `mol` (moles per mole
// of perovskite; default 1). For a mixed halide the coefficients follow the
// (1-x):x mixing of the two pure precursor sets.
//
// moles      = concentration [M] * volume [mL] / 1000
// mass_i [g] = moles * mol_i * molarMass_i [g/mol]
// DMSO [mL]  = target volume   (solid volume assumed negligible)

const MATERIALS = {
  MAPbI3: {
    label: "MAPbI3 (CH3NH3PbI3)",
    short: "MAPbI3",
    solvent: "DMSO",
    precursors: [
      { name: "PbI2", molarMass: 461.01 },
      { name: "MAI", molarMass: 158.97 },
    ],
  },
  MAPbBr3: {
    label: "MAPbBr3 (CH3NH3PbBr3)",
    short: "MAPbBr3",
    solvent: "DMSO",
    precursors: [
      { name: "PbBr2", molarMass: 367.01 },
      { name: "MABr", molarMass: 111.97 },
    ],
  },
  // Mixed halide MAPb(I[1-x]Br[x])3 — composition set dynamically from x.
  MIXED: {
    label: "MAPb(I,Br)3 (mixed halide)",
    short: "MAPb(I,Br)3",
    solvent: "DMSO",
    x: 0.96,
    precursors: [],
  },
};

// Molar masses of the four precursors used by the mixed halide.
const MIXED_PRECURSORS = {
  PbI2: 461.01,
  PbBr2: 367.01,
  MAI: 158.97,
  MABr: 111.97,
};

// Set the mixed-halide composition (Br fraction x in [0,1]) and rebuild its
// precursors as (1-x)(PbI2 + MAI) + x(PbBr2 + MABr).
function setMixedComposition(x) {
  const xb = Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0.96));
  const m = MATERIALS.MIXED;
  m.x = xb;
  m.short = `MAPb(I${(1 - xb).toFixed(2)}Br${xb.toFixed(2)})3`;
  m.label = `${m.short} (mixed halide)`;
  m.precursors = [
    { name: "PbI2", molarMass: MIXED_PRECURSORS.PbI2, mol: 1 - xb },
    { name: "PbBr2", molarMass: MIXED_PRECURSORS.PbBr2, mol: xb },
    { name: "MAI", molarMass: MIXED_PRECURSORS.MAI, mol: 1 - xb },
    { name: "MABr", molarMass: MIXED_PRECURSORS.MABr, mol: xb },
  ];
}
setMixedComposition(0.96); // default composition

// Stoichiometric coefficient of a precursor (moles per mole of perovskite).
function coeff(p) {
  return p.mol === undefined ? 1 : p.mol;
}

// Format a coefficient without floating-point noise (e.g. 0.04, 0.96, 1).
function fmtCoeff(m) {
  return parseFloat(m.toFixed(4)).toString();
}

// Friendly display name (composition) for a material key.
function displayName(key) {
  return (MATERIALS[key] && MATERIALS[key].short) || key;
}

// Compute the amounts needed for one precursor solution.
function computeSynthesis(materialKey, concentration, volumeMl) {
  const material = MATERIALS[materialKey];
  if (!material) throw new Error("Unknown material: " + materialKey);

  const moles = (concentration * volumeMl) / 1000; // mol of perovskite
  const solids = material.precursors.map((p) => ({
    name: p.name,
    mol: coeff(p),
    grams: moles * coeff(p) * p.molarMass,
  }));

  return {
    material: materialKey,
    moles,
    solvent: material.solvent,
    solventMl: volumeMl,
    solids,
  };
}

// --- Viscosity estimate -----------------------------------------------------
//
// Concentrated precursor inks behave roughly like a Mooney/Arrhenius mixture:
// viscosity rises exponentially with the dissolved-solute mass loading, and
// falls with temperature following an Andrade/Arrhenius law.
//
//   w       = C * sum(molarMass) / 1000               solute conc. [g/mL]
//   eta_ref = eta0 * exp(k * w)                        viscosity at T_ref [cP]
//   eta(T)  = eta_ref * exp[ (Ea/R)*(1/T - 1/T_ref) ] temperature corrected
//
//   eta0 : pure-solvent viscosity at T_ref (DMSO ~ 1.99 cP at 25 C)
//   k    : empirical loading coefficient [mL/g]
//   Ea   : activation energy for viscous flow [kJ/mol] (DMSO-like ~13.5)
//   T    : absolute temperature [K],  T_ref = 298.15 K (25 C)
//
// w is intensive (independent of batch volume): heavier salts (MAPbI3,
// sum M ~ 620 g/mol) load more mass per litre than MAPbBr3 (~479 g/mol),
// so they give a higher viscosity at the same molarity.
const SOLVENT_VISCOSITY = { DMSO: 1.99 }; // cP at 25 C
const DEFAULT_VISC_K = 1.0;   // mL/g
const DEFAULT_EA = 13.5;      // kJ/mol, activation energy for viscous flow
const R_GAS = 8.314;          // J/mol/K
const T_REF_K = 298.15;       // 25 C reference where eta0 is defined

function soluteMolarMass(materialKey) {
  const material = MATERIALS[materialKey];
  return material.precursors.reduce((s, p) => s + coeff(p) * p.molarMass, 0);
}

// Arrhenius temperature factor relative to T_ref (= 1 at 25 C).
function temperatureFactor(tempC, Ea) {
  const T = tempC + 273.15;
  return Math.exp(((Ea * 1000) / R_GAS) * (1 / T - 1 / T_REF_K));
}

// Estimate solution viscosity [cP] for a precursor mixture at temperature tempC.
function computeViscosity(materialKey, concentration, eta0, k, tempC, Ea) {
  const massConc = (concentration * soluteMolarMass(materialKey)) / 1000; // g/mL
  const etaRef = eta0 * Math.exp(k * massConc);          // at 25 C
  const t = tempC === undefined ? 25 : tempC;
  const ea = Ea === undefined ? DEFAULT_EA : Ea;
  const viscosity = etaRef * temperatureFactor(t, ea);   // at tempC
  return { massConc, etaRef, viscosity };
}

// --- Browser UI wiring (guarded so the file can also be imported elsewhere) ---
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.getElementById("material");
    for (const [key, m] of Object.entries(MATERIALS)) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = m.label;
      select.appendChild(opt);
    }
    // Draw the initial viscosity-vs-temperature chart from the defaults.
    if (document.getElementById("visc-chart")) calculate();
  });
  // Keep the canvas crisp / rescaled on viewport changes.
  window.addEventListener("resize", () => {
    if (document.getElementById("visc-chart")) calculate();
  });
}

function calculate() {
  const materialKey = document.getElementById("material").value;
  const concentration = parseFloat(document.getElementById("concentration").value);
  const volumeMl = parseFloat(document.getElementById("volume").value);

  // Mixed-halide composition: update from the x input before any computation.
  const xEl = document.getElementById("xbr");
  if (xEl) {
    setMixedComposition(parseFloat(xEl.value));
    const opt = document.querySelector('#material option[value="MIXED"]');
    if (opt) opt.textContent = MATERIALS.MIXED.label;
  }

  if (!(concentration >= 0) || !(volumeMl >= 0)) {
    alert("농도와 부피는 0 이상의 숫자여야 합니다.");
    return;
  }

  // Viscosity-model parameters (fall back to defaults if the inputs are absent).
  const eta0El = document.getElementById("eta0");
  const kEl = document.getElementById("visck");
  const tempEl = document.getElementById("temp");
  const eaEl = document.getElementById("ea");
  const eta0 = eta0El ? parseFloat(eta0El.value) : SOLVENT_VISCOSITY.DMSO;
  const k = kEl ? parseFloat(kEl.value) : DEFAULT_VISC_K;
  const tempC = tempEl ? parseFloat(tempEl.value) : 25;
  const Ea = eaEl ? parseFloat(eaEl.value) : DEFAULT_EA;

  const r = computeSynthesis(materialKey, concentration, volumeMl);
  const v = computeViscosity(materialKey, concentration, eta0, k, tempC, Ea);

  const reaction = MATERIALS[materialKey].precursors
    .filter((p) => coeff(p) > 0)
    .map((p) => (coeff(p) === 1 ? p.name : `${fmtCoeff(coeff(p))} ${p.name}`))
    .join(" + ");
  document.getElementById("reaction").innerHTML =
    `${reaction}  →  ${displayName(materialKey)}   (${r.moles.toExponential(3)} mol)<br>` +
    `용질 질량농도 ${v.massConc.toFixed(4)} g/mL &nbsp;|&nbsp; ` +
    `η(25°C) = ${v.etaRef.toFixed(2)} cP &nbsp;→&nbsp; ` +
    `η(${tempC}°C) ≈ <strong>${v.viscosity.toFixed(2)} cP</strong>`;

  const body = document.getElementById("result-body");
  body.innerHTML = "";
  for (const s of r.solids) {
    if (s.mol <= 0) continue; // skip precursors absent at this composition
    const role = s.mol === 1 ? "전구체 (precursor)" : `전구체 ×${fmtCoeff(s.mol)} (precursor)`;
    addRow(body, s.name, role, `${s.grams.toFixed(4)} g`);
  }
  addRow(body, r.solvent, "용매 (solvent)", `${r.solventMl.toFixed(3)} mL`);

  document.getElementById("result").hidden = false;

  // Per-mixture viscosity comparison at the chosen concentration & temperature.
  const viscBody = document.getElementById("visc-body");
  if (viscBody) {
    viscBody.innerHTML = "";
    for (const key of Object.keys(MATERIALS)) {
      const vi = computeViscosity(key, concentration, eta0, k, tempC, Ea);
      addRow3(
        viscBody,
        displayName(key),
        soluteMolarMass(key).toFixed(2),
        vi.massConc.toFixed(4),
        vi.etaRef.toFixed(2),
        vi.viscosity.toFixed(2)
      );
    }
    document.getElementById("visc-result").hidden = false;
  }

  drawViscChart({ concentration, eta0, k, Ea, selectedTemp: tempC });
}

// Append a row from its cells.
function addRow3(body, ...cells) {
  const tr = document.createElement("tr");
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  body.appendChild(tr);
}

// --- Chart: viscosity vs. temperature ---------------------------------------

const VISC_CHART_COLORS = {
  grid: "#2a3050",
  axis: "#9aa3c0",
  text: "#9aa3c0",
  marker: "#e8ebf5",
};
const MATERIAL_COLORS = {
  MAPbI3: "#8e44ad",
  MAPbBr3: "#27ae60",
  MIXED: "#e0a13a",
};
const TEMP_MIN = 0;   // C
const TEMP_MAX = 80;  // C

function niceCeil(value) {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const frac = value / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * base;
}

// Draw viscosity-vs-temperature curves (one per mixture) on #visc-chart.
function drawViscChart({ concentration, eta0, k, Ea, selectedTemp }) {
  const canvas = document.getElementById("visc-chart");
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

  const keys = Object.keys(MATERIALS);
  const viscAt = (key, t) =>
    computeViscosity(key, concentration, eta0, k, t, Ea).viscosity;

  // Y range from the coldest point (highest viscosity) across mixtures.
  let maxV = 0;
  for (const key of keys) {
    const vv = viscAt(key, TEMP_MIN);
    if (vv > maxV) maxV = vv;
  }
  const yMax = niceCeil(maxV);

  const mapX = (t) => padL + ((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * plotW;
  const mapY = (vv) => padT + (1 - vv / yMax) * plotH;

  ctx.font = "12px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = VISC_CHART_COLORS.text;
  ctx.strokeStyle = VISC_CHART_COLORS.grid;
  ctx.lineWidth = 1;

  // Y ticks (viscosity, cP).
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 5; i++) {
    const val = (yMax / 5) * i;
    const y = mapY(val);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(1), padL - 8, y);
  }

  // X ticks (temperature, C).
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let t = TEMP_MIN; t <= TEMP_MAX; t += 20) {
    const x = mapX(t);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText(String(t), x, padT + plotH + 8);
  }

  // Axis titles.
  ctx.fillStyle = VISC_CHART_COLORS.axis;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("Temperature (°C)", padL + plotW / 2, cssH - 4);
  ctx.save();
  ctx.translate(13, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText("Viscosity (cP)", 0, 0);
  ctx.restore();

  // Selected-temperature guide.
  if (selectedTemp >= TEMP_MIN && selectedTemp <= TEMP_MAX) {
    const mx = mapX(selectedTemp);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = VISC_CHART_COLORS.marker;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(mx, padT);
    ctx.lineTo(mx, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // One curve per mixture + marker at the selected temperature.
  const N = 160;
  let ly = padT + 6;
  for (const key of keys) {
    const color = MATERIAL_COLORS[key] || "#6c8cff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = TEMP_MIN + ((TEMP_MAX - TEMP_MIN) * i) / N;
      const x = mapX(t);
      const y = mapY(viscAt(key, t));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (selectedTemp >= TEMP_MIN && selectedTemp <= TEMP_MAX) {
      const mx = mapX(selectedTemp);
      const my = mapY(viscAt(key, selectedTemp));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx, my, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Legend swatch.
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(padL + plotW - 120, ly);
    ctx.lineTo(padL + plotW - 94, ly);
    ctx.stroke();
    ctx.fillStyle = VISC_CHART_COLORS.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(displayName(key), padL + plotW - 88, ly);
    ly += 16;
  }
}

function addRow(body, component, role, amount) {
  const tr = document.createElement("tr");
  for (const text of [component, role, amount]) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  body.appendChild(tr);
}

// Export for Node-based reuse/testing if available.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MATERIALS, computeSynthesis, computeViscosity, soluteMolarMass,
    setMixedComposition, displayName,
  };
}
