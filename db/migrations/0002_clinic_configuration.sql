-- Reordered by hand: composite foreign keys (clinic_id, x_id) need the
-- (clinic_id, id) unique indexes to exist first, and drizzle-kit emits FKs before indexes.
CREATE TABLE "clinic_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "clinic_hours_dow" CHECK ("clinic_hours"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "clinic_hours_bounds" CHECK ("clinic_hours"."start_minute" >= 0 AND "clinic_hours"."end_minute" <= 1440 AND "clinic_hours"."start_minute" < "clinic_hours"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "schedule_override_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"override_id" uuid NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "schedule_override_intervals_bounds" CHECK ("schedule_override_intervals"."start_minute" >= 0 AND "schedule_override_intervals"."end_minute" <= 1440 AND "schedule_override_intervals"."start_minute" < "schedule_override_intervals"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "schedule_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"staff_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" "override_type" NOT NULL,
	"label_en" text,
	"label_ar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_overrides_date_order" CHECK ("schedule_overrides"."start_date" <= "schedule_overrides"."end_date")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"duration_minutes" integer NOT NULL,
	"price_minor" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_duration_range" CHECK ("services"."duration_minutes" BETWEEN 5 AND 480),
	CONSTRAINT "services_duration_step" CHECK ("services"."duration_minutes" % 5 = 0),
	CONSTRAINT "services_price_nonneg" CHECK ("services"."price_minor" IS NULL OR "services"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name_en" text NOT NULL,
	"display_name_ar" text NOT NULL,
	"title_en" text,
	"title_ar" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clinic_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "staff_hours_dow" CHECK ("staff_hours"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "staff_hours_bounds" CHECK ("staff_hours"."start_minute" >= 0 AND "staff_hours"."end_minute" <= 1440 AND "staff_hours"."start_minute" < "staff_hours"."end_minute")
);
--> statement-breakpoint
CREATE TABLE "staff_services" (
	"clinic_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "staff_services_staff_id_service_id_pk" PRIMARY KEY("staff_id","service_id")
);
--> statement-breakpoint
CREATE INDEX "clinic_hours_clinic_day_idx" ON "clinic_hours" USING btree ("clinic_id","day_of_week");
--> statement-breakpoint
CREATE INDEX "schedule_override_intervals_override_idx" ON "schedule_override_intervals" USING btree ("override_id");
--> statement-breakpoint
CREATE INDEX "schedule_overrides_lookup_idx" ON "schedule_overrides" USING btree ("clinic_id","start_date","end_date");
--> statement-breakpoint
CREATE INDEX "services_clinic_active_idx" ON "services" USING btree ("clinic_id","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX "services_clinic_id_key" ON "services" USING btree ("clinic_id","id");
--> statement-breakpoint
CREATE INDEX "staff_clinic_active_idx" ON "staff" USING btree ("clinic_id","is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_clinic_id_key" ON "staff" USING btree ("clinic_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_clinic_user_key" ON "staff" USING btree ("clinic_id","user_id");
--> statement-breakpoint
CREATE INDEX "staff_hours_staff_day_idx" ON "staff_hours" USING btree ("staff_id","day_of_week");
--> statement-breakpoint
CREATE INDEX "staff_services_service_idx" ON "staff_services" USING btree ("clinic_id","service_id");
--> statement-breakpoint
ALTER TABLE "clinic_hours" ADD CONSTRAINT "clinic_hours_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_override_intervals" ADD CONSTRAINT "schedule_override_intervals_override_id_schedule_overrides_id_fk" FOREIGN KEY ("override_id") REFERENCES "public"."schedule_overrides"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_staff_fk" FOREIGN KEY ("clinic_id","staff_id") REFERENCES "public"."staff"("clinic_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_hours" ADD CONSTRAINT "staff_hours_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_hours" ADD CONSTRAINT "staff_hours_staff_fk" FOREIGN KEY ("clinic_id","staff_id") REFERENCES "public"."staff"("clinic_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_staff_fk" FOREIGN KEY ("clinic_id","staff_id") REFERENCES "public"."staff"("clinic_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_service_fk" FOREIGN KEY ("clinic_id","service_id") REFERENCES "public"."services"("clinic_id","id") ON DELETE cascade ON UPDATE no action;
