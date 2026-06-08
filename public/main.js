// Solution Synthesis calculator for perovskite precursor solutions.
//
// Reaction (1:1 molar ratio):
//   MAPbI3  <-  PbI2  + MAI   (solvent: DMSO)
//   MAPbBr3 <-  PbBr2 + MABr  (solvent: DMSO)
//
// moles      = concentration [M] * volume [mL] / 1000
// mass_i [g] = moles * molarMass_i [g/mol]
// DMSO [mL]  = target volume   (solid volume assumed negligible)

const MATERIALS = {
  MAPbI3: {
    label: "MAPbI3 (CH3NH3PbI3)",
    solvent: "DMSO",
    precursors: [
      { name: "PbI2", molarMass: 461.01 },
      { name: "MAI", molarMass: 158.97 },
    ],
  },
  MAPbBr3: {
    label: "MAPbBr3 (CH3NH3PbBr3)",
    solvent: "DMSO",
    precursors: [
      { name: "PbBr2", molarMass: 367.01 },
      { name: "MABr", molarMass: 111.97 },
    ],
  },
};

// Compute the amounts needed for one precursor solution.
function computeSynthesis(materialKey, concentration, volumeMl) {
  const material = MATERIALS[materialKey];
  if (!material) throw new Error("Unknown material: " + materialKey);

  const moles = (concentration * volumeMl) / 1000; // mol
  const solids = material.precursors.map((p) => ({
    name: p.name,
    grams: moles * p.molarMass,
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
// viscosity rises exponentially with the dissolved-solute mass loading.
//
//   w   = C * sum(molarMass) / 1000        dissolved-solute conc. [g/mL]
//   eta = eta0 * exp(k * w)                viscosity [cP]
//
//   eta0 : pure-solvent viscosity (DMSO ~ 1.99 cP at 25 C)
//   k    : empirical loading coefficient [mL/g]
//
// w is intensive (independent of batch volume): heavier salts (MAPbI3,
// sum M ~ 620 g/mol) load more mass per litre than MAPbBr3 (~479 g/mol),
// so they give a higher viscosity at the same molarity.
const SOLVENT_VISCOSITY = { DMSO: 1.99 }; // cP at 25 C
const DEFAULT_VISC_K = 1.0; // mL/g

function soluteMolarMass(materialKey) {
  const material = MATERIALS[materialKey];
  return material.precursors.reduce((s, p) => s + p.molarMass, 0);
}

// Estimate solution viscosity [cP] for a precursor mixture.
function computeViscosity(materialKey, concentration, eta0, k) {
  const massConc = (concentration * soluteMolarMass(materialKey)) / 1000; // g/mL
  const viscosity = eta0 * Math.exp(k * massConc);
  return { massConc, viscosity };
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
  });
}

function calculate() {
  const materialKey = document.getElementById("material").value;
  const concentration = parseFloat(document.getElementById("concentration").value);
  const volumeMl = parseFloat(document.getElementById("volume").value);

  if (!(concentration >= 0) || !(volumeMl >= 0)) {
    alert("농도와 부피는 0 이상의 숫자여야 합니다.");
    return;
  }

  // Viscosity-model parameters (fall back to defaults if the inputs are absent).
  const eta0El = document.getElementById("eta0");
  const kEl = document.getElementById("visck");
  const eta0 = eta0El ? parseFloat(eta0El.value) : SOLVENT_VISCOSITY.DMSO;
  const k = kEl ? parseFloat(kEl.value) : DEFAULT_VISC_K;

  const r = computeSynthesis(materialKey, concentration, volumeMl);
  const v = computeViscosity(materialKey, concentration, eta0, k);

  const reaction = MATERIALS[materialKey].precursors.map((p) => p.name).join(" + ");
  document.getElementById("reaction").innerHTML =
    `${reaction}  →  ${materialKey}   (${r.moles.toExponential(3)} mol)<br>` +
    `용질 질량농도 ${v.massConc.toFixed(4)} g/mL &nbsp;→&nbsp; ` +
    `추정 점도 η ≈ <strong>${v.viscosity.toFixed(2)} cP</strong>`;

  const body = document.getElementById("result-body");
  body.innerHTML = "";
  for (const s of r.solids) {
    addRow(body, s.name, "전구체 (precursor)", `${s.grams.toFixed(4)} g`);
  }
  addRow(body, r.solvent, "용매 (solvent)", `${r.solventMl.toFixed(3)} mL`);

  document.getElementById("result").hidden = false;

  // Per-mixture viscosity comparison at the chosen concentration.
  const viscBody = document.getElementById("visc-body");
  if (viscBody) {
    viscBody.innerHTML = "";
    for (const key of Object.keys(MATERIALS)) {
      const vi = computeViscosity(key, concentration, eta0, k);
      addRow3(
        viscBody,
        key,
        soluteMolarMass(key).toFixed(2),
        vi.massConc.toFixed(4),
        vi.viscosity.toFixed(2)
      );
    }
    document.getElementById("visc-result").hidden = false;
  }
}

// Append a 4-cell row (material, sum M, mass conc, viscosity).
function addRow3(body, ...cells) {
  const tr = document.createElement("tr");
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  body.appendChild(tr);
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
  module.exports = { MATERIALS, computeSynthesis, computeViscosity, soluteMolarMass };
}
