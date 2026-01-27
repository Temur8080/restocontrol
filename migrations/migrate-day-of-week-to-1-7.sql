-- Migration: Convert day_of_week from 0-6 to 1-7 format
-- 0 (Sunday) -> 7, 1-6 (Monday-Saturday) -> 1-6

BEGIN;

-- Drop the old constraint first
ALTER TABLE work_schedules DROP CONSTRAINT IF EXISTS work_schedules_day_of_week_check;

-- Update existing data: 0 -> 7, 1-6 stays the same
UPDATE work_schedules 
SET day_of_week = CASE 
    WHEN day_of_week = 0 THEN 7
    ELSE day_of_week
END
WHERE day_of_week = 0;

-- Add new constraint (1-7)
ALTER TABLE work_schedules ADD CONSTRAINT work_schedules_day_of_week_check 
    CHECK (day_of_week BETWEEN 1 AND 7);

-- Update comment
COMMENT ON COLUMN work_schedules.day_of_week IS '1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday, 7=Sunday';

COMMIT;

