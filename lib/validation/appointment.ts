import { z } from "zod";
import type { CountryCode } from "@/lib/countries";
import { phoneFieldFor } from "./booking";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** 24-hour wall-clock time in the clinic's zone, as <input type="time"> sends it. */
const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const when = { serviceId: z.uuid(), staffId: z.uuid(), date: isoDate, time: wallTime };

/** Manual booking by staff (scope §4). Phones are read in the clinic's country. */
export const staffBookingSchemaFor = (country: CountryCode) =>
  z.object({
    ...when,
    fullName: z.string().trim().min(2).max(100),
    phone: phoneFieldFor(country),
  });

export const staffRescheduleSchema = z.object({
  ...when,
  appointmentId: z.uuid(),
  expectedSequence: z.coerce.number().int().min(0),
});

export const patientEditSchemaFor = (country: CountryCode) =>
  z.object({
    patientId: z.uuid(),
    fullName: z.string().trim().min(2).max(100),
    phone: phoneFieldFor(country),
  });
