import type {
  CardFlowCanonicalCard,
  CardFlowNormalizedMappingResult,
  CardFlowNormalizedRecognitionResult,
  ConfirmScanRequest,
  CrmConfirmation,
  CrmScan,
  MaxBuyResult,
  PregradeDefectInput,
  PregradeEstimate,
} from '@cardflows/shared';
import { Platform } from 'react-native';
import { API_BASE_URL } from '../config';
import type { GradingPhoto } from '../grading/photos';

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

export async function identifyCard(
  imageUri: string,
  provenance: 'user_capture' | 'catalog_art'
): Promise<CardFlowNormalizedRecognitionResult> {
  const formData = new FormData();
  
  const filename = imageUri.split('/').pop() || 'card.jpg';
  const match = /\.(\w+)$/.exec(filename);
  const extension = match ? match[1].toLowerCase() : 'jpg';
  
  let mimeType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg';
  if (extension === 'png') {
    mimeType = 'image/png';
  } else if (extension === 'webp') {
    mimeType = 'image/webp';
  }

  formData.append('mimeType', mimeType);
  formData.append('provenance', provenance);
  formData.append('image', {
    uri: imageUri,
    name: filename,
    type: mimeType,
  } as any);

  const response = await fetch(`${API_BASE_URL}/v1/identify`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to identify card: ${response.statusText}`);
  }

  return response.json() as Promise<CardFlowNormalizedRecognitionResult>;
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

export interface CreateScanInput {
  uri: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  captureMethod: 'camera_photo' | 'photo_library';
  cardsightScenario?: string;
  mapperScenario?: string;
}

export async function createScan(input: CreateScanInput): Promise<{ ok: boolean; scan: CrmScan }> {
  const formData = new FormData();
  formData.append('mimeType', input.mimeType);
  formData.append('captureMethod', input.captureMethod);
  if (input.cardsightScenario) {
    formData.append('cardsightScenario', input.cardsightScenario);
  }
  if (input.mapperScenario) {
    formData.append('mapperScenario', input.mapperScenario);
  }

  const filename = input.mimeType === 'image/png' ? 'scan.png' : 'scan.jpg';
  formData.append('image', {
    uri: input.uri,
    name: filename,
    type: input.mimeType,
  } as unknown as Blob);

  const response = await fetch(`${API_BASE_URL}/v1/scans`, {
    method: 'POST',
    body: formData,
  });
  return response.json() as Promise<{ ok: boolean; scan: CrmScan }>;
}

export async function getScan(scanId: string): Promise<{ ok: boolean; scan: CrmScan }> {
  const response = await fetch(`${API_BASE_URL}/v1/scans/${scanId}`);
  return response.json() as Promise<{ ok: boolean; scan: CrmScan }>;
}

export async function confirmScan(
  scanId: string,
  body: ConfirmScanRequest
): Promise<{ ok: boolean; confirmation: CrmConfirmation }> {
  const response = await fetch(`${API_BASE_URL}/v1/scans/${scanId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<{ ok: boolean; confirmation: CrmConfirmation }>;
}

export async function rejectScan(scanId: string): Promise<{ ok: boolean; scan: CrmScan }> {
  const response = await fetch(`${API_BASE_URL}/v1/scans/${scanId}/reject`, {
    method: 'POST',
  });
  return response.json() as Promise<{ ok: boolean; scan: CrmScan }>;
}

export async function searchCatalog(input: {
  setName?: string;
  localId?: string;
  name?: string;
  tcgdexId?: string;
}): Promise<{ ok: boolean; candidates: CardFlowCanonicalCard[] }> {
  const params = new URLSearchParams({ language: 'en' });
  if (input.setName) params.set('setName', input.setName);
  if (input.localId) params.set('localId', input.localId);
  if (input.name) params.set('name', input.name);
  if (input.tcgdexId) params.set('tcgdexId', input.tcgdexId);

  const response = await fetch(`${API_BASE_URL}/v1/catalog/search?${params.toString()}`);
  return response.json() as Promise<{ ok: boolean; candidates: CardFlowCanonicalCard[] }>;
}

export type PregradeSuccess = { ok: true } & PregradeEstimate;

export interface PregradeNeedsDefects {
  ok: false;
  code: 'NEEDS_DEFECTS';
  message: string;
}

export interface PregradePhotoRetake {
  ok: false;
  code: 'PHOTO_RETAKE';
  side: 'front' | 'back';
  reasons: string[];
}

export type PregradeResponse = PregradeSuccess | PregradeNeedsDefects | PregradePhotoRetake;

async function appendPhoto(form: FormData, field: 'front' | 'back', photo: GradingPhoto) {
  if (Platform.OS === 'web') {
    const response = await fetch(photo.uri);
    const blob = await response.blob();
    const file = new File([blob], photo.fileName, { type: photo.mimeType });
    form.append(field, file);
    return;
  }

  form.append(field, {
    uri: photo.uri,
    name: photo.fileName,
    type: photo.mimeType,
  } as unknown as Blob);
}

export async function submitPregrade(input: {
  front: GradingPhoto;
  back: GradingPhoto;
  defects: PregradeDefectInput[];
}): Promise<PregradeResponse> {
  const form = new FormData();
  await appendPhoto(form, 'front', input.front);
  await appendPhoto(form, 'back', input.back);
  form.append('defects', JSON.stringify(input.defects));

  const response = await fetch(`${API_BASE_URL}/api/v1/grading/pregrade`, {
    method: 'POST',
    body: form,
  });

  const body = (await response.json()) as PregradeResponse;
  return body;
}
