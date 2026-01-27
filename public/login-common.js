// ==================== COMMON LOGIN FUNCTIONALITY ====================
// Bu fayl barcha login sahifalari uchun umumiy funksiyalarni o'z ichiga oladi

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const loginButton = document.getElementById('loginButton');
    const buttonText = document.querySelector('.button-text');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('errorMessage');
    const successMessage = document.getElementById('successMessage');

    if (!loginForm || !loginButton) return;

    // Get login type from page (admin or employee)
    const isEmployeeLogin = window.location.pathname.includes('employee-login');
    const allowedRole = isEmployeeLogin ? 'employee' : null;

    function hideMessages() {
        if (errorMessage) errorMessage.style.display = 'none';
        if (successMessage) successMessage.style.display = 'none';
    }

    function showError(message) {
        hideMessages();
        if (errorMessage) {
            errorMessage.textContent = message;
            errorMessage.style.display = 'block';
        }
    }

    function showSuccess(message) {
        hideMessages();
        if (successMessage) {
            successMessage.textContent = message;
            successMessage.style.display = 'block';
        }
    }

    function setLoading(isLoading) {
        if (loginButton) loginButton.disabled = isLoading;
        if (buttonText) {
            buttonText.textContent = isLoading ? 'Kutilmoqda...' : 'Kirish';
        }
        if (loader) {
            loader.style.display = isLoading ? 'inline-block' : 'none';
        }
    }

    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const username = document.getElementById('username')?.value.trim();
        const password = document.getElementById('password')?.value;

        if (!username || !password) {
            showError('Iltimos, barcha maydonlarni to\'ldiring');
            return;
        }

        hideMessages();
        setLoading(true);

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: username,
                    password: password
                })
            });

            const data = await response.json();
            setLoading(false);

            // 403 Forbidden xatolikni handle qilish
            if (response.status === 403) {
                showError(data.message || 'Sizning hisobingiz to\'xtatilgan. Iltimos, administratorga murojaat qiling.');
                return;
            }

            // 401 Unauthorized xatolikni handle qilish
            if (response.status === 401) {
                showError(data.message || 'Noto\'g\'ri username yoki password');
                return;
            }

            if (data.success) {
                // Check role restrictions
                if (isEmployeeLogin && data.user.role !== 'employee') {
                    showError('Bu sahifa faqat hodimlar uchun. Adminlar boshqa sahifadan kirishi kerak.');
                    return;
                }

                localStorage.setItem('authToken', data.token);
                localStorage.setItem('userRole', data.user.role);
                
                showSuccess(data.message || 'Muvaffaqiyatli kirildi!');
                
                setTimeout(() => {
                    if (data.user.role === 'super_admin' || data.user.role === 'admin') {
                        window.location.href = '/admin';
                    } else if (data.user.role === 'employee') {
                        window.location.href = '/employee-dashboard';
                    } else {
                        showError('Noma\'lum rol. Iltimos, tizim administratoriga murojaat qiling.');
                    }
                }, 1000);
            } else {
                showError(data.message || 'Xatolik yuz berdi. Iltimos, qayta urinib ko\'ring.');
            }
        } catch (error) {
            setLoading(false);
            console.error('Login error:', error);
            showError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
        }
    });

    // Password toggle functionality
    const passwordInput = document.getElementById('password');
    const passwordToggle = document.getElementById('passwordToggle');
    const eyeOpen = passwordToggle?.querySelector('.eye-open');
    const eyeClosed = passwordToggle?.querySelector('.eye-closed');

    if (passwordToggle && passwordInput) {
        passwordToggle.addEventListener('click', function() {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            
            if (eyeOpen && eyeClosed) {
                if (isPassword) {
                    eyeOpen.style.display = 'none';
                    eyeClosed.style.display = 'block';
                } else {
                    eyeOpen.style.display = 'block';
                    eyeClosed.style.display = 'none';
                }
            }
        });
    }

    // Clear messages on input
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            if (errorMessage && errorMessage.style.display === 'block') {
                hideMessages();
            }
        });
    });

    // Enter key support
    document.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && loginButton && !loginButton.disabled) {
            loginForm.dispatchEvent(new Event('submit'));
        }
    });
});
