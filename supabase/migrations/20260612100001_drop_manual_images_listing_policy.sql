-- Remove broad public SELECT (listing) on manual-images bucket. Public bucket object URLs still work via getPublicUrl.
DROP POLICY IF EXISTS "manual_images_public_read" ON storage.objects;
