import type { TcgdexVariants } from "@cardflow/shared";

export interface VariantOption {
  id: string;
  label: string;
}

const VARIANT_DEFS: Array<{
  flag: keyof TcgdexVariants;
  id: string;
  label: string;
}> = [
  { flag: "normal", id: "normal", label: "normal" },
  { flag: "holo", id: "holo", label: "Holofoil" },
  { flag: "reverse", id: "reverse", label: "Reverse" },
  { flag: "firstEdition", id: "1st edition", label: "1st edition" },
  { flag: "wPromo", id: "wPromo", label: "W Promo" },
];

export function variantOptions(variants: TcgdexVariants | null | undefined): VariantOption[] {
  if (!variants) return [];
  return VARIANT_DEFS.filter((def) => variants[def.flag]).map(({ id, label }) => ({
    id,
    label,
  }));
}

export function defaultVariantId(
  variants: TcgdexVariants,
  selected?: string | null,
): string {
  const options = variantOptions(variants);
  if (selected && options.some((option) => option.id === selected)) return selected;
  return options[0]?.id ?? "normal";
}
