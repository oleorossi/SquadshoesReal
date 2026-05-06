
-- Storage bucket for finance attachments (receipts, PDFs, images)
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-attachments', 'finance-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Table to track attachments linked to accounts
CREATE TABLE public.finance_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (account_type IN ('payable', 'receivable')),
  account_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  mime_type TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_finance_attachments_account ON public.finance_attachments(account_type, account_id);

-- RLS
ALTER TABLE public.finance_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view finance attachments"
  ON public.finance_attachments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert finance attachments"
  ON public.finance_attachments FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete finance attachments"
  ON public.finance_attachments FOR DELETE TO authenticated USING (true);

-- Storage RLS policies
CREATE POLICY "Authenticated users can upload finance attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'finance-attachments');

CREATE POLICY "Authenticated users can view finance attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'finance-attachments');

CREATE POLICY "Authenticated users can delete finance attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'finance-attachments');
