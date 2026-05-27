DELETE FROM sns_property_select_options WHERE field LIKE 'progress_%';

INSERT INTO sns_property_select_options (field, label, sort_order) VALUES
  ('progress_post_text', 'O-泉', 0),
  ('progress_post_text', 'O-坂本', 1),
  ('progress_post_text', 'O-吉田', 2);

INSERT INTO sns_property_select_options (field, label, sort_order)
SELECT v.field, v.label, v.sort_order FROM (VALUES
  ('tiktok_reserved', 'O-泉', 0),
  ('tiktok_reserved', 'O-坂本', 1),
  ('tiktok_reserved', 'O-吉田', 2),
  ('tiktok_wp', 'O-泉', 0),
  ('tiktok_wp', 'O-坂本', 1),
  ('tiktok_wp', 'O-吉田', 2),
  ('instagram_reserved', 'O-泉', 0),
  ('instagram_reserved', 'O-坂本', 1),
  ('instagram_reserved', 'O-吉田', 2),
  ('instagram_wp', 'O-泉', 0),
  ('instagram_wp', 'O-坂本', 1),
  ('instagram_wp', 'O-吉田', 2),
  ('threads_post_date', 'O-泉', 0),
  ('threads_post_date', 'O-坂本', 1),
  ('threads_post_date', 'O-吉田', 2)
) AS v(field, label, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM sns_property_select_options o WHERE o.field = v.field
);
