# External datasets used by the card finder

External data is **train/val only**. Sean's own photos are the frozen **test set** and are never trained on.
Every card print visible in external data is listed below. Those prints are **excluded from the test-set card pool**
(see `train/denylist.txt` for the baseline cards excluded from training, and `train/real-exclude.txt` for
real photos dropped because they show a baseline card).

| Dataset | Licence | Source / revision | Used | Labels | Split |
|---|---|---|---|---|---|
| [antokun/pokemon-card-segmentation](https://huggingface.co/datasets/antokun/pokemon-card-segmentation) | **CC0-1.0** (HF tag) | HF dataset, downloaded 2026-10-13 (`343182_pokemon.tar`, 107 photos 3000×4000) | 106 photos (1 had an unusable polygon) | Author's 4-point YOLO-seg polygons (a 5-point polygon with a repeated point is collapsed to 4) | 88 train / 18 val, by SHA-1 of the file name (`real_data.split_of`) |
| [stevelohwc/pokemon_card_image_for_authenticity_classification](https://huggingface.co/datasets/stevelohwc/pokemon_card_image_for_authenticity_classification) | **MIT** (HF tag) | HF dataset, downloaded 2026-10-13 (290 photos 4032×3024, `labels.csv`) | 67 authentic photos (front + back) | **Pseudo-labels**: corners from card-finder v0.2.1 + edge snapping, kept only if confidence ≥ 0.5, no reject reason and rectified aspect within 3% of 63:88; then reviewed by eye on contact sheets. 26 authentic photos failed the filter and are unused. | 53 train / 14 val, same hash split |

- **Counterfeits** in the stevelohwc set (`labels` = 0, 195 photos) are **dropped**, not used as negatives: a fake card is still a card for the finder, so labelling it "not card" would teach the wrong thing.
- Pseudo-labels use the same edge snapping as the finder, so scores on that val split are optimistic (same caveat as the provisional baseline). The antokun val split has independent author labels and is the one to trust.
- Some antokun photos show more than one card (stacks, packs) with only one outlined; the unlabelled cards count as background in training.
- Build: `python3 train/real_data.py --ext <download dir> --out <manifest dir>`. Training mixes 40% real / 60% synthetic (`train.py --real ... --real-frac 0.4`).

### Roboflow Universe (added 2026-10-18)

| Dataset | Licence | Version | Quads kept (train/val) | Notes |
|---|---|---|---|---|
| [pokemoncarddetect/pokemon-card-obb-egjdh](https://universe.roboflow.com/pokemoncarddetect/pokemon-card-obb-egjdh) | **MIT** | v2 (no-aug export; Stretch-to 640) | 263 (205/58) | Best of the three; OBB → minAreaRect quads |
| [samuels-workspace-ayfij/pokemon-card-corners-jbrsi](https://universe.roboflow.com/samuels-workspace-ayfij/pokemon-card-corners-jbrsi) | **CC BY 4.0** | v1 (least images; still aug) | 89 (76/13) | COCO-seg → quads; credit required |
| [pokemon-card-detection-a3etk/pokemon-scanner-rzy69](https://universe.roboflow.com/pokemon-card-detection-a3etk/pokemon-scanner-rzy69) | **CC BY 4.0** | v2 (least with OBB; still aug) | 184 (152/32) | Multi-card → largest quad; credit required |

All three versions apply Roboflow **Stretch-to square**, so image-space aspect ≠ physical 63:88. Rows are tagged `square_stretched: true` and sampled at weight 0.25 in `train/real.py`. Do not score corner error on Roboflow val — keep antokun author labels as the comparable split.

- Roboflow Universe (exported 2026-10-18; commercial licences only): see table below. Primary JSONL manifests use stretch-aware geometry (Roboflow Stretch-to-square); `sample_weight` 0.25 so they do not dominate antokun/steve. Corner-precision reporting stays on the **antokun val** split only.

## Prints visible in external data (exclude from the test-set pool)
Read from the rectified name bars of every front (132 fronts). Most antokun cards are Indonesian prints; names are as printed.

**Pokémon:** Kecleon, Mew ex, Combusken (×2), Glaceon ex, Torchic, Gouging Fire ex, Wingull, Pelipper (×2), Eevee, Gible (×2), Gabite, Oddish, Blaziken ex, Chien-Pao ex, Kyogre ex, Garchomp ex (×2), Kleavor V, Duskull, Hisuian Voltorb, Koraidon ex, Kyurem Hitam ex (Black Kyurem ex), Linoone, Aegislash, Munkidori ex, Brute Bonnet, Iron Valiant ex, Noibat (×2), Weezing, Swinub, Shaymin, Steven's Beldum (×2), Applin (×4), Sprigatito (×3), Ogerpon Topeng Sumur ex (Wellspring Mask Ogerpon ex), Dudunsparce ex, Iron Boulder, Palafin ex, Hawlucha, Pawmot, Froslass, Annihilape, Slither Wing, Floragato, Ponyta, Kilowattrel Mistika (Tera), Seedot, Ralts, Stufful (×2), Heliolisk, Shiftry (×2), Magnezone, Dialga (×2), Bulbasaur, **Sizzlipede** (baseline card, photo excluded), Kadabra, Ninjask, Clawitzer, Alakazam, Tyrogue, Snover, Buneary, Numel, Meganium.

**Trainers / energy (Indonesian names as printed):** Penelitian Profesor (Professor's Research) ×2, Bocah Bercelana Pendek (Youngster) ×2, Bola Great (Great Ball) ×2, Tukar Pokémon (Switch) ×2, Gemblengan Ahli Karate (Black Belt's Training) ×4, MJ Evolution, Nemola (Nemona) ×3, Transfer Energi, Bola Ultra (Ultra Ball), Kemurnian Hati Bianca (Bianca's Devotion), Bola Pokémon (Poké Ball), Arvin, Tekad Misty (Misty's Determination), Eksplorasi Green (Green's Exploration), Gua Besar Zero (Area Zero Underdepths), Terompet Kaca (Glass Trumpet), Techno Radar, Topeng Oni (Ogre's Mask?), Moci Rantai (Chain Mochi?), Pelindung Dada Bebatuan, Pemacu Energi Futur (Future Booster Energy Capsule), Emergency Board, Ikat Kepala Semangat, Pelayanan Lana (Lana's Aid), Kota Mukun, Tas Hop (Hop's Bag), Tandu Malam (Night Stretcher), Mutiara Lillie (Lillie's Pearl), Energy Switch, Wally's Compassion ×2, Acerola's Mischief; Basic energies (Fighting, Fire, Water, Lightning).

Three fronts were sideways/too blurred to read; card backs carry no print identity.
