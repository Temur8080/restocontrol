-- Hodim statusini faollashtirish (barcha hodimlar)
UPDATE users 
SET is_active = true 
WHERE role = 'employee';

-- Yoki ma'lum bir hodimni faollashtirish
-- UPDATE users 
-- SET is_active = true 
-- WHERE id = (SELECT user_id FROM employees WHERE id = YOUR_EMPLOYEE_ID);

-- Yoki ma'lum bir admin'ga tegishli hodimlarni faollashtirish
-- UPDATE users 
-- SET is_active = true 
-- WHERE role = 'employee' 
-- AND id IN (SELECT user_id FROM employees WHERE admin_id = YOUR_ADMIN_ID);
