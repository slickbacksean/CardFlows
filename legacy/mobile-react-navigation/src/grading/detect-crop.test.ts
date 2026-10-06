import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canConfirmDetectedCrop,
  cropToDataUri,
  parseDetectCropRetake,
  parseDetectCropSuccess,
  parseDetectCropUnavailable,
  shouldRequestPhotoGradeAfterConfirm,
} from './detect-crop.ts';

describe('parseDetectCropSuccess', () => {
  it('builds a data URI from the detected crop and does not invent a grade', () => {
    const parsed = parseDetectCropSuccess({
      ok: true,
      side: 'front',
      crop: { mimeType: 'image/jpeg', base64: 'abc' },
      warnings: ['Glare detected'],
      estimate: 10,
    });
    assert.deepEqual(parsed, {
      ok: true,
      side: 'front',
      cropUri: 'data:image/jpeg;base64,abc',
      warnings: ['Glare detected'],
    });
    assert.equal(parsed && 'estimate' in parsed, false);
  });

  it('rejects a success body with no crop bytes', () => {
    assert.equal(parseDetectCropSuccess({ ok: true, side: 'front', crop: { mimeType: 'image/jpeg' } }), null);
  });
});

describe('parseDetectCropRetake', () => {
  it('keeps PHOTO_RETAKE on the crop with no score', () => {
    const parsed = parseDetectCropRetake({
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'back',
      reasons: ['Card not found'],
      crop: { mimeType: 'image/jpeg', base64: 'xyz' },
    });
    assert.deepEqual(parsed, {
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'back',
      reasons: ['Card not found'],
      cropUri: 'data:image/jpeg;base64,xyz',
    });
    assert.equal(parsed && 'estimate' in parsed, false);
  });
});

describe('parseDetectCropUnavailable', () => {
  it('returns the server message and no crop', () => {
    const parsed = parseDetectCropUnavailable({
      ok: false,
      code: 'UNAVAILABLE',
      message: 'Card detection is not available.',
    });
    assert.deepEqual(parsed, {
      ok: false,
      code: 'UNAVAILABLE',
      message: 'Card detection is not available.',
    });
  });
});

describe('crop helpers', () => {
  it('returns undefined for empty crop bytes', () => {
    assert.equal(cropToDataUri({ mimeType: 'image/jpeg', base64: '' }), undefined);
  });

  it('only confirms after a successful detection', () => {
    assert.equal(canConfirmDetectedCrop(true, [], []), true);
    assert.equal(canConfirmDetectedCrop(false, [], []), false);
    assert.equal(canConfirmDetectedCrop(undefined, [], []), false);
    assert.equal(canConfirmDetectedCrop(true, ['Use a JPEG, PNG, or WebP photo.'], []), false);
    assert.equal(canConfirmDetectedCrop(true, [], ['Card not found']), false);
  });

  it('requests a photo pre-grade only after both crops are confirmed', () => {
    assert.equal(shouldRequestPhotoGradeAfterConfirm('front', true, false), false);
    assert.equal(shouldRequestPhotoGradeAfterConfirm('back', true, true), true);
    assert.equal(shouldRequestPhotoGradeAfterConfirm('front', true, true), true);
    assert.equal(shouldRequestPhotoGradeAfterConfirm('back', false, true), false);
  });
});
