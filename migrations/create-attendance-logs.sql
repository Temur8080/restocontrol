-- Attendance Logs Table
-- Stores attendance events from Hikvision terminals with duplicate protection

CREATE TABLE IF NOT EXISTS attendance_logs (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    employee_name VARCHAR(255) NOT NULL,
    terminal_name VARCHAR(100) NOT NULL,
    event_time TIMESTAMP WITH TIME ZONE NOT NULL,
    verification_mode VARCHAR(50),
    serial_no VARCHAR(255) NOT NULL,
    picture_url VARCHAR(500),
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Unique constraint: serialNo must be unique per terminal
    UNIQUE(serial_no, terminal_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee_id ON attendance_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_terminal_name ON attendance_logs(terminal_name);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_event_time ON attendance_logs(event_time);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_serial_no ON attendance_logs(serial_no);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee_time ON attendance_logs(employee_name, event_time);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_admin_id ON attendance_logs(admin_id);

-- Add comment
COMMENT ON TABLE attendance_logs IS 'Hikvision terminal attendance events log';
COMMENT ON COLUMN attendance_logs.serial_no IS 'Hikvision event serialNo - used for duplicate detection';
COMMENT ON COLUMN attendance_logs.employee_id IS 'References employees table if mapping exists, otherwise NULL';
COMMENT ON COLUMN attendance_logs.employee_name IS 'Employee identifier from terminal (employeeNoString)';


