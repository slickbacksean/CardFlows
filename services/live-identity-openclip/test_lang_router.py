#!/usr/bin/env python3
"""Unit tests for the card-language router. Stdlib only.

  python test_lang_router.py
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from lang_router import (  # noqa: E402
    ALL_REASONS,
    HANZI_JA_MARGIN,
    LATIN_BEST_OVER_EN,
    LATIN_BEST_OVER_OTHER,
    LATIN_EN_FLOOR,
    REASON_CONTAINS_KANA,
    REASON_DEFAULT_LATIN,
    REASON_HANZI_JA_WINS,
    REASON_HANZI_KEEP_ZH,
    REASON_HANZI_WITHOUT_KANA,
    REASON_LATIN_BEST_NOT_AHEAD,
    REASON_LATIN_BEST_SEPARATED,
    REASON_LATIN_EN_GE_FLOOR,
    REASON_LATIN_JA_ZH_NEAR_TIE,
    SIMPLIFIED_CHARS,
    TRADITIONAL_CHARS,
    CatalogRegistry,
    LangRouterConfig,
    apply_language_route,
    baseline_route,
    lang_router_v2_enabled,
    load_config,
    registry_from_env,
    route_card_language,
    zh_id_prefix,
    zh_script_preference,
)


def _payload(tcgdex_id: str, similarity: float) -> dict:
    return {
        "ok": True,
        "pipeline": "trained_dinov2_fusion",
        "accepted": True,
        "reason": "accepted",
        "orb": "not_applicable",
        "tcgdexId": tcgdex_id,
        "similarity": similarity,
        "margin": 0.04,
        "warped": False,
        "candidates": [{"tcgdexId": tcgdex_id, "name": "", "similarity": similarity}],
    }


class FlagTests(unittest.TestCase):
    def test_default_and_zero_are_off(self):
        self.assertFalse(lang_router_v2_enabled({}))
        for raw in ("0", "false", "no", "off", "", "  ", "2", "r18h2de"):
            self.assertFalse(lang_router_v2_enabled({"LANG_ROUTER_V2": raw}), raw)

    def test_on_values(self):
        for raw in ("1", "true", "TRUE", "yes", "on", " On "):
            self.assertTrue(lang_router_v2_enabled({"LANG_ROUTER_V2": raw}), raw)


class BaselineTests(unittest.TestCase):
    def test_contains_kana_hiragana_katakana_and_halfwidth(self):
        for text in ("ぴかちゅう", "ピカチュウ", "ﾋﾟｶﾁｭｳ", "雷ピカチュウ", "ピカ丘"):
            self.assertEqual(baseline_route(text), ("ja", REASON_CONTAINS_KANA), text)

    def test_hanzi_without_kana(self):
        for text in ("皮卡丘", "噴火龍", "皮卡丘 Pikachu", "皮卡丘・噴火龍"):
            self.assertEqual(baseline_route(text), ("zh", REASON_HANZI_WITHOUT_KANA), text)

    def test_default_latin_or_other(self):
        for text in ("Pikachu", "Pikachu 25", "", None, "123", "・"):
            self.assertEqual(baseline_route(text), ("en", REASON_DEFAULT_LATIN), repr(text))


class RetunedBranchTests(unittest.TestCase):
    def _route(self, text, scores=None, config=None):
        with self.assertLogs("cardflow.lang_router", level="INFO") as captured:
            result = route_card_language(text, scores, enabled=True, config=config)
        self.assertTrue(any(result[1] in line for line in captured.output))
        self.assertTrue(any(f"lang={result[0]}" in line for line in captured.output))
        return result

    def test_contains_kana_stays_baseline_even_when_zh_score_wins(self):
        scores = {"en": 0.0, "ja": 0.0, "zh": 0.99}
        self.assertEqual(self._route("ピカチュウ", scores), ("ja", REASON_CONTAINS_KANA))

    def test_hanzi_ja_wins_by_T_at_threshold(self):
        # 0.50 - 0.48 == 0.02 within float error, and the compare is >= T.
        scores = {"en": 0.10, "ja": 0.50, "zh": 0.48}
        self.assertGreaterEqual(0.50 - 0.48, HANZI_JA_MARGIN)
        self.assertEqual(self._route("皮卡丘", scores), ("ja", REASON_HANZI_JA_WINS))

    def test_hanzi_keep_zh_just_below_T(self):
        scores = {"en": 0.10, "ja": 0.519, "zh": 0.50}
        self.assertLess(0.519 - 0.50, HANZI_JA_MARGIN)
        self.assertEqual(self._route("噴火龍", scores), ("zh", REASON_HANZI_KEEP_ZH))

    def test_hanzi_keep_zh_when_zh_leads_or_ties(self):
        self.assertEqual(
            self._route("電", {"ja": 0.20, "zh": 0.80}),
            ("zh", REASON_HANZI_KEEP_ZH),
        )
        self.assertEqual(
            self._route("電", {"ja": 0.40, "zh": 0.40}),
            ("zh", REASON_HANZI_KEEP_ZH),
        )

    def test_hanzi_missing_scores_stay_baseline(self):
        self.assertEqual(self._route("皮卡丘", {"ja": 0.9}), ("zh", REASON_HANZI_WITHOUT_KANA))
        self.assertEqual(self._route("皮卡丘", None), ("zh", REASON_HANZI_WITHOUT_KANA))
        self.assertEqual(
            self._route("皮卡丘", {"ja": float("nan"), "zh": 0.1}),
            ("zh", REASON_HANZI_WITHOUT_KANA),
        )

    def test_latin_en_ge_floor(self):
        scores = {"en": LATIN_EN_FLOOR, "ja": 0.99, "zh": 0.99}
        self.assertEqual(self._route("Pikachu", scores), ("en", REASON_LATIN_EN_GE_FLOOR))

    def test_latin_best_not_ahead_of_en(self):
        # best - en = 0.06 < 0.08, so EN even though JA leads ZH.
        scores = {"en": 0.30, "ja": 0.36, "zh": 0.10}
        self.assertLess(0.36 - 0.30, LATIN_BEST_OVER_EN)
        self.assertEqual(self._route("Charizard", scores), ("en", REASON_LATIN_BEST_NOT_AHEAD))

    def test_latin_best_separated_ja_and_zh(self):
        ja_scores = {"en": 0.10, "ja": 0.90, "zh": 0.10}
        self.assertGreaterEqual(0.90 - 0.10, LATIN_BEST_OVER_OTHER)
        self.assertEqual(self._route("Pikachu", ja_scores), ("ja", REASON_LATIN_BEST_SEPARATED))
        zh_scores = {"en": 0.10, "ja": 0.10, "zh": 0.90}
        self.assertEqual(self._route("Pikachu", zh_scores), ("zh", REASON_LATIN_BEST_SEPARATED))

    def test_latin_best_separated_exact_margins(self):
        # 0.40 - 0.30 is not < 0.08, and 0.40 - 0.35 clears 0.05, so JA wins.
        # (0.38 - 0.33 is 0.04999... and must not be used as a stand-in for 0.05.)
        scores = {"en": 0.30, "ja": 0.40, "zh": 0.35}
        self.assertFalse((0.40 - 0.30) < LATIN_BEST_OVER_EN)
        self.assertGreaterEqual(0.40 - 0.35, LATIN_BEST_OVER_OTHER)
        self.assertEqual(self._route("Abra", scores), ("ja", REASON_LATIN_BEST_SEPARATED))

    def test_latin_ja_zh_near_tie_stay_en(self):
        scores = {"en": 0.20, "ja": 0.40, "zh": 0.37}
        self.assertGreaterEqual(0.40 - 0.20, LATIN_BEST_OVER_EN)
        self.assertLess(0.40 - 0.37, LATIN_BEST_OVER_OTHER)
        self.assertEqual(self._route("Mew", scores), ("en", REASON_LATIN_JA_ZH_NEAR_TIE))

    def test_latin_tie_between_ja_and_zh_prefers_ja_then_near_tie_stays_en(self):
        # best = ja on a tie, other = zh, separation 0 -> near-tie stays EN.
        scores = {"en": 0.20, "ja": 0.50, "zh": 0.50}
        self.assertEqual(self._route("Mew", scores), ("en", REASON_LATIN_JA_ZH_NEAR_TIE))

    def test_latin_missing_score_stays_baseline(self):
        self.assertEqual(
            self._route("Pikachu", {"en": 0.01, "ja": 0.99}),
            ("en", REASON_DEFAULT_LATIN),
        )

    def test_every_reason_string_is_produced(self):
        samples = {
            REASON_CONTAINS_KANA: self._route("ピカ", {"en": 0.1, "ja": 0.1, "zh": 0.9}),
            REASON_HANZI_WITHOUT_KANA: self._route("皮", None),
            REASON_DEFAULT_LATIN: self._route("Pika", None),
            REASON_HANZI_JA_WINS: self._route("皮", {"ja": 0.50, "zh": 0.48}),
            REASON_HANZI_KEEP_ZH: self._route("皮", {"ja": 0.10, "zh": 0.80}),
            REASON_LATIN_EN_GE_FLOOR: self._route("Pika", {"en": 0.35, "ja": 0.99, "zh": 0.99}),
            REASON_LATIN_BEST_NOT_AHEAD: self._route("Pika", {"en": 0.30, "ja": 0.36, "zh": 0.10}),
            REASON_LATIN_BEST_SEPARATED: self._route("Pika", {"en": 0.10, "ja": 0.90, "zh": 0.10}),
            REASON_LATIN_JA_ZH_NEAR_TIE: self._route("Pika", {"en": 0.20, "ja": 0.40, "zh": 0.37}),
        }
        self.assertEqual(set(samples), set(ALL_REASONS))
        for reason, (lang, got) in samples.items():
            self.assertEqual(got, reason)
            self.assertIn(lang, {"en", "ja", "zh"})


class FlagOffTests(unittest.TestCase):
    def test_flag_off_routing_equals_baseline(self):
        """Scores that would flip the retuned rule must not change flag-off routing."""
        cases = [
            ("ピカチュウ", {"en": 0.0, "ja": 0.0, "zh": 1.0}),
            ("ぴかちゅう", {"en": 0.9, "ja": 0.0, "zh": 0.9}),
            ("ﾋﾟｶﾁｭｳ", {"en": 0.1, "ja": 0.1, "zh": 0.1}),
            ("皮卡丘", {"en": 0.10, "ja": 0.90, "zh": 0.10}),
            ("噴火龍", {"en": 0.10, "ja": 0.10, "zh": 0.90}),
            ("皮卡丘・噴火龍", {"ja": 0.80, "zh": 0.10}),
            ("Pikachu", {"en": 0.10, "ja": 0.90, "zh": 0.10}),
            ("Pikachu", {"en": 0.90, "ja": 0.10, "zh": 0.10}),
            ("Pikachu", {"en": 0.20, "ja": 0.40, "zh": 0.37}),
            ("", {"en": 0.0, "ja": 1.0, "zh": 0.0}),
            (None, {"en": 0.0, "ja": 1.0, "zh": 1.0}),
        ]
        for text, scores in cases:
            with self.subTest(text=text):
                self.assertEqual(
                    route_card_language(text, scores, enabled=False),
                    baseline_route(text),
                )
                self.assertEqual(
                    route_card_language(text, scores, enabled=None, env={}),
                    baseline_route(text),
                )

    def test_flag_off_apply_returns_same_payload_without_logging(self):
        payload = _payload("base1-58", 0.11)
        ja = _payload("ja-1", 0.91)
        with tempfile.TemporaryDirectory() as tmp:
            ja_path = Path(tmp) / "ja.json"
            ja_path.write_text("[]")
            registry = registry_from_env({"LANG_CATALOG_JA": str(ja_path)})
            self.assertFalse(registry.is_en_only())
            with self.assertNoLogs("cardflow.lang_router", level="INFO"):
                out = apply_language_route(
                    payload,
                    "Pikachu",
                    scores={"en": 0.11, "ja": 0.91, "zh": 0.05},
                    answers={"ja": ja},
                    registry=registry,
                    enabled=False,
                )
            self.assertIs(out, payload)
            self.assertNotIn("lang", payload)
            self.assertEqual(payload["tcgdexId"], "base1-58")


class ConfigTests(unittest.TestCase):
    def test_defaults_match_constants(self):
        config = load_config({})
        self.assertEqual(config.hanzi_ja_margin, HANZI_JA_MARGIN)
        self.assertEqual(config.latin_en_floor, LATIN_EN_FLOOR)
        self.assertEqual(config.latin_best_over_en, LATIN_BEST_OVER_EN)
        self.assertEqual(config.latin_best_over_other, LATIN_BEST_OVER_OTHER)

    def test_invalid_env_keeps_default(self):
        config = load_config({"LANG_ROUTER_HANZI_JA_MARGIN": "nope", "LANG_ROUTER_LATIN_EN_FLOOR": "nan"})
        self.assertEqual(config.hanzi_ja_margin, HANZI_JA_MARGIN)
        self.assertEqual(config.latin_en_floor, LATIN_EN_FLOOR)

    def test_override_changes_hanzi_decision(self):
        loose = LangRouterConfig(hanzi_ja_margin=0.5)
        scores = {"ja": 0.50, "zh": 0.48}
        self.assertEqual(
            route_card_language("皮卡丘", scores, enabled=True, config=loose),
            ("zh", REASON_HANZI_KEEP_ZH),
        )
        self.assertEqual(
            route_card_language("皮卡丘", scores, enabled=True, config=LangRouterConfig()),
            ("ja", REASON_HANZI_JA_WINS),
        )


class ScriptPreferenceTests(unittest.TestCase):
    def test_traditional_simplified_tie_and_none(self):
        self.assertEqual(zh_script_preference("寶可夢"), "zh-tw")
        self.assertEqual(zh_script_preference("宝可梦"), "zh-Hans")
        self.assertEqual(zh_script_preference("電"), "zh-tw")
        self.assertEqual(zh_script_preference("电"), "zh-Hans")
        self.assertIsNone(zh_script_preference("電电"))
        self.assertIsNone(zh_script_preference("寶梦"))
        self.assertIsNone(zh_script_preference("皮卡丘"))
        self.assertIsNone(zh_script_preference("Pikachu"))
        self.assertIsNone(zh_script_preference(""))
        self.assertIsNone(zh_script_preference(None))
        self.assertEqual(zh_script_preference("寶夢电"), "zh-tw")

    def test_pairs_are_disjoint_single_chars(self):
        self.assertTrue(TRADITIONAL_CHARS.isdisjoint(SIMPLIFIED_CHARS))
        self.assertIn("寶", TRADITIONAL_CHARS)
        self.assertIn("宝", SIMPLIFIED_CHARS)
        self.assertNotIn("皮", TRADITIONAL_CHARS | SIMPLIFIED_CHARS)
        self.assertGreater(len(TRADITIONAL_CHARS), 20)

    def test_id_prefixes(self):
        self.assertEqual(zh_id_prefix("zh-Hans"), "zh-Hans_")
        self.assertEqual(zh_id_prefix("zh-tw"), "zh-tw_")
        self.assertIsNone(zh_id_prefix(None))
        self.assertIsNone(zh_id_prefix("zh"))


class CatalogRegistryTests(unittest.TestCase):
    def test_en_only_is_noop(self):
        registry = registry_from_env({})
        self.assertTrue(registry.is_en_only())
        self.assertEqual(registry.configured_langs(), ("en",))
        en = {"tcgdexId": "base1-58"}
        ja = {"tcgdexId": "ja-1"}
        self.assertIs(registry.choose("ja", {"en": en, "ja": ja}, "ピカチュウ"), en)
        self.assertIs(registry.choose("zh", {"en": en, "zh": {"tcgdexId": "zh-1"}}, "皮卡丘"), en)
        missing = Path("/no/such/lang-catalog-ja.json")
        self.assertTrue(registry_from_env({"LANG_CATALOG_JA": str(missing)}).is_en_only())

    def test_configured_ja_selects_ja_answer_without_reading_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            ja_path = Path(tmp) / "ja.json"
            secret = "catalog-bytes-must-not-leak"
            ja_path.write_text(secret)
            registry = registry_from_env({"LANG_CATALOG_JA": str(ja_path)})
            self.assertEqual(registry.configured_langs(), ("en", "ja"))
            en = {"tcgdexId": "en-1"}
            ja = {"tcgdexId": "ja-1"}
            self.assertIs(registry.choose("ja", {"en": en, "ja": ja}), ja)
            self.assertIs(registry.choose("en", {"en": en, "ja": ja}), en)
            self.assertIs(registry.choose("ja", {"en": en}), en)
            self.assertNotIn(secret, str(registry.choose("ja", {"en": en, "ja": ja})))

    def test_zh_script_catalogs(self):
        with tempfile.TemporaryDirectory() as tmp:
            hans = Path(tmp) / "hans.json"
            tw = Path(tmp) / "tw.json"
            hans.write_text("[]")
            tw.write_text("[]")
            registry = registry_from_env(
                {"LANG_CATALOG_ZH_HANS": str(hans), "LANG_CATALOG_ZH_TW": str(tw)}
            )
            self.assertEqual(registry.configured_langs(), ("en", "zh"))
            en = {"id": "en"}
            hans_ans = {"id": "hans"}
            tw_ans = {"id": "tw"}
            answers = {"en": en, "zh-Hans": hans_ans, "zh-tw": tw_ans}
            self.assertIs(registry.choose("zh", answers, "宝可梦"), hans_ans)
            self.assertIs(registry.choose("zh", answers, "寶可夢"), tw_ans)
            # No script preference and no generic ZH catalog: stay on EN.
            self.assertIs(registry.choose("zh", answers, "皮卡丘"), en)
            only_tw = CatalogRegistry(zh_tw_path=str(tw))
            self.assertIs(only_tw.choose("zh", answers, "宝可梦"), en)

    def test_apply_en_only_keeps_payload_when_flag_on(self):
        payload = _payload("base1-58", 0.11)
        ja = _payload("ja-1", 0.91)
        out = apply_language_route(
            payload,
            "Pikachu",
            scores={"en": 0.11, "ja": 0.91, "zh": 0.05},
            answers={"ja": ja},
            registry=registry_from_env({}),
            enabled=True,
        )
        self.assertIs(out, payload)

    def test_apply_flag_on_uses_ja_catalog_answer(self):
        payload = _payload("base1-58", 0.11)
        ja = _payload("ja-1", 0.91)
        with tempfile.TemporaryDirectory() as tmp:
            ja_path = Path(tmp) / "ja.json"
            ja_path.write_text("[]")
            registry = registry_from_env({"LANG_CATALOG_JA": str(ja_path)})
            out = apply_language_route(
                payload,
                "Pikachu",
                scores={"en": 0.11, "ja": 0.91, "zh": 0.05},
                answers={"ja": ja},
                registry=registry,
                enabled=True,
            )
        self.assertEqual(out["tcgdexId"], "ja-1")
        self.assertEqual(out["lang"], "ja")
        self.assertEqual(out["langReason"], REASON_LATIN_BEST_SEPARATED)
        self.assertEqual(out["reason"], "accepted")
        self.assertNotIn("lang", payload)
        self.assertEqual(ja.get("lang"), None)

    def test_apply_reads_top1_similarity_from_catalog_answers(self):
        payload = _payload("base1-58", 0.11)
        ja = _payload("ja-1", 0.91)
        zh = _payload("zh-1", 0.05)
        with tempfile.TemporaryDirectory() as tmp:
            ja_path = Path(tmp) / "ja.json"
            ja_path.write_text("[]")
            registry = registry_from_env({"LANG_CATALOG_JA": str(ja_path)})
            out = apply_language_route(
                payload,
                "Abra",
                answers={"ja": ja, "zh": zh},
                registry=registry,
                enabled=True,
            )
        self.assertEqual(out["langReason"], REASON_LATIN_BEST_SEPARATED)
        self.assertEqual(out["tcgdexId"], "ja-1")


class ServeWireTests(unittest.TestCase):
    def test_serve_guards_the_router_with_the_flag(self):
        serve = (ROOT / "serve.py").read_text()
        self.assertIn("LANG_ROUTER_V2", serve)
        guard = serve.index("if not lang_router_v2_enabled():")
        call = serve.index("apply_language_route(")
        self.assertLess(guard, call)
        # Flag-off return happens before any router call.
        self.assertIn("return payload", serve[guard:call])

    def test_image_copies_router_module(self):
        docker = (ROOT / "Dockerfile").read_text()
        self.assertIn("lang_router.py", docker)
        copied = docker.split("COPY --chown=app:app", 1)[1]
        self.assertIn("lang_router.py", copied.split("reranker", 1)[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
