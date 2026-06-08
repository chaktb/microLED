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

  const r = computeSynthesis(materialKey, concentration, volumeMl);

  const reaction = MATERIALS[materialKey].precursors.map((p) => p.name).join(" + ");
  document.getElementById("reaction").textContent =
    `${reaction}  →  ${materialKey}   (${r.moles.toExponential(3)} mol)`;

  const body = document.getElementById("result-body");
  body.innerHTML = "";
  for (const s of r.solids) {
    addRow(body, s.name, "전구체 (precursor)", `${s.grams.toFixed(4)} g`);
  }
  addRow(body, r.solvent, "용매 (solvent)", `${r.solventMl.toFixed(3)} mL`);

  document.getElementById("result").hidden = false;
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
  module.exports = { MATERIALS, computeSynthesis };
}
