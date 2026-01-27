// Test script - apiRoutes initialization tekshirish
console.log('Testing apiRoutes initialization...');

try {
  // 1. apiRoutes require qilish
  console.log('1. Requiring apiRoutes...');
  const apiRoutes = require('./routes/api');
  console.log('✅ apiRoutes require qilindi:', typeof apiRoutes);
  
  // 2. Express app yaratish
  console.log('2. Creating Express app...');
  const express = require('express');
  const app = express();
  console.log('✅ Express app yaratildi');
  
  // 3. apiRoutes ishlatish
  console.log('3. Using apiRoutes...');
  app.use('/api', apiRoutes);
  console.log('✅ apiRoutes ishlatildi');
  
  console.log('\n✅ Barcha testlar muvaffaqiyatli!');
  
} catch (error) {
  console.error('❌ Xatolik:', error.message);
  console.error('Stack:', error.stack);
}
