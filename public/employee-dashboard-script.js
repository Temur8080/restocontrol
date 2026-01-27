// ==================== AUTHENTICATION ====================
function getAuthToken() {
    return localStorage.getItem('authToken');
}

function checkAuth() {
    const token = getAuthToken();
    if (!token) {
        window.location.href = '/employee-login';
        return false;
    }
    return true;
}

// ==================== API REQUEST ====================
async function apiRequest(endpoint, options = {}) {
    const token = getAuthToken();
    if (!token) {
        window.location.href = '/employee-login';
        return null;
    }

    const defaultHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

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
            window.location.href = '/employee-login';
            return null;
        }

        if (response.status === 403) {
            const errorData = await response.json().catch(() => ({ message: 'Ruxsat berilmagan' }));
            console.error('403 Forbidden:', endpoint, errorData.message);
            alert(errorData.message || 'Ruxsat berilmagan. Iltimos, administratorga murojaat qiling.');
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            window.location.href = '/employee-login';
            return null;
        }

        return response;
    } catch (error) {
        console.error('API Request error:', error);
        return null;
    }
}

// ==================== UTILITY FUNCTIONS ====================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return '—';
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

function getDayName(dayOfWeek) {
    const days = {
        1: 'Dushanba',
        2: 'Seshanba',
        3: 'Chorshanba',
        4: 'Payshanba',
        5: 'Juma',
        6: 'Shanba',
        7: 'Yakshanba'
    };
    return days[dayOfWeek] || '—';
}

// ==================== STATE MANAGEMENT ====================
let currentEmployeeId = null;
let dashboardData = null;

// ==================== DOM ELEMENTS ====================
const employeeName = document.getElementById('employeeName');
const employeePosition = document.getElementById('employeePosition');
const statsGrid = document.getElementById('statsGrid');
const personalInfo = document.getElementById('personalInfo');
const workScheduleCompact = document.getElementById('workScheduleCompact');
const attendanceList = document.getElementById('attendanceList');
const salariesList = document.getElementById('salariesList');
const bonusesList = document.getElementById('bonusesList');
const penaltiesList = document.getElementById('penaltiesList');
const editForm = document.getElementById('editForm');
const saveBtn = document.getElementById('saveBtn');
const saveLoader = document.getElementById('saveLoader');
const editError = document.getElementById('editError');
const editSuccess = document.getElementById('editSuccess');
const logoutBtn = document.getElementById('logoutBtn');
const refreshOverviewBtn = document.getElementById('refreshOverviewBtn');
const refreshPersonalBtn = document.getElementById('refreshPersonalBtn');
const refreshSalariesBtn = document.getElementById('refreshSalariesBtn');

// ==================== AUTO-REFRESH SYSTEM ====================
let autoRefreshIntervals = {};
let autoRefreshEnabled = true;
const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds

// Auto-refresh manager
const AutoRefreshManager = {
    // Check if page is visible
    isPageVisible: () => {
        return !document.hidden;
    },
    
    // Check if any modal is open
    isModalOpen: () => {
        const modals = document.querySelectorAll('.modal, .modal-overlay, [class*="modal"]');
        return Array.from(modals).some(modal => {
            const style = window.getComputedStyle(modal);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        });
    },
    
    // Register a function for auto-refresh
    register: (name, refreshFunction, interval = AUTO_REFRESH_INTERVAL) => {
        // Clear existing interval if any
        if (autoRefreshIntervals[name]) {
            clearInterval(autoRefreshIntervals[name]);
        }
        
        // Create new interval
        autoRefreshIntervals[name] = setInterval(() => {
            if (!autoRefreshEnabled) return;
            if (!AutoRefreshManager.isPageVisible()) return;
            if (AutoRefreshManager.isModalOpen()) return;
            
            try {
                refreshFunction();
            } catch (error) {
                console.error(`Auto-refresh error for ${name}:`, error);
            }
        }, interval);
        
        console.log(`✅ Auto-refresh registered: ${name} (every ${interval/1000}s)`);
    },
    
    // Unregister a function
    unregister: (name) => {
        if (autoRefreshIntervals[name]) {
            clearInterval(autoRefreshIntervals[name]);
            delete autoRefreshIntervals[name];
            console.log(`🛑 Auto-refresh unregistered: ${name}`);
        }
    },
    
    // Pause all auto-refresh
    pause: () => {
        autoRefreshEnabled = false;
        console.log('⏸️  Auto-refresh paused');
    },
    
    // Resume all auto-refresh
    resume: () => {
        autoRefreshEnabled = true;
        console.log('▶️  Auto-refresh resumed');
    },
    
    // Stop all auto-refresh
    stop: () => {
        Object.keys(autoRefreshIntervals).forEach(name => {
            clearInterval(autoRefreshIntervals[name]);
        });
        autoRefreshIntervals = {};
        console.log('🛑 All auto-refresh stopped');
    }
};

// Pause auto-refresh when page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        AutoRefreshManager.pause();
    } else {
        AutoRefreshManager.resume();
    }
});

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async function() {
    if (!checkAuth()) return;

    initMenuNavigation();
    initMobileMenu();
    initLogout();
    initRefreshButtons();
    initEditForm();
    
    await loadEmployeeInfo();
    
    // Load dashboard data and ensure statistics section is visible
    await loadDashboard();
    
    // Ensure overview section is visible and charts are initialized
    const overviewSection = document.getElementById('overviewSection');
    if (overviewSection) {
        overviewSection.style.display = 'block';
        
        // Wait a bit for DOM to be ready, then initialize charts
        setTimeout(() => {
            if (dashboardData && typeof Chart !== 'undefined') {
                initCharts(dashboardData);
            }
        }, 300);
    }
    
    // ==================== REGISTER AUTO-REFRESH ====================
    // Register auto-refresh for employee dashboard sections
    setTimeout(() => {
        // Dashboard overview auto-refresh
        AutoRefreshManager.register('dashboard', () => {
            const overviewSection = document.getElementById('overviewSection');
            if (overviewSection && overviewSection.style.display !== 'block') return;
            loadDashboard();
        });
        
        // Employee info auto-refresh
        AutoRefreshManager.register('employeeInfo', () => {
            const personalInfoSection = document.getElementById('personalInfoSection');
            if (personalInfoSection && personalInfoSection.style.display !== 'block') return;
            loadEmployeeInfo();
        });
        
        // Salaries auto-refresh
        AutoRefreshManager.register('salaries', () => {
            const salariesSection = document.getElementById('salariesSection');
            if (salariesSection && salariesSection.style.display !== 'block') return;
            loadSalaries();
        });
        
        console.log('✅ Auto-refresh system initialized for employee dashboard');
    }, 2000); // Wait 2 seconds after initial load
});

// ==================== MENU NAVIGATION ====================
function initMenuNavigation() {
    const menuLinks = document.querySelectorAll('#employeeMenu .sidebar-menu-link');
    const sections = document.querySelectorAll('.content-section');

    menuLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const sectionId = this.getAttribute('data-section');

            menuLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');

            sections.forEach(s => {
                s.style.display = 'none';
            });

            const targetSection = document.getElementById(`${sectionId}Section`);
            if (targetSection) {
                targetSection.style.display = 'block';
                
                // Load section data
                if (sectionId === 'overview') {
                    // If dashboard data already exists, just display it
                    if (dashboardData) {
                        displayDashboard(dashboardData);
                    } else {
                        loadDashboard();
                    }
                } else if (sectionId === 'personal') {
                    loadEmployeeInfo();
                } else if (sectionId === 'salaries') {
                    loadSalaries();
                }
            }

            // Close mobile menu
            // Use cached mobile state to avoid forced reflow
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                const employeeSidebar = document.getElementById('employeeSidebar');
                const sidebarOverlay = document.getElementById('sidebarOverlay');
                if (employeeSidebar) employeeSidebar.classList.remove('mobile-open');
                if (sidebarOverlay) sidebarOverlay.classList.remove('show');
                document.body.style.overflow = '';
            }
        });
    });
}

// ==================== MOBILE MENU ====================
function initMobileMenu() {
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const employeeSidebar = document.getElementById('employeeSidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (!mobileMenuToggle || !employeeSidebar || !sidebarOverlay) return;
    
    mobileMenuToggle.addEventListener('click', function() {
        employeeSidebar.classList.toggle('mobile-open');
        sidebarOverlay.classList.toggle('show');
        document.body.style.overflow = employeeSidebar.classList.contains('mobile-open') ? 'hidden' : '';
    });
    
    sidebarOverlay.addEventListener('click', function() {
        employeeSidebar.classList.remove('mobile-open');
        sidebarOverlay.classList.remove('show');
        document.body.style.overflow = '';
    });
    
    // Optimize resize handler to avoid forced reflows
    let resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            requestAnimationFrame(() => {
        if (window.innerWidth > 768) {
            employeeSidebar.classList.remove('mobile-open');
            sidebarOverlay.classList.remove('show');
            document.body.style.overflow = '';
        }
    });
        }, 100);
    }, { passive: true });
}

// ==================== LOGOUT ====================
function initLogout() {
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            if (confirm('Chiqishni xohlaysizmi?')) {
                localStorage.removeItem('authToken');
                localStorage.removeItem('userRole');
                window.location.href = '/employee-login';
            }
        });
    }
}

// ==================== REFRESH BUTTONS ====================
function initRefreshButtons() {
    if (refreshOverviewBtn) {
        refreshOverviewBtn.addEventListener('click', function() {
            loadDashboard();
        });
    }
    
    if (refreshPersonalBtn) {
        refreshPersonalBtn.addEventListener('click', function() {
            loadEmployeeInfo();
        });
    }
    
    if (refreshSalariesBtn) {
        refreshSalariesBtn.addEventListener('click', function() {
            loadSalaries();
        });
    }
}

// ==================== LOAD EMPLOYEE INFO ====================
async function loadEmployeeInfo() {
    try {
        const response = await apiRequest('/api/me-employee');
        if (!response) return;

        const data = await response.json();
        if (!data.success || !data.user) return;

        currentEmployeeId = data.user.id;
        displayPersonalInfo(data.user);
        populateEditForm(data.user);
        
        // Update sidebar
        const sidebarLogo = document.getElementById('sidebarLogo');
        const sidebarTitle = document.getElementById('sidebarTitle');
        if (data.user.organization_name && sidebarTitle) {
            sidebarTitle.textContent = data.user.organization_name;
        }
        if (data.user.logo_path && sidebarLogo) {
            sidebarLogo.src = data.user.logo_path;
            sidebarLogo.style.display = 'block';
        }
    } catch (error) {
        console.error('Load employee info error:', error);
    }
}

function displayPersonalInfo(employee) {
    if (!personalInfo) return;

    personalInfo.innerHTML = `
        <div class="personal-info-card">
            <div class="personal-info-icon" style="background: #eff6ff; color: #3b82f6;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
            </div>
            <div class="personal-info-content">
                <div class="personal-info-label">Username</div>
                <div class="personal-info-value">${escapeHtml(employee.username || '—')}</div>
            </div>
        </div>
        <div class="personal-info-card">
            <div class="personal-info-icon" style="background: #f0fdf4; color: #16a34a;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
            </div>
            <div class="personal-info-content">
                <div class="personal-info-label">To'liq Ism</div>
                <div class="personal-info-value">${escapeHtml(employee.full_name || '—')}</div>
            </div>
        </div>
        <div class="personal-info-card">
            <div class="personal-info-icon" style="background: #fef3c7; color: #f59e0b;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                </svg>
            </div>
            <div class="personal-info-content">
                <div class="personal-info-label">Lavozim</div>
                <div class="personal-info-value">${escapeHtml(employee.position || '—')}</div>
            </div>
        </div>
        <div class="personal-info-card">
            <div class="personal-info-icon" style="background: #f3e8ff; color: #9333ea;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
            </div>
            <div class="personal-info-content">
                <div class="personal-info-label">Telefon</div>
                <div class="personal-info-value">${escapeHtml(employee.phone || 'Kiritilmagan')}</div>
            </div>
        </div>
        <div class="personal-info-card">
            <div class="personal-info-icon" style="background: #fef2f2; color: #dc2626;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
            </div>
            <div class="personal-info-content">
                <div class="personal-info-label">Email</div>
                <div class="personal-info-value">${escapeHtml(employee.email || 'Kiritilmagan')}</div>
            </div>
        </div>
        <div class="personal-info-card">
            <div class="personal-info-icon" style="background: #f0f9ff; color: #0284c7;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
            </div>
            <div class="personal-info-content">
                <div class="personal-info-label">Qo'shilgan sana</div>
                <div class="personal-info-value">${formatDate(employee.created_at)}</div>
            </div>
        </div>
    `;
}

function populateEditForm(employee) {
    if (!editForm) return;
    
    const fullNameInput = document.getElementById('editFullName');
    const positionInput = document.getElementById('editPosition');
    const phoneInput = document.getElementById('editPhone');
    const emailInput = document.getElementById('editEmail');
    
    if (fullNameInput) fullNameInput.value = employee.full_name || '';
    if (positionInput) positionInput.value = employee.position || '';
    if (phoneInput) phoneInput.value = employee.phone || '';
    if (emailInput) emailInput.value = employee.email || '';
}

// ==================== LOAD DASHBOARD ====================
async function loadDashboard() {
    try {
        const response = await apiRequest('/api/employee/dashboard');
        if (!response) return;

        const data = await response.json();
        if (!data.success) return;

        dashboardData = data;
        displayDashboard(data);
    } catch (error) {
        console.error('Load dashboard error:', error);
    }
}

function displayDashboard(data) {
    const emp = data.employee || {};
    
    // Update header
    if (employeeName) {
        employeeName.textContent = emp.full_name || '—';
    }
    if (employeePosition) {
        employeePosition.textContent = emp.position || '—';
    }
    
    // Display statistics
    displayStatistics(data.totals || {});
    
    // Display charts
    if (typeof Chart !== 'undefined') {
        setTimeout(() => {
            initCharts(data);
        }, 100);
    }
    
    // Display work schedule
    displayWorkSchedule(data.work_schedule || []);
    
    // Display attendance
    displayAttendance(data.attendance_days || []);
}

function displayStatistics(totals) {
    if (!statsGrid) return;
    
    statsGrid.innerHTML = `
        <div class="stat-card-modern">
            <div class="stat-card-icon" style="background: #eff6ff; color: #3b82f6;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
            </div>
            <div>
                <div class="stat-card-label">Ish Vaqti (30 kun)</div>
                <div class="stat-card-value">${(totals.total_work_hours_30d || 0).toFixed(1)} soat</div>
            </div>
        </div>
        <div class="stat-card-modern">
            <div class="stat-card-icon" style="background: #fef3c7; color: #f59e0b;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
            </div>
            <div>
                <div class="stat-card-label">Kechikish (30 kun)</div>
                <div class="stat-card-value">${totals.total_late_minutes_30d || 0} daqiqa</div>
            </div>
        </div>
        <div class="stat-card-modern">
            <div class="stat-card-icon" style="background: #f0fdf4; color: #16a34a;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
            </div>
            <div>
                <div class="stat-card-label">Maosh (oylik)</div>
                <div class="stat-card-value">${formatMoney(totals.total_salary_month || 0)} so'm</div>
            </div>
        </div>
        <div class="stat-card-modern">
            <div class="stat-card-icon" style="background: #f0fdf4; color: #16a34a;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
            </div>
            <div>
                <div class="stat-card-label">Bonus (oylik)</div>
                <div class="stat-card-value">${formatMoney(totals.total_bonus_month || 0)} so'm</div>
            </div>
        </div>
        <div class="stat-card-modern">
            <div class="stat-card-icon" style="background: #fef2f2; color: #dc2626;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
            </div>
            <div>
                <div class="stat-card-label">Jarima (oylik)</div>
                <div class="stat-card-value">${formatMoney(totals.total_penalty_month || 0)} so'm</div>
            </div>
        </div>
        <div class="stat-card-modern">
            <div class="stat-card-icon" style="background: #eff6ff; color: #3b82f6;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                </svg>
            </div>
            <div>
                <div class="stat-card-label">Jami (oylik)</div>
                <div class="stat-card-value">${formatMoney(totals.net_amount_month || 0)} so'm</div>
            </div>
        </div>
    `;
}

function displayWorkSchedule(schedules) {
    if (!workScheduleCompact) return;
    
    if (schedules.length === 0) {
        workScheduleCompact.innerHTML = '<div style="text-align: center; padding: 20px; color: #6b7280;">Ish jadvali belgilanmagan</div>';
        return;
    }
    
    workScheduleCompact.innerHTML = schedules.map(schedule => {
        const dayName = getDayName(schedule.day_of_week);
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;">
                <div style="font-size: 13px; font-weight: 500; color: #111827;">${dayName}</div>
                <div style="font-size: 13px; color: #6b7280;">${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}</div>
            </div>
        `;
    }).join('');
}

function displayAttendance(attendanceDays) {
    // attendanceDays may now include 'events' array with all entry/exit events
    if (!attendanceList) return;
    
    if (attendanceDays.length === 0) {
        attendanceList.innerHTML = '<div style="text-align: center; padding: 20px; color: #6b7280;">Davomat ma\'lumotlari yo\'q</div>';
        return;
    }
    
    // Show last 10 days
    const recentDays = attendanceDays.slice(-10).reverse();
    
    attendanceList.innerHTML = recentDays.map(day => {
        const date = new Date(day.date);
        const dateStr = date.toLocaleDateString('uz-UZ', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        const dayName = getDayName(date.getDay() === 0 ? 7 : date.getDay());
        
        // If events array exists, show all entry/exit pairs
        let eventsHtml = '';
        if (day.events && Array.isArray(day.events) && day.events.length > 0) {
            // Group events into entry-exit pairs
            const pairs = [];
            let currentEntry = null;
            
            for (const event of day.events) {
                if (event.type === 'entry') {
                    currentEntry = event.time;
                } else if (event.type === 'exit' && currentEntry) {
                    pairs.push({ entry: currentEntry, exit: event.time });
                    currentEntry = null;
                }
            }
            
            // If there's an unpaired entry, show it
            if (currentEntry) {
                pairs.push({ entry: currentEntry, exit: null });
            }
            
            if (pairs.length > 0) {
                eventsHtml = pairs.map(pair => {
                    const entryTime = formatTime(pair.entry);
                    const exitTime = pair.exit ? formatTime(pair.exit) : '—';
                    return `${entryTime} → ${exitTime}`;
                }).join(' | ');
            } else {
                // Fallback to simple display
                eventsHtml = `${day.entry_time ? `Kirish: ${formatTime(day.entry_time)}` : 'Kirish: —'} ${day.exit_time ? `| Chiqish: ${formatTime(day.exit_time)}` : '| Chiqish: —'}`;
            }
        } else {
            // Fallback to simple display if no events array
            eventsHtml = `${day.entry_time ? `Kirish: ${formatTime(day.entry_time)}` : 'Kirish: —'} ${day.exit_time ? `| Chiqish: ${formatTime(day.exit_time)}` : '| Chiqish: —'}`;
        }
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: white; border: 1px solid #e5e7eb; border-radius: 6px;">
                <div style="flex: 1;">
                    <div style="font-size: 13px; font-weight: 500; color: #111827;">${dayName}, ${dateStr}</div>
                    <div style="font-size: 12px; color: #6b7280; margin-top: 4px; word-break: break-word;">
                        ${eventsHtml}
                    </div>
                </div>
                <div style="width: 8px; height: 8px; border-radius: 50%; background: ${day.entry_time ? '#10b981' : '#ef4444'}; flex-shrink: 0; margin-left: 8px;"></div>
            </div>
        `;
    }).join('');
}

// ==================== LOAD SALARIES ====================
async function loadSalaries() {
    if (!dashboardData) {
        await loadDashboard();
    }
    
    if (dashboardData) {
        displaySalaries(dashboardData.salaries || []);
        displayBonuses(dashboardData.bonuses || []);
        displayPenalties(dashboardData.penalties || []);
    }
}

function displaySalaries(salaries) {
    if (!salariesList) return;
    
    if (salaries.length === 0) {
        salariesList.innerHTML = '<div style="text-align: center; padding: 20px; color: #6b7280;">Maosh ma\'lumotlari yo\'q</div>';
        return;
    }
    
    salariesList.innerHTML = salaries.map(salary => {
        return `
            <div style="padding: 12px 16px; background: white; border: 1px solid #e5e7eb; border-radius: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div style="font-size: 14px; font-weight: 600; color: #111827;">${formatMoney(salary.amount)} so'm</div>
                    <div style="font-size: 12px; color: #6b7280;">${formatPeriodType(salary.period_type)}</div>
                </div>
                <div style="font-size: 12px; color: #6b7280;">
                    ${formatDate(salary.period_date)} ${salary.notes ? `• ${escapeHtml(salary.notes)}` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function displayBonuses(bonuses) {
    if (!bonusesList) return;
    
    if (bonuses.length === 0) {
        bonusesList.innerHTML = '<div style="text-align: center; padding: 16px; color: #6b7280; font-size: 13px;">Bonuslar yo\'q</div>';
        return;
    }
    
    bonusesList.innerHTML = bonuses.map(bonus => {
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px;">
                <div>
                    <div style="font-size: 13px; font-weight: 600; color: #16a34a;">+${formatMoney(bonus.amount)} so'm</div>
                    <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${escapeHtml(bonus.reason || '—')}</div>
                </div>
                <div style="font-size: 12px; color: #6b7280;">${formatDate(bonus.period_date)}</div>
            </div>
        `;
    }).join('');
}

function displayPenalties(penalties) {
    if (!penaltiesList) return;
    
    if (penalties.length === 0) {
        penaltiesList.innerHTML = '<div style="text-align: center; padding: 16px; color: #6b7280; font-size: 13px;">Jarimalar yo\'q</div>';
        return;
    }
    
    penaltiesList.innerHTML = penalties.map(penalty => {
        // Parse reason to extract date and minutes
        let reasonText = penalty.reason || '—';
        let dateText = '';
        let minutesText = '';
        
        // Try to parse format like "2026-01-08: Kech qolgan: 332 minut"
        const reasonMatch = reasonText.match(/(\d{4}-\d{2}-\d{2}):\s*(.+?):\s*(\d+)\s*minut/i);
        if (reasonMatch) {
            const date = new Date(reasonMatch[1]);
            dateText = date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' });
            const minutes = parseInt(reasonMatch[3]);
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            if (hours > 0) {
                minutesText = `${hours}.${Math.floor(mins / 6)} soat`;
            } else {
                minutesText = `${minutes} min`;
            }
            reasonText = reasonMatch[2]; // "Kech qolgan"
        } else {
            // Try simpler format
            const simpleMatch = reasonText.match(/(\d{4}-\d{2}-\d{2})/);
            if (simpleMatch) {
                const date = new Date(simpleMatch[1]);
                dateText = date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' });
                reasonText = reasonText.replace(/\d{4}-\d{2}-\d{2}:\s*/g, '').trim();
            } else {
                dateText = formatDate(penalty.penalty_date || penalty.period_date);
            }
        }
        
        // If no date extracted, use penalty_date or period_date
        if (!dateText) {
            dateText = formatDate(penalty.penalty_date || penalty.period_date);
        }
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: white; border: 1px solid #fee2e2; border-radius: 8px; transition: all 0.2s ease;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <div style="font-size: 14px; font-weight: 600; color: #dc2626;">-${formatMoney(penalty.amount)} so'm</div>
                        ${minutesText ? `<span style="font-size: 11px; color: #9ca3af; background: #fef2f2; padding: 2px 6px; border-radius: 4px;">${minutesText}</span>` : ''}
                    </div>
                    <div style="font-size: 12px; color: #6b7280; display: flex; align-items: center; gap: 6px;">
                        <span>${escapeHtml(reasonText)}</span>
                    </div>
                </div>
                <div style="font-size: 11px; color: #9ca3af; text-align: right; flex-shrink: 0; margin-left: 12px;">
                    ${dateText}
                </div>
            </div>
        `;
    }).join('');
}

// ==================== EDIT FORM ====================
function initEditForm() {
    if (!editForm) return;
    
    editForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const fullName = document.getElementById('editFullName')?.value.trim();
        const position = document.getElementById('editPosition')?.value.trim();
        const phone = document.getElementById('editPhone')?.value.trim();
        const email = document.getElementById('editEmail')?.value.trim();
        
        if (!fullName || !position) {
            showEditError('To\'liq ism va lavozim kiritishingiz kerak');
            return;
        }
        
        hideEditMessages();
        setEditLoading(true);
        
        try {
            const response = await apiRequest(`/api/employees/${currentEmployeeId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    full_name: fullName,
                    position: position,
                    phone: phone || null,
                    email: email || null
                })
            });
            
            if (!response) {
                setEditLoading(false);
                return;
            }
            
            const data = await response.json();
            setEditLoading(false);
            
            if (data.success) {
                showEditSuccess('Ma\'lumotlar muvaffaqiyatli yangilandi');
                await loadEmployeeInfo();
                await loadDashboard();
            } else {
                showEditError(data.message || 'Ma\'lumotlarni yangilashda xatolik');
            }
        } catch (error) {
            console.error('Update employee error:', error);
            setEditLoading(false);
            showEditError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
        }
    });
}

function hideEditMessages() {
    if (editError) editError.style.display = 'none';
    if (editSuccess) editSuccess.style.display = 'none';
}

function showEditError(message) {
    hideEditMessages();
    if (editError) {
        editError.textContent = message;
        editError.style.display = 'block';
    }
}

function showEditSuccess(message) {
    hideEditMessages();
    if (editSuccess) {
        editSuccess.textContent = message;
        editSuccess.style.display = 'block';
        setTimeout(() => {
            if (editSuccess) editSuccess.style.display = 'none';
        }, 3000);
    }
}

function setEditLoading(loading) {
    if (saveBtn) {
        saveBtn.disabled = loading;
        if (saveLoader) saveLoader.style.display = loading ? 'inline-block' : 'none';
        const btnText = saveBtn.querySelector('.btn-text');
        if (btnText) btnText.textContent = loading ? 'Saqlanmoqda...' : 'Saqlash';
    }
}

// ==================== CHARTS ====================
let attendanceChartInstance = null;
let workHoursChartInstance = null;
let salaryTrendChartInstance = null;
let bonusPenaltyChartInstance = null;

function initCharts(data) {
    // Check if overview section is visible
    const overviewSection = document.getElementById('overviewSection');
    if (!overviewSection || overviewSection.style.display === 'none') {
        console.log('Overview section is hidden, charts will be initialized when section is shown');
        return;
    }
    
    // Check if canvas elements exist
    const attendanceChart = document.getElementById('attendanceChart');
    const workHoursChart = document.getElementById('workHoursChart');
    const salaryTrendChart = document.getElementById('salaryTrendChart');
    const bonusPenaltyChart = document.getElementById('bonusPenaltyChart');
    
    if (!attendanceChart || !workHoursChart || !salaryTrendChart || !bonusPenaltyChart) {
        console.log('Chart canvas elements not found, retrying...');
        setTimeout(() => {
            initCharts(data);
        }, 100);
        return;
    }
    
    // Destroy existing charts
    if (attendanceChartInstance) {
        try {
            attendanceChartInstance.destroy();
        } catch (e) {
            console.error('Error destroying attendance chart:', e);
        }
    }
    if (workHoursChartInstance) {
        try {
            workHoursChartInstance.destroy();
        } catch (e) {
            console.error('Error destroying work hours chart:', e);
        }
    }
    if (salaryTrendChartInstance) {
        try {
            salaryTrendChartInstance.destroy();
        } catch (e) {
            console.error('Error destroying salary trend chart:', e);
        }
    }
    if (bonusPenaltyChartInstance) {
        try {
            bonusPenaltyChartInstance.destroy();
        } catch (e) {
            console.error('Error destroying bonus penalty chart:', e);
        }
    }

    // Initialize charts immediately
    try {
        // Attendance Chart (30 days)
        initAttendanceChart(data.attendance_days || []);
        
        // Work Hours Chart (Weekly)
        initWorkHoursChart(data.weekly_attendance || []);
        
        // Salary Trend Chart
        initSalaryTrendChart(data.salaries || []);
        
        // Bonus vs Penalty Chart
        initBonusPenaltyChart(data.bonuses || [], data.penalties || []);
    } catch (error) {
        console.error('Error initializing charts:', error);
        // Retry after a short delay
        setTimeout(() => {
            initCharts(data);
        }, 200);
    }
}

function initAttendanceChart(attendanceDays) {
    const ctx = document.getElementById('attendanceChart');
    if (!ctx) return;

    // Group by date and count entries
    const dayMap = new Map();
    attendanceDays.forEach(day => {
        const date = new Date(day.date);
        const key = date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' });
        if (!dayMap.has(key)) {
            dayMap.set(key, { date: key, count: 0 });
        }
        if (day.entry_time) {
            dayMap.get(key).count++;
        }
    });

    const labels = Array.from(dayMap.keys()).slice(-14); // Last 14 days
    const values = labels.map(label => dayMap.get(label)?.count || 0);

    attendanceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Davomat',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 10,
                    titleFont: { size: 12 },
                    bodyFont: { size: 11 }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 },
                        stepSize: 1
                    },
                    grid: {
                        color: '#f3f4f6'
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10 },
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function initWorkHoursChart(weeklyAttendance) {
    const ctx = document.getElementById('workHoursChart');
    if (!ctx) return;

    const dayNames = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
    const labels = [];
    const workHours = [];

    weeklyAttendance.forEach(day => {
        const date = new Date(day.date);
        const dayName = dayNames[day.day_of_week - 1] || '—';
        labels.push(dayName);
        
        let hours = 0;
        if (day.entry_time && day.exit_time) {
            const entry = new Date(day.entry_time);
            const exit = new Date(day.exit_time);
            hours = (exit.getTime() - entry.getTime()) / (1000 * 60 * 60);
        }
        workHours.push(Math.round(hours * 10) / 10);
    });

    workHoursChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ish Vaqti (soat)',
                data: workHours,
                backgroundColor: '#10b981',
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            return context.parsed.y.toFixed(1) + ' soat';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 },
                        callback: function(value) {
                            return value + 'h';
                        }
                    },
                    grid: {
                        color: '#f3f4f6'
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10 }
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function initSalaryTrendChart(salaries) {
    const ctx = document.getElementById('salaryTrendChart');
    if (!ctx) return;

    // Group by month
    const monthMap = new Map();
    salaries.forEach(salary => {
        const date = new Date(salary.period_date);
        const monthKey = date.toLocaleDateString('uz-UZ', { month: 'short', year: 'numeric' });
        if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, 0);
        }
        monthMap.set(monthKey, monthMap.get(monthKey) + parseFloat(salary.amount || 0));
    });

    const labels = Array.from(monthMap.keys()).slice(-6); // Last 6 months
    const values = labels.map(label => monthMap.get(label) || 0);

    salaryTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Maosh',
                data: values,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointBackgroundColor: '#8b5cf6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            return formatMoney(context.parsed.y) + ' so\'m';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 },
                        callback: function(value) {
                            return formatMoney(value);
                        }
                    },
                    grid: {
                        color: '#f3f4f6'
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10 },
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function initBonusPenaltyChart(bonuses, penalties) {
    const ctx = document.getElementById('bonusPenaltyChart');
    if (!ctx) return;

    // Group by month
    const monthMap = new Map();
    
    bonuses.forEach(bonus => {
        const date = new Date(bonus.period_date);
        const monthKey = date.toLocaleDateString('uz-UZ', { month: 'short', year: 'numeric' });
        if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { bonus: 0, penalty: 0 });
        }
        monthMap.get(monthKey).bonus += parseFloat(bonus.amount || 0);
    });
    
    penalties.forEach(penalty => {
        const date = new Date(penalty.period_date);
        const monthKey = date.toLocaleDateString('uz-UZ', { month: 'short', year: 'numeric' });
        if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, { bonus: 0, penalty: 0 });
        }
        monthMap.get(monthKey).penalty += parseFloat(penalty.amount || 0);
    });

    const labels = Array.from(monthMap.keys()).slice(-6).sort(); // Last 6 months
    const bonusValues = labels.map(label => monthMap.get(label)?.bonus || 0);
    const penaltyValues = labels.map(label => monthMap.get(label)?.penalty || 0);

    bonusPenaltyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Bonuslar',
                    data: bonusValues,
                    backgroundColor: '#10b981',
                    borderRadius: 6
                },
                {
                    label: 'Jarimalar',
                    data: penaltyValues,
                    backgroundColor: '#ef4444',
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        font: { size: 11 },
                        padding: 10,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatMoney(context.parsed.y) + ' so\'m';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 },
                        callback: function(value) {
                            return formatMoney(value);
                        }
                    },
                    grid: {
                        color: '#f3f4f6'
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10 },
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}
