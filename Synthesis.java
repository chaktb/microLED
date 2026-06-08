import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Solution Synthesis calculator for perovskite precursor solutions.
 *
 * Reaction (1:1 molar ratio):
 *     MAPbI3  &lt;-  PbI2  + MAI   (solvent: DMSO)
 *     MAPbBr3 &lt;-  PbBr2 + MABr  (solvent: DMSO)
 *
 * moles      = concentration [M] * volume [mL] / 1000
 * mass_i [g] = moles * molarMass_i [g/mol]
 * DMSO [mL]  = target volume   (solid volume assumed negligible)
 *
 * Usage:
 *     javac Synthesis.java
 *     java Synthesis                       // default example (all materials, 0.9 M, 1 mL)
 *     java Synthesis MAPbI3 0.9 1          // one material
 *     java Synthesis MAPbBr3 1.2 2.5
 */
public class Synthesis {

    /** A precursor reagent and its molar mass (g/mol). */
    static final class Precursor {
        final String name;
        final double molarMass;

        Precursor(String name, double molarMass) {
            this.name = name;
            this.molarMass = molarMass;
        }
    }

    /** A target material: its solvent and the precursors mixed 1:1. */
    static final class Material {
        final String label;
        final String solvent;
        final List<Precursor> precursors;

        Material(String label, String solvent, List<Precursor> precursors) {
            this.label = label;
            this.solvent = solvent;
            this.precursors = precursors;
        }
    }

    static final Map<String, Material> MATERIALS = new LinkedHashMap<>();

    static {
        MATERIALS.put("MAPbI3", new Material(
                "MAPbI3 (CH3NH3PbI3)", "DMSO",
                List.of(new Precursor("PbI2", 461.01),
                        new Precursor("MAI", 158.97))));
        MATERIALS.put("MAPbBr3", new Material(
                "MAPbBr3 (CH3NH3PbBr3)", "DMSO",
                List.of(new Precursor("PbBr2", 367.01),
                        new Precursor("MABr", 111.97))));
    }

    /** Print the synthesis recipe for one material at the given concentration/volume. */
    static void printRecipe(String materialKey, double concentration, double volumeMl) {
        Material material = MATERIALS.get(materialKey);
        if (material == null) {
            throw new IllegalArgumentException(
                    "Unknown material: " + materialKey + ". Choose from " + MATERIALS.keySet());
        }

        double moles = concentration * volumeMl / 1000.0; // mol

        StringBuilder reaction = new StringBuilder();
        for (int i = 0; i < material.precursors.size(); i++) {
            if (i > 0) reaction.append(" + ");
            reaction.append(material.precursors.get(i).name);
        }

        System.out.printf("%n=== %s  (%s M, %s mL) ===%n", materialKey, concentration, volumeMl);
        System.out.printf("Reaction: %s  ->  %s%n", reaction, materialKey);
        System.out.printf("Moles   : %.3e mol%n", moles);
        System.out.println("----------------------------------------");
        for (Precursor p : material.precursors) {
            double grams = moles * p.molarMass;
            System.out.printf("  %-6s (precursor): %.4f g%n", p.name, grams);
        }
        System.out.printf("  %-6s (solvent)  : %.3f mL%n", material.solvent, volumeMl);
    }

    public static void main(String[] args) {
        if (args.length == 0) {
            // Default example: every material at 0.9 M, 1 mL.
            for (String key : MATERIALS.keySet()) {
                printRecipe(key, 0.9, 1.0);
            }
        } else if (args.length == 3) {
            String materialKey = args[0];
            double concentration = Double.parseDouble(args[1]);
            double volumeMl = Double.parseDouble(args[2]);
            printRecipe(materialKey, concentration, volumeMl);
        } else {
            System.out.println("Usage: java Synthesis [MATERIAL CONCENTRATION VOLUME_ML]");
            System.out.println("Example: java Synthesis MAPbI3 0.9 1");
            System.exit(1);
        }
    }
}
