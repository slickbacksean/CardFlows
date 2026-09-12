/** Confidence bands align with CardSight OpenAPI: High|Medium|Low */
export type RecognitionConfidence = 'High' | 'Medium' | 'Low';

export type MatchLevel = 'exact' | 'set' | 'none';

export interface RecognitionField {
  key: string;
  value: string;
}

export interface RecognitionCandidate {
  vendorCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  language: string | null;
  fields: RecognitionField[];
  /** Optional rank hint for UI (0 = best) */
  rank?: number;
}

export interface RecognitionDetection {
  confidence: RecognitionConfidence | null;
  matchLevel: MatchLevel;
  vendorCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  language: string | null;
  fields: RecognitionField[];
  /** Medium/Low: suggestions mapped into candidates */
  candidates: RecognitionCandidate[];
}

export interface RecognitionError {
  code:
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'RATE_LIMITED'
    | 'PROVIDER_AUTH'
    | 'BAD_REQUEST'
    | 'NOT_FOUND'
    | 'FEATURE_DISABLED'
    | 'QUOTA_EXCEEDED'
    | 'UNKNOWN';
  httpStatus?: number;
  message: string;
  retryable: boolean;
}

export interface FixtureMeta {
  mocked?: boolean;
  description?: string;
}

export interface CardFlowNormalizedRecognitionResult {
  provider: 'cardsight' | 'mock';
  ok: boolean;
  vendorRequestId: string | null;
  processingTimeMs: number | null;
  detections: RecognitionDetection[];
  error: RecognitionError | null;
  _meta?: FixtureMeta;
}

export interface IdentifyCardRequest {
  /** Decoded image bytes (server already received upload from client) */
  image: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Optional segment UUID | name | shortname for /v1/identify/card/{segment} */
  segment?: string;
  /** Client correlation id — not a vendor secret */
  clientRequestId?: string;
}

export interface CardRecognitionProvider {
  readonly name: 'cardsight' | 'mock';
  identifyCard(req: IdentifyCardRequest): Promise<CardFlowNormalizedRecognitionResult>;
  checkSetIdentifiable?(setId: string): Promise<{ setId: string; isIdentifiable: boolean }>;
}
