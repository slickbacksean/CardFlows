import type { CardFlowCanonicalCard, CatalogImage, TcgdexVariants } from "./types";

export interface MockCatalogSet {
  id: string;
  name: string;
  aliases: string[];
  logo?: string;
  cardCount?: {
    official: number;
    total: number;
  };
}

export interface MockCatalogCard {
  tcgdexId: string;
  tcgdexSetId: string;
  localId: string;
  name: string;
  language: "en";
  category: string;
  rarity: string;
  illustrator?: string;
  variants: TcgdexVariants;
  image: CatalogImage;
}

export const MOCK_SETS: MockCatalogSet[] = [
  {
    id: "base1",
    name: "Base Set",
    aliases: ["Base Set"],
    logo: "https://assets.tcgdex.net/en/base/base1/logo",
    cardCount: { official: 102, total: 102 },
  },
  {
    id: "base4",
    name: "Base Set 2",
    aliases: ["Base Set 2"],
  },
  {
    id: "lc",
    name: "Legendary Collection",
    aliases: ["Legendary Collection"],
  },
  {
    id: "swsh3",
    name: "Darkness Ablaze",
    aliases: ["Darkness Ablaze"],
    logo: "https://assets.tcgdex.net/en/swsh/swsh3/logo",
    cardCount: { official: 189, total: 201 },
  },
];

const defaultVariants: TcgdexVariants = {
  firstEdition: false,
  holo: false,
  normal: true,
  reverse: false,
  wPromo: false,
};

function tcgdexImage(
  seriesPath: string,
  setId: string,
  localId: string,
  quality: "high" | "low" = "high",
): CatalogImage {
  const baseUrl = `https://assets.tcgdex.net/en/${seriesPath}/${setId}/${localId}`;
  return {
    baseUrl,
    source: "tcgdex_assets",
    quality,
    extension: "webp",
    constructedUrl: `${baseUrl}/${quality}.webp`,
    provenance: `tcgdex assets.tcgdex.net; card id ${setId}-${localId}; lang en; database not affiliated with Nintendo or The Pokémon Company`,
  };
}

export const MOCK_CARDS: MockCatalogCard[] = [
  {
    tcgdexId: "base1-58",
    tcgdexSetId: "base1",
    localId: "58",
    name: "Pikachu",
    language: "en",
    category: "Pokemon",
    rarity: "Common",
    illustrator: "Mitsuhiro Arita",
    variants: {
      firstEdition: true,
      holo: false,
      normal: true,
      reverse: false,
      wPromo: false,
    },
    image: tcgdexImage("base", "base1", "58"),
  },
  {
    tcgdexId: "base1-4",
    tcgdexSetId: "base1",
    localId: "4",
    name: "Charizard",
    language: "en",
    category: "Pokemon",
    rarity: "Rare",
    variants: {
      firstEdition: true,
      holo: true,
      normal: false,
      reverse: false,
      wPromo: false,
    },
    image: tcgdexImage("base", "base1", "4", "low"),
  },
  {
    tcgdexId: "base4-4",
    tcgdexSetId: "base4",
    localId: "4",
    name: "Charizard",
    language: "en",
    category: "Pokemon",
    rarity: "Rare",
    variants: {
      firstEdition: false,
      holo: true,
      normal: false,
      reverse: false,
      wPromo: false,
    },
    image: tcgdexImage("base", "base4", "4", "low"),
  },
  {
    tcgdexId: "lc-3",
    tcgdexSetId: "lc",
    localId: "3",
    name: "Charizard",
    language: "en",
    category: "Pokemon",
    rarity: "Holo Rare",
    variants: {
      firstEdition: false,
      holo: true,
      normal: true,
      reverse: true,
      wPromo: false,
    },
    image: tcgdexImage("lc", "lc", "3", "low"),
  },
  {
    tcgdexId: "base1-25",
    tcgdexSetId: "base1",
    localId: "25",
    name: "Machamp",
    language: "en",
    category: "Pokemon",
    rarity: "Rare",
    variants: { ...defaultVariants, firstEdition: true },
    image: tcgdexImage("base", "base1", "25"),
  },
  {
    tcgdexId: "swsh3-136",
    tcgdexSetId: "swsh3",
    localId: "136",
    name: "Furret",
    language: "en",
    category: "Pokemon",
    rarity: "Uncommon",
    illustrator: "tetsuya koizumi",
    variants: {
      firstEdition: false,
      holo: false,
      normal: true,
      reverse: true,
      wPromo: false,
    },
    image: tcgdexImage("swsh", "swsh3", "136"),
  },
];

export function catalogFingerprint(language: string, tcgdexId: string): string {
  return `${language}:${tcgdexId}`;
}

export function findSetByName(setName: string | null | undefined): MockCatalogSet | null {
  if (!setName) return null;
  const needle = setName.trim().toLowerCase();
  return (
    MOCK_SETS.find(
      (set) =>
        set.name.toLowerCase() === needle ||
        set.aliases.some((alias) => alias.toLowerCase() === needle),
    ) ?? null
  );
}

export function findCardBySetAndLocalId(
  setId: string,
  localId: string,
): MockCatalogCard | null {
  return (
    MOCK_CARDS.find(
      (card) => card.tcgdexSetId === setId && card.localId === String(localId),
    ) ?? null
  );
}

export function findCardByTcgdexId(tcgdexId: string): MockCatalogCard | null {
  return MOCK_CARDS.find((card) => card.tcgdexId === tcgdexId) ?? null;
}

export function toCanonicalCard(
  card: MockCatalogCard,
  options: {
    cardflowCardId?: string | null;
    cardsightCardId?: string | null;
    selectedVariant?: string | null;
  } = {},
): CardFlowCanonicalCard {
  const set = MOCK_SETS.find((item) => item.id === card.tcgdexSetId);
  return {
    cardflowCardId: options.cardflowCardId ?? null,
    language: card.language,
    tcgdexId: card.tcgdexId,
    tcgdexSetId: card.tcgdexSetId,
    localId: card.localId,
    name: card.name,
    category: card.category,
    rarity: card.rarity,
    illustrator: card.illustrator ?? null,
    variants: card.variants,
    selectedVariant: options.selectedVariant ?? null,
    set: {
      id: card.tcgdexSetId,
      name: set?.name ?? card.tcgdexSetId,
      logo: set?.logo,
      cardCount: set?.cardCount,
    },
    image: card.image,
    cardsightCardId: options.cardsightCardId ?? null,
    catalogFingerprint: catalogFingerprint(card.language, card.tcgdexId),
  };
}
