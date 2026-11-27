ALTER TABLE "clinics" ALTER COLUMN "name_ar" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "name_ar" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "display_name_ar" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "country" text DEFAULT 'SA' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD CONSTRAINT "clinics_country_format" CHECK ("clinics"."country" ~ '^[A-Z]{2}$');