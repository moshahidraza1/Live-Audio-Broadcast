-- Add recurring schedule templates
CREATE TABLE IF NOT EXISTS schedule_templates (
  masjid_id uuid NOT NULL REFERENCES masjids(id) ON DELETE CASCADE,
  prayer_name prayer_name NOT NULL,
  adhan_time_local time NOT NULL,
  iqamah_time_local time,
  khutbah_time_local time,
  is_juma boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_templates_uq UNIQUE (masjid_id, prayer_name)
);

CREATE INDEX IF NOT EXISTS schedule_templates_masjid_idx ON schedule_templates (masjid_id);
