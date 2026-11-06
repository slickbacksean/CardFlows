"""
Printing reranker (r21rr) ported from bundle/reranker/{rrcore,rrmodel,feats}.py.

SIFT+RANSAC align query → ref hi-res; blur-matched local NCC on discriminative
pixels; logistic model in model_frozen.json. Override the fusion pred only when
max p > 0.9.

Missing model / fam / hr_cat → loader returns None (fusion-only). A throw on a
frame keeps the fusion pred and logs once per error class.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np

FK = ["all", "bot", "art", "oth", "inl", "noal"]
CW, CH = 600, 825
DEFAULT_THRESHOLD = 0.9
DEFAULT_TOPK = 6
BUNDLED_MODEL = Path(__file__).resolve().parent / "reranker" / "model_frozen.json"
MappingLike = dict[str, Any]

_logged_errors: set[str] = set()


def _log_once(cls: str, msg: str) -> None:
    if cls in _logged_errors:
        return
    _logged_errors.add(cls)
    print(f"[printing_rerank] {msg}")


def xvec(feats: dict[str, float], gap: float = 0.0) -> np.ndarray:
    # gap intentionally unused: counterfactual refs would leak it
    _ = gap
    return np.array([float(feats.get(k, 0.0)) for k in FK] + [1.0], np.float64)


def prob(model: MappingLike, X: np.ndarray) -> np.ndarray:
    mu = np.array(model["mu"], dtype=np.float64)
    sd = np.array(model["sd"], dtype=np.float64)
    w = np.array(model["w"], dtype=np.float64)
    Z = np.c_[(X[:, :-1] - mu) / sd, np.ones(len(X))]
    return 1.0 / (1.0 + np.exp(-Z @ w))


def decide_override(
    ref: str,
    feat_by_alt: dict[str, dict[str, float]],
    model: MappingLike,
    threshold: float = DEFAULT_THRESHOLD,
) -> tuple[str, str | None, float]:
    """
    Logistic decide from rrmodel.py: override ref with best_alt only if p > t.

    Returns (final_id, best_alt, p).
    """
    alts = [c for c in feat_by_alt]
    if not alts:
        return ref, None, 0.0
    X = np.array([xvec(feat_by_alt[c], 0.0) for c in alts], dtype=np.float64)
    p = prob(model, X)
    k = int(np.argmax(p))
    best_p = float(p[k])
    best_alt = alts[k]
    return (best_alt if best_p > threshold else ref), best_alt, best_p


def load_frozen_model(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict) or "w" not in data or "mu" not in data or "sd" not in data:
        raise ValueError(f"invalid frozen logistic model: {path}")
    t = float(data.get("t", DEFAULT_THRESHOLD))
    data["t"] = t
    return data


def family_for(
    pred: str,
    fam: dict[str, Any],
    card_names: dict[str, str],
    topk: int = DEFAULT_TOPK,
) -> list[str]:
    """Same-name family, pred forced to index 0, capped at topk."""
    raw: Any = None
    if pred in fam:
        raw = fam[pred]
    else:
        name = (card_names.get(pred) or "").strip()
        if name and name in fam:
            raw = fam[name]
        else:
            needle = name.lower()
            if needle:
                for key, value in fam.items():
                    if str(key).strip().lower() == needle:
                        raw = value
                        break
    ids: list[str] = []
    if isinstance(raw, dict):
        raw = raw.get("ids") or raw.get("tcgdexIds") or []
    if isinstance(raw, list):
        ids = [str(x) for x in raw if x]
    if pred not in ids:
        ids = [pred, *[i for i in ids if i != pred]]
    else:
        ids = [pred, *[i for i in ids if i != pred]]
    return ids[: max(int(topk), 1)]


def _cv2():
    import cv2

    return cv2


class PrintReranker:
    """Live SIFT/NCC reranker. Construct via load_print_reranker()."""

    def __init__(
        self,
        model: dict[str, Any],
        fam: dict[str, Any],
        hr_cat: Path,
        threshold: float = DEFAULT_THRESHOLD,
        topk: int = DEFAULT_TOPK,
        card_names: dict[str, str] | None = None,
    ):
        self.model = model
        self.fam = fam
        self.hr_cat = Path(hr_cat)
        self.threshold = float(threshold)
        self.topk = int(topk)
        self.card_names = card_names or {}
        self._sift = None
        self._bf = None
        self._cc: dict[str, Any] = {}
        self._pair: dict[tuple[str, str], Any] = {}
        self._mask: dict[tuple[str, str, float], Any] = {}
        self._dm: dict[tuple[str, str], Any] = {}
        yy, xx = np.mgrid[0:CH, 0:CW]
        yn, xn = yy / CH, xx / CW
        self.BOT = yn > 0.88
        self.ART = (yn > 0.09) & (yn < 0.52) & (xn > 0.07) & (xn < 0.93)
        self.INT = (yn > 0.03) & (yn < 0.97) & (xn > 0.03) & (xn < 0.97)
        self.SIG = [0, 1, 1.6, 2.5, 4]

    def _ensure_sift(self) -> None:
        if self._sift is not None:
            return
        cv2 = _cv2()
        self._sift = cv2.SIFT_create(nfeatures=4000)
        self._bf = cv2.BFMatcher(cv2.NORM_L2)

    # --- rrcore.py ---

    def cat(self, tcgdex_id: str) -> Any:
        if tcgdex_id not in self._cc:
            cv2 = _cv2()
            path = self.hr_cat / f"{tcgdex_id}.jpg"
            if not path.is_file():
                png = self.hr_cat / f"{tcgdex_id}.png"
                path = png if png.is_file() else path
            im = cv2.imread(str(path)) if path.is_file() else None
            if im is None:
                self._cc[tcgdex_id] = None
            else:
                im = cv2.resize(im, (CW, CH), interpolation=cv2.INTER_AREA)
                g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
                self._ensure_sift()
                k, d = self._sift.detectAndCompute(g, None)
                self._cc[tcgdex_id] = (im, g, k, d)
        return self._cc[tcgdex_id]

    def qfeat(self, im: np.ndarray, maxside: int = 1400, minh: int = 825) -> tuple:
        cv2 = _cv2()
        s = min(1.0, maxside / max(im.shape[:2]))
        if im.shape[0] * s < minh * 0.9:
            s = minh / im.shape[0]  # upscale low-res crops
        im = cv2.resize(
            im,
            None,
            fx=s,
            fy=s,
            interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC,
        )
        g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        self._ensure_sift()
        k, d = self._sift.detectAndCompute(g, None)
        return im, g, k, d

    def align(self, q: tuple, tcgdex_id: str) -> tuple[np.ndarray | None, int]:
        """returns (warped query in catalog frame, ninliers) or (None, 0)"""
        cv2 = _cv2()
        c = self.cat(tcgdex_id)
        if c is None or q[3] is None or c[3] is None or len(q[2]) < 8:
            return None, 0
        m = self._bf.knnMatch(c[3], q[3], k=2)
        g = [a for a, b in (x for x in m if len(x) == 2) if a.distance < 0.8 * b.distance]
        if len(g) < 10:
            return None, len(g)
        src = np.float32([c[2][a.queryIdx].pt for a in g])
        dst = np.float32([q[2][a.trainIdx].pt for a in g])
        H, mk = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
        if H is None:
            return None, 0
        ni = int(mk.sum())
        co = cv2.perspectiveTransform(
            np.float32([[0, 0], [CW, 0], [CW, CH], [0, CH]])[None], H
        )[0]
        if not cv2.isContourConvex(co.astype(np.float32)) or cv2.contourArea(co) < 0.02 * q[0].shape[0] * q[0].shape[1]:
            return None, ni
        w = cv2.warpPerspective(q[0], np.linalg.inv(H), (CW, CH), flags=cv2.INTER_LINEAR)
        return w, ni

    def lnorm(self, g: np.ndarray, s: float = 6) -> np.ndarray:
        cv2 = _cv2()
        g = g.astype(np.float32)
        m = cv2.GaussianBlur(g, (0, 0), s)
        v = cv2.GaussianBlur((g - m) ** 2, (0, 0), s)
        return (g - m) / np.sqrt(v + 25)

    def ncc_map(self, a: np.ndarray, b: np.ndarray, s: float = 8) -> tuple[np.ndarray, np.ndarray]:
        cv2 = _cv2()
        a = a.astype(np.float32)
        b = b.astype(np.float32)
        ma, mb = cv2.GaussianBlur(a, (0, 0), s), cv2.GaussianBlur(b, (0, 0), s)
        va = cv2.GaussianBlur(a * a, (0, 0), s) - ma * ma
        vb = cv2.GaussianBlur(b * b, (0, 0), s) - mb * mb
        cv = cv2.GaussianBlur(a * b, (0, 0), s) - ma * mb
        return cv / np.sqrt(np.maximum(va, 1) * np.maximum(vb, 1) + 1e-6), np.minimum(va, vb)

    def cat_to(self, tcgdex_id: str, ref: str) -> np.ndarray | None:
        k = (tcgdex_id, ref)
        if k not in self._pair:
            c = self.cat(tcgdex_id)
            if c is None:
                self._pair[k] = None
            else:
                w, _ni = self.align(c, ref)
                self._pair[k] = w if w is not None else c[0]
        return self._pair[k]

    def diff_mask(self, tcgdex_id: str, ref: str, frac: float = 0.05) -> np.ndarray:
        cv2 = _cv2()
        k = (tcgdex_id, ref, frac)
        if k not in self._mask:
            a = cv2.cvtColor(self.cat_to(tcgdex_id, ref), cv2.COLOR_BGR2GRAY)
            b = self.cat(ref)[1]
            d = cv2.GaussianBlur(np.abs(self.lnorm(a, 4) - self.lnorm(b, 4)), (0, 0), 5)
            bx, by = int(0.03 * CW), int(0.03 * CH)
            d[:by] = 0
            d[-by:] = 0
            d[:, :bx] = 0
            d[:, -bx:] = 0
            self._mask[k] = d >= np.quantile(d, 1 - frac)
        return self._mask[k]

    def diff_map(self, tcgdex_id: str, ref: str) -> np.ndarray:
        cv2 = _cv2()
        if (tcgdex_id, ref) not in self._dm:
            a = cv2.cvtColor(self.cat_to(tcgdex_id, ref), cv2.COLOR_BGR2GRAY)
            b = self.cat(ref)[1]
            self._dm[(tcgdex_id, ref)] = cv2.GaussianBlur(
                np.abs(self.lnorm(a, 4) - self.lnorm(b, 4)), (0, 0), 5
            )
        return self._dm[(tcgdex_id, ref)]

    def gblur(self, g: np.ndarray, s: float) -> np.ndarray:
        if s == 0:
            return g
        return _cv2().GaussianBlur(g, (0, 0), s)

    def _corr(self, a: np.ndarray, b: np.ndarray) -> float:
        if a.size < 2 or b.size < 2:
            return -1.0
        c = np.corrcoef(a, b)[0, 1]
        return -1.0 if not np.isfinite(c) else float(c)

    # --- feats.py ---

    def frame_feats(self, qim: np.ndarray, cands: list[str], ref: str) -> dict[str, dict[str, float]] | None:
        cv2 = _cv2()
        q = self.qfeat(qim)
        w, _ni = self.align(q, ref)
        if w is None:
            inl = {c: self.align(q, c)[1] for c in cands if self.cat(c) is not None}
            if ref not in inl:
                return None
            return {
                c: dict(
                    all=0.0,
                    bot=0.0,
                    art=0.0,
                    oth=0.0,
                    noal=1.0,
                    inl=float(np.log((inl[c] + 1) / (inl[ref] + 1))),
                )
                for c in inl
                if c != ref
            }
        wg = cv2.cvtColor(w, cv2.COLOR_BGR2GRAY).astype(np.float32)
        rg = self.cat(ref)[1].astype(np.float32)
        best = max(
            self.SIG,
            key=lambda s: self._corr(self.gblur(rg, s)[self.INT][::7], wg[self.INT][::7]),
        )
        nr, _ = self.ncc_map(wg, self.gblur(rg, best), 6)
        out: dict[str, dict[str, float]] = {}
        for c in cands:
            if c == ref or self.cat(c) is None:
                continue
            warped = self.cat_to(c, ref)
            if warped is None:
                continue
            cg = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY).astype(np.float32)
            D = self.diff_map(c, ref)
            nc, _ = self.ncc_map(wg, self.gblur(cg, best), 6)
            d = nc - nr
            f: dict[str, float] = {}
            for k, Z in (
                ("all", self.INT),
                ("bot", self.INT & self.BOT),
                ("art", self.ART),
                ("oth", self.INT & ~self.BOT & ~self.ART),
            ):
                dz = D[Z]
                th = np.quantile(dz, 0.85)
                m = dz >= th
                f[k] = float(d[Z][m].mean()) if th > 0.15 else 0.0
                f[k + "_d"] = float(th)
            f["noal"] = 0.0
            out[c] = f
        inl = {c: self.align(q, c)[1] for c in cands if self.cat(c) is not None}
        for c in out:
            out[c]["inl"] = float(np.log((inl.get(c, 0) + 1) / (inl.get(ref, 0) + 1)))
        return out

    def card_feats(
        self, qims: list[np.ndarray], cands: list[str], ref: str
    ) -> tuple[dict[str, dict[str, float]], int]:
        fr = [f for f in (self.frame_feats(q, cands, ref) for q in qims) if f is not None]
        if not fr:
            return {}, 0
        res: dict[str, dict[str, float]] = {}
        for c in cands:
            if c == ref or c not in fr[0]:
                continue
            res[c] = {
                k: float(np.median([f[c].get(k, 0.0) for f in fr if c in f]))
                for k in ("all", "bot", "art", "oth", "inl", "noal")
            }
        return res, len(fr)

    def maybe_override(
        self,
        images: list[Any],
        pred: str,
        card_names: dict[str, str] | None = None,
        feat_by_alt: dict[str, dict[str, float]] | None = None,
    ) -> tuple[str, dict[str, Any]]:
        """
        Override pred with the best same-name alt only if max p > threshold.

        feat_by_alt: optional precomputed features (unit tests; skips SIFT).
        """
        names = card_names if card_names is not None else self.card_names
        info: dict[str, Any] = {"overridden": False, "ref": pred, "p": 0.0, "alt": None}
        try:
            cands = family_for(pred, self.fam, names, topk=self.topk)
            if len(cands) < 2:
                return pred, info
            if feat_by_alt is None and self.cat(cands[0]) is None:
                return pred, info
            feats = feat_by_alt
            if feats is None:
                qims = [_pil_to_bgr(im) for im in images]
                qims = [q for q in qims if q is not None]
                if not qims:
                    return pred, info
                feats, _n = self.card_feats(qims, cands, cands[0])
            if not feats:
                return pred, info
            final, alt, p = decide_override(pred, feats, self.model, self.threshold)
            info.update({"alt": alt, "p": p, "overridden": final != pred, "cands": cands})
            return final, info
        except Exception as exc:  # noqa: BLE001
            _log_once(type(exc).__name__, f"{type(exc).__name__}: keep fusion pred ({exc})")
            return pred, info


def _pil_to_bgr(image: Any) -> np.ndarray | None:
    if image is None:
        return None
    if isinstance(image, np.ndarray):
        if image.ndim == 2:
            cv2 = _cv2()
            return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        if image.ndim == 3 and image.shape[2] == 3:
            return image
        return None
    try:
        from PIL import Image

        if isinstance(image, Image.Image):
            rgb = np.asarray(image.convert("RGB"))
            return rgb[:, :, ::-1].copy()
    except Exception:
        return None
    return None


def print_rerank_enabled(env: dict[str, str] | None = None) -> bool:
    src = os.environ if env is None else env
    return str(src.get("PRINT_RERANK_ENABLED", "") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def load_print_reranker(card_names: dict[str, str] | None = None) -> PrintReranker | None:
    """
    Master switch PRINT_RERANK_ENABLED. Missing model/fam/hr_cat → None (fusion-only).
    """
    if not print_rerank_enabled():
        return None
    model_path = os.environ.get("PRINT_RERANK_MODEL", "").strip() or str(BUNDLED_MODEL)
    fam_path = os.environ.get("PRINT_RERANK_FAM", "").strip()
    hr_cat = os.environ.get("PRINT_RERANK_HR_CAT", "").strip()
    if not fam_path or not hr_cat:
        print(
            "[printing_rerank] PRINT_RERANK_ENABLED=1 but FAM/HR_CAT missing; serving fusion-only"
        )
        return None
    fam_file = Path(fam_path).expanduser()
    hr_dir = Path(hr_cat).expanduser()
    model_file = Path(model_path).expanduser()
    if not model_file.is_file() or not fam_file.is_file() or not hr_dir.is_dir():
        print(
            "[printing_rerank] model/fam/hr_cat missing on disk; serving fusion-only "
            f"(model={model_file.is_file()} fam={fam_file.is_file()} hr={hr_dir.is_dir()})"
        )
        return None
    try:
        model = load_frozen_model(model_file)
        fam = json.loads(fam_file.read_text())
        if not isinstance(fam, dict):
            raise ValueError("fam.json must be an object")
        threshold = float(os.environ.get("PRINT_RERANK_THRESHOLD", "") or model.get("t", DEFAULT_THRESHOLD))
        topk = int(os.environ.get("PRINT_RERANK_TOPK_SAME_NAME", str(DEFAULT_TOPK)))
        reranker = PrintReranker(
            model=model,
            fam=fam,
            hr_cat=hr_dir,
            threshold=threshold,
            topk=topk,
            card_names=card_names or {},
        )
        print(
            f"[printing_rerank] loaded t={reranker.threshold} topk={reranker.topk} "
            f"fam={len(fam)} hr={hr_dir}"
        )
        return reranker
    except Exception as exc:  # noqa: BLE001
        print(f"[printing_rerank] failed to load ({exc}); serving fusion-only")
        return None
