import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardFlowNormalizedMappingResult } from '../types/catalog.js';
import type { CardFlowNormalizedRecognitionResult } from '../types/recognition.js';
import { buildCrmScan, stripPreviewCardflowId } from './build-scan.js';
import { catalogFingerprint } from './catalog-fingerprint.js';
import { mintCardflowCardId } from './mint-cardflow-card-id.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

function loadFixture<T>(filename: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, filename), 'utf-8')) as T;
}

describe('catalogFingerprint', () => {
  it('builds language:tcgdex_id fingerprint', () => {
    expect(catalogFingerprint('en', 'base1-58')).toBe('en:base1-58');
  });
});

describe('mintCardflowCardId', () => {
  it('returns a UUID v4 string', () => {
    const id = mintCardflowCardId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe('stripPreviewCardflowId', () => {
  it('nulls cardflowCardId on mapping and candidates before confirm', () => {
    const mapping = loadFixture<CardFlowNormalizedMappingResult>(
      'cardsight-to-tcgdex-mapping-example.json'
    );
    expect(mapping.cardflowCardId).not.toBeNull();

    const stripped = stripPreviewCardflowId(mapping);
    expect(stripped.cardflowCardId).toBeNull();
    expect(stripped.canonicalCard?.cardflowCardId).toBeNull();
  });
});

describe('buildCrmScan', () => {
  it('creates scan with null cardflowCardId and identity_unconfirmed', () => {
    const recognition = loadFixture<CardFlowNormalizedRecognitionResult>(
      'cardsight-high-confidence.json'
    );
    const mapping = stripPreviewCardflowId(
      loadFixture<CardFlowNormalizedMappingResult>('cardsight-to-tcgdex-mapping-example.json')
    );

    const scan = buildCrmScan({
      scanId: 'scan-1',
      userId: 'user-1',
      captureMethod: 'camera_photo',
      mimeType: 'image/jpeg',
      recognitionResult: recognition,
      mappingResult: mapping,
    });

    expect(scan.cardflowCardId).toBeNull();
    expect(scan.preInventoryState).toBe('identity_unconfirmed');
    expect(scan.mapping.proposedCardflowCardId).toBeNull();
    expect(scan.mapping.tcgdexId).toBe('base1-58');
  });
});
