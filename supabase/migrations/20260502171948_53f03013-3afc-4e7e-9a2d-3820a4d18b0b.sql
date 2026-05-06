-- Fix missing foreign key relationship for overhead history
DO $$ 
BEGIN 
    -- Ensure the profiles table exists (it should, but safety first)
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'profiles') THEN
        
        -- Check if the constraint already exists
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.table_constraints 
            WHERE constraint_name = 'technical_sheet_overhead_history_changed_by_fkey'
        ) THEN
            -- Add the foreign key constraint
            ALTER TABLE public.technical_sheet_overhead_history
            ADD CONSTRAINT technical_sheet_overhead_history_changed_by_fkey 
            FOREIGN KEY (changed_by) REFERENCES public.profiles(id) 
            ON DELETE SET NULL;
        END IF;

    END IF;
END $$;
