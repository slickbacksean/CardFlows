import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardFlowNormalizedMappingResult } from '@cardflows/shared';
import type { CardFlowNormalizedRecognitionResult } from '@cardflows/shared';
import type { TcgdexCard } from '@cardflows/shared';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../shared/fixtures');

export function loadFixture<T>(filename: string): T {
  const raw = JSON.parse(readFileSync(join(fixturesDir, filename), 'utf-8')) as T & {
    _meta?: { mocked?: boolean };
  };
  if (!raw._meta?.mocked) {
    throw new Error(`Fixture ${filename} is missing _meta.mocked === true`);
  }
  return raw;
}

export const cardsightFixtures = {
  highConfidence: () =>
    loadFixture<CardFlowNormalizedRecognitionResult>('cardsight-high-confidence.json'),
  ambiguous: () => loadFixture<CardFlowNormalizedRecognitionResult>('cardsight-ambiguous-match.json'),
  noCard: () => loadFixture<CardFlowNormalizedRecognitionResult>('cardsight-no-card-detected.json'),
  providerError: () =>
    loadFixture<CardFlowNormalizedRecognitionResult>('cardsight-provider-error.json'),
  rateLimit: () => loadFixture<CardFlowNormalizedRecognitionResult>('cardsight-rate-limit.json'),
};

export const tcgdexFixtures = {
  card: () => loadFixture<{ card: TcgdexCard }>('tcgdex-card-example.json'),
  highMap: () => loadFixture<CardFlowNormalizedMappingResult>('cardsight-to-tcgdex-mapping-example.json'),
  noMatch: () => loadFixture<CardFlowNormalizedMappingResult>('tcgdex-no-match-example.json'),
  ambiguous: () => loadFixture<CardFlowNormalizedMappingResult>('tcgdex-ambiguous-match-example.json'),
};
