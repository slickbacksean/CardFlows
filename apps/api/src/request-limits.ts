/** JSON routes other than livestream identify. */
export const JSON_BODY_MAX_BYTES = 64 * 1024;

/** Livestream identify posts a crop. Larger stills use the scan and grade routes. */
export const LIVESTREAM_IDENTIFY_BODY_MAX_BYTES = 1024 * 1024;

/**
 * Whole-request cap on the grading routes (checked before multipart parsing, so a huge
 * upload is refused instead of buffered). Phone-side prep (P0-02) sends JPEG at most
 * 4032 px on the long edge at quality 0.8, typically 1–3 MB per still. 22 MB covers a
 * pair plus form overhead and stays under Cloud Run's 32 MiB HTTP/1 limit. Each image
 * is still capped at 20 MB on its own. The API then reads width/height from the image
 * header and rejects anything over 4032 px without decoding pixels.
 */
export const GRADE_ROUTE_BODY_MAX_BYTES = 22 * 1024 * 1024;
