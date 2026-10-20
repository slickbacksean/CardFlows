/**
 * User-owned spreadsheets for pasting into a marketplace.
 * PokeSniper does not upload, log in, or publish these rows.
 */

export interface EbayListingExportRow {
  title: string;
  description: string;
  condition: string | null;
  askingPrice: string | null;
  currency: string;
  quantity: number;
  setName: string;
  localId: string;
}

export interface TcgTraderExportRow {
  name: string;
  setName: string;
  localId: string;
  variant: string | null;
  condition: string | null;
  quantity: number;
}

export const EBAY_LISTING_CSV_HEADER =
  "Title,Description,Condition,Asking price,Currency,Quantity,Set,Number";

export const TCG_TRADER_CSV_HEADER = "Name,Set,Number,Variant,Condition,Quantity";

function csvCell(value: string): string {
  const text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

export function ebayListingCsv(rows: readonly EbayListingExportRow[]): string {
  const lines = rows.map((row) =>
    csvLine([
      row.title.trim(),
      row.description.trim(),
      row.condition?.trim() ?? "",
      row.askingPrice?.trim() ?? "",
      row.currency.trim(),
      String(row.quantity),
      row.setName.trim(),
      row.localId.trim(),
    ]),
  );
  return [EBAY_LISTING_CSV_HEADER, ...lines].join("\n");
}

export function tcgTraderCollectionCsv(rows: readonly TcgTraderExportRow[]): string {
  const lines = rows.map((row) =>
    csvLine([
      row.name.trim(),
      row.setName.trim(),
      row.localId.trim(),
      row.variant?.trim() ?? "",
      row.condition?.trim() ?? "",
      String(row.quantity),
    ]),
  );
  return [TCG_TRADER_CSV_HEADER, ...lines].join("\n");
}
