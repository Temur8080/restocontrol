-- PostgreSQL database schema for login system

-- Create users table (admins and employees)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'employee',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    organization_name VARCHAR(200),
    logo_path VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on username for faster lookups
CREATE INDEX IF NOT EXISTS idx_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_role ON users(role);

-- Create employees table (hodimlar ma'lumotlari)
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(100) NOT NULL,
    position VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_employee_user_id ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_position ON employees(position);
CREATE INDEX IF NOT EXISTS idx_employee_admin_id ON employees(admin_id);

-- Create positions table (lavozimlar)
CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, admin_id)
);

-- Create index on position name
CREATE INDEX IF NOT EXISTS idx_position_name ON positions(name);
CREATE INDEX IF NOT EXISTS idx_position_admin_id ON positions(admin_id);

-- Create salaries table (hodimlar maoshlari)
CREATE TABLE IF NOT EXISTS salaries (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    period_date DATE NOT NULL,
    work_position VARCHAR(100), -- Qaysi lavozimda ishlagan (NULL bo'lsa, hodimning asosiy lavozimi ishlatiladi)
    notes TEXT,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for salaries table
CREATE INDEX IF NOT EXISTS idx_salary_employee_id ON salaries(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_period_type ON salaries(period_type);
CREATE INDEX IF NOT EXISTS idx_salary_period_date ON salaries(period_date);
CREATE INDEX IF NOT EXISTS idx_salary_created_by ON salaries(created_by);
CREATE INDEX IF NOT EXISTS idx_salary_work_position ON salaries(work_position);
CREATE INDEX IF NOT EXISTS idx_salary_admin_id ON salaries(admin_id);

-- Add foreign key constraint for employee position (optional - references position name)
-- Note: We'll keep position as VARCHAR in employees table for flexibility

-- Create daily_changes table (kunlik o'zgarishlar)
CREATE TABLE IF NOT EXISTS daily_changes (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    change_date DATE NOT NULL,
    change_type VARCHAR(50) NOT NULL CHECK (change_type IN ('position_change', 'substitute', 'other')),
    old_position VARCHAR(100),
    new_position VARCHAR(100),
    substitute_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    original_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    notes TEXT,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for daily_changes table
CREATE INDEX IF NOT EXISTS idx_daily_change_employee_id ON daily_changes(employee_id);
CREATE INDEX IF NOT EXISTS idx_daily_change_date ON daily_changes(change_date);
CREATE INDEX IF NOT EXISTS idx_daily_change_type ON daily_changes(change_type);
CREATE INDEX IF NOT EXISTS idx_daily_change_substitute ON daily_changes(substitute_employee_id);
CREATE INDEX IF NOT EXISTS idx_daily_change_original ON daily_changes(original_employee_id);
CREATE INDEX IF NOT EXISTS idx_daily_change_created_by ON daily_changes(created_by);
CREATE INDEX IF NOT EXISTS idx_daily_change_admin_id ON daily_changes(admin_id);

-- Create salary_rates table (ish haqqi belgilash)
CREATE TABLE IF NOT EXISTS salary_rates (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    position_name VARCHAR(100),
    amount DECIMAL(12, 2) NOT NULL,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    notes TEXT,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT check_employee_or_position CHECK (
        (employee_id IS NOT NULL AND position_name IS NULL) OR 
        (employee_id IS NULL AND position_name IS NOT NULL)
    )
);

-- Create indexes for salary_rates table
CREATE INDEX IF NOT EXISTS idx_salary_rate_employee_id ON salary_rates(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_rate_position_name ON salary_rates(position_name);
CREATE INDEX IF NOT EXISTS idx_salary_rate_period_type ON salary_rates(period_type);
CREATE INDEX IF NOT EXISTS idx_salary_rate_created_by ON salary_rates(created_by);
CREATE INDEX IF NOT EXISTS idx_salary_rate_admin_id ON salary_rates(admin_id);

-- Create terminals table (Hikvision terminallari)
CREATE TABLE IF NOT EXISTS terminals (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    terminal_type VARCHAR(20) NOT NULL CHECK (terminal_type IN ('entry', 'exit')),
    username VARCHAR(100),
    password VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for terminals table
CREATE INDEX IF NOT EXISTS idx_terminal_type ON terminals(terminal_type);
CREATE INDEX IF NOT EXISTS idx_terminal_admin_id ON terminals(admin_id);
CREATE INDEX IF NOT EXISTS idx_terminal_active ON terminals(is_active);

CREATE TABLE IF NOT EXISTS employee_faces (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    terminal_id INTEGER REFERENCES terminals(id) ON DELETE SET NULL,
    face_template_id VARCHAR(100), -- Terminal tomonidan berilgan ID
    face_photo_path VARCHAR(255), -- Yuz rasmi saqlash joyi (ixtiyoriy)
    is_synced BOOLEAN NOT NULL DEFAULT FALSE,
    sync_at TIMESTAMP,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, terminal_id)
);

-- Create indexes for employee_faces table
CREATE INDEX IF NOT EXISTS idx_employee_face_employee_id ON employee_faces(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_face_terminal_id ON employee_faces(terminal_id);
CREATE INDEX IF NOT EXISTS idx_employee_face_template_id ON employee_faces(face_template_id);
CREATE INDEX IF NOT EXISTS idx_employee_face_admin_id ON employee_faces(admin_id);

