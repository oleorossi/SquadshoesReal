DO $$ 
BEGIN 
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='planned_delivery') THEN
    ALTER TABLE public.orders RENAME COLUMN planned_delivery TO due_date;
  END IF;
END $$;