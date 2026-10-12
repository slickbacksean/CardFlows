/** JSON routes other than livestream identify. */
export const JSON_BODY_MAX_BYTES = 64 * 1024;

/** Livestream identify posts a crop. Larger stills use the scan and grade routes. */
export const LIVESTREAM_IDENTIFY_BODY_MAX_BYTES = 1024 * 1024;

/**
 * Whole-request cap on the grading routes (checked before multipart parsing, so a huge
 * upload is refused instead of buffered). Sized for a full-resolution quality-1 front+back
 * pair (each typically 8-15 MB on 48 MP phones) plus form overhead, and stays under
 * Cloud Run's 32 MiB HTTP/1 limit. Each image is still capped at 20 MB on its own.
 */
export const GRADE_ROUTE_BODY_MAX_BYTES = 31 * 1024 * 1024;
