
-- Fix overlapping certificates bucket policy
DROP POLICY IF EXISTS "Auth users can read certificates" ON storage.objects;

-- Fix overlapping employee-receipts bucket policy
DROP POLICY IF EXISTS "Auth users can view receipts" ON storage.objects;

-- Add RLS policy on realtime.messages to restrict subscriptions to approved users
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
    EXECUTE 'CREATE POLICY "Approved users can access realtime" ON realtime.messages FOR SELECT TO authenticated USING (public.is_approved_user())';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
