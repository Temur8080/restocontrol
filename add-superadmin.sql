-- Superadmin qo'shish uchun SQL query
-- Eslatma: Parolni hash qilish kerak (bcrypt orqali)
-- JavaScript script orqali qo'shish tavsiya etiladi

-- Variant 1: To'g'ridan-to'g'ri INSERT (Parolni hash qilish kerak!)
-- Mana bu usulni ISHLATMANGLIK - parol hash qilinmagan!

-- Agar qo'lda qilmoqchi bo'lsangiz, add-superadmin.js script'ini ishlating!

-- Variant 2: Mavjud userni super_admin qilish
UPDATE users 
SET role = 'super_admin', 
    is_active = true
WHERE username = 'admin';

-- Superadmin'ni ko'rish
SELECT id, username, role, is_active, created_at 
FROM users 
WHERE role = 'super_admin';

-- Barcha adminlarni ko'rish
SELECT id, username, role, is_active 
FROM users 
WHERE role IN ('admin', 'super_admin')
ORDER BY role, username;
