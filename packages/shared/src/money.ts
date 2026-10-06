const CENTS_PER_DOLLAR = 100;

export const INVALID_DOLLAR_AMOUNT = "Enter a valid price.";

/**
 * User-entered USD. Returns cents, or null when the text is not a price.
 * Accepts a leading `$` and a comma decimal (`12,50`). Rejects negatives.
 * Rounds half-up from the thousandths digit so `1.005` is 101 cents.
 */
export function parseDollarsToCents(amount: string | number | null | undefined): number | null {
  if (amount === null || amount === undefined) return null;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount) || Object.is(amount, -0)) return null;
    return parseDollarText(String(amount));
  }
  if (typeof amount !== "string") return null;
  return parseDollarText(amount);
}

export function dollarsToCents(amount: string | number): number {
  const cents = parseDollarsToCents(amount);
  if (cents === null) {
    throw new Error(`Invalid dollar amount: ${String(amount)}`);
  }
  return cents;
}

export function centsToDollarString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${(absolute / CENTS_PER_DOLLAR).toFixed(2)}`;
}

export function optionalDollarsToCents(
  amount: string | number | null | undefined,
): number | null {
  if (amount === null || amount === undefined || amount === "") return null;
  return parseDollarsToCents(amount);
}

export function roundHalfUpToCent(value: number): number {
  return Math.round(value);
}

function parseDollarText(raw: string): number | null {
  let text = raw.trim().replace(/\s+/g, "");
  if (!text) return null;
  if (text.startsWith("$")) text = text.slice(1);
  if (!text || text.startsWith("+") || text.includes("-")) return null;
  const normalized = normalizeDecimalSeparators(text);
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null;
  const [whole = "", fraction = ""] = normalized.split(".");
  if (whole.length > 12) return null;
  const dollars = Number(whole);
  if (!Number.isSafeInteger(dollars)) return null;
  const digits = `${fraction}000`;
  const centsTwo = Number(digits.slice(0, 2));
  const roundUp = digits[2]! >= "5";
  return dollars * CENTS_PER_DOLLAR + centsTwo + (roundUp ? 1 : 0);
}

function normalizeDecimalSeparators(text: string): string | null {
  const hasDot = text.includes(".");
  const hasComma = text.includes(",");
  if (hasDot && hasComma) {
    const decimalIsDot = text.lastIndexOf(".") > text.lastIndexOf(",");
    const thousands = decimalIsDot ? "," : ".";
    const stripped = text.split(thousands).join("");
    return decimalIsDot ? stripped : stripped.replace(",", ".");
  }
  if (!hasComma) return text;
  const parts = text.split(",");
  const last = parts[parts.length - 1] ?? "";
  if (
    parts.length === 2 &&
    last.length > 0 &&
    last.length <= 2 &&
    parts.every((part) => /^\d+$/.test(part))
  ) {
    return `${parts[0]}.${last}`;
  }
  if (parts.every((part, index) => /^\d+$/.test(part) && (index === 0 || part.length === 3))) {
    return parts.join("");
  }
  return null;
}
