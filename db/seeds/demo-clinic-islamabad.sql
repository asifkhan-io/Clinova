-- The sales demo clinic (roadmap Week 3, scope §5 "realistic enough to double
-- as the sales demo"). Runs on PRODUCTION on purpose: it is the page shown to
-- clinic owners at /en/c/demo. It holds NO patients and NO appointments — a
-- demo is done by booking live on the phone, and fake patient rows with real-
-- looking Pakistani numbers could belong to real people.
--
-- The name is deliberately fictional ("Clinova Demo Dental") so it can never be
-- mistaken for, or collide with, a real Islamabad clinic. No phone, no map.
-- No owner: the platform admin invites one from the admin page ("reissue
-- invite" with a fresh email), so no password ever passes through a script.
--
-- Idempotent: does nothing if a clinic with slug 'demo' already exists.
-- Run as the database owner (Neon console SQL editor or psql on DATABASE_URL_UNPOOLED).
DO $$
DECLARE
  c uuid;
  consult uuid; scaling uuid; filling uuid; rootcanal uuid; whitening uuid; braces uuid;
  ayesha uuid; bilal uuid; sana uuid;
  d int;
BEGIN
  IF EXISTS (SELECT 1 FROM clinics WHERE slug = 'demo') THEN
    RAISE NOTICE 'demo clinic already exists, nothing to do';
    RETURN;
  END IF;

  INSERT INTO clinics (slug, name_en, name_ar, address_en, country, timezone, status, booking_enabled,
                       buffer_minutes, min_lead_minutes, max_horizon_days, change_cutoff_minutes, slot_granularity_minutes)
  VALUES ('demo', 'Clinova Demo Dental', NULL, 'Islamabad (demo clinic — not a real practice)', 'PK', 'Asia/Karachi', 'active', true,
          0, 60, 60, 120, 30)
  RETURNING id INTO c;

  -- Prices in paisa (PKR × 100). NULL = "price on request".
  INSERT INTO services (clinic_id, name_en, description_en, duration_minutes, price_minor, sort_order) VALUES
    (c, 'Consultation & check-up', 'Examination and treatment plan.', 30, 150000, 1) RETURNING id INTO consult;
  INSERT INTO services (clinic_id, name_en, description_en, duration_minutes, price_minor, sort_order) VALUES
    (c, 'Scaling & polishing', 'Professional cleaning.', 45, 400000, 2) RETURNING id INTO scaling;
  INSERT INTO services (clinic_id, name_en, description_en, duration_minutes, price_minor, sort_order) VALUES
    (c, 'Tooth filling', 'Tooth-coloured composite filling.', 45, 500000, 3) RETURNING id INTO filling;
  INSERT INTO services (clinic_id, name_en, description_en, duration_minutes, price_minor, sort_order) VALUES
    (c, 'Root canal (per sitting)', NULL, 60, 1500000, 4) RETURNING id INTO rootcanal;
  INSERT INTO services (clinic_id, name_en, description_en, duration_minutes, price_minor, sort_order) VALUES
    (c, 'Teeth whitening', NULL, 60, 2000000, 5) RETURNING id INTO whitening;
  INSERT INTO services (clinic_id, name_en, description_en, duration_minutes, price_minor, sort_order) VALUES
    (c, 'Braces consultation', 'Assessment for braces or aligners.', 30, NULL, 6) RETURNING id INTO braces;

  INSERT INTO staff (clinic_id, display_name_en, title_en, sort_order) VALUES (c, 'Dr. Ayesha Malik', 'General Dentist', 1) RETURNING id INTO ayesha;
  INSERT INTO staff (clinic_id, display_name_en, title_en, sort_order) VALUES (c, 'Dr. Bilal Ahmed', 'Orthodontist', 2) RETURNING id INTO bilal;
  INSERT INTO staff (clinic_id, display_name_en, title_en, sort_order) VALUES (c, 'Dr. Sana Rauf', 'Endodontist', 3) RETURNING id INTO sana;

  INSERT INTO staff_services (clinic_id, staff_id, service_id) VALUES
    (c, ayesha, consult), (c, ayesha, scaling), (c, ayesha, filling), (c, ayesha, whitening),
    (c, bilal, consult), (c, bilal, braces),
    (c, sana, consult), (c, sana, filling), (c, sana, rootcanal);

  -- 0 = Sunday (closed). Split shift 10:00–14:00 and 17:00–21:00, the usual
  -- pattern for private clinics here. Times are minutes from midnight.
  FOR d IN 1..6 LOOP
    INSERT INTO clinic_hours (clinic_id, day_of_week, start_minute, end_minute) VALUES (c, d, 600, 840), (c, d, 1020, 1260);
    -- Dr. Ayesha: every working day, both shifts.
    INSERT INTO staff_hours (clinic_id, staff_id, day_of_week, start_minute, end_minute) VALUES (c, ayesha, d, 600, 840), (c, ayesha, d, 1020, 1260);
  END LOOP;
  -- Dr. Bilal: evenings, Monday / Wednesday / Friday.
  FOREACH d IN ARRAY ARRAY[1, 3, 5] LOOP
    INSERT INTO staff_hours (clinic_id, staff_id, day_of_week, start_minute, end_minute) VALUES (c, bilal, d, 1020, 1260);
  END LOOP;
  -- Dr. Sana: Tuesday / Thursday / Saturday, both shifts.
  FOREACH d IN ARRAY ARRAY[2, 4, 6] LOOP
    INSERT INTO staff_hours (clinic_id, staff_id, day_of_week, start_minute, end_minute) VALUES (c, sana, d, 600, 840), (c, sana, d, 1020, 1260);
  END LOOP;

  -- A public holiday on a fixed date, so the closure feature shows in the demo.
  INSERT INTO schedule_overrides (clinic_id, staff_id, start_date, end_date, type, label_en)
  VALUES (c, NULL, '2026-12-25', '2026-12-25', 'closed', 'Quaid-e-Azam Day');
END $$;
