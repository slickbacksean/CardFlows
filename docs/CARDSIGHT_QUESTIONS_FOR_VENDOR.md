# CardSight — Questions for Vendor

**Purpose:** Close **Unconfirmed** gaps before CardFlow production integration.  
**Do not** treat answers as Confirmed until written vendor reply or updated public docs.  
**Context:** CardFlow intends server-side still-image identify for MVP; Pokémon catalog is TCGdex; live video is out of MVP unless founder-approved.

---

## A. Authentication & keys

1. What is the supported **API key rotation** process (create, revoke, grace period, multi-key)?  
   - Public docs: **Unconfirmed**.
2. Are keys scoped (identify-only vs pricing vs catalog)? Any least-privilege options?
3. How are compromised keys detected/revoked? Is there usage alerting beyond billing?

## B. Upload constraints (still image)

4. What are **hard limits** for image upload: max bytes, max dimensions, min dimensions, aspect ratio?  
   - OpenAPI `FileUploadInput` documents binary `image` only — **Unconfirmed** size/dimension limits.
5. Preferred encoding for mobile: JPEG quality guidance? WebP support parity with JPEG/PNG?
6. Multi-card images: max cards per identify call? Behavior when more cards are present than billed/counted?
7. Are EXIF / GPS metadata stripped server-side? Any PII retention from uploads?

## C. Identify semantics & Pokémon coverage

8. For Pokémon specifically: which **segments / shortnames** should CardFlow use on `POST /v1/identify/card/{segment}`?
9. Coverage: % of modern English Pokémon sets identifiable? Japanese / other languages?
10. How should clients interpret **set-level** matches (no `card.id`) for UX — force picker vs auto-navigate set?
11. Ordering of `suggestions[]`: always best-first? Stable across identical images?
12. `parallelSuggestions` is marked beta in OpenAPI — production-ready for Pokémon? SLA for breaking changes?
13. Confirm `CARD_LANGUAGE` field key and ISO 639-1 values for Pokémon identify responses.

## D. Errors, rate limits, quotas

14. OpenAPI identify responses list `200,400,401,404,408,500,503` but marketing cites **429**. Please confirm:
    - Is `429` returned on identify/detect?
    - Response body shape for rate limit (headers: `Retry-After`?)
15. Exact **quota** definition: which endpoints consume monthly quota? Do `GET /v1/identify/list/sets` and `GET /v1/identify/check/set/{set_id}` remain free?
16. RPS enforcement: sliding window vs fixed window? Shared across keys on one account?
17. Recommended client backoff for `408` / `503` / `429`.

## E. Data retention, privacy, commercial terms

18. How long are **uploaded images** retained? Can retention be set to zero / ephemeral?  
    - Public: **Unconfirmed**.
19. May CardFlow **cache** identify results and pricing responses? Max retention for commercial End User Applications?  
    - Exact cache retention: **Unconfirmed**.
20. Confirm commercial use is permitted for CardFlow as an End User Application (consumer collection app), and clarify any restrictions on persisting vendor card UUIDs as cross-references (not as a competing standalone DB).
21. Privacy: are images used to train models? Opt-out available?

## F. Pricing API (if enabled later)

22. Freshness of `meta.last_sale_date` and marketplace listings for Pokémon?
23. Bulk pricing: hard max 100 — any higher tier limits?
24. Attribution requirements when displaying eBay (or other) sourced prices in-app?

## G. Live video (Enterprise — not MVP)

25. Minimum Enterprise contract for gRPC/WebSocket streaming?
26. Mobile RN feasibility (gRPC-Web vs custom bridge)? Any sample clients?
27. Confirm ~200–300 ms end-to-end claim under typical mobile uplink.

## H. Support & SLAs

28. Support channels and SLA for Free vs paid tiers?
29. Status page / incident notification?
30. Changelog / deprecation policy for OpenAPI breaking changes?

---

## Suggested send order

1. **Blockers for MVP still-image:** B4–B5, C8–C9, D14–D16, E18–E20.  
2. **Soon after:** A1, C10–C13, D17, H28–H30.  
3. **Later:** Pricing (F), Live video (G).

Record vendor answers with date + contact; then update `CARDSIGHT_VALIDATION.md` Confirmed/Unconfirmed tables.
