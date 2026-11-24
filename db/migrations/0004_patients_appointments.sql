-- Reordered by hand: composite FKs need the (clinic_id, id) unique indexes first.
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"source" "appointment_source" NOT NULL,
	"access_token_hash" text NOT NULL,
	"reschedule_count" smallint DEFAULT 0 NOT NULL,
	"ics_sequence" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" "cancelled_by",
	"cancelled_by_user_id" uuid,
	"status_updated_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_order" CHECK ("appointments"."end_at" > "appointments"."start_at"),
	CONSTRAINT "appointments_reschedule_nonneg" CHECK ("appointments"."reschedule_count" >= 0),
	CONSTRAINT "appointments_cancel_consistency" CHECK (("appointments"."status" = 'cancelled' AND "appointments"."cancelled_at" IS NOT NULL AND "appointments"."cancelled_by" IS NOT NULL) OR ("appointments"."status" <> 'cancelled' AND "appointments"."cancelled_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clinic_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_policy_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_phone_e164" CHECK ("patients"."phone_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_token_key" ON "appointments" USING btree ("access_token_hash");
--> statement-breakpoint
CREATE INDEX "appointments_clinic_start_idx" ON "appointments" USING btree ("clinic_id","start_at");
--> statement-breakpoint
CREATE INDEX "appointments_staff_start_idx" ON "appointments" USING btree ("staff_id","start_at") WHERE "appointments"."status" IN ('booked', 'completed');
--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("clinic_id","patient_id","start_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "audit_log_clinic_time_idx" ON "audit_log" USING btree ("clinic_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_phone_key" ON "patients" USING btree ("clinic_id","phone_e164");
--> statement-breakpoint
CREATE UNIQUE INDEX "patients_clinic_id_key" ON "patients" USING btree ("clinic_id","id");
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_fk" FOREIGN KEY ("clinic_id","patient_id") REFERENCES "public"."patients"("clinic_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_fk" FOREIGN KEY ("clinic_id","staff_id") REFERENCES "public"."staff"("clinic_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_fk" FOREIGN KEY ("clinic_id","service_id") REFERENCES "public"."services"("clinic_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
