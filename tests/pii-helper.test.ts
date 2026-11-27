/**
 * Regression for the flaky privacy assertions: audit metadata is full of random
 * UUIDs, and a bare "966" check failed whenever one contained those digits.
 */
import { describe, expect, it } from "vitest";
import { expectNoPii } from "./helpers/pii";

describe("expectNoPii", () => {
  it("does not trip on ids that happen to contain 966", () => {
    const metadata = { patientId: "0a966f1e-9669-4966-8966-966966966966", startAt: "2027-01-03T06:30:00.000Z" };
    expect(() => expectNoPii(metadata, "Noura")).not.toThrow();
  });

  it("still catches a name or a phone number in any common spelling", () => {
    expect(() => expectNoPii({ note: "Noura Ali" }, "Noura")).toThrow();
    expect(() => expectNoPii({ p: "+966512345678" }, "Noura")).toThrow();
    expect(() => expectNoPii({ p: "00966512345678" }, "Noura")).toThrow();
    expect(() => expectNoPii({ p: "966512345678" }, "Noura")).toThrow();
    expect(() => expectNoPii({ p: "0512345678" }, "Noura")).toThrow();
  });
});
