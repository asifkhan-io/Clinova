/**
 * Guards for the translation files, so a missing Arabic string or a stray
 * Arabic-Indic digit is a failed test, not something a patient finds.
 */
import { describe, expect, it } from "vitest";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";

type Tree = { [k: string]: string | Tree };
const flatten = (tree: Tree, prefix = ""): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});

const enFlat = flatten(en as Tree);
const arFlat = flatten(ar as Tree);

describe("translation files", () => {
  it("have exactly the same keys in English and Arabic", () => {
    expect(Object.keys(arFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it("have no empty strings", () => {
    const empty = [...Object.entries(enFlat), ...Object.entries(arFlat)].filter(([, v]) => v.trim() === "");
    expect(empty).toEqual([]);
  });

  it("use Latin digits only — Arabic-Indic digits (٠-٩) are banned (user-flows §10)", () => {
    const offenders = Object.entries(arFlat).filter(([, v]) => /[٠-٩۰-۹]/.test(v));
    expect(offenders).toEqual([]);
  });

  it("keep the same {placeholders} in both languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    const mismatched = Object.keys(enFlat).filter((k) => JSON.stringify(vars(enFlat[k]!)) !== JSON.stringify(vars(arFlat[k] ?? "")));
    expect(mismatched).toEqual([]);
  });
});
