# Multi-Frame Hold Logic (seg3.py) - Server Implementation Notes

## Current State

**The server does NOT currently have per-hold frame grouping.** The `/v1/match` endpoint processes **single frames independently**, receiving one crop image per request with no session or hold tracking.

## Where Multi-Frame Logic Lives Today

Multi-frame temporal voting is implemented **client-side** in:
- `apps/mobile/lib/live-identify.ts` (scanner loop)
- `packages/shared/src/live-identity-vote.ts` (voting logic)

The client:
1. Polls frames at 250ms intervals
2. Sends each frame to `/v1/match` independently
3. Collects similarities from 3-12 frames (configurable)
4. Performs temporal voting: `mean_similarity + max_similarity`
5. Auto-shows when combined score > 1.65 (or 2+ votes match)

This is controlled by:
```typescript
EXPO_PUBLIC_CARD_FLOW_LIVESTREAM_TEMPORAL_VOTING=1  // Off by default
```

## Where Server-Side Multi-Frame Would Go

If we moved multi-frame hold logic to the server (as in seg3.py), here are the three implementation options:

### Option 1: Session-Based Endpoint (Recommended)

Add a **stateful session API** that accumulates frames per hold:

```python
@app.post("/v1/match-session")
async def match_session(
  crop: UploadFile = File(...),
  session_id: str = Form(...),  # Client-generated hold ID
  timestamp_ms: int = Form(...),  # Frame timestamp
  quad: str | None = Form(default=None),
  # ... other params
) -> JSONResponse:
  # 1. Store frame in session buffer (in-memory or Redis)
  session = get_or_create_session(session_id)
  session.add_frame(crop, timestamp_ms, quad)
  
  # 2. Localize each frame (if enabled)
  if LOCALIZE:
    loc_result = localize_card(image)
    if loc_result['quad']:
      localized = warp_localized(image, loc_result['quad'])
      session.add_localized_frame(localized, timestamp_ms)
  
  # 3. Embed all frames in the session
  embeddings = [_trained_model.embed_only(frame) for frame in session.frames]
  
  # 4. Split hold where card changes (seg3.py logic)
  segments = split_at_card_changes(embeddings, session.frames, 
                                     similarity_threshold=0.6,
                                     position_jump_threshold=0.5)
  
  # 5. Merge single-blurry-frame splits
  segments = merge_single_frame_splits(segments, merge_threshold=0.72)
  
  # 6. Score segments (catalog confidence, length, position)
  scored_segments = score_segments(segments, session.center_timestamp)
  
  # 7. Pick best contiguous run (2+ frames required)
  best_segment = max(scored_segments, key=lambda s: s.score)
  
  # 8. Drop outliers (frames disagreeing with segment majority)
  inliers = drop_outliers(best_segment, agreement_threshold=0.7)
  
  # 9. Use medoid frame (most similar to segment mean)
  medoid_frame = find_medoid(inliers)
  
  # 10. Match the medoid against catalog
  candidates, timings = _trained_model.match(medoid_frame)
  
  return JSONResponse({
    "ok": True,
    "sessionId": session_id,
    "framesInSession": len(session.frames),
    "segmentsFound": len(segments),
    "bestSegmentSize": len(inliers),
    "medoidTimestampMs": medoid_frame.timestamp_ms,
    # ... match results
  })
```

**Session storage**: Use Redis or in-memory dict with TTL (~30s per session).

**Client changes**: Client sends `session_id` (e.g., IoU track ID) with each frame.

### Option 2: Batch Endpoint

Add a **batch endpoint** that receives multiple frames at once:

```python
@app.post("/v1/match-batch")
async def match_batch(
  frames: list[UploadFile] = File(...),
  quads: str | None = Form(default=None),  # JSON array of quads
  timestamps: str = Form(...),  # JSON array of timestamps
) -> JSONResponse:
  # 1. Parse input
  images = [Image.open(BytesIO(await f.read())) for f in frames]
  quad_list = json.loads(quads) if quads else [None] * len(images)
  timestamp_list = json.loads(timestamps)
  
  # 2-9. Same segmentation logic as Option 1
  # 10. Return batch results
```

**Client changes**: Client buffers 3-12 frames, then sends them together.

### Option 3: Keep Client-Side (Current)

**Simplest option**: Keep temporal voting on the client, add server-side hybrid crop only.

**Pros**:
- No server state management
- No API changes
- Works with current client code
- Lower server latency (single frame)

**Cons**:
- Can't leverage seg3.py's advanced segmentation
- Client must implement voting logic
- Network latency affects frame collection

## seg3.py Algorithm Details

For reference, here's what seg3.py does:

### 1. Split Hold at Card Changes
```python
for i in range(1, N):
  cut = embeddings[i] @ embeddings[i-1] < THRESHOLD  # 0.6
  or np.linalg.norm(centers[i] - centers[i-1]) > 0.5 * card_height
  if cut:
    segments.append([i])
  else:
    segments[-1].append(i)
```

### 2. Merge Single-Frame Splits
```python
for s in segments:
  if merged_segments:
    a = embeddings[merged[-1]].mean(0)
    b = embeddings[s].mean(0)
    if cosine_similarity(a, b) >= 0.72:
      merged[-1].extend(s)
      continue
  merged_segments.append(s)
```

### 3. Score Segments
```python
def score(segment):
  mu = embeddings[segment].mean(0)
  mu /= np.linalg.norm(mu)
  catalog_conf = max(catalog_embeddings @ mu)  # Label-free
  
  length_bonus = 0.15 * len(segment) / total_frames
  center_bonus = -0.05 * abs(mean_timestamp(segment) - hold_center) / hold_duration
  
  return catalog_conf + length_bonus + center_bonus
```

### 4. Drop Outliers
```python
mu = embeddings[segment].mean(0)
mu /= np.linalg.norm(mu)
inliers = [i for i in segment if embeddings[i] @ mu >= 0.7]
```

### 5. Find Medoid
```python
mu = embeddings[inliers].mean(0)
similarities = embeddings[inliers] @ mu
medoid_idx = inliers[np.argmax(similarities)]
```

## Recommendation

For this PR, **keep client-side voting (Option 3)** and only add:
1. ✅ Robust server-side localization (done)
2. ✅ Hybrid crop choice (done)

**Defer multi-frame server logic** to a future PR when:
- We have a use case requiring server-side segmentation
- We decide between session-based vs. batch endpoints
- We implement Redis for session storage

The hybrid crop improvement (box → localized) already delivers the 41.7% → 75% accuracy gain without needing multi-frame logic on the server.

## Testing Multi-Frame Logic (If Implemented)

If we do implement server-side multi-frame:

```python
# services/live-identity-openclip/scripts/test_multiframe.py

def test_card_change_detection():
    # Generate 10 frames of Card A, then 10 frames of Card B
    frames_a = [create_card_a() for _ in range(10)]
    frames_b = [create_card_b() for _ in range(10)]
    
    segments = split_at_card_changes(frames_a + frames_b)
    assert len(segments) == 2
    assert len(segments[0]) == 10
    assert len(segments[1]) == 10

def test_blurry_frame_merge():
    # 3 frames of Card A, 1 blurry frame (outlier), 3 more of Card A
    frames = [card_a, card_a, card_a, blur, card_a, card_a, card_a]
    segments = split_and_merge(frames)
    assert len(segments) == 1  # Merged back together

def test_medoid_selection():
    # 5 frames with varying blur
    frames = [sharp, medium, blur, sharp, medium]
    medoid = find_medoid(frames)
    assert medoid in [frames[0], frames[3]]  # One of the sharp frames
```

## References

- Client voting: `packages/shared/src/live-identity-vote.ts`
- Client scanner: `apps/mobile/lib/live-identify.ts`
- Offline eval: `seg3.py` (multi-frame segmentation prototype)
- Research: README claims +4.5pp on streams, +10pp on eBay with temporal voting
