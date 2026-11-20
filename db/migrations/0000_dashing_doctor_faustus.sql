CREATE TYPE "public"."actor_type" AS ENUM('patient', 'member', 'platform_admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."appointment_source" AS ENUM('online', 'staff');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."cancelled_by" AS ENUM('patient', 'staff');--> statement-breakpoint
CREATE TYPE "public"."clinic_role" AS ENUM('clinic_owner', 'clinic_staff');--> statement-breakpoint
CREATE TYPE "public"."clinic_status" AS ENUM('trial', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."clinic_type" AS ENUM('dental');--> statement-breakpoint
CREATE TYPE "public"."override_type" AS ENUM('closed', 'custom_hours');--> statement-breakpoint
CREATE TABLE "clinics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"address_en" text,
	"address_ar" text,
	"phone" text,
	"maps_url" text,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"clinic_type" "clinic_type" DEFAULT 'dental' NOT NULL,
	"status" "clinic_status" DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"booking_enabled" boolean DEFAULT false NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"min_lead_minutes" integer DEFAULT 120 NOT NULL,
	"max_horizon_days" integer DEFAULT 60 NOT NULL,
	"change_cutoff_minutes" integer DEFAULT 120 NOT NULL,
	"slot_granularity_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinics_slug_format" CHECK ("clinics"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "clinics_buffer_range" CHECK ("clinics"."buffer_minutes" BETWEEN 0 AND 120),
	CONSTRAINT "clinics_lead_range" CHECK ("clinics"."min_lead_minutes" BETWEEN 0 AND 20160),
	CONSTRAINT "clinics_horizon_range" CHECK ("clinics"."max_horizon_days" BETWEEN 1 AND 365),
	CONSTRAINT "clinics_cutoff_range" CHECK ("clinics"."change_cutoff_minutes" BETWEEN 0 AND 20160),
	CONSTRAINT "clinics_granularity_allowed" CHECK ("clinics"."slot_granularity_minutes" IN (5, 10, 15, 20, 30, 60))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "clinics_slug_key" ON "clinics" USING btree ("slug");