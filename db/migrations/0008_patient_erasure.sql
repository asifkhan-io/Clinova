DROP INDEX "patients_clinic_phone_key";--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_phone_key" ON "patients" USING btree ("clinic_id","phone_e164") WHERE "patients"."anonymized_at" IS NULL;