-- Add subscription fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS subscription_due_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS subscription_price DECIMAL(12, 2);

-- Create index for faster lookups on due date
CREATE INDEX IF NOT EXISTS idx_users_subscription_due_date ON users(subscription_due_date);
