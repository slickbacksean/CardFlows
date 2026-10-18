import { describe, expect, it } from "vitest";
import { mapGradeCardReport } from "./cardgrading-map";

describe("mapGradeCardReport full extras", () => {
  it("trusts tilt surface and surfaces checkNotes", () => {
    const mapped = mapGradeCardReport({
      grade_estimate: { overall_grade: 7.5 },
      centering: { overall_grade: 9, front: { grade: 9 }, back: { grade: 9 } },
      corners_edges: {
        overall_grade: 7,
        front: { corners_grade: 7, edges_grade: 8, grade: 7 },
        back: { corners_grade: 8, edges_grade: 8, grade: 8 },
      },
      surface: { front: { grade: 6, method: "tilt_difference" }, back: { grade: 7 } },
      subgrades: {
        front: { centering: 9, corners: 7, edges: 8, surface: 6 },
        back: { centering: 9, corners: 8, edges: 8, surface: 7 },
      },
      cardflow: {
        angled: { provided: 0, used: 0, status: "not_provided" },
        full_extras: {
          used: true,
          surface_trusted: true,
          check_notes: ["Front: Possible whitening on top-left corner", "Front: Scratch on the surface"],
        },
      },
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.subgrades.surface.points).not.toBeNull();
    expect(mapped.subgrades.surface.front).toBe(6);
    expect(mapped.checkNotes).toEqual([
      "Front: Possible whitening on top-left corner",
      "Front: Scratch on the surface",
    ]);
    expect(mapped.note).toMatch(/tilted photos/i);
    expect(mapped.label).toBe("Pre-grade estimate");
    expect(mapped.disclaimer).toBe("Estimate only. Not an official grade.");
    expect(JSON.stringify(mapped)).not.toMatch(/\bAI\b/);
  });
});
