-- Add HLS fields to broadcasts
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS hls_url text,
  ADD COLUMN IF NOT EXISTS hls_egress_id varchar(255),
  ADD COLUMN IF NOT EXISTS hls_rtmp_url text;
