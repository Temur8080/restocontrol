-- Migration: Add admin_id to all tables for data isolation
-- This ensures each admin can only see and manage their own data

-- Add admin_id to positions table
ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Update positions: set admin_id based on created_by or assign to first admin
-- If positions were created before admin_id existed, we'll need to handle this
-- For now, we'll set a default (you may need to adjust this based on your data)
UPDATE positions 
SET admin_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
WHERE admin_id IS NULL;

-- Make admin_id NOT NULL after setting defaults
ALTER TABLE positions 
ALTER COLUMN admin_id SET NOT NULL;

-- Drop old unique constraint and add new one with admin_id
ALTER TABLE positions 
DROP CONSTRAINT IF EXISTS positions_name_key;

-- Add new constraint (will fail if exists, but can be safely ignored)
ALTER TABLE positions 
ADD CONSTRAINT positions_name_admin_unique UNIQUE(name, admin_id);

-- Create index
CREATE INDEX IF NOT EXISTS idx_position_admin_id ON positions(admin_id);

-- Add admin_id to salaries table
ALTER TABLE salaries 
ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Update salaries: set admin_id from employee's admin_id
UPDATE salaries s
SET admin_id = e.admin_id
FROM employees e
WHERE s.employee_id = e.id AND s.admin_id IS NULL;

-- Make admin_id NOT NULL after setting defaults
ALTER TABLE salaries 
ALTER COLUMN admin_id SET NOT NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_salary_admin_id ON salaries(admin_id);

-- Add admin_id to daily_changes table
ALTER TABLE daily_changes 
ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Update daily_changes: set admin_id from employee's admin_id
UPDATE daily_changes dc
SET admin_id = e.admin_id
FROM employees e
WHERE dc.employee_id = e.id AND dc.admin_id IS NULL;

-- Make admin_id NOT NULL after setting defaults
ALTER TABLE daily_changes 
ALTER COLUMN admin_id SET NOT NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_daily_change_admin_id ON daily_changes(admin_id);

-- Add admin_id to salary_rates table
ALTER TABLE salary_rates 
ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Update salary_rates: set admin_id from employee's admin_id or created_by
UPDATE salary_rates sr
SET admin_id = COALESCE(
  (SELECT e.admin_id FROM employees e WHERE sr.employee_id = e.id),
  (SELECT u.id FROM users u WHERE sr.created_by = u.id AND u.role IN ('admin', 'super_admin') LIMIT 1)
)
WHERE sr.admin_id IS NULL;

-- Make admin_id NOT NULL after setting defaults
ALTER TABLE salary_rates 
ALTER COLUMN admin_id SET NOT NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_salary_rate_admin_id ON salary_rates(admin_id);

-- Add admin_id to attendance_logs table
ALTER TABLE attendance_logs 
ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Update attendance_logs: set admin_id from employee's admin_id or terminal's admin_id
UPDATE attendance_logs al
SET admin_id = COALESCE(
  (SELECT e.admin_id FROM employees e WHERE al.employee_id = e.id),
  (SELECT t.admin_id FROM terminals t WHERE t.name = al.terminal_name LIMIT 1)
)
WHERE al.admin_id IS NULL;

-- For attendance_logs without employee or terminal, set to first admin (you may need to adjust)
UPDATE attendance_logs
SET admin_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
WHERE admin_id IS NULL;

-- Make admin_id NOT NULL after setting defaults
ALTER TABLE attendance_logs 
ALTER COLUMN admin_id SET NOT NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_attendance_logs_admin_id ON attendance_logs(admin_id);

-- Add admin_id to work_schedules table
ALTER TABLE work_schedules 
ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Update work_schedules: set admin_id from employee's admin_id
UPDATE work_schedules ws
SET admin_id = e.admin_id
FROM employees e
WHERE ws.employee_id = e.id AND ws.admin_id IS NULL;

-- Make admin_id NOT NULL after setting defaults
ALTER TABLE work_schedules 
ALTER COLUMN admin_id SET NOT NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_work_schedules_admin_id ON work_schedules(admin_id);

-- Add admin_id to employee_faces table
ALTER TABLE employee_faces 
ADD COLUMN IF NOT EXISTS admin_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Update employee_faces: set admin_id from employee's admin_id
UPDATE employee_faces ef
SET admin_id = e.admin_id
FROM employees e
WHERE ef.employee_id = e.id AND ef.admin_id IS NULL;

-- Make admin_id NOT NULL after setting defaults
ALTER TABLE employee_faces 
ALTER COLUMN admin_id SET NOT NULL;

-- Create index
CREATE INDEX IF NOT EXISTS idx_employee_face_admin_id ON employee_faces(admin_id);

