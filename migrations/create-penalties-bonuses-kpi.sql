-- Create penalties table (jarimalar)
CREATE TABLE IF NOT EXISTS penalties (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    penalty_date DATE NOT NULL,
    reason TEXT,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    period_date DATE NOT NULL,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for penalties table
CREATE INDEX IF NOT EXISTS idx_penalty_employee_id ON penalties(employee_id);
CREATE INDEX IF NOT EXISTS idx_penalty_date ON penalties(penalty_date);
CREATE INDEX IF NOT EXISTS idx_penalty_period_type ON penalties(period_type);
CREATE INDEX IF NOT EXISTS idx_penalty_period_date ON penalties(period_date);
CREATE INDEX IF NOT EXISTS idx_penalty_admin_id ON penalties(admin_id);

-- Create bonuses table (bonuslar)
CREATE TABLE IF NOT EXISTS bonuses (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    bonus_date DATE NOT NULL,
    reason TEXT,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    period_date DATE NOT NULL,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for bonuses table
CREATE INDEX IF NOT EXISTS idx_bonus_employee_id ON bonuses(employee_id);
CREATE INDEX IF NOT EXISTS idx_bonus_date ON bonuses(bonus_date);
CREATE INDEX IF NOT EXISTS idx_bonus_period_type ON bonuses(period_type);
CREATE INDEX IF NOT EXISTS idx_bonus_period_date ON bonuses(period_date);
CREATE INDEX IF NOT EXISTS idx_bonus_admin_id ON bonuses(admin_id);

-- Create kpi_records table (KPI yozuvlari)
CREATE TABLE IF NOT EXISTS kpi_records (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    score DECIMAL(5, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
    amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    kpi_date DATE NOT NULL,
    reason TEXT,
    period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    period_date DATE NOT NULL,
    admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for kpi_records table
CREATE INDEX IF NOT EXISTS idx_kpi_employee_id ON kpi_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_kpi_date ON kpi_records(kpi_date);
CREATE INDEX IF NOT EXISTS idx_kpi_period_type ON kpi_records(period_type);
CREATE INDEX IF NOT EXISTS idx_kpi_period_date ON kpi_records(period_date);
CREATE INDEX IF NOT EXISTS idx_kpi_admin_id ON kpi_records(admin_id);
