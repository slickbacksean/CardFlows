/** JSON routes other than livestream identify. */
export const JSON_BODY_MAX_BYTES = 64 * 1024;

/** Livestream identify posts a crop. Larger stills use the scan and grade routes. */
export const LIVESTREAM_IDENTIFY_BODY_MAX_BYTES = 1024 * 1024;

/**
 * Whole-request cap on the grading routes (checked before multipart parsing, so a huge
 * upload is refused instead of buffered). Fits one 20 MB photo or a resized front+back
 * pair plus form overhead, and stays under Cloud Run's 32 MiB HTTP/1 limit.
 */
export const GRADE_ROUTE_BODY_MAX_BYTES = 22 * 1024 * 1024;
