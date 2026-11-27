import { expect } from "vitest";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Audit metadata must hold ids and times only, never a patient's name or phone
 * (scope §8). Match the name and a full Saudi number in any spelling.
 *
 * Ids are stripped first and the number is matched whole. The old check was a
 * bare /966/, and the ids in the metadata are random UUIDs: roughly 1 run in 60
 * per assertion contained those three digits by chance, which made four of
 * these assertions flaky.
 */
export function expectNoPii(metadata: unknown, name: string) {
  const json = JSON.stringify(metadata).replace(UUID, "<id>");
  expect(json).not.toContain(name);
  expect(json).not.toMatch(/(\+|00)?966\d{9}|\b05\d{8}\b/);
}
