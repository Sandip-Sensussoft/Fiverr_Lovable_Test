-- Remove unique constraint on email to allow duplicate submissions
-- This allows the same email to be used multiple times

-- Drop the unique constraint on email if it exists
DO $$ 
BEGIN
    -- Check if unique constraint exists and drop it
    IF EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'leads_email_key'
    ) THEN
        ALTER TABLE public.leads DROP CONSTRAINT leads_email_key;
        RAISE NOTICE 'Unique constraint on email removed successfully';
    ELSE
        RAISE NOTICE 'No unique constraint found on email column';
    END IF;
END $$;

-- Add an index for performance (non-unique)
CREATE INDEX IF NOT EXISTS idx_leads_email_performance ON public.leads(email);

-- Verify the change
SELECT 
    conname as constraint_name,
    contype as constraint_type
FROM pg_constraint 
WHERE conrelid = 'public.leads'::regclass 
AND contype = 'u'; -- unique constraints
