# TCGCSV recorded fixtures

Recorded slices of [tcgcsv.com](https://tcgcsv.com) Pokemon (`categoryId=3`) responses for Trending snapshot unit tests. **No live network in CI.**

These are truncated dumps (a few products/prices per group), not the full daily files. They keep the TCGCSV JSON shape (`success`, `results`) so the HTTP parser and mapper run against real field names (`extendedData.Number`, `subTypeName`, `marketPrice`).

| File | What |
|---|---|
| `last-updated.txt` | TCGCSV build timestamp |
| `groups.json` | English sets + one JP exclusive + Miscellaneous |
| `{groupId}-products.json` | Slimmed products (`productId`, `name`, `imageUrl`, Number/Rarity) |
| `{groupId}-prices.json` | Matching `marketPrice` + `subTypeName` rows |

Polite recapture: `User-Agent: PokeSniper/1.0 (trending-snapshot)`, ≥100ms between requests, only when last-updated.txt changed.
