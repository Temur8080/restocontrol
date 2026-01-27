-- Work Schedules Table
-- Stores work schedule for each employee (which days and times they work)

CREATE TABLE IF NOT EXISTS work_schedules (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Monday, 2=Tuesday, ..., 7=Sunday
    start_time TIME NOT NULL, -- Work start time (e.g., 09:00:00)
    end_time TIME NOT NULL, -- Work end time (e.g., 18:00:00)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- One schedule per employee per day
    UNIQUE(employee_id, day_of_week)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_work_schedules_employee_id ON work_schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_work_schedules_day_of_week ON work_schedules(day_of_week);
CREATE INDEX IF NOT EXISTS idx_work_schedules_active ON work_schedules(is_active);
CREATE INDEX IF NOT EXISTS idx_work_schedules_admin_id ON work_schedules(admin_id);

-- Add comment
COMMENT ON TABLE work_schedules IS 'Employee work schedules - defines which days and times employees work';
COMMENT ON COLUMN work_schedules.day_of_week IS '1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday, 7=Sunday';
COMMENT ON COLUMN work_schedules.start_time IS 'Expected work start time for this day';
COMMENT ON COLUMN work_schedules.end_time IS 'Expected work end time for this day';


