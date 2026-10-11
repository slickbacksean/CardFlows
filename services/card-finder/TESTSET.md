# Frozen real-photo test set (step 1)

This set is for scoring only. Nothing in it is ever used for training, tuning
thresholds, or picking checkpoints. Sean's 25 earlier shots (`baseline/`) are the
baseline set, not the test set.

## Target

- 300+ phone photos, half fronts and half backs, of 60+ different physical cards.
- Grouped into capture sessions. A session is one background + one light + one phone.
- Splits are by card and by session, never by photo, so a card or session seen in a
  dev or training set never appears here.
- Plus a repeatability subset: 20 cards x 5 shots each (same card, re-placed each time).

## Shot list for Sean (about 400 photos, 6 sessions + repeatability)

Pick 60 cards before you start, and keep them in one stack in this order:

- 30 regular cards with a yellow or silver border (the most common kind)
- 10 holo or reverse-holo cards (shiny)
- 10 full-art or borderless cards (art goes to the edge). If you have fewer, use what you have and tell me
- 5 Japanese cards, if you have any (otherwise more regular cards)
- 5 cards with visible wear: whitening on an edge, a bent corner, a crease

For each session, use 25 cards from the stack (rotate so all 60 get used), and take
**one front photo and one back photo** of each: 50 photos per session.
Use the CardFlow Grade camera when it opens, or the normal phone camera.

| Session | Background | Light | Holder | Phone angle | Phone |
|---|---|---|---|---|---|
| S1 | Dark mat (your usual) | Room light | Raw card | Straight overhead | iPhone |
| S2 | Light wood or white table | Daylight from a window | Raw card | Tilt 10 to 20° | iPhone |
| S3 | Laptop or grey desk | Desk lamp to one side | Penny sleeve | Overhead to 10° | iPhone |
| S4 | Busy surface: binder page, playmat, or patterned cloth | Overhead room light (some glare is fine) | Toploader | Overhead to 15° | Android, or a second iPhone |
| S5 | Held in your hand, background is the room | Any | Raw or sleeve | Whatever is natural | Android, or a second iPhone |
| S6 | Dark mat | Lamp close, low angle | Raw card | Tilt 20 to 30° on purpose | Second Android, if you can borrow one |

Repeatability (S7): pick 20 cards (include 4 full-art and 4 backs). Photograph each
card 5 times on the dark mat. Pick it up and put it back down between shots.
That's 100 photos.

Rules for every photo:

- The whole card must be in the photo, with at least a finger-width of space around it.
- One card per photo.
- No need to make it perfect. Blurry, tilted, or glary shots are useful, so keep them.
  Only retake if a corner is cut off.
- Don't crop or edit the photos.

How to hand them over: one folder per session, named S1 to S7, with the photos
straight from the phone (AirDrop to the Mac into `~/CardFlows-testset/S1/` and so on).
If you know the set and number of a card, a note helps, but it isn't required.

Phones: the plan asks for 2 iPhones and 2 Androids. If you only have one phone,
do all sessions on it and we'll report that as a known gap.

## Labels (done for you)

Each photo gets: 4 corner points, card id, side (front/back), finish
(bordered/holo/full-art/japanese), background, holder, device, session.
Corners use the **virtual corner** convention: the intersection of the two straight
card edges, outside the rounded corner. `label_assist.py` snaps rough clicks to the
edges and writes zoomed corner sheets for an eye check.

Later for condition (step 5): a flatbed scan of 20 of the cards gives centering truth.

## Manifest format

One JSON object per line:

```json
{"image": "photos/test/S1/IMG_0001.jpg", "corners": [[x,y],[x,y],[x,y],[x,y]],
 "card": "sv3pt5-25", "side": "front", "finish": "holo", "background": "dark-mat",
 "holder": "raw", "device": "iphone-15", "session": "S1", "label_method": "..."}
```

Photos stay out of git (`photos/` is ignored). The manifest is committed and frozen;
any change to it needs a new version file (`test/manifest.v2.jsonl`).
