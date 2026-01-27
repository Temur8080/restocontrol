-- Jarima sozlamalari maydonlarini qo'shish
-- Bu migration users jadvaliga jarima sozlamalarini qo'shadi

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS late_threshold_minutes INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS penalty_per_minute INTEGER DEFAULT 1000,
ADD COLUMN IF NOT EXISTS max_penalty_per_day INTEGER DEFAULT 50000;

-- Izohlar
COMMENT ON COLUMN users.late_threshold_minutes IS 'Kechikish chegarasi (daqiqa) - shu minutdan keyin kech qolgan hisoblanadi';
COMMENT ON COLUMN users.penalty_per_minute IS 'Har bir kechikkan minut uchun jarima (so''m)';
COMMENT ON COLUMN users.max_penalty_per_day IS 'Bir kunda maksimal jarima (so''m)';
