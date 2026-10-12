import { describe, expect, it } from "vitest";
import { ebayListingCsv, tcgTraderCollectionCsv } from "./collection-export";

describe("marketplace collection files", () => {
  it("quotes commas and keeps a blank asking price", () => {
    const csv = ebayListingCsv([
      {
        title: 'Pikachu, "Base"',
        description: "Raw single.\nEnglish.",
        condition: "NM",
        askingPrice: null,
        currency: "USD",
        quantity: 1,
        setName: "Base Set",
        localId: "58",
      },
    ]);

    expect(csv.split("\n")[0]).toBe(
      "Title,Description,Condition,Asking price,Currency,Quantity,Set,Number",
    );
    expect(csv).toContain('"Pikachu, ""Base"""');
    expect(csv).toContain('"Raw single.\nEnglish."');
    expect(csv).toContain(",NM,,USD,1,Base Set,58");
  });

  it("writes a TCG Trader row without private notes", () => {
    const csv = tcgTraderCollectionCsv([
      {
        name: "Charizard",
        setName: "Base Set",
        localId: "4",
        variant: "holo",
        condition: "LP",
        quantity: 2,
      },
    ]);

    expect(csv).toBe("Name,Set,Number,Variant,Condition,Quantity\nCharizard,Base Set,4,holo,LP,2");
    expect(csv.toLowerCase()).not.toContain("note");
  });
});
