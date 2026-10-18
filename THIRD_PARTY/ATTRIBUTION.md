# Third-party attribution

## Card-finder training data

| Dataset | Licence | Used for | Attribution |
|---|---|---|---|
| [antokun/pokemon-card-segmentation](https://huggingface.co/datasets/antokun/pokemon-card-segmentation) | CC0-1.0 | Card-finder real-photo fine-tune (author polygons) | Public domain (CC0). No attribution required; still listed for provenance. |
| [stevelohwc/pokemon_card_image_for_authenticity_classification](https://huggingface.co/datasets/stevelohwc/pokemon_card_image_for_authenticity_classification) | MIT | Card-finder real-photo fine-tune (pseudo-labels on authentic photos only) | © stevelohwc. MIT — retain license notice. |
| [pokemoncarddetect/pokemon-card-obb-egjdh](https://universe.roboflow.com/pokemoncarddetect/pokemon-card-obb-egjdh) | MIT | Card-finder real-photo fine-tune (OBB quads, down-weighted) | © PokemonCardDetect via Roboflow Universe. MIT — retain license notice. |
| [samuels-workspace-ayfij/pokemon-card-corners-jbrsi](https://universe.roboflow.com/samuels-workspace-ayfij/pokemon-card-corners-jbrsi) | **CC BY 4.0** | Card-finder real-photo fine-tune (seg quads, down-weighted) | **Credit:** “pokemon-card-corners dataset by Samuels Workspace, Roboflow Universe, licensed under CC BY 4.0” — https://universe.roboflow.com/samuels-workspace-ayfij/pokemon-card-corners-jbrsi |
| [pokemon-card-detection-a3etk/pokemon-scanner-rzy69](https://universe.roboflow.com/pokemon-card-detection-a3etk/pokemon-scanner-rzy69) | **CC BY 4.0** | Card-finder real-photo fine-tune (OBB quads, down-weighted) | **Credit:** “Pokemon Scanner dataset on Roboflow Universe, licensed under CC BY 4.0” — https://universe.roboflow.com/pokemon-card-detection-a3etk/pokemon-scanner-rzy69 |

Sean's own photos are CardFlow-owned and are the frozen **test set** only (never trained on).

## Card-finder model code / weights

Trained **from scratch** (random init) on synthetic composites + the datasets above. No ImageNet or other pretrained encoder weights.

| Component | Licence |
|---|---|
| segmentation_models_pytorch | MIT |
| timm MobileNetV3 architecture | Apache-2.0 |
| PyTorch | BSD-style |
| ONNX Runtime (inference) | MIT |

**Not used:** AGPL YOLO weights (the former `apps/api/models` YOLO11n-OBB path is replaced by this finder for grading corners).
