import { describe, expect, it } from "vitest";
import { computeAllInCost } from "./all-in-cost";

describe("computeAllInCost", () => {
  it("sums all five lines for the Pikachu complete example", () => {
    const result = computeAllInCost({
      purchasePrice: "3.50",
      shipping: "0.00",
      tax: "0.29",
      fees: "0.00",
      supplies: "0.25",
    });
    expect(result.allInTotal).toBe("4.04");
  });

  it("defaults optional lines to 0", () => {
    const result = computeAllInCost({ purchasePrice: "15.00" });
    expect(result.shipping).toBe("0.00");
    expect(result.tax).toBe("0.00");
    expect(result.fees).toBe("0.00");
    expect(result.supplies).toBe("0.00");
    expect(result.allInTotal).toBe("15.00");
  });
});
