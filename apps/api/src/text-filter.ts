/**
 * Sean (Oct 25): Community text filter for profanity, slurs, links, and phone numbers.
 * Used for usernames, display names (future), and comments (v2).
 */

// Basic profanity and slur list (Apple guideline 1.2 requirement)
const BLOCKED_PATTERNS = [
  // Profanity
  /\b(fuck|shit|ass|bitch|damn|crap|piss|cock|dick|pussy|cunt|bastard|slut|whore)\w*/gi,
  // Slurs and offensive terms (basic set)
  /\b(nigga|nigger|fag|faggot|retard|tranny|chink|spic|kike|wetback)\w*/gi,
  // Scam/spam keywords
  /\b(click here|buy now|limited time|act now|call now)\b/gi,
  // URLs and links
  /https?:\/\//gi,
  /www\./gi,
  /\b[a-z0-9]+\.(com|net|org|io|co|app|xyz)\b/gi,
  // Phone numbers
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/g,
  // Email-like patterns
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
];

export interface FilterResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Filter text for profanity, slurs, links, and phone numbers.
 * Returns { allowed: false, reason } if blocked.
 */
export function filterText(text: string): FilterResult {
  if (!text || text.trim().length === 0) {
    return { allowed: false, reason: "Text cannot be empty" };
  }

  const trimmed = text.trim();

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: "That can't be posted. Remove links or offensive words.",
      };
    }
  }

  return { allowed: true };
}

/**
 * Validate username: 3-20 characters, letters/numbers/underscore only,
 * and passes the text filter.
 */
export function validateUsername(username: string): FilterResult {
  if (!username || username.trim().length === 0) {
    return { allowed: false, reason: "Username cannot be empty" };
  }

  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return { allowed: false, reason: "Username must be at least 3 characters" };
  }

  if (trimmed.length > 20) {
    return { allowed: false, reason: "Username must be 20 characters or less" };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return {
      allowed: false,
      reason: "Username can only contain letters, numbers, and underscores",
    };
  }

  // Also check the text filter
  const filterResult = filterText(trimmed);
  if (!filterResult.allowed) {
    return { allowed: false, reason: "Username contains inappropriate content" };
  }

  return { allowed: true };
}

/**
 * Validate comment text: max 280 characters, passes text filter.
 */
export function validateCommentText(text: string): FilterResult {
  if (!text || text.trim().length === 0) {
    return { allowed: false, reason: "Comment cannot be empty" };
  }

  const trimmed = text.trim();

  if (trimmed.length > 280) {
    return { allowed: false, reason: "Comment must be 280 characters or less" };
  }

  return filterText(trimmed);
}
