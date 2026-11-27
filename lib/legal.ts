/**
 * The privacy notice's and terms' section order. The words live in
 * messages/<locale>.json (Legal.<doc>.sections.<key>); tests/legal.test.ts
 * checks that every key listed here exists in both languages.
 */
export const LEGAL_SECTIONS = {
  privacy: ["who", "what", "why", "notCollected", "whoSees", "where", "howLong", "rights", "abuse", "cookies", "changes"],
  terms: ["service", "booking", "payment", "noAdvice", "clinics", "availability", "privacy", "changes"],
} as const;

export type LegalDoc = keyof typeof LEGAL_SECTIONS;
