-- Remove unique constraint on email field to allow duplicate submissions
-- Run this in your Supabase SQL Editor

-- Step 1: Drop the unique constraint on email
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
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %', SQLERRM;
END $$;

-- Step 2: Add a regular index for performance (optional)
CREATE INDEX IF NOT EXISTS idx_leads_email_performance ON public.leads(email);

-- Step 3: Verify the constraint is removed
SELECT 
    conname as constraint_name,
    contype as constraint_type
FROM pg_constraint 
WHERE conrelid = 'public.leads'::regclass 
AND contype = 'u'; -- unique constraints

-- Step 4: Show current table structure
\d public.leads;
