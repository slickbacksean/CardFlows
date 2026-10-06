/** Parse a dollar decimal string (e.g. "8.00") to integer cents. */
export function dollarsToCents(amount: string): number {
  const trimmed = amount.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`Invalid dollar amount: ${amount}`);
  }
  const [whole, fraction = ''] = trimmed.split('.');
  const paddedFraction = fraction.padEnd(2, '0').slice(0, 2);
  const sign = whole.startsWith('-') ? -1 : 1;
  const absoluteWhole = whole.replace('-', '');
  return sign * (Number(absoluteWhole) * 100 + Number(paddedFraction));
}

/** Format integer cents as a dollar decimal string with two places. */
export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}${dollars}.${String(remainder).padStart(2, '0')}`;
}
