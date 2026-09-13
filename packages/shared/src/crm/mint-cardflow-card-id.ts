import { randomUUID } from 'node:crypto';

/** Mint a new CardFlow canonical card id (UUID v4). Only call on user Confirm. */
export function mintCardflowCardId(): string {
  return randomUUID();
}
