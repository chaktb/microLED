#!/usr/bin/env python3
"""Solution Synthesis calculator for perovskite precursor solutions.

Reaction (1:1 molar ratio):
    MAPbI3  <-  PbI2  + MAI   (solvent: DMSO)
    MAPbBr3 <-  PbBr2 + MABr  (solvent: DMSO)

moles      = concentration [M] * volume [mL] / 1000
mass_i [g] = moles * molar_mass_i [g/mol]
DMSO [mL]  = target volume   (solid volume assumed negligible)

Usage:
    python synthesis.py                          # default example (all materials, 0.9 M, 1 mL)
    python synthesis.py MAPbI3 0.9 1             # one material
    python synthesis.py MAPbBr3 1.2 2.5
"""

import sys
from dataclasses import dataclass


@dataclass
class Precursor:
    name: str
    molar_mass: float  # g/mol


@dataclass
class Material:
    label: str
    solvent: str
    precursors: list


MATERIALS = {
    "MAPbI3": Material(
        label="MAPbI3 (CH3NH3PbI3)",
        solvent="DMSO",
        precursors=[
            Precursor("PbI2", 461.01),
            Precursor("MAI", 158.97),
        ],
    ),
    "MAPbBr3": Material(
        label="MAPbBr3 (CH3NH3PbBr3)",
        solvent="DMSO",
        precursors=[
            Precursor("PbBr2", 367.01),
            Precursor("MABr", 111.97),
        ],
    ),
}


def compute_synthesis(material_key, concentration, volume_ml):
    """Return a dict describing the amounts needed for one precursor solution."""
    material = MATERIALS.get(material_key)
    if material is None:
        raise ValueError(f"Unknown material: {material_key!r}. "
                         f"Choose from {list(MATERIALS)}")

    moles = concentration * volume_ml / 1000.0  # mol
    solids = [
        {"name": p.name, "grams": moles * p.molar_mass}
        for p in material.precursors
    ]
    return {
        "material": material_key,
        "moles": moles,
        "solvent": material.solvent,
        "solvent_ml": volume_ml,
        "solids": solids,
    }


def print_recipe(material_key, concentration, volume_ml):
    r = compute_synthesis(material_key, concentration, volume_ml)
    reaction = " + ".join(p.name for p in MATERIALS[material_key].precursors)
    print(f"\n=== {material_key}  ({concentration} M, {volume_ml} mL) ===")
    print(f"Reaction: {reaction}  ->  {material_key}")
    print(f"Moles   : {r['moles']:.3e} mol")
    print("-" * 40)
    for s in r["solids"]:
        print(f"  {s['name']:<6} (precursor): {s['grams']:.4f} g")
    print(f"  {r['solvent']:<6} (solvent)  : {r['solvent_ml']:.3f} mL")


def main(argv):
    if len(argv) == 1:
        # Default example: every material at 0.9 M, 1 mL.
        for key in MATERIALS:
            print_recipe(key, 0.9, 1.0)
    elif len(argv) == 4:
        material_key = argv[1]
        concentration = float(argv[2])
        volume_ml = float(argv[3])
        print_recipe(material_key, concentration, volume_ml)
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
