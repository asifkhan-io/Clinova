import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------- enums ------------------------------- */

export const clinicStatusEnum = pgEnum("clinic_status", [
  "trial",
  "active",
  "suspended",
]);
export const clinicTypeEnum = pgEnum("clinic_type", ["dental"]);
export const clinicRoleEnum = pgEnum("clinic_role", [
  "clinic_owner",
  "clinic_staff",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", [
  "booked",
  "completed",
  "cancelled",
  "no_show",
]);
export const appointmentSourceEnum = pgEnum("appointment_source", [
  "online",
  "staff",
]);
export const cancelledByEnum = pgEnum("cancelled_by", ["patient", "staff"]);

export const overrideTypeEnum = pgEnum("override_type", [
  "closed",
  "custom_hours",
]);
export const actorTypeEnum = pgEnum("actor_type", [
  "patient",
  "member",
  "platform_admin",
  "system",
]);

/* --------------------------- clinics: tenant root --------------------------- */

export const clinics = pgTable(
  "clinics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),

    // Bilingual data, not just a bilingual UI.
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    addressEn: text("address_en"),
    addressAr: text("address_ar"),
    phone: text("phone"),
    mapsUrl: text("maps_url"),

    // Scheduling identity. Timestamps are UTC everywhere; this is how we get back
    // to local time for slot generation.
    timezone: text("timezone").notNull().default("Asia/Riyadh"), // IANA name
    clinicType: clinicTypeEnum("clinic_type").notNull().default("dental"),

    // Commercial state — the v1 billing lever, checked in the auth layer.
    status: clinicStatusEnum("status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

    // The clinic's own switch, separate from our commercial one.
    bookingEnabled: boolean("booking_enabled").notNull().default(false),

    // Booking rules. Five integers do not justify a settings table, and a
    // key-value table would lose the checks below — which are the only thing
    // stopping a typo from emptying a clinic's calendar.
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    minLeadMinutes: integer("min_lead_minutes").notNull().default(120),
    maxHorizonDays: integer("max_horizon_days").notNull().default(60),
    changeCutoffMinutes: integer("change_cutoff_minutes")
      .notNull()
      .default(120),
    slotGranularityMinutes: integer("slot_granularity_minutes")
      .notNull()
      .default(15),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("clinics_slug_key").on(t.slug),
    check("clinics_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("clinics_buffer_range", sql`${t.bufferMinutes} BETWEEN 0 AND 120`),
    check("clinics_lead_range", sql`${t.minLeadMinutes} BETWEEN 0 AND 20160`),
    check("clinics_horizon_range", sql`${t.maxHorizonDays} BETWEEN 1 AND 365`),
    check(
      "clinics_cutoff_range",
      sql`${t.changeCutoffMinutes} BETWEEN 0 AND 20160`,
    ),
    check(
      "clinics_granularity_allowed",
      sql`${t.slotGranularityMinutes} IN (5, 10, 15, 20, 30, 60)`,
    ),
  ],
);
