"""
Card-language router for the live-identity scanner.

The sidecar identifies a crop by embedding it and searching a catalog. Offline
builds produced separate EN / JA / ZH catalogs (ZH ids use ``zh-Hans_`` and
``zh-tw_`` prefixes). This module picks which catalog's top-1 answer to use.

``LANG_ROUTER_V2`` defaults off (unset or ``0``). Callers must keep the live
match payload unchanged in that case: ``apply_language_route`` returns the
same dict and does not log. With the flag on, the retuned rule may select JA
or ZH when those catalogs are configured and their top-1 raw cosines are
supplied. A registry with only EN configured is a no-op.

No catalog binaries are loaded here.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Retuned-rule thresholds. Override with LANG_ROUTER_* env vars.
HANZI_JA_MARGIN = 0.02
LATIN_EN_FLOOR = 0.35
LATIN_BEST_OVER_EN = 0.08
LATIN_BEST_OVER_OTHER = 0.05

ZH_HANS_ID_PREFIX = "zh-Hans_"
ZH_TW_ID_PREFIX = "zh-tw_"

REASON_CONTAINS_KANA = "contains_kana"
REASON_HANZI_WITHOUT_KANA = "hanzi_without_kana"
REASON_DEFAULT_LATIN = "default_latin_or_other"
REASON_HANZI_JA_WINS = "hanzi_ja_wins_by_T"
REASON_HANZI_KEEP_ZH = "hanzi_keep_zh"
REASON_LATIN_EN_GE_FLOOR = "latin_en_ge_floor"
REASON_LATIN_BEST_NOT_AHEAD = "latin_best_not_ahead_of_en"
REASON_LATIN_BEST_SEPARATED = "latin_best_separated"
REASON_LATIN_JA_ZH_NEAR_TIE = "latin_ja_zh_near_tie_stay_en"

ALL_REASONS = (
    REASON_CONTAINS_KANA,
    REASON_HANZI_WITHOUT_KANA,
    REASON_DEFAULT_LATIN,
    REASON_HANZI_JA_WINS,
    REASON_HANZI_KEEP_ZH,
    REASON_LATIN_EN_GE_FLOOR,
    REASON_LATIN_BEST_NOT_AHEAD,
    REASON_LATIN_BEST_SEPARATED,
    REASON_LATIN_JA_ZH_NEAR_TIE,
)

_ON_VALUES = frozenset({"1", "true", "yes", "on"})
_SCORE_LANGS = ("en", "ja", "zh")

logger = logging.getLogger("cardflow.lang_router")
logger.setLevel(logging.INFO)
logger.propagate = False
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("[lang_router] %(message)s"))
    logger.addHandler(_handler)

# Traditional, simplified. Identical glyphs are omitted. Used only by the
# optional script helper; the router itself returns en / ja / zh.
_SCRIPT_PAIRS: tuple[tuple[str, str], ...] = (
    ("寶", "宝"),
    ("夢", "梦"),
    ("龍", "龙"),
    ("電", "电"),
    ("鬥", "斗"),
    ("惡", "恶"),
    ("鋼", "钢"),
    ("靈", "灵"),
    ("訓", "训"),
    ("練", "练"),
    ("進", "进"),
    ("無", "无"),
    ("閃", "闪"),
    ("擊", "击"),
    ("傷", "伤"),
    ("別", "别"),
    ("這", "这"),
    ("個", "个"),
    ("對", "对"),
    ("後", "后"),
    ("發", "发"),
    ("時", "时"),
    ("間", "间"),
    ("開", "开"),
    ("關", "关"),
    ("會", "会"),
    ("來", "来"),
    ("強", "强"),
    ("體", "体"),
    ("氣", "气"),
    ("點", "点"),
    ("種", "种"),
    ("類", "类"),
    ("術", "术"),
    ("護", "护"),
    ("與", "与"),
    ("為", "为"),
    ("從", "从"),
    ("應", "应"),
    ("東", "东"),
    ("車", "车"),
    ("門", "门"),
    ("長", "长"),
    ("風", "风"),
    ("飛", "飞"),
    ("鳥", "鸟"),
    ("馬", "马"),
    ("國", "国"),
    ("獸", "兽"),
    ("蟲", "虫"),
    ("亞", "亚"),
    ("爾", "尔"),
    ("納", "纳"),
    ("聖", "圣"),
    ("戰", "战"),
    ("機", "机"),
    ("極", "极"),
    ("級", "级"),
    ("屬", "属"),
    ("裝", "装"),
    ("備", "备"),
    ("場", "场"),
    ("選", "选"),
    ("擇", "择"),
    ("棄", "弃"),
    ("張", "张"),
    ("數", "数"),
    ("龜", "龟"),
    ("傑", "杰"),
    ("噴", "喷"),
    ("騎", "骑"),
    ("華", "华"),
    ("麗", "丽"),
    ("畫", "画"),
    ("傳", "传"),
    ("說", "说"),
    ("語", "语"),
    ("見", "见"),
    ("覺", "觉"),
    ("視", "视"),
    ("觀", "观"),
    ("廣", "广"),
    ("實", "实"),
    ("現", "现"),
    ("單", "单"),
    ("雙", "双"),
    ("絕", "绝"),
    ("緣", "缘"),
    ("網", "网"),
    ("絡", "络"),
)


def _compile_script_sets(pairs: tuple[tuple[str, str], ...]) -> tuple[frozenset[str], frozenset[str]]:
    traditional: set[str] = set()
    simplified: set[str] = set()
    for trad, simp in pairs:
        if len(trad) != 1 or len(simp) != 1 or trad == simp:
            continue
        traditional.add(trad)
        simplified.add(simp)
    overlap = traditional & simplified
    if overlap:
        traditional -= overlap
        simplified -= overlap
    return frozenset(traditional), frozenset(simplified)


TRADITIONAL_CHARS, SIMPLIFIED_CHARS = _compile_script_sets(_SCRIPT_PAIRS)


@dataclass(frozen=True)
class LangRouterConfig:
    """Thresholds for the retuned rule. Defaults match the offline retune."""

    hanzi_ja_margin: float = HANZI_JA_MARGIN
    latin_en_floor: float = LATIN_EN_FLOOR
    latin_best_over_en: float = LATIN_BEST_OVER_EN
    latin_best_over_other: float = LATIN_BEST_OVER_OTHER


def _env_float(src: Mapping[str, str], key: str, default: float) -> float:
    raw = str(src.get(key, "") or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    if value != value or value in (float("inf"), float("-inf")):
        return default
    return value


def load_config(env: Mapping[str, str] | None = None) -> LangRouterConfig:
    src = os.environ if env is None else env
    return LangRouterConfig(
        hanzi_ja_margin=_env_float(src, "LANG_ROUTER_HANZI_JA_MARGIN", HANZI_JA_MARGIN),
        latin_en_floor=_env_float(src, "LANG_ROUTER_LATIN_EN_FLOOR", LATIN_EN_FLOOR),
        latin_best_over_en=_env_float(src, "LANG_ROUTER_LATIN_BEST_OVER_EN", LATIN_BEST_OVER_EN),
        latin_best_over_other=_env_float(src, "LANG_ROUTER_LATIN_BEST_OVER_OTHER", LATIN_BEST_OVER_OTHER),
    )


def lang_router_v2_enabled(env: Mapping[str, str] | None = None) -> bool:
    """True only for LANG_ROUTER_V2 in {1, true, yes, on}. Unset and 0 are off."""
    src = os.environ if env is None else env
    raw = str(src.get("LANG_ROUTER_V2", "") or "").strip().lower()
    return raw in _ON_VALUES


def _is_kana(ch: str) -> bool:
    """Hiragana / katakana letters. Katakana middle dot U+30FB is not kana."""
    code = ord(ch)
    if 0x3041 <= code <= 0x3096 or 0x3099 <= code <= 0x309F:
        return True
    if 0x30A1 <= code <= 0x30FA or code == 0x30FC or 0x30FD <= code <= 0x30FF:
        return True
    if 0x31F0 <= code <= 0x31FF:
        return True
    if 0xFF66 <= code <= 0xFF9D:
        return True
    return False


def _is_hanzi(ch: str) -> bool:
    code = ord(ch)
    if 0x3400 <= code <= 0x4DBF or 0x4E00 <= code <= 0x9FFF:
        return True
    return 0xF900 <= code <= 0xFAFF


def baseline_route(ocr_text: str | None) -> tuple[str, str]:
    """Kana -> JA. Hanzi without kana -> ZH. Otherwise EN."""
    has_kana = False
    has_hanzi = False
    for ch in ocr_text or "":
        if _is_kana(ch):
            has_kana = True
            break
        if _is_hanzi(ch):
            has_hanzi = True
    if has_kana:
        return "ja", REASON_CONTAINS_KANA
    if has_hanzi:
        return "zh", REASON_HANZI_WITHOUT_KANA
    return "en", REASON_DEFAULT_LATIN


def _as_float(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _score(scores: Mapping[str, Any] | None, lang: str) -> float | None:
    if not scores or lang not in scores:
        return None
    return _as_float(scores.get(lang))


def _route_hanzi(
    scores: Mapping[str, Any] | None,
    config: LangRouterConfig,
    base: tuple[str, str],
) -> tuple[str, str]:
    ja = _score(scores, "ja")
    zh = _score(scores, "zh")
    if ja is None or zh is None:
        return base
    # T = hanzi_ja_margin (default 0.02). Ties and ZH wins stay on ZH.
    if ja - zh >= config.hanzi_ja_margin:
        return "ja", REASON_HANZI_JA_WINS
    return "zh", REASON_HANZI_KEEP_ZH


def _route_latin(
    scores: Mapping[str, Any] | None,
    config: LangRouterConfig,
    base: tuple[str, str],
) -> tuple[str, str]:
    en = _score(scores, "en")
    ja = _score(scores, "ja")
    zh = _score(scores, "zh")
    if en is None or ja is None or zh is None:
        return base
    if en >= config.latin_en_floor:
        return "en", REASON_LATIN_EN_GE_FLOOR
    # Ties go to JA.
    if ja >= zh:
        best_lang, best, other = "ja", ja, zh
    else:
        best_lang, best, other = "zh", zh, ja
    if best - en < config.latin_best_over_en:
        return "en", REASON_LATIN_BEST_NOT_AHEAD
    if best - other >= config.latin_best_over_other:
        return best_lang, REASON_LATIN_BEST_SEPARATED
    return "en", REASON_LATIN_JA_ZH_NEAR_TIE


def route_card_language(
    ocr_text: str | None,
    scores: Mapping[str, Any] | None = None,
    *,
    enabled: bool | None = None,
    config: LangRouterConfig | None = None,
    env: Mapping[str, str] | None = None,
) -> tuple[str, str]:
    """Return ``(lang, reason)`` and log the reason.

    ``lang`` is ``en``, ``ja``, or ``zh``. Flag off (the default) ignores
    ``scores`` and returns the baseline route.
    """
    active = config if config is not None else load_config(env)
    on = lang_router_v2_enabled(env) if enabled is None else bool(enabled)
    base = baseline_route(ocr_text)
    if not on:
        result = base
    elif base[1] == REASON_HANZI_WITHOUT_KANA:
        result = _route_hanzi(scores, active, base)
    elif base[1] == REASON_DEFAULT_LATIN:
        result = _route_latin(scores, active, base)
    else:
        # Kana, and any future baseline reason, stay on the baseline result.
        result = base
    logger.info("lang=%s reason=%s", result[0], result[1])
    return result


def zh_script_preference(ocr_text: str | None) -> str | None:
    """Cheap simplified-vs-traditional count. ``zh-tw``, ``zh-Hans``, or None.

    None means the text has no distinctive chars from the pairs table, or the
    two counts tie. Not used to override the en/ja/zh decision by itself.
    """
    if not ocr_text:
        return None
    traditional = 0
    simplified = 0
    for ch in ocr_text:
        in_trad = ch in TRADITIONAL_CHARS
        in_simp = ch in SIMPLIFIED_CHARS
        if in_trad and not in_simp:
            traditional += 1
        elif in_simp and not in_trad:
            simplified += 1
    if traditional == 0 and simplified == 0:
        return None
    if traditional > simplified:
        return "zh-tw"
    if simplified > traditional:
        return "zh-Hans"
    return None


def zh_id_prefix(script: str | None) -> str | None:
    if script == "zh-Hans":
        return ZH_HANS_ID_PREFIX
    if script == "zh-tw":
        return ZH_TW_ID_PREFIX
    return None


def _path_ready(path: str | None) -> bool:
    text = (path or "").strip()
    if not text:
        return False
    try:
        candidate = Path(text).expanduser()
        return candidate.is_file() or candidate.is_dir()
    except OSError:
        return False


@dataclass(frozen=True)
class CatalogRegistry:
    """Optional EN/JA/ZH catalog paths. EN is the in-process catalog.

    Extra languages count as configured only when their path exists. This
    object never reads catalog bytes. ``choose`` is a no-op (returns the EN
    answer) when only EN is configured.
    """

    en_path: str | None = None
    ja_path: str | None = None
    zh_path: str | None = None
    zh_hans_path: str | None = None
    zh_tw_path: str | None = None

    def is_en_only(self) -> bool:
        return self.configured_langs() == ("en",)

    def configured_langs(self) -> tuple[str, ...]:
        langs = ["en"]
        if _path_ready(self.ja_path):
            langs.append("ja")
        if _path_ready(self.zh_path) or _path_ready(self.zh_hans_path) or _path_ready(self.zh_tw_path):
            langs.append("zh")
        return tuple(langs)

    def choose(self, lang: str, answers: Mapping[str, Any], ocr_text: str | None = None) -> Any:
        """Pick a catalog answer. EN-only always returns ``answers['en']``."""
        en_answer = answers.get("en")
        if self.is_en_only():
            return en_answer
        if lang == "ja" and _path_ready(self.ja_path) and "ja" in answers:
            return answers["ja"]
        if lang == "zh":
            picked = self._choose_zh(answers, ocr_text)
            if picked is not None:
                return picked
        if lang == "en":
            return en_answer
        return en_answer

    def _choose_zh(self, answers: Mapping[str, Any], ocr_text: str | None) -> Any:
        script = zh_script_preference(ocr_text)
        if script == "zh-tw" and _path_ready(self.zh_tw_path) and "zh-tw" in answers:
            return answers["zh-tw"]
        if script == "zh-Hans" and _path_ready(self.zh_hans_path) and "zh-Hans" in answers:
            return answers["zh-Hans"]
        if _path_ready(self.zh_path) and "zh" in answers:
            return answers["zh"]
        return None


def registry_from_env(env: Mapping[str, str] | None = None) -> CatalogRegistry:
    src = os.environ if env is None else env

    def grab(key: str) -> str | None:
        raw = str(src.get(key, "") or "").strip()
        return raw or None

    return CatalogRegistry(
        en_path=grab("LANG_CATALOG_EN"),
        ja_path=grab("LANG_CATALOG_JA"),
        zh_path=grab("LANG_CATALOG_ZH"),
        zh_hans_path=grab("LANG_CATALOG_ZH_HANS"),
        zh_tw_path=grab("LANG_CATALOG_ZH_TW"),
    )


def _merged_scores(
    scores: Mapping[str, Any] | None,
    answers: Mapping[str, Any] | None,
    payload: Mapping[str, Any] | None = None,
) -> dict[str, float]:
    """Top-1 raw cosines. Explicit scores win, then per-catalog answers.

    The live match payload is the EN answer, so its similarity fills ``en``
    when that score was not passed separately.
    """
    merged: dict[str, float] = {}
    for lang in _SCORE_LANGS:
        value = _score(scores, lang)
        if value is not None:
            merged[lang] = value
    if answers:
        for lang in _SCORE_LANGS:
            if lang in merged:
                continue
            answer = answers.get(lang)
            if isinstance(answer, dict):
                value = _as_float(answer.get("similarity"))
                if value is not None:
                    merged[lang] = value
    if "en" not in merged and isinstance(payload, dict):
        value = _as_float(payload.get("similarity"))
        if value is not None:
            merged["en"] = value
    return merged


def apply_language_route(
    payload: dict[str, Any],
    ocr_text: str | None,
    *,
    scores: Mapping[str, Any] | None = None,
    answers: Mapping[str, Any] | None = None,
    registry: CatalogRegistry | None = None,
    enabled: bool | None = None,
    config: LangRouterConfig | None = None,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Apply the router to a match payload.

    Flag off: return ``payload`` itself (no log, no new keys).
    Flag on and EN-only registry: log the decision and return ``payload``.
    Flag on with another catalog's answer selected: return a copy of that
    answer plus ``lang`` and ``langReason``. The accept ``reason`` field is
    left as the catalog match set it.
    """
    on = lang_router_v2_enabled(env) if enabled is None else bool(enabled)
    if not on:
        return payload
    reg = registry if registry is not None else registry_from_env(env)
    merged_scores = _merged_scores(scores, answers, payload)
    lang, reason = route_card_language(
        ocr_text,
        merged_scores,
        enabled=True,
        config=config,
        env=env,
    )
    if reg.is_en_only():
        return payload
    pool: dict[str, Any] = dict(answers or {})
    pool.setdefault("en", payload)
    chosen = reg.choose(lang, pool, ocr_text)
    if chosen is None or chosen is payload or not isinstance(chosen, dict):
        return payload
    switched = dict(chosen)
    switched["lang"] = lang
    switched["langReason"] = reason
    return switched
