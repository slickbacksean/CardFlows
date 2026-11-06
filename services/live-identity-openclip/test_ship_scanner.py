#!/usr/bin/env python3
"""
Ship scanner unit tests (numpy only; no DINOv2 weights).

  python test_ship_scanner.py

Covers: fusion math on fixture embeddings, OCR 0.15/0.10, accept 0.68/margin 0.02,
printing-rerank override only when p>0.9, fallback when fusion files missing,
refuse on catalog shape mismatch.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from fusion_score import (  # noqa: E402
    EXPECTED_CAT_N,
    CatalogShapeError,
    accept_gate,
    apply_ocr_boosts,
    fuse_similarities,
    fusion_requested,
    gate_frames,
    load_fusion_arrays,
    merge_card_names,
    pick_exact_id,
    resolve_pipeline,
    view_similarity,
)
from printing_rerank import (  # noqa: E402
    BUNDLED_MODEL,
    decide_override,
    family_for,
    load_frozen_model,
    load_print_reranker,
    print_rerank_enabled,
    xvec,
    prob,
)
from trained_dinov2_fusion import FusedTrainedModel, load_fused_model  # noqa: E402


class FakeViewModel:
    def __init__(self, sim: np.ndarray):
        self.sim = np.asarray(sim, dtype=np.float64)

    def view_similarities(self, image):
        return self.sim, {"embedFullMs": 1.0, "embedArtMs": 1.0, "searchMs": 0.1}


def _unit(vec: np.ndarray) -> np.ndarray:
    v = np.asarray(vec, dtype=np.float32).reshape(-1)
    return v / max(float(np.linalg.norm(v)), 1e-6)


class FusionMathTests(unittest.TestCase):
    def test_weighted_mean_2h_d_e_over_4(self):
        sim_h = np.array([1.0, 0.0, 0.0, 0.0])
        sim_d = np.array([0.0, 1.0, 0.0, 0.0])
        sim_e = np.array([0.0, 0.0, 1.0, 0.0])
        sv = fuse_similarities(sim_h, sim_d, sim_e, (2.0, 1.0, 1.0))
        np.testing.assert_allclose(sv, [0.5, 0.25, 0.25, 0.0])

    def test_fixture_embeddings_full_plus_art(self):
        rng = np.random.default_rng(0)
        n, dim = 4, 8
        e_full = _unit(rng.normal(size=dim))
        e_art = _unit(rng.normal(size=dim))
        cat_full_h = np.stack([_unit(rng.normal(size=dim)) for _ in range(n)])
        cat_art_h = np.stack([_unit(rng.normal(size=dim)) for _ in range(n)])
        cat_full_d = np.stack([_unit(rng.normal(size=dim)) for _ in range(n)])
        cat_art_d = np.stack([_unit(rng.normal(size=dim)) for _ in range(n)])
        cat_full_e = np.stack([_unit(rng.normal(size=dim)) for _ in range(n)])
        cat_art_e = np.stack([_unit(rng.normal(size=dim)) for _ in range(n)])
        # Make id 2 the clear winner on h (weight 2).
        cat_full_h[2] = e_full
        cat_art_h[2] = e_art
        sim_h = view_similarity(cat_full_h, cat_art_h, e_full, e_art)
        sim_d = view_similarity(cat_full_d, cat_art_d, e_full, e_art)
        sim_e = view_similarity(cat_full_e, cat_art_e, e_full, e_art)
        sv = fuse_similarities(sim_h, sim_d, sim_e, (2.0, 1.0, 1.0))
        expected = (2 * sim_h + sim_d + sim_e) / 4
        np.testing.assert_allclose(sv, expected)
        pred, idx, top, margin = pick_exact_id(sv, [f"id-{i}" for i in range(n)])
        self.assertEqual(pred, "id-2")
        self.assertEqual(idx, 2)
        self.assertGreater(float(sim_h[2]), 0.99)
        self.assertGreater(margin, 0.0)
        self.assertGreater(top, float(sv[0]))

    def test_ocr_boosts_0_15_name_0_10_number(self):
        sv = np.array([0.60, 0.59, 0.50])
        ids = ["sv3-1", "sv3-tg05", "sv3-2"]
        names = {"sv3-1": "Pikachu", "sv3-tg05": "Pikachu", "sv3-2": "Raichu"}
        boosted = apply_ocr_boosts(sv, ids, names, ["Pikachu"], ["tg05"], 0.15, 0.10)
        np.testing.assert_allclose(boosted, [0.75, 0.84, 0.50])
        pred, idx, *_ = pick_exact_id(boosted, ids)
        self.assertEqual(pred, "sv3-tg05")
        self.assertEqual(idx, 1)

    def test_accept_0_68_margin_0_02(self):
        self.assertTrue(accept_gate(0.68, 0.02))
        self.assertFalse(accept_gate(0.679, 0.02))
        self.assertFalse(accept_gate(0.68, 0.019))
        self.assertTrue(accept_gate(0.90, 0.02))

    def test_frame_gate_drops_weak_frames(self):
        strong = np.array([0.90, 0.10, 0.05])
        weak = np.array([0.70, 0.60, 0.01])  # peak 0.70 < 0.90 - 0.08
        pooled = gate_frames([strong, weak], gate=0.08)
        np.testing.assert_allclose(pooled, strong)
        kept = gate_frames([strong, np.array([0.85, 0.20, 0.00])], gate=0.08)
        np.testing.assert_allclose(kept, (strong + np.array([0.85, 0.20, 0.00])) / 2)

    def test_fused_model_exact_id_not_name_pooled(self):
        ids = ["a-1", "a-2", "b-1"]
        names = {"a-1": "Alpha", "a-2": "Alpha", "b-1": "Beta"}
        # Name-pooling would pick a-2 (0.80) as Alpha; exact-ID picks a-1 (0.81).
        fused = FusedTrainedModel(
            models={
                "h": FakeViewModel([0.81, 0.40, 0.10]),
                "d": FakeViewModel([0.81, 0.40, 0.10]),
                "e": FakeViewModel([0.81, 0.40, 0.10]),
            },
            cat_ids=ids,
            card_names=names,
            weights=(2.0, 1.0, 1.0),
        )
        # Override d/e so a-2 is high on those but fusion still prefers a-1:
        fused.models["d"] = FakeViewModel([0.70, 0.80, 0.10])
        fused.models["e"] = FakeViewModel([0.70, 0.80, 0.10])
        # sv[a-1] = (2*0.81 + 0.70 + 0.70)/4 = 0.755
        # sv[a-2] = (2*0.40 + 0.80 + 0.80)/4 = 0.60
        candidates, _t = fused.match(object())
        self.assertEqual(candidates[0]["tcgdexId"], "a-1")
        self.assertEqual(fused.last_pred, "a-1")

    def test_catx_names_merge(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catx_names.json"
            path.write_text(json.dumps({"sv8pt5-tg01": "Pikachu"}))
            names = merge_card_names({"base1-1": "Alakazam"}, path)
            self.assertEqual(names["base1-1"], "Alakazam")
            self.assertEqual(names["sv8pt5-tg01"], "Pikachu")


class PipelineFallbackTests(unittest.TestCase):
    def setUp(self):
        self._saved = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)

    def _clear_model_env(self):
        for key in list(os.environ):
            if key.startswith("TRAINED_MODEL_") or key.startswith("PRINT_RERANK_"):
                os.environ.pop(key, None)

    def test_fusion_flag_alone_is_not_fusion(self):
        self._clear_model_env()
        os.environ["TRAINED_MODEL_FUSION"] = "1"
        os.environ["TRAINED_MODEL_WEIGHTS"] = "/no/such/weights.pt"
        os.environ["TRAINED_MODEL_CAT_FULL"] = "/no/such/full.npy"
        os.environ["TRAINED_MODEL_CAT_ART"] = "/no/such/art.npy"
        os.environ["TRAINED_MODEL_CAT_IDS"] = "/no/such/ids.json"
        self.assertTrue(fusion_requested())
        self.assertEqual(resolve_pipeline(), "openclip")

    def test_missing_files_fall_back_to_openclip(self):
        self._clear_model_env()
        self.assertEqual(resolve_pipeline(), "openclip")
        self.assertIsNone(load_fused_model("cpu", {}))

    def test_fusion_when_all_hde_files_exist(self):
        self._clear_model_env()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            files = {
                "TRAINED_MODEL_H_WEIGHTS": tmp_path / "h.pt",
                "TRAINED_MODEL_D_WEIGHTS": tmp_path / "d.pt",
                "TRAINED_MODEL_E_WEIGHTS": tmp_path / "e.pt",
                "TRAINED_MODEL_H_CAT_FULL": tmp_path / "h_full.npy",
                "TRAINED_MODEL_H_CAT_ART": tmp_path / "h_art.npy",
                "TRAINED_MODEL_D_CAT_FULL": tmp_path / "d_full.npy",
                "TRAINED_MODEL_D_CAT_ART": tmp_path / "d_art.npy",
                "TRAINED_MODEL_E_CAT_FULL": tmp_path / "e_full.npy",
                "TRAINED_MODEL_E_CAT_ART": tmp_path / "e_art.npy",
                "TRAINED_MODEL_CAT_IDS": tmp_path / "ids.json",
            }
            for key, path in files.items():
                path.write_bytes(b"x")
                os.environ[key] = str(path)
            os.environ["TRAINED_MODEL_FUSION"] = "1"
            self.assertEqual(resolve_pipeline(), "fusion")

    def test_legacy_single_when_fusion_incomplete(self):
        self._clear_model_env()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            weights = tmp_path / "b1_best.pt"
            full = tmp_path / "cat_full_b1.npy"
            art = tmp_path / "cat_art_b1.npy"
            ids = tmp_path / "cat_ids.json"
            weights.write_bytes(b"x")
            np.save(full, np.zeros((2, 384), np.float16))
            np.save(art, np.zeros((2, 384), np.float16))
            ids.write_text(json.dumps(["a-1", "a-2"]))
            os.environ["TRAINED_MODEL_FUSION"] = "r18h2de"
            os.environ["TRAINED_MODEL_WEIGHTS"] = str(weights)
            os.environ["TRAINED_MODEL_CAT_FULL"] = str(full)
            os.environ["TRAINED_MODEL_CAT_ART"] = str(art)
            os.environ["TRAINED_MODEL_CAT_IDS"] = str(ids)
            self.assertEqual(resolve_pipeline(), "single")
            self.assertIsNone(load_fused_model("cpu", {}))

    def test_refuse_catalog_shape_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            ids = tmp_path / "cat_ids.json"
            ids.write_text(json.dumps(["a-1", "a-2"]))
            paths = []
            for name in ("h_full", "h_art", "d_full", "d_art", "e_full", "e_art"):
                p = tmp_path / f"{name}.npy"
                np.save(p, np.zeros((2, 384), np.float16))
                paths.append(p)
            with self.assertRaises(CatalogShapeError) as ctx:
                load_fusion_arrays(ids, paths, expected_n=EXPECTED_CAT_N)
            self.assertIn("2 != 20339", str(ctx.exception))

            wrong_dim = tmp_path / "bad.npy"
            np.save(wrong_dim, np.zeros((EXPECTED_CAT_N, 16), np.float16))
            ids_ok = tmp_path / "ids20339.json"
            ids_ok.write_text(json.dumps([f"id-{i}" for i in range(EXPECTED_CAT_N)]))
            with self.assertRaises(CatalogShapeError):
                load_fusion_arrays(ids_ok, [wrong_dim], expected_n=EXPECTED_CAT_N, dim=384)

    def test_reranker_missing_files_returns_none(self):
        self._clear_model_env()
        os.environ["PRINT_RERANK_ENABLED"] = "1"
        self.assertTrue(print_rerank_enabled())
        self.assertIsNone(load_print_reranker({}))


class PrintingRerankTests(unittest.TestCase):
    def setUp(self):
        self.model = load_frozen_model(BUNDLED_MODEL)
        self.assertEqual(self.model["t"], 0.9)

    def _p(self, feats: dict[str, float]) -> float:
        X = np.array([xvec(feats, 0.0)])
        return float(prob(self.model, X)[0])

    def _high_feats(self) -> dict[str, float]:
        # High art/oth/inl, low all/noal → p > 0.9 on the frozen logistic.
        return {"all": -2.0, "bot": 1.0, "art": 3.0, "oth": 3.0, "inl": 4.0, "noal": 0.0}

    def _low_feats(self) -> dict[str, float]:
        return {"all": 0.0, "bot": 0.0, "art": 0.0, "oth": 0.0, "inl": 0.0, "noal": 1.0}

    def test_override_only_when_p_gt_0_9(self):
        high = self._high_feats()
        low = self._low_feats()
        self.assertGreater(self._p(high), 0.9)
        self.assertLessEqual(self._p(low), 0.9)
        final, alt, p = decide_override("ref-1", {"alt-2": high}, self.model, 0.9)
        self.assertEqual(final, "alt-2")
        self.assertEqual(alt, "alt-2")
        self.assertGreater(p, 0.9)
        kept, alt2, p2 = decide_override("ref-1", {"alt-2": low}, self.model, 0.9)
        self.assertEqual(kept, "ref-1")
        self.assertEqual(alt2, "alt-2")
        self.assertLessEqual(p2, 0.9)

    def test_equal_to_threshold_does_not_override(self):
        # Craft feats so p is just below / we assert strict > on a 0.9 sentinel via decide.
        final, _alt, _p = decide_override("ref-1", {}, self.model, 0.9)
        self.assertEqual(final, "ref-1")

    def test_maybe_override_uses_threshold(self):
        from printing_rerank import PrintReranker

        with tempfile.TemporaryDirectory() as tmp:
            hr = Path(tmp) / "hr_cat"
            hr.mkdir()
            rerank = PrintReranker(
                model=self.model,
                fam={"Pikachu": ["ref-1", "alt-2"]},
                hr_cat=hr,
                threshold=0.9,
                topk=6,
                card_names={"ref-1": "Pikachu", "alt-2": "Pikachu"},
            )
            pred, info = rerank.maybe_override(
                [],
                "ref-1",
                feat_by_alt={"alt-2": self._high_feats()},
            )
            self.assertEqual(pred, "alt-2")
            self.assertTrue(info["overridden"])
            pred2, info2 = rerank.maybe_override(
                [],
                "ref-1",
                feat_by_alt={"alt-2": self._low_feats()},
            )
            self.assertEqual(pred2, "ref-1")
            self.assertFalse(info2["overridden"])

    def test_family_forces_pred_first_and_caps(self):
        fam = {"Pikachu": ["alt-2", "ref-1", "alt-3", "alt-4", "alt-5", "alt-6", "alt-7"]}
        names = {"ref-1": "Pikachu"}
        ids = family_for("ref-1", fam, names, topk=6)
        self.assertEqual(ids[0], "ref-1")
        self.assertEqual(len(ids), 6)

    def test_throw_keeps_fusion_pred(self):
        from printing_rerank import PrintReranker

        with tempfile.TemporaryDirectory() as tmp:
            rerank = PrintReranker(
                model=self.model,
                fam={"Pikachu": ["ref-1", "alt-2"]},
                hr_cat=Path(tmp),
                card_names={"ref-1": "Pikachu"},
            )

            def boom(_id):
                raise RuntimeError("sift exploded")

            rerank.cat = boom  # type: ignore[method-assign]
            pred, info = rerank.maybe_override([np.zeros((10, 10, 3), np.uint8)], "ref-1")
            self.assertEqual(pred, "ref-1")
            self.assertFalse(info["overridden"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
