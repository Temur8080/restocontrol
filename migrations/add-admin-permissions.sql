-- Add permissions column to users table for admin access control
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;

-- Create index for permissions
CREATE INDEX IF NOT EXISTS idx_user_permissions ON users USING GIN (permissions);
