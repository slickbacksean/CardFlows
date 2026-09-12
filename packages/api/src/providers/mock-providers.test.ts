import { describe, expect, it } from 'vitest';
import { cardsightFixtures, tcgdexFixtures } from '../fixtures.js';
import { MockCardIdentityMapper } from './mock-card-identity-mapper.js';
import { MockCardRecognitionProvider } from './mock-card-recognition-provider.js';
import { MockTcgdexCatalogProvider } from './mock-tcgdex-catalog-provider.js';

describe('MockCardRecognitionProvider', () => {
  it('loads cardsight fixtures with _meta.mocked === true', () => {
    const fixture = cardsightFixtures.highConfidence();
    expect(fixture._meta?.mocked).toBe(true);
    expect(fixture.provider).toBe('mock');
    expect(fixture.ok).toBe(true);
    expect(fixture.detections[0]?.vendorCardId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('returns high-confidence fixture by default', async () => {
    const provider = new MockCardRecognitionProvider('high-confidence');
    const result = await provider.identifyCard({
      image: Buffer.from('test'),
      mimeType: 'image/jpeg',
    });
    expect(result._meta?.mocked).toBe(true);
    expect(result.detections[0]?.name).toBe('Pikachu');
  });

  it('returns ambiguous fixture for ambiguous scenario', async () => {
    const provider = new MockCardRecognitionProvider('ambiguous');
    const result = await provider.identifyCard({
      image: Buffer.from('test'),
      mimeType: 'image/jpeg',
    });
    expect(result._meta?.mocked).toBe(true);
    expect(result.detections[0]?.name).toBe('Charizard');
    expect(result.detections[0]?.candidates.length).toBeGreaterThan(0);
  });

  it('returns provider error fixture', async () => {
    const provider = new MockCardRecognitionProvider('error');
    const result = await provider.identifyCard({
      image: Buffer.from('test'),
      mimeType: 'image/jpeg',
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('PROVIDER_TIMEOUT');
  });
});

describe('MockTcgdexCatalogProvider', () => {
  it('loads tcgdex card fixture with _meta.mocked === true', () => {
    const fixture = tcgdexFixtures.card();
    expect(fixture._meta?.mocked).toBe(true);
    expect(fixture.card.id).toBe('swsh3-136');
    expect(fixture.card).not.toHaveProperty('pricing');
  });

  it('resolves Base Set Pikachu by set and localId', async () => {
    const provider = new MockTcgdexCatalogProvider('high-map');
    const card = await provider.getCardBySetAndLocalId('base1', '58', 'en');
    expect(card?.id).toBe('base1-58');
    expect(card?.name).toBe('Pikachu');
  });
});

describe('MockCardIdentityMapper', () => {
  it('maps high-confidence recognition to tcgdx id base1-58', async () => {
    const mapper = new MockCardIdentityMapper('high-map');
    const result = await mapper.mapRecognitionToCatalog({
      language: 'en',
      setName: 'Base Set',
      number: '58',
      name: 'Pikachu',
      vendorCardId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });

    expect(result._meta?.mocked).toBe(true);
    expect(result.status).toBe('matched');
    expect(result.tcgdexId).toBe('base1-58');
    expect(result.cardsightCardId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result.cardflowCardId).toBe('7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58');
  });

  it('never maps on name alone', async () => {
    const mapper = new MockCardIdentityMapper('high-map');
    const result = await mapper.mapRecognitionToCatalog({
      language: 'en',
      setName: null,
      number: null,
      name: 'Charizard',
      vendorCardId: null,
    });

    expect(result._meta?.mocked).toBe(true);
    expect(result.status).toBe('ambiguous');
    expect(result.tcgdexId).toBeNull();
    expect(result.candidates.length).toBe(3);
  });

  it('returns no_match for unresolvable set', async () => {
    const mapper = new MockCardIdentityMapper('no-match');
    const result = await mapper.mapRecognitionToCatalog({
      language: 'en',
      setName: 'Unknown Promo Binder',
      number: '999',
      name: 'Pikachu',
      vendorCardId: 'e5f6a7b8-c9d0-4123-89ab-cdef01234567',
    });

    expect(result._meta?.mocked).toBe(true);
    expect(result.status).toBe('no_match');
    expect(result.tcgdexId).toBeNull();
    expect(result.cardflowCardId).toBeNull();
  });

  it('keeps cardflow_card_id, tcgdex_id, and cardsight_card_id separate', async () => {
    const fixture = tcgdexFixtures.highMap();
    expect(fixture.tcgdexId).toBe('base1-58');
    expect(fixture.cardsightCardId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(fixture.cardflowCardId).toBe('7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58');
    expect(fixture.tcgdexId).not.toBe(fixture.cardsightCardId);
  });
});
