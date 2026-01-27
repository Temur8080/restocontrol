
const bcrypt = require('bcrypt');

const password = process.argv[2] || 'admin123';

bcrypt.hash(password, 10)
  .then(hash => {
    console.log('\n================================');
    console.log('Parol:', password);
    console.log('Hash:', hash);
    console.log('================================\n');
    console.log('Database\'ga quyidagi SQL ni bajaring:');
    console.log(`UPDATE users SET password = '${hash}' WHERE username = 'admin';`);
    console.log(`Yoki yangi user qo\'shish uchun:`);
    console.log(`INSERT INTO users (username, password) VALUES ('username', '${hash}');\n`);
  })
  .catch(err => {
    console.error('Xatolik:', err);
  });

