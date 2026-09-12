import type { CardFlowNormalizedMappingResult, CardFlowNormalizedRecognitionResult, MaxBuyResult } from '@cardflows/shared';
import { API_BASE_URL } from '../config';

export async function fetchHealth(): Promise<{ ok: boolean; provider: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return response.json() as Promise<{ ok: boolean; provider: string }>;
}

export async function computeMaxBuy(input: {
  referencePriceAmount: string | null;
  condition: string | null;
}): Promise<{ ok: boolean; maxBuy: MaxBuyResult; uiCopy: { display: string } }> {
  const response = await fetch(`${API_BASE_URL}/v1/max-buy/compute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json() as Promise<{ ok: boolean; maxBuy: MaxBuyResult; uiCopy: { display: string } }>;
}

export async function mapRecognition(input: {
  language: string | null;
  setName: string | null;
  number: string | null;
  name: string | null;
  vendorCardId: string | null;
}): Promise<CardFlowNormalizedMappingResult> {
  const response = await fetch(`${API_BASE_URL}/v1/catalog/map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json() as Promise<CardFlowNormalizedMappingResult>;
}

export async function identifyCardMock(): Promise<CardFlowNormalizedRecognitionResult> {
  const formData = new FormData();
  formData.append('mimeType', 'image/jpeg');
  formData.append('image', new Blob(['mock'], { type: 'image/jpeg' }), 'scan.jpg');

  const response = await fetch(`${API_BASE_URL}/v1/identify`, {
    method: 'POST',
    body: formData,
  });
  return response.json() as Promise<CardFlowNormalizedRecognitionResult>;
}
