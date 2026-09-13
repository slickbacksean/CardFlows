import type { TcgdexLanguage } from '../types/catalog.js';

export function catalogFingerprint(language: TcgdexLanguage, tcgdexId: string): string {
  return `${language}:${tcgdexId}`;
}
