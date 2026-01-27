// ==================== COMMON UTILITIES ====================
// Bu fayl barcha sahifalar uchun umumiy utility funksiyalarni o'z ichiga oladi

// ==================== FORMATTING FUNCTIONS ====================
function formatDate(dateString) {
    if (!dateString) return 'Noma\'lum';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('uz-UZ', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch (e) {
        return dateString;
    }
}

function formatDateTime(dateString) {
    if (!dateString) return '—';
    try {
        const date = new Date(dateString);
        return date.toLocaleString('uz-UZ', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
}

function formatTime(dateString) {
    if (!dateString) return '—';
    try {
        const date = new Date(dateString);
        return date.toLocaleTimeString('uz-UZ', {
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return dateString;
    }
}

function formatMoney(amount) {
    const num = parseFloat(amount || 0);
    if (isNaN(num)) return '0';
    return new Intl.NumberFormat('uz-UZ', { 
        maximumFractionDigits: 0 
    }).format(num);
}

function formatPeriodType(type) {
    const types = {
        'daily': 'Kunlik',
        'weekly': 'Haftalik',
        'monthly': 'Oylik'
    };
    return types[type] || type || '—';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== API REQUEST ====================
async function apiRequest(endpoint, options = {}) {
    const token = localStorage.getItem('authToken');
    if (!token && endpoint !== '/api/login') {
        window.location.href = '/';
        return null;
    }

    const defaultHeaders = {
        'Content-Type': 'application/json',
    };

    if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(endpoint, {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers
            }
        });

        if (response.status === 401) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            window.location.href = '/';
            return null;
        }

        return response;
    } catch (error) {
        console.error('API Request error:', error);
        return null;
    }
}

// ==================== UI HELPERS ====================
function setLoading(button, loader, buttonText, isLoading, loadingText = 'Kutilmoqda...', normalText = 'Kirish') {
    if (button) button.disabled = isLoading;
    if (buttonText) {
        buttonText.textContent = isLoading ? loadingText : normalText;
    }
    if (loader) {
        loader.style.display = isLoading ? 'inline-block' : 'none';
    }
}

function showMessage(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.style.display = 'block';
    element.className = isError ? 'error-message' : 'success-message';
}

function hideMessage(element) {
    if (element) element.style.display = 'none';
}

function hideMessages(...elements) {
    elements.forEach(el => hideMessage(el));
}

// ==================== VALIDATION ====================
function validateRequired(value, fieldName) {
    if (!value || value.trim() === '') {
        return `${fieldName} kiritilishi shart`;
    }
    return null;
}

function validateEmail(email) {
    if (!email) return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return 'Noto\'g\'ri email manzil';
    }
    return null;
}

// ==================== DATE UTILITIES ====================
function getDateRange(days = 30) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
    return {
        start: start.toISOString().slice(0, 10),
        end: now.toISOString().slice(0, 10)
    };
}

function getMonthRange() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    monthStart.setHours(0, 0, 0, 0);
    monthEnd.setHours(23, 59, 59, 999);
    return {
        start: monthStart.toISOString().slice(0, 10),
        end: monthEnd.toISOString().slice(0, 10)
    };
}

// ==================== MOBILE UTILITIES ====================
// Cache mobile state to avoid forced reflows
let cachedMobileState = null;
let cachedMobileWidth = null;

function isMobile() {
    // Only read window.innerWidth if cache is invalid
    const currentWidth = window.innerWidth;
    if (cachedMobileWidth !== currentWidth) {
        cachedMobileWidth = currentWidth;
        cachedMobileState = currentWidth <= 768;
    }
    return cachedMobileState;
}

// Invalidate cache on resize (debounced)
let utilsResizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(utilsResizeTimeout);
    utilsResizeTimeout = setTimeout(() => {
        cachedMobileWidth = null;
        cachedMobileState = null;
    }, 100);
}, { passive: true });

function toggleMobileMenu(menu, overlay, toggle) {
    if (!isMobile()) return;
    
    if (menu && overlay) {
        menu.classList.toggle('mobile-open');
        overlay.style.display = menu.classList.contains('mobile-open') ? 'block' : 'none';
        document.body.style.overflow = menu.classList.contains('mobile-open') ? 'hidden' : '';
    }
}

// ==================== DEBOUNCE ====================
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ==================== EXPORT FOR MODULES ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatDate,
        formatDateTime,
        formatTime,
        formatMoney,
        formatPeriodType,
        escapeHtml,
        apiRequest,
        setLoading,
        showMessage,
        hideMessage,
        hideMessages,
        validateRequired,
        validateEmail,
        getDateRange,
        getMonthRange,
        isMobile,
        toggleMobileMenu,
        debounce
    };
}
