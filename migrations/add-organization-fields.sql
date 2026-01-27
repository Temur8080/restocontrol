-- Add organization fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS organization_address VARCHAR(255),
ADD COLUMN IF NOT EXISTS organization_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS organization_email VARCHAR(100);
