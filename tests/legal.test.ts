/**
 * Week 3: the privacy notice and terms. Their section order lives in
 * lib/legal.ts; their words live in the translation files.
 * A section listed there but missing in either language would render a raw
 * key on a public page, so it fails here instead.
 */
import { describe, expect, it } from "vitest";
import { LEGAL_SECTIONS } from "@/lib/legal";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";

type Section = { title: string; body: string };
type Doc = { title: string; intro: string; sections: Record<string, Section> };

describe("legal pages", () => {
  for (const [name, messages] of [["en", en], ["ar", ar]] as const) {
    for (const [doc, keys] of Object.entries(LEGAL_SECTIONS)) {
      it(`${name}: ${doc} has every section, and nothing extra`, () => {
        const d = (messages.Legal as unknown as Record<string, Doc>)[doc]!;
        expect(d.title.trim()).not.toBe("");
        expect(Object.keys(d.sections).sort()).toEqual([...keys].sort());
        for (const k of keys) {
          expect(d.sections[k]!.title.trim()).not.toBe("");
          expect(d.sections[k]!.body.trim()).not.toBe("");
        }
      });
    }
  }
});
