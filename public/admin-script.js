
function getAuthToken() {
    return localStorage.getItem('authToken');
}

// Global utility functions
function formatCurrency(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return '0 so\'m';
    return new Intl.NumberFormat('uz-UZ', {
        style: 'currency',
        currency: 'UZS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount).replace('UZS', 'so\'m');
}

// Narx input'larini format qilish (3 ta sondan keyin nuqta)
function formatAmountInput(input) {
    if (!input) return;

    // Faqat raqamlarni qoldirish (nuqta va vergulni olib tashlash)
    let value = input.value.replace(/[^\d]/g, '');

    // Agar bo'sh bo'lsa, bo'sh qoldirish
    if (!value) {
        input.value = '';
        return;
    }

    // Raqamni format qilish (3 ta sondan keyin nuqta, masalan 3000 -> 3.000)
    const numValue = parseInt(value, 10);
    // Intl.NumberFormat o'rniga oddiy regex, chunki Intl nbsp (bo'sh joy) qo'yadi
    const formatted = numValue
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    // Input'ga formatlangan qiymatni yozish
    input.value = formatted;
}

// Narx input'larini format qilish (input event uchun)
function setupAmountInputFormatting(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Agar allaqachon event listener qo'shilgan bo'lsa, qayta qo'shmaslik
    if (input.dataset.formatted === 'true') return;
    input.dataset.formatted = 'true';

    // Input event - yozish paytida format qilish
    input.addEventListener('input', function (e) {
        const target = e.target;
        const cursorPosition = target.selectionStart;
        const oldValue = target.value;

        // Format qilish
        formatAmountInput(target);

        // Cursor pozitsiyasini tiklash faqat matn inputlarida
        if (target.type === 'text' && typeof target.setSelectionRange === 'function') {
            const newValue = target.value;
            const diff = newValue.length - oldValue.length;
            const newPosition = Math.max(0, Math.min((cursorPosition || 0) + diff, newValue.length));
            try {
                target.setSelectionRange(newPosition, newPosition);
            } catch (err) {
                // Ba'zi brauzerlar xato berishi mumkin - e'tiborsiz qoldiramiz
            }
        }
    });

    // Blur event - focus yo'qotganda format qilish
    input.addEventListener('blur', function (e) {
        formatAmountInput(e.target);
    });

    // Focus event - focus olganda format qilish
    input.addEventListener('focus', function (e) {
        formatAmountInput(e.target);
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showTerminalLockedNotification(data) {
    const { terminalName, ipAddress, username, unlockTimeSeconds, unlockTimeStr } = data;

    const notification = document.createElement('div');
    notification.className = 'terminal-locked-notification';
    notification.innerHTML = `
        <div class="terminal-locked-notification-content">
            <div class="terminal-locked-notification-header">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <circle cx="12" cy="16" r="1"></circle>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                <span class="terminal-locked-notification-title">Terminal Bloklangan</span>
                <button class="terminal-locked-notification-close" onclick="this.parentElement.parentElement.parentElement.remove()">×</button>
            </div>
            <div class="terminal-locked-notification-body">
                <div class="terminal-locked-info-item">
                    <strong>Terminal:</strong> ${terminalName || 'Noma\'lum'}
                </div>
                <div class="terminal-locked-info-item">
                    <strong>IP Manzil:</strong> ${ipAddress || 'Noma\'lum'}
                </div>
                <div class="terminal-locked-info-item">
                    <strong>Username:</strong> ${username || 'admin'}
                </div>
                <div class="terminal-locked-info-item">
                    <strong>Qulf vaqti:</strong> 
                    <span class="terminal-locked-time">${unlockTimeStr}</span>
                </div>
                <div class="terminal-locked-solutions">
                    <strong>Yechim:</strong>
                    <ul>
                        <li>Terminalni fizik jihatdan qayta ishga tushiring</li>
                        <li>${unlockTimeSeconds > 0 ? `Yoki ${unlockTimeStr} kutib turing` : 'Yoki terminal Web interfeysida account qulfini oching'}</li>
                        <li>Yoki terminal Web interfeysida account qulfini oching</li>
                    </ul>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    }, 15000);
}


// Request cache va debouncing
const requestCache = new Map();
const requestDebounce = new Map();
const CACHE_TTL = 30000; // 30 soniya
const DEBOUNCE_DELAY = 300; // 300ms

async function apiRequest(endpoint, options = {}) {
    const token = getAuthToken();
    const defaultHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // GET so'rovlar uchun cache
    const isGetRequest = !options.method || options.method === 'GET';
    const cacheKey = `${endpoint}_${JSON.stringify(options)}`;

    if (isGetRequest && requestCache.has(cacheKey)) {
        const cached = requestCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            // Cache'dan ma'lumotni Response formatida qaytarish
            return Promise.resolve(new Response(JSON.stringify(cached.data), {
                status: 200,
                statusText: 'OK',
                headers: { 'Content-Type': 'application/json' }
            }));
        }
        requestCache.delete(cacheKey);
    }

    // Debouncing - bir xil so'rovlar uchun
    // MUHIM: Response body'ni ikki marta o'qilmasligi uchun clone() ishlatamiz
    if (isGetRequest && requestDebounce.has(cacheKey)) {
        return new Promise(async (resolve, reject) => {
            try {
                const existingPromise = requestDebounce.get(cacheKey);
                const existingResponse = await existingPromise;
                // Response body'ni ikki marta o'qilmasligi uchun clone() ishlatamiz
                if (existingResponse && existingResponse.ok) {
                    resolve(existingResponse.clone());
                } else {
                    resolve(existingResponse);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    try {
        const requestPromise = fetch(endpoint, {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers
            }
        }).then(async (response) => {
            // Cache'ga saqlash (faqat muvaffaqiyatli so'rovlar uchun)
            if (isGetRequest && response.ok) {
                const clonedResponse = response.clone();
                try {
                    const data = await clonedResponse.json();
                    requestCache.set(cacheKey, {
                        data,
                        timestamp: Date.now()
                    });
                } catch (e) {
                    // JSON parse xatolik - cache'ga saqlamaymiz
                }
            }
            requestDebounce.delete(cacheKey);
            return response;
        });

        if (isGetRequest) {
            requestDebounce.set(cacheKey, requestPromise);
        }

        const response = await requestPromise;

        if (response.status === 401) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            window.location.href = '/';
            return null;
        }

        if (response.status === 403) {
            const errorData = await response.json().catch(() => ({ message: 'Ruxsat berilmagan' }));
            console.error('403 Forbidden:', endpoint, errorData.message);
            // 403 xatolikni ko'rsatish
            alert(errorData.message || 'Ruxsat berilmagan. Iltimos, administratorga murojaat qiling.');
            return null;
        }

        // 404 xatolikni to'g'ri qaytarish
        if (response.status === 404) {
            console.error('Endpoint topilmadi:', endpoint, 'Status:', response.status);
            // Response obyektini o'zgartirmasdan qaytaramiz, lekin xatolikni log qilamiz
        }

        return response;
    } catch (error) {
        console.error('API Request error:', error, 'Endpoint:', endpoint);
        return null;
    }
}


let deleteUserId = null;
let editUserId = null;
let editUserUsername = null;
let deleteEmployeeId = null;
let editEmployeeId = null;


const addAdminForm = document.getElementById('addAdminForm');
const addBtn = document.getElementById('addBtn');
const addLoader = document.getElementById('addLoader');
const btnText = document.querySelector('.btn-text');
const addErrorMessage = document.getElementById('addErrorMessage');
const addSuccessMessage = document.getElementById('addSuccessMessage');
const adminsList = document.getElementById('adminsList');
const loadingMessage = document.getElementById('loadingMessage');
const emptyMessage = document.getElementById('emptyMessage');
const refreshBtn = document.getElementById('refreshBtn');
const addAdminModal = document.getElementById('addAdminModal');
const openAddAdminModal = document.getElementById('openAddAdminModal');
const closeAddAdminModal = document.getElementById('closeAddAdminModal');
const cancelAddAdmin = document.getElementById('cancelAddAdmin');
const logoutBtn = document.getElementById('logoutBtn');
const editModal = document.getElementById('editModal');
const editAdminForm = document.getElementById('editAdminForm');
const editUsername = document.getElementById('editUsername');
const editPassword = document.getElementById('editPassword');
const editRole = document.getElementById('editRole');
const editErrorMessage = document.getElementById('editErrorMessage');
const editSuccessMessage = document.getElementById('editSuccessMessage');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const saveEditBtn = document.getElementById('saveEditBtn');
const editLoader = document.getElementById('editLoader');
const deleteModal = document.getElementById('deleteModal');
const deleteUsername = document.getElementById('deleteUsername');
const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');


const organizationSettingsForm = document.getElementById('organizationSettingsForm');
const organizationName = document.getElementById('organizationName');
const organizationAddress = document.getElementById('organizationAddress');
const organizationPhone = document.getElementById('organizationPhone');
const organizationEmail = document.getElementById('organizationEmail');
const logoUpload = document.getElementById('logoUpload');
const logoPreview = document.getElementById('logoPreview');
const saveOrganizationBtn = document.getElementById('saveOrganizationBtn');
const saveOrganizationLoader = document.getElementById('saveOrganizationLoader');
const organizationErrorMessage = document.getElementById('organizationErrorMessage');
const organizationSuccessMessage = document.getElementById('organizationSuccessMessage');
const sidebarLogo = document.getElementById('sidebarLogo');
const sidebarTitle = document.getElementById('sidebarTitle');
const lateThresholdMinutes = document.getElementById('lateThresholdMinutes');
const penaltyPerMinute = document.getElementById('penaltyPerMinute');
const maxPenaltyPerDay = document.getElementById('maxPenaltyPerDay');


let currentUserRole = null;
let currentUserPermissions = {};

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

        console.log(`✅ Auto-refresh registered: ${name} (every ${interval / 1000}s)`);
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


// Barcha amount input'larini format qilish uchun setup
function setupAllAmountInputs() {
    // Barcha amount input field'larini topish va format qilish
    const amountInputIds = [
        'salaryAmount',
        'editSalaryAmount',
        'modalSalaryRateAmount',
        'editSalaryRateAmount',
        'modalBonusAmount',
        'bonusAmount',
        'penaltyAmount',
        'lateThresholdMinutes',
        'penaltyPerMinute',
        'maxPenaltyPerDay'
    ];

    amountInputIds.forEach(inputId => {
        setupAmountInputFormatting(inputId);
    });

    // Dynamic yaratilgan input'lar uchun (modal'lar ochilganda)
    // Observer pattern yoki event delegation ishlatish mumkin
    // Lekin hozircha asosiy input'lar uchun yetarli
}

document.addEventListener('DOMContentLoaded', async function () {
    // Barcha amount input'larini format qilish uchun setup
    setupAllAmountInputs();

    if (!getAuthToken()) {
        window.location.href = '/';
        return;
    }


    try {
        const response = await apiRequest('/api/me');
        if (response) {
            const data = await response.json();
            if (data.success && data.user) {
                currentUserRole = data.user.role;
                currentUserPermissions = data.user.permissions || {};


                const adminSection = document.querySelector('.add-admin-card');
                const adminListCard = document.querySelector('.admins-list-card');

                if (currentUserRole === 'super_admin') {

                    const employeesListSection = document.getElementById('employeesListSection');
                    const positionsSection = document.getElementById('positionsManagementSection');
                    const orgSection = document.getElementById('organizationSettingsSection');
                    if (employeesListSection) employeesListSection.style.display = 'none';
                    if (positionsSection) positionsSection.style.display = 'none';
                    if (orgSection) orgSection.style.display = 'none';

                    loadAdmins();
                } else if (currentUserRole === 'admin') {

                    const adminsSection = document.getElementById('adminsSection');
                    if (adminsSection) adminsSection.style.display = 'none';

                    // Obuna holatini tekshirish
                    if (data.user.subscription_due_date) {
                        checkSubscriptionStatus(data.user);
                    }


                    loadEmployees();
                    loadPositions();
                    loadOrganizationSettings();
                    loadEmployeesForSalaries();
                } else {

                    const adminsSection = document.getElementById('adminsSection');
                    const orgSection = document.getElementById('organizationSettingsSection');
                    if (adminsSection) adminsSection.style.display = 'none';
                    if (orgSection) orgSection.style.display = 'none';
                }


                updateHeaderWithOrganization(data.user.organization_name, data.user.logo_path);


                initSidebarMenu(currentUserRole);

                // Initialize mobile menu
                initMobileMenu();
            }
        }
    } catch (error) {
        console.error('Error getting user info:', error);
    }




    const addEmployeeIconBtn = document.getElementById('addEmployeeIconBtn');
    if (addEmployeeIconBtn) {
        addEmployeeIconBtn.addEventListener('click', async function () {
            await loadAndCreateEmployeesFromTerminals();
        });
    }


    const submenuLinks = document.querySelectorAll('.submenu-link');
    submenuLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const subsectionId = this.getAttribute('data-subsection');
            if (subsectionId) {
                if (subsectionId.startsWith('employees')) {
                    showEmployeesSubsection(subsectionId);
                }
                // Moliya bo'limi uchun subsection yo'q
            }
        });
    });


    const addPositionIconBtn = document.getElementById('addPositionIconBtn');
    if (addPositionIconBtn) {
        addPositionIconBtn.addEventListener('click', function () {
            showAddPositionModal();
        });
    }


    const addDailyChangeIconBtn = document.getElementById('addDailyChangeIconBtn');
    if (addDailyChangeIconBtn) {
        addDailyChangeIconBtn.addEventListener('click', function () {
            showAddDailyChangeModal();
        });
    }


    const refreshDailyChangesBtn = document.getElementById('refreshDailyChangesBtn');
    if (refreshDailyChangesBtn) {
        refreshDailyChangesBtn.addEventListener('click', function () {
            loadDailyChanges();
        });
    }

    // Daily changes filters and search
    const dailyChangesSearch = document.getElementById('dailyChangesSearch');
    const dailyChangesTypeFilter = document.getElementById('dailyChangesTypeFilter');
    const dailyChangesStartDate = document.getElementById('dailyChangesStartDate');
    const dailyChangesEndDate = document.getElementById('dailyChangesEndDate');
    const dailyChangesQuickToday = document.getElementById('dailyChangesQuickToday');
    const dailyChangesQuickWeek = document.getElementById('dailyChangesQuickWeek');
    const dailyChangesClearFilters = document.getElementById('dailyChangesClearFilters');

    if (dailyChangesSearch) {
        dailyChangesSearch.addEventListener('input', function () {
            dailyChangesFilterState.search = this.value;
            applyFiltersAndDisplay();
        });
    }

    if (dailyChangesTypeFilter) {
        dailyChangesTypeFilter.addEventListener('change', function () {
            dailyChangesFilterState.changeType = this.value;
            loadDailyChanges();
        });
    }

    if (dailyChangesStartDate) {
        dailyChangesStartDate.addEventListener('change', function () {
            dailyChangesFilterState.startDate = this.value;
            if (dailyChangesFilterState.startDate && dailyChangesFilterState.endDate) {
                if (dailyChangesFilterState.startDate > dailyChangesFilterState.endDate) {
                    dailyChangesFilterState.endDate = dailyChangesFilterState.startDate;
                    if (dailyChangesEndDate) dailyChangesEndDate.value = dailyChangesFilterState.startDate;
                }
            }
            loadDailyChanges();
        });
    }

    if (dailyChangesEndDate) {
        dailyChangesEndDate.addEventListener('change', function () {
            dailyChangesFilterState.endDate = this.value;
            if (dailyChangesFilterState.startDate && dailyChangesFilterState.endDate) {
                if (dailyChangesFilterState.startDate > dailyChangesFilterState.endDate) {
                    dailyChangesFilterState.startDate = dailyChangesFilterState.endDate;
                    if (dailyChangesStartDate) dailyChangesStartDate.value = dailyChangesFilterState.endDate;
                }
            }
            loadDailyChanges();
        });
    }

    if (dailyChangesQuickToday) {
        dailyChangesQuickToday.addEventListener('click', function () {
            const today = new Date().toISOString().split('T')[0];
            dailyChangesFilterState.startDate = today;
            dailyChangesFilterState.endDate = today;
            if (dailyChangesStartDate) dailyChangesStartDate.value = today;
            if (dailyChangesEndDate) dailyChangesEndDate.value = today;
            dailyChangesFilterState.changeType = '';
            if (dailyChangesTypeFilter) dailyChangesTypeFilter.value = '';
            dailyChangesFilterState.search = '';
            if (dailyChangesSearch) dailyChangesSearch.value = '';

            document.querySelectorAll('.quick-filter-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            loadDailyChanges();
        });
    }

    if (dailyChangesQuickWeek) {
        dailyChangesQuickWeek.addEventListener('click', function () {
            const today = new Date().toISOString().split('T')[0];
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            dailyChangesFilterState.startDate = weekAgo;
            dailyChangesFilterState.endDate = today;
            if (dailyChangesStartDate) dailyChangesStartDate.value = weekAgo;
            if (dailyChangesEndDate) dailyChangesEndDate.value = today;
            dailyChangesFilterState.changeType = '';
            if (dailyChangesTypeFilter) dailyChangesTypeFilter.value = '';
            dailyChangesFilterState.search = '';
            if (dailyChangesSearch) dailyChangesSearch.value = '';

            document.querySelectorAll('.quick-filter-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            loadDailyChanges();
        });
    }

    // Calendar and Download buttons for daily changes
    const calendarDailyChangesBtn = document.getElementById('calendarDailyChangesBtn');
    if (calendarDailyChangesBtn) {
        calendarDailyChangesBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleDailyChangesCalendar();
        });
    }

    // Close calendar when clicking outside
    document.addEventListener('click', function (e) {
        const calendarWidget = document.getElementById('dailyChangesCalendarWidget');
        const calendarBtn = document.getElementById('calendarDailyChangesBtn');
        if (calendarWidget && calendarBtn &&
            !calendarWidget.contains(e.target) &&
            !calendarBtn.contains(e.target)) {
            hideDailyChangesCalendar();
        }
    });

    const downloadDailyChangesBtn = document.getElementById('downloadDailyChangesBtn');
    if (downloadDailyChangesBtn) {
        downloadDailyChangesBtn.addEventListener('click', function () {
            downloadDailyChangesList();
        });
    }


    const addSalaryRateIconBtn = document.getElementById('addSalaryRateIconBtn');
    if (addSalaryRateIconBtn) {
        addSalaryRateIconBtn.addEventListener('click', function () {
            showAddSalaryRateModal();
        });
    }


    const refreshSalaryRatesBtn = document.getElementById('refreshSalaryRatesBtn');
    if (refreshSalaryRatesBtn) {
        refreshSalaryRatesBtn.addEventListener('click', function () {
            loadSalaryRates();
        });
    }


    const addTerminalIconBtn = document.getElementById('addTerminalIconBtn');
    if (addTerminalIconBtn) {
        addTerminalIconBtn.addEventListener('click', function () {
            showAddTerminalModal();
        });
    }

    const refreshTerminalsBtn = document.getElementById('refreshTerminalsBtn');
    if (refreshTerminalsBtn) {
        refreshTerminalsBtn.addEventListener('click', function () {
            loadTerminals();
            loadDailyChanges();
        });
    }


    const refreshAttendanceBtn = document.getElementById('refreshAttendanceBtn');
    if (refreshAttendanceBtn) {
        refreshAttendanceBtn.addEventListener('click', async function () {
            loadDailyChanges();

            const btn = this;
            const svg = btn.querySelector('svg');
            if (svg) {
                svg.classList.add('spinning');
            }
            btn.disabled = true;

            try {

                const syncResponse = await apiRequest('/api/terminals/sync-all', {
                    method: 'POST'
                });

                if (syncResponse) {
                    const syncData = await syncResponse.json();
                    if (syncData.success) {
                        console.log(`✅ Terminallar sinxronlashdi: ${syncData.totalSaved} ta yangi event, ${syncData.totalDuplicates} ta duplikat`);

                        // Terminal bloklangani haqida bildirishnoma ko'rsatish
                        if (syncData.results && syncData.results.length > 0) {
                            const lockedTerminals = syncData.results.filter(r => r.isAccountLocked === true);
                            if (lockedTerminals.length > 0) {
                                for (const terminal of lockedTerminals) {
                                    const unlockMinutes = Math.ceil((terminal.unlockTimeSeconds || 0) / 60);
                                    const unlockTimeStr = unlockMinutes > 0
                                        ? `${unlockMinutes} daqiqa`
                                        : 'vaqti noma\'lum';

                                    showTerminalLockedNotification({
                                        terminalName: terminal.terminalName,
                                        ipAddress: terminal.ipAddress,
                                        username: terminal.username,
                                        unlockTimeSeconds: terminal.unlockTimeSeconds,
                                        unlockTimeStr: unlockTimeStr
                                    });
                                }
                            }
                        }
                    }
                }


                await loadAttendance();
            } catch (error) {
                console.error('Refresh attendance error:', error);

                await loadAttendance();
            } finally {

                btn.disabled = false;
                if (svg) {
                    svg.classList.remove('spinning');
                }
            }
        });
    }



    const calendarAttendanceBtn = document.getElementById('calendarAttendanceBtn');
    if (calendarAttendanceBtn) {
        calendarAttendanceBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleAttendanceCalendar();
        });
    }

    // Close calendar when clicking outside
    document.addEventListener('click', function (e) {
        const calendarWidget = document.getElementById('attendanceCalendarWidget');
        const calendarBtn = document.getElementById('calendarAttendanceBtn');
        if (calendarWidget && calendarBtn &&
            !calendarWidget.contains(e.target) &&
            !calendarBtn.contains(e.target)) {
            hideAttendanceCalendar();
        }
    });

    const downloadAttendanceBtn = document.getElementById('downloadAttendanceBtn');
    if (downloadAttendanceBtn) {
        downloadAttendanceBtn.addEventListener('click', function () {
            downloadAttendanceList();
        });
    }




    const terminalsSection = document.getElementById('terminalsManagementSection');
    if (terminalsSection) {
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (terminalsSection.style.display !== 'none') {
                        loadTerminals();
                    }
                }
            });
        });
        observer.observe(terminalsSection, { attributes: true, attributeFilter: ['style'] });
    }


    const attendanceSection = document.getElementById('employeesAttendanceSection');
    if (attendanceSection) {
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (attendanceSection.style.display !== 'none') {
                        loadAttendance();
                        loadEmployeesForAttendanceFilter();
                        loadTerminalsForAttendanceFilter();
                    }
                }
            });
        });
        observer.observe(attendanceSection, { attributes: true, attributeFilter: ['style'] });
    }

    // ==================== REGISTER AUTO-REFRESH ====================
    // Register auto-refresh for main data sections
    // Only refresh when section is visible
    setTimeout(() => {
        // Employees list auto-refresh
        AutoRefreshManager.register('employees', () => {
            const employeesSection = document.getElementById('employeesListSection');
            if (employeesSection && employeesSection.style.display !== 'none') {
                loadEmployees();
            }
        });

        // Terminals auto-refresh
        AutoRefreshManager.register('terminals', () => {
            const terminalsSection = document.getElementById('terminalsManagementSection');
            if (terminalsSection && terminalsSection.style.display !== 'none') {
                loadTerminals();
            }
        });

        // Attendance auto-refresh
        AutoRefreshManager.register('attendance', () => {
            const attendanceSection = document.getElementById('employeesAttendanceSection');
            if (attendanceSection && attendanceSection.style.display !== 'none') {
                loadAttendance();
            }
        });

        // Salaries auto-refresh
        AutoRefreshManager.register('salaries', () => {
            const salariesSection = document.getElementById('salariesSection');
            if (salariesSection && salariesSection.style.display !== 'none') {
                loadSalaries();
            }
        });

        // Salary rates auto-refresh
        AutoRefreshManager.register('salaryRates', () => {
            const salaryRatesSection = document.getElementById('salaryRatesSection');
            if (salaryRatesSection && salaryRatesSection.style.display !== 'none') {
                loadSalaryRates();
            }
        });

        console.log('✅ Auto-refresh system initialized');
    }, 2000); // Wait 2 seconds after initial load


    function showAddPositionModal() {
        const addPositionModal = document.getElementById('addPositionModal');
        if (addPositionModal) {

            const form = document.getElementById('addPositionModalForm');
            if (form) form.reset();

            const errorMsg = document.getElementById('modalAddPositionErrorMessage');
            const successMsg = document.getElementById('modalAddPositionSuccessMessage');
            if (errorMsg) errorMsg.style.display = 'none';
            if (successMsg) successMsg.style.display = 'none';

            addPositionModal.style.display = 'flex';

            setTimeout(() => {
                const nameInput = document.getElementById('modalPositionName');
                if (nameInput) nameInput.focus();
            }, 100);
        }
    }


    function hideAddPositionModal() {
        const addPositionModal = document.getElementById('addPositionModal');
        if (addPositionModal) {
            addPositionModal.style.display = 'none';
        }
    }


    const cancelAddPositionModalBtn = document.getElementById('cancelAddPositionModalBtn');
    if (cancelAddPositionModalBtn) {
        cancelAddPositionModalBtn.addEventListener('click', hideAddPositionModal);
    }


    const addPositionModalForm = document.getElementById('addPositionModalForm');
    if (addPositionModalForm) {
        addPositionModalForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const name = document.getElementById('modalPositionName').value.trim();
            const description = document.getElementById('modalPositionDescription').value.trim();

            if (!name) {
                const errorMsg = document.getElementById('modalAddPositionErrorMessage');
                if (errorMsg) {
                    errorMsg.textContent = 'Lavozim nomi kiritishingiz kerak';
                    errorMsg.style.display = 'block';
                }
                return;
            }


            const errorMsg = document.getElementById('modalAddPositionErrorMessage');
            const successMsg = document.getElementById('modalAddPositionSuccessMessage');
            if (errorMsg) errorMsg.style.display = 'none';
            if (successMsg) successMsg.style.display = 'none';


            const loader = document.getElementById('modalAddPositionLoader');
            const saveBtn = document.getElementById('saveAddPositionModalBtn');
            if (loader) loader.style.display = 'inline-block';
            if (saveBtn) saveBtn.disabled = true;

            try {
                const response = await apiRequest('/api/positions', {
                    method: 'POST',
                    body: JSON.stringify({
                        name,
                        description: description || null
                    })
                });

                if (!response) {
                    if (loader) loader.style.display = 'none';
                    if (saveBtn) saveBtn.disabled = false;
                    return;
                }

                const data = await response.json();

                if (loader) loader.style.display = 'none';
                if (saveBtn) saveBtn.disabled = false;

                if (data.success) {
                    if (successMsg) {
                        successMsg.textContent = data.message || 'Lavozim muvaffaqiyatli qo\'shildi';
                        successMsg.style.display = 'block';
                    }

                    loadPositions();

                    setTimeout(() => {
                        hideAddPositionModal();
                    }, 1500);
                } else {
                    if (errorMsg) {
                        errorMsg.textContent = data.message || 'Lavozim qo\'shishda xatolik yuz berdi';
                        errorMsg.style.display = 'block';
                    }
                }
            } catch (error) {
                if (loader) loader.style.display = 'none';
                if (saveBtn) saveBtn.disabled = false;
                console.error('Add position error:', error);
                if (errorMsg) {
                    errorMsg.textContent = 'Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.';
                    errorMsg.style.display = 'block';
                }
            }
        });
    }


    async function loadAndCreateEmployeesFromTerminals() {
        try {
            const addEmployeeIconBtn = document.getElementById('addEmployeeIconBtn');
            if (addEmployeeIconBtn) {
                addEmployeeIconBtn.disabled = true;
                addEmployeeIconBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>';
                addEmployeeIconBtn.style.opacity = '0.6';
            }

            const response = await apiRequest('/api/employees/generate-from-terminals', {
                method: 'POST'
            });

            if (!response) {
                if (addEmployeeIconBtn) {
                    addEmployeeIconBtn.disabled = false;
                    addEmployeeIconBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>';
                    addEmployeeIconBtn.style.opacity = '1';
                }
                return;
            }

            const data = await response.json();

            if (addEmployeeIconBtn) {
                addEmployeeIconBtn.disabled = false;
                addEmployeeIconBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>';
                addEmployeeIconBtn.style.opacity = '1';
            }

            if (data.success) {
                if (data.created > 0) {
                    loadEmployees();
                }
            }
        } catch (error) {
            console.error('Load and create employees from terminals error:', error);
            const addEmployeeIconBtn = document.getElementById('addEmployeeIconBtn');
            if (addEmployeeIconBtn) {
                addEmployeeIconBtn.disabled = false;
                addEmployeeIconBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>';
                addEmployeeIconBtn.style.opacity = '1';
            }
        }
    }
});




function initSidebarMenu(role) {
    const sidebarMenu = document.getElementById('sidebarMenu');
    if (!sidebarMenu) return;

    sidebarMenu.innerHTML = '';

    if (role === 'super_admin') {

        const menuItems = [
            {
                id: 'statistics',
                label: 'Statistika',
                icon: `<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>`,
                sectionIds: ['statisticsSection']
            },
            {
                id: 'admins',
                label: 'Adminlar',
                icon: `<svg viewBox="0 0 24 24"><path d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z"/></svg>`,
                sectionIds: ['adminsSection']
            },
            {
                id: 'settings',
                label: 'Sozlamalar',
                icon: `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
                sectionIds: ['settingsSection']
            }
        ];

        menuItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'sidebar-menu-item';
            li.innerHTML = `
                <a href="#" class="sidebar-menu-link" data-section="${item.sectionIds[0]}">
                    <span class="sidebar-menu-icon">${item.icon}</span>
                    <span>${item.label}</span>
                </a>
            `;
            sidebarMenu.appendChild(li);
        });

        showSection('statisticsSection');

    } else if (role === 'admin') {

        const allMenuItems = [
            {
                id: 'statistics',
                label: 'Statistika',
                icon: `<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>`,
                sectionIds: ['statisticsSection']
            },
            {
                id: 'employees',
                label: 'Hodimlar',
                icon: `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
                sectionIds: ['employeesSection']
            },
            {
                id: 'terminals',
                label: 'Terminallar',
                icon: `<svg viewBox="0 0 24 24"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>`,
                sectionIds: ['terminalsManagementSection']
            },
            {
                id: 'income',
                label: 'Moliya',
                icon: `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/></svg>`,
                sectionIds: ['incomeSection']
            },
            {
                id: 'settings',
                label: 'Sozlamalar',
                icon: `<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
                sectionIds: ['organizationSettingsSection']
            }
        ];

        // Filter menu items based on permissions
        const menuItems = allMenuItems.filter(item => {
            // If permission is explicitly set to false, hide it
            // Default is true (show) if not set
            return currentUserPermissions[item.id] !== false;
        });

        menuItems.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = 'sidebar-menu-item';
            li.innerHTML = `
                <a href="#" class="sidebar-menu-link" data-section="${item.sectionIds[0]}">
                    <span class="sidebar-menu-icon">${item.icon}</span>
                    <span>${item.label}</span>
                </a>
            `;
            sidebarMenu.appendChild(li);
        });


        showSection('statisticsSection');
    }


    const menuLinks = sidebarMenu.querySelectorAll('.sidebar-menu-link');
    menuLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const sectionId = this.getAttribute('data-section');


            menuLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');


            showSection(sectionId);
        });
    });


    if (menuLinks.length > 0) {
        menuLinks[0].classList.add('active');
    }
}


// Mobile Menu Toggle Functionality
function initMobileMenu() {
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const adminSidebar = document.getElementById('adminSidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (!mobileMenuToggle || !adminSidebar || !sidebarOverlay) return;

    // Toggle sidebar on button click
    mobileMenuToggle.addEventListener('click', function () {
        adminSidebar.classList.toggle('mobile-open');
        sidebarOverlay.classList.toggle('show');
        document.body.style.overflow = adminSidebar.classList.contains('mobile-open') ? 'hidden' : '';
    });

    // Close sidebar on overlay click
    sidebarOverlay.addEventListener('click', function () {
        adminSidebar.classList.remove('mobile-open');
        sidebarOverlay.classList.remove('show');
        document.body.style.overflow = '';
    });

    // Close sidebar when clicking on menu links (mobile only)
    const menuLinks = document.querySelectorAll('.sidebar-menu-link');
    // Cache mobile state to avoid forced reflows
    let isMobileWidth = window.innerWidth <= 768;

    const closeSidebarIfMobile = () => {
        if (isMobileWidth) {
            adminSidebar.classList.remove('mobile-open');
            sidebarOverlay.classList.remove('show');
            document.body.style.overflow = '';
        }
    };

    menuLinks.forEach(link => {
        link.addEventListener('click', closeSidebarIfMobile);
    });

    // Close sidebar on logout button click (mobile only)
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', closeSidebarIfMobile);
    }

    // Resize handler - layout muammolarini hal qilish
    let resizeTimeout;
    window.addEventListener('resize', function () {
        // Debounce resize event - performance uchun
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            requestAnimationFrame(() => {
                const newWidth = window.innerWidth;
                const newHeight = window.innerHeight;
                isMobileWidth = newWidth <= 768;

                // Mobile menu'ni yopish (agar desktop bo'lsa)
                if (!isMobileWidth) {
                    adminSidebar.classList.remove('mobile-open');
                    sidebarOverlay.classList.remove('show');
                    document.body.style.overflow = '';
                }

                // Desktop layout'ni yangilash
                if (newWidth > 768) {
                    const adminContentWrapper = document.querySelector('.admin-content-wrapper');
                    if (adminContentWrapper) {
                        const sidebarWidth = adminSidebar.offsetWidth || 260;
                        adminContentWrapper.style.width = `calc(100vw - ${sidebarWidth}px)`;
                        adminContentWrapper.style.height = `${newHeight}px`;

                        // Ekran o'lchami mobil (<=768px) dan katta bo'lganda,
                        // kontent har doim yuqoridan boshlanishi uchun scrollTop ni 0 ga olish
                        adminContentWrapper.scrollTop = 0;
                    }
                }

                // Barcha section'larni yangilash (agar kerak bo'lsa)
                const activeSection = document.querySelector('.content-section[style*="display: block"], .content-section[style*="display: flex"]');
                if (activeSection) {
                    // Force reflow - layout'ni yangilash
                    void activeSection.offsetHeight;
                }
            });
        }, 150); // 150ms debounce
    }, { passive: true });
}


function showSection(sectionId) {

    const allSections = [
        'statisticsSection',
        'adminsSection',
        'organizationSettingsSection',
        'employeesSection',
        'settingsSection',
        'salariesManagementSection',
        'salariesListSection',
        'terminalsManagementSection',
        'incomeSection'
    ];


    allSections.forEach(id => {
        const section = getSectionElement(id);
        if (section) {
            section.style.display = 'none';
        }
    });


    if (sectionId !== 'employeesSection') {
        const employeeSubsections = [
            'employeesListSection',
            'employeesAttendanceSection',
            'employeesDailyChangesSection',
            'employeesPositionsSection'
        ];
        employeeSubsections.forEach(id => {
            const section = getSectionElement(id);
            if (section) {
                section.style.display = 'none';
            }
        });
    }


    if (sectionId === 'adminsSection') {
        const section = document.getElementById('adminsSection');
        if (section) section.style.display = 'flex';
    } else if (sectionId === 'employeesSection') {

        const empSection = document.getElementById('employeesSection');
        if (empSection) empSection.style.display = 'block';

        showEmployeesSubsection('employeesListSection');
        loadEmployees();
        loadPositions();
    } else if (sectionId === 'salariesManagementSection') {

        const salMgmt = document.getElementById('salariesManagementSection');
        const salList = document.getElementById('salariesListSection');
        if (salMgmt) salMgmt.style.display = 'block';
        if (salList) salList.style.display = 'block';
        loadSalaries();
        loadEmployeesForSalaries();
    } else if (sectionId === 'incomeSection') {
        const incomeSection = document.getElementById('incomeSection');
        if (incomeSection) incomeSection.style.display = 'block';
        updateSalaryFilterButtons();
        loadSalaries();
    } else if (sectionId === 'statisticsSection') {

        const section = getSectionElement(sectionId);
        if (section) {
            section.style.display = 'block';
        }

        loadStatistics();
    } else if (sectionId === 'organizationSettingsSection') {

        const section = getSectionElement(sectionId);
        if (section) {
            section.style.display = 'block';
        }

        loadOrganizationSettings();
    } else if (sectionId === 'settingsSection') {

        const section = getSectionElement(sectionId);
        if (section) {
            section.style.display = 'block';
        }

        loadSettings();
    } else {

        const section = getSectionElement(sectionId);
        if (section) {
            section.style.display = 'block';
        }
    }
}


function getSectionElement(sectionId) {
    return document.getElementById(sectionId);
}


// showIncomeSubsection removed - Moliya bo'limi endi faqat Maoshlarni ko'rsatadi

function showEmployeesSubsection(subsectionId) {

    const subsections = ['employeesListSection', 'employeesAttendanceSection', 'employeesDailyChangesSection', 'employeesPositionsSection', 'employeesSalarySection', 'employeesBonusesSection', 'employeesPenaltiesSection'];
    subsections.forEach(id => {
        const section = document.getElementById(id);
        if (section) section.style.display = 'none';
    });


    const selectedSection = document.getElementById(subsectionId);
    if (selectedSection) {
        selectedSection.style.display = 'block';
    }


    const submenuLinks = document.querySelectorAll('#employeesSection .submenu-link');
    submenuLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-subsection') === subsectionId) {
            link.classList.add('active');
        }
    });


    stopEmployeesAutoRefresh();
    stopAttendanceAutoRefresh();


    if (subsectionId === 'employeesListSection') {
        // Avtomatik terminal sinxronizatsiyasini boshlash (fon jarayoni)
        // Sinxronizatsiya va ma'lumotlarni yuklash parallel ishlaydi
        // Avval sinxronizatsiyani boshlash, keyin ma'lumotlarni yuklash
        Promise.race([
            autoSyncTerminals(),
            new Promise(resolve => setTimeout(resolve, 2000)) // Maksimum 2 soniya kutish
        ]).finally(() => {
            // Sinxronizatsiya tugagach yoki 2 soniyadan keyin ma'lumotlarni yuklash
            loadEmployees();
        });
        startEmployeesAutoRefresh();
    } else if (subsectionId === 'employeesPositionsSection') {
        loadPositions();
    } else if (subsectionId === 'employeesDailyChangesSection') {
        loadDailyChanges();
        loadEmployeesForDailyChanges();
        loadPositionsForDailyChanges();
    } else if (subsectionId === 'employeesSalarySection') {
        // Maoshlar bo'limiga kirilganda avtomatik "Jami" tanlash
        currentSalaryPeriod = 'all';
        updateSalaryFilterButtons();
        loadSalaryRates();
        loadEmployeesForSalaryRates();
        loadPositionsForSalaryRates();
    } else if (subsectionId === 'employeesBonusesSection') {
        loadBonuses();
        loadEmployeesForBonuses();
        loadEmployeesForPenaltyFilter();
    } else if (subsectionId === 'employeesPenaltiesSection') {
        loadPenalties();
        loadEmployeesForPenaltyFilter();
        loadEmployeesForPenaltyModal();
    } else if (subsectionId === 'employeesAttendanceSection') {
        // Avtomatik terminal sinxronizatsiyasini boshlash (fon jarayoni)
        // Sinxronizatsiya va ma'lumotlarni yuklash parallel ishlaydi
        // Avval sinxronizatsiyani boshlash, keyin ma'lumotlarni yuklash
        Promise.race([
            autoSyncTerminals(),
            new Promise(resolve => setTimeout(resolve, 2000)) // Maksimum 2 soniya kutish
        ]).finally(() => {
            // Sinxronizatsiya tugagach yoki 2 soniyadan keyin ma'lumotlarni yuklash
            loadAttendance();
        });
        startAttendanceAutoRefresh();
    }
}


async function loadStatistics() {
    if (currentUserRole !== 'admin' && currentUserRole !== 'super_admin') {
        return;
    }

    const statisticsContent = document.getElementById('statisticsContent');
    if (!statisticsContent) return;

    statisticsContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #6b7280;">Yuklanmoqda...</div>';

    try {
        if (currentUserRole === 'super_admin') {
            const response = await apiRequest('/api/statistics/overall');
            if (!response) {
                statisticsContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #dc2626;">Ma\'lumotlarni yuklashda xatolik yuz berdi</div>';
                return;
            }

            const data = await response.json();
            if (!data.success) {
                statisticsContent.innerHTML = `<div style="padding: 20px; text-align: center; color: #dc2626;">${data.message || 'Xatolik yuz berdi'}</div>`;
                return;
            }

            displaySuperAdminStatistics(data.statistics);
        } else {
            // Admin statistics
            // Optimizatsiya: limit'larni kamaytirish va faqat kerakli ma'lumotlarni yuklash
            const [employeesResponse, salariesResponse, bonusesResponse, penaltiesResponse, attendanceResponse] = await Promise.all([
                apiRequest('/api/employees'),
                apiRequest('/api/salaries?limit=100'), // 1000 dan 100 ga kamaytirildi
                apiRequest('/api/bonuses?limit=100'), // 1000 dan 100 ga kamaytirildi
                apiRequest('/api/penalties?limit=100'), // 1000 dan 100 ga kamaytirildi
                apiRequest('/api/attendance?limit=100') // 1000 dan 100 ga kamaytirildi
            ]);

            const employeesData = employeesResponse ? await employeesResponse.json() : { employees: [] };
            const salariesData = salariesResponse ? await salariesResponse.json() : { salaries: [] };
            const bonusesData = bonusesResponse ? await bonusesResponse.json() : { bonuses: [] };
            const penaltiesData = penaltiesResponse ? await penaltiesResponse.json() : { penalties: [] };
            const attendanceData = attendanceResponse ? await attendanceResponse.json() : { attendance: [] };

            const employees = employeesData.employees || [];
            const salaries = salariesData.salaries || [];
            const bonuses = bonusesData.bonuses || [];
            const penalties = penaltiesData.penalties || [];
            const attendance = attendanceData.attendance || [];

            const employeeCount = employees.length;
            const activeEmployeeCount = employees.filter(e => e.is_active !== false).length;
            const salaryCount = salaries.length;
            const totalSalaryAmount = salaries.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
            const totalBonusAmount = bonuses.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
            const totalPenaltyAmount = penalties.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

            // Calculate attendance stats
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayAttendance = attendance.filter(a => {
                const date = new Date(a.event_time);
                return date >= today;
            }).length;

            // Calculate salary by period
            const dailySalaries = salaries.filter(s => s.period_type === 'daily');
            const weeklySalaries = salaries.filter(s => s.period_type === 'weekly');
            const monthlySalaries = salaries.filter(s => s.period_type === 'monthly');

            let html = `
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; padding: 12px; background: #f9fafb; border-radius: 6px; border: 1px solid #e5e7eb;">
                    <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Hodimlar</div>
                        <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px;">
                            <span>${employeeCount}</span>
                            <span style="font-size: 12px; font-weight: 400; color: #10b981;">${activeEmployeeCount} faol</span>
                        </div>
                    </div>
                    <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Maoshlar</div>
                        <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
                            <span>${salaryCount}</span>
                            <span style="font-size: 12px; font-weight: 400; color: #6b7280;">Jami: ${formatCurrency(totalSalaryAmount)}</span>
                        </div>
                    </div>
                    <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Davomat</div>
                        <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px;">
                            <span>${todayAttendance}</span>
                            <span style="font-size: 12px; font-weight: 400; color: #6b7280;">Jami: ${attendance.length}</span>
                        </div>
                    </div>
                    <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Bonuslar</div>
                        <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
                            <span>${bonuses.length}</span>
                            <span style="font-size: 12px; font-weight: 400; color: #10b981;">Jami: ${formatCurrency(totalBonusAmount)}</span>
                        </div>
                    </div>
                    <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Jarimalar</div>
                        <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
                            <span>${penalties.length}</span>
                            <span style="font-size: 12px; font-weight: 400; color: #dc2626;">Jami: ${formatCurrency(totalPenaltyAmount)}</span>
                        </div>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Maoshlar bo'yicha</div>
                        <canvas id="statisticsSalaryChart" style="max-height: 250px;"></canvas>
                    </div>
                    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Davomat (30 kun)</div>
                        <canvas id="statisticsAttendanceChart" style="max-height: 250px;"></canvas>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Bonuslar va Jarimalar</div>
                        <canvas id="bonusPenaltyChart" style="max-height: 250px;"></canvas>
                    </div>
                    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Maoshlar Tendentsiyasi</div>
                        <canvas id="salaryTrendChart" style="max-height: 250px;"></canvas>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px;">
                    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Eng Faol Hodimlar (30 kun)</div>
                        <canvas id="adminTopEmployeesChart" style="max-height: 250px;"></canvas>
                    </div>
                    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                        <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Davomat Oylik</div>
                        <canvas id="adminMonthlyAttendanceChart" style="max-height: 250px;"></canvas>
                    </div>
                </div>
            `;

            statisticsContent.innerHTML = html;

            // Initialize charts - use chunked initialization for better performance
            if (typeof Chart !== 'undefined') {
                // Use chunked initialization to avoid blocking the main thread
                initAdminStatisticsChartsAsync({
                    daily: dailySalaries.length,
                    weekly: weeklySalaries.length,
                    monthly: monthlySalaries.length
                }, attendance, bonuses, penalties, salaries, employees);
            }
        }
    } catch (error) {
        console.error('Load statistics error:', error);
        if (statisticsContent) {
            statisticsContent.innerHTML = '<div style="padding: 20px; text-align: center; color: #dc2626;">Statistikani yuklashda xatolik yuz berdi</div>';
        }
    }
}

// Initialize charts for admin statistics (async/chunked version)
function initAdminStatisticsChartsAsync(salaryData, attendanceData, bonusesData = [], penaltiesData = [], salariesData = [], employeesData = []) {
    // Destroy existing charts before creating new ones
    const chartIds = [
        'statisticsSalaryChart',
        'statisticsAttendanceChart',
        'bonusPenaltyChart',
        'salaryTrendChart',
        'adminTopEmployeesChart',
        'adminMonthlyAttendanceChart'
    ];

    chartIds.forEach(chartId => {
        const canvas = document.getElementById(chartId);
        if (canvas) {
            const existingChart = Chart.getChart(canvas);
            if (existingChart) {
                existingChart.destroy();
            }
        }
    });

    // Create charts in chunks to avoid blocking the main thread
    const chartTasks = [
        () => createSalaryChart(salaryData),
        () => createAttendanceChart(attendanceData),
        () => createBonusPenaltyChart(bonusesData, penaltiesData),
        () => createSalaryTrendChart(salariesData),
        // Use the provided employeesData parameter instead of undefined employees
        () => createTopEmployeesChart(attendanceData, employeesData),
        () => createMonthlyAttendanceChart(attendanceData)
    ];

    // Create charts one by one with delays to avoid blocking main thread
    // Use setTimeout instead of RAF to avoid violations
    chartTasks.forEach((task, index) => {
        setTimeout(() => {
            try {
                task();
            } catch (error) {
                console.error('Chart creation error:', error);
            }
        }, index * 50); // 50ms delay between charts to avoid blocking
    });
}

// Individual chart creation functions for async initialization
function createSalaryChart(salaryData) {
    const ctx = document.getElementById('statisticsSalaryChart');
    if (!ctx) return;
    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Kunlik', 'Haftalik', 'Oylik'],
            datasets: [{
                data: [salaryData.daily, salaryData.weekly, salaryData.monthly],
                backgroundColor: ['#3b82f6', '#10b981', '#f59e0b'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false, // Disable animation for better performance
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8 } }
            }
        }
    });
}

function createAttendanceChart(attendanceData) {
    const ctx = document.getElementById('statisticsAttendanceChart');
    if (!ctx || attendanceData.length === 0) return;
    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();

    const last30Days = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        const dateStr = date.toISOString().split('T')[0];
        const count = attendanceData.filter(a => {
            const aDate = new Date(a.event_time);
            aDate.setHours(0, 0, 0, 0);
            return aDate.toISOString().split('T')[0] === dateStr;
        }).length;
        last30Days.push({ date: dateStr, count: count });
    }

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: last30Days.map(d => {
                const date = new Date(d.date);
                return date.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' });
            }),
            datasets: [{
                label: 'Davomat',
                data: last30Days.map(d => d.count),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false, // Disable animation for better performance
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 10 }, stepSize: 1 }, grid: { color: '#f3f4f6' } },
                x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 }, grid: { display: false } }
            }
        }
    });
}

function createBonusPenaltyChart(bonusesData, penaltiesData) {
    const ctx = document.getElementById('bonusPenaltyChart');
    if (!ctx || bonusesData.length === 0 || penaltiesData.length === 0) return;
    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();

    const totalBonus = bonusesData.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    const totalPenalty = penaltiesData.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Bonuslar', 'Jarimalar'],
            datasets: [{
                label: 'Summa',
                data: [totalBonus, totalPenalty],
                backgroundColor: ['#10b981', '#dc2626'],
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false, // Disable animation for better performance
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: (v) => formatCurrency(v) }, grid: { color: '#f3f4f6' } },
                x: { ticks: { font: { size: 10 } }, grid: { display: false } }
            }
        }
    });
}

function createSalaryTrendChart(salariesData) {
    const ctx = document.getElementById('salaryTrendChart');
    if (!ctx || salariesData.length === 0) return;
    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();

    const monthlySalaries = {};
    salariesData.forEach(s => {
        const date = new Date(s.period_date || s.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlySalaries[monthKey]) monthlySalaries[monthKey] = 0;
        monthlySalaries[monthKey] += parseFloat(s.amount || 0);
    });

    const monthLabels = Object.keys(monthlySalaries).sort();
    const monthValues = monthLabels.map(m => monthlySalaries[m]);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: monthLabels.map(m => {
                const [year, month] = m.split('-');
                return new Date(year, month - 1).toLocaleDateString('uz-UZ', { month: 'short' });
            }),
            datasets: [{
                label: 'Maoshlar',
                data: monthValues,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false, // Disable animation for better performance
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: (v) => formatCurrency(v) }, grid: { color: '#f3f4f6' } },
                x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 }, grid: { display: false } }
            }
        }
    });
}

function createTopEmployeesChart(attendanceData, employeesData) {
    const ctx = document.getElementById('adminTopEmployeesChart');
    if (!ctx || !attendanceData || attendanceData.length === 0 || !employeesData || employeesData.length === 0) return;
    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();

    // 30 kun ichidagi attendance event'larni filtrlash
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const last30DaysAttendance = attendanceData.filter(a => {
        const eventDate = new Date(a.event_time);
        return eventDate >= thirtyDaysAgo && eventDate <= today;
    });

    // Har bir hodim uchun davomat sonini hisoblash
    const employeeAttendanceCount = {};
    last30DaysAttendance.forEach(a => {
        const employeeId = a.employee_id;
        if (employeeId) {
            if (!employeeAttendanceCount[employeeId]) {
                employeeAttendanceCount[employeeId] = 0;
            }
            employeeAttendanceCount[employeeId]++;
        }
    });

    // Hodimlar ro'yxatini yaratish va saralash
    const topEmployees = Object.keys(employeeAttendanceCount)
        .map(employeeId => {
            const employee = employeesData.find(e => e.id === parseInt(employeeId));
            return {
                id: employeeId,
                name: employee ? employee.full_name : `Hodim #${employeeId}`,
                count: employeeAttendanceCount[employeeId]
            };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10); // Top 10 hodim

    if (topEmployees.length === 0) {
        // Agar ma'lumot yo'q bo'lsa, bo'sh grafik ko'rsatish
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Ma\'lumot yo\'q'],
                datasets: [{ label: 'Davomat soni', data: [0], backgroundColor: '#9ca3af', borderRadius: 8 }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                animation: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { font: { size: 10 }, stepSize: 1 }, grid: { color: '#f3f4f6' } },
                    x: { ticks: { font: { size: 10 } }, grid: { display: false } }
                }
            }
        });
        return;
    }

    const labels = topEmployees.map(e => {
        // Ismni qisqartirish (agar juda uzun bo'lsa)
        return e.name.length > 15 ? e.name.substring(0, 15) + '...' : e.name;
    });
    const data = topEmployees.map(e => e.count);

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Davomat soni',
                data: data,
                backgroundColor: '#06b6d4',
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false, // Disable animation for better performance
            indexAxis: 'y', // Horizontal bar chart
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const employee = topEmployees[context.dataIndex];
                            return `${employee.name}: ${context.parsed.x} ta davomat`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { font: { size: 10 }, stepSize: 1 },
                    grid: { color: '#f3f4f6' }
                },
                y: {
                    ticks: { font: { size: 10 } },
                    grid: { display: false }
                }
            }
        }
    });
}

function createMonthlyAttendanceChart(attendanceData) {
    const ctx = document.getElementById('adminMonthlyAttendanceChart');
    if (!ctx || attendanceData.length === 0) return;
    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();

    const monthlyData = {};
    attendanceData.forEach(a => {
        const date = new Date(a.event_time);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[monthKey]) monthlyData[monthKey] = 0;
        monthlyData[monthKey]++;
    });

    const monthLabels = Object.keys(monthlyData).sort().slice(-6);
    const monthValues = monthLabels.map(m => monthlyData[m]);

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: monthLabels.map(m => {
                const [year, month] = m.split('-');
                return new Date(year, month - 1).toLocaleDateString('uz-UZ', { month: 'short' });
            }),
            datasets: [{ label: 'Davomat', data: monthValues, backgroundColor: '#ec4899', borderRadius: 8 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            animation: false, // Disable animation for better performance
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 10 }, stepSize: 1 }, grid: { color: '#f3f4f6' } },
                x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 45 }, grid: { display: false } }
            }
        }
    });
}

// Initialize charts for admin statistics (original sync version - kept for compatibility)
function initAdminStatisticsCharts(salaryData, attendanceData, bonusesData = [], penaltiesData = [], salariesData = [], employeesData = []) {
    // Destroy existing charts before creating new ones
    const chartIds = [
        'statisticsSalaryChart',
        'statisticsAttendanceChart',
        'bonusPenaltyChart',
        'salaryTrendChart',
        'adminTopEmployeesChart',
        'adminMonthlyAttendanceChart'
    ];

    chartIds.forEach(chartId => {
        const canvas = document.getElementById(chartId);
        if (canvas) {
            const existingChart = Chart.getChart(canvas);
            if (existingChart) {
                existingChart.destroy();
            }
        }
    });

    // Salary by period chart
    const ctx1 = document.getElementById('statisticsSalaryChart');
    if (ctx1) {
        new Chart(ctx1, {
            type: 'doughnut',
            data: {
                labels: ['Kunlik', 'Haftalik', 'Oylik'],
                datasets: [{
                    data: [salaryData.daily, salaryData.weekly, salaryData.monthly],
                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: { size: 11 },
                            padding: 8
                        }
                    }
                }
            }
        });
    }

    // Attendance chart (last 30 days)
    const ctx2 = document.getElementById('statisticsAttendanceChart');
    if (ctx2 && attendanceData.length > 0) {
        const last30Days = [];
        const today = new Date();
        for (let i = 29; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            const dateStr = date.toISOString().split('T')[0];
            const count = attendanceData.filter(a => {
                const aDate = new Date(a.event_time);
                aDate.setHours(0, 0, 0, 0);
                return aDate.toISOString().split('T')[0] === dateStr;
            }).length;
            last30Days.push({ date: dateStr, count: count });
        }

        new Chart(ctx2, {
            type: 'line',
            data: {
                labels: last30Days.map(d => {
                    const date = new Date(d.date);
                    return date.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' });
                }),
                datasets: [{
                    label: 'Davomat',
                    data: last30Days.map(d => d.count),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
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

    // Bonus vs Penalty Chart
    const bonusPenaltyCtx = document.getElementById('bonusPenaltyChart');
    if (bonusPenaltyCtx && bonusesData.length > 0 && penaltiesData.length > 0) {
        const totalBonus = bonusesData.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
        const totalPenalty = penaltiesData.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

        new Chart(bonusPenaltyCtx, {
            type: 'bar',
            data: {
                labels: ['Bonuslar', 'Jarimalar'],
                datasets: [{
                    label: 'Summa',
                    data: [totalBonus, totalPenalty],
                    backgroundColor: ['#10b981', '#dc2626'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: { size: 10 },
                            callback: function (value) {
                                return formatCurrency(value);
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

    // Salary Trend Chart
    const salaryTrendCtx = document.getElementById('salaryTrendChart');
    if (salaryTrendCtx && salariesData.length > 0) {
        const monthlySalaries = {};
        salariesData.forEach(s => {
            const date = new Date(s.period_date || s.created_at);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlySalaries[monthKey]) {
                monthlySalaries[monthKey] = 0;
            }
            monthlySalaries[monthKey] += parseFloat(s.amount || 0);
        });

        const monthLabels = Object.keys(monthlySalaries).sort();
        const monthValues = monthLabels.map(m => monthlySalaries[m]);

        new Chart(salaryTrendCtx, {
            type: 'line',
            data: {
                labels: monthLabels.map(m => {
                    const [year, month] = m.split('-');
                    return new Date(year, month - 1).toLocaleDateString('uz-UZ', { month: 'short' });
                }),
                datasets: [{
                    label: 'Maoshlar',
                    data: monthValues,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: { size: 10 },
                            callback: function (value) {
                                return formatCurrency(value);
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

    // Top Employees Chart (30 kun)
    const adminTopEmployeesCtx = document.getElementById('adminTopEmployeesChart');
    if (adminTopEmployeesCtx && attendanceData.length > 0 && employeesData && employeesData.length > 0) {
        createTopEmployeesChart(attendanceData, employeesData);
    }

    // Monthly Attendance Chart
    const adminMonthlyCtx = document.getElementById('adminMonthlyAttendanceChart');
    if (adminMonthlyCtx && attendanceData.length > 0) {
        const monthlyData = {};
        attendanceData.forEach(a => {
            const date = new Date(a.event_time);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = 0;
            }
            monthlyData[monthKey]++;
        });

        const monthLabels = Object.keys(monthlyData).sort().slice(-6);
        const monthValues = monthLabels.map(m => monthlyData[m]);

        new Chart(adminMonthlyCtx, {
            type: 'bar',
            data: {
                labels: monthLabels.map(m => {
                    const [year, month] = m.split('-');
                    return new Date(year, month - 1).toLocaleDateString('uz-UZ', { month: 'short' });
                }),
                datasets: [{
                    label: 'Davomat',
                    data: monthValues,
                    backgroundColor: '#ec4899',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
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
}

// Display super admin statistics with charts
function displaySuperAdminStatistics(stats) {
    const statisticsContent = document.getElementById('statisticsContent');
    if (!statisticsContent) return;

    let html = `
        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; padding: 12px; background: #f9fafb; border-radius: 4px; border: 1px solid #e5e7eb;">
            <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Adminlar</div>
                <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px;">
                    <span>${stats.admins.total}</span>
                    <span style="font-size: 12px; font-weight: 400; color: #10b981;">${stats.admins.active} faol</span>
                </div>
            </div>
            <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Hodimlar</div>
                <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px;">
                    <span>${stats.employees.total}</span>
                    <span style="font-size: 12px; font-weight: 400; color: #10b981;">${stats.employees.active} faol</span>
                </div>
            </div>
            <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Terminallar</div>
                <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px;">
                    <span>${stats.terminals.total}</span>
                    <span style="font-size: 12px; font-weight: 400; color: #10b981;">${stats.terminals.active} faol</span>
                </div>
            </div>
            <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Lavozimlar</div>
                <div style="font-size: 18px; font-weight: 600; color: #111827;">${stats.positions.total}</div>
            </div>
            <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Davomat (Bugun)</div>
                <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px;">
                    <span>${stats.attendance.today}</span>
                    <span style="font-size: 12px; font-weight: 400; color: #6b7280;">Jami: ${stats.attendance.total}</span>
                </div>
            </div>
            <div style="flex: 1; min-width: 150px; padding: 10px 12px; background: white; border-radius: 4px; border: 1px solid #e5e7eb;">
                <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Davomat (Hafta)</div>
                <div style="font-size: 18px; font-weight: 600; color: #111827; display: flex; align-items: baseline; gap: 6px;">
                    <span>${stats.attendance.this_week}</span>
                    <span style="font-size: 12px; font-weight: 400; color: #6b7280;">Oy: ${stats.attendance.this_month}</span>
                </div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-bottom: 12px;">
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Davomat (30 kun)</div>
                <canvas id="attendanceByDayChart" style="max-height: 250px;"></canvas>
            </div>
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Davomat bo'yicha Adminlar</div>
                <canvas id="attendanceByAdminChart" style="max-height: 250px;"></canvas>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-bottom: 12px;">
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Hodimlar bo'yicha Adminlar</div>
                <canvas id="employeesByAdminChart" style="max-height: 250px;"></canvas>
            </div>
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Tasdiqlash Usullari</div>
                <canvas id="verificationModesChart" style="max-height: 250px;"></canvas>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-bottom: 12px;">
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Terminallar bo'yicha Adminlar</div>
                <canvas id="terminalsByAdminChart" style="max-height: 250px;"></canvas>
            </div>
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Kirish va Chiqish</div>
                <canvas id="entryExitChart" style="max-height: 250px;"></canvas>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; margin-bottom: 12px;">
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Eng Faol Hodimlar (30 kun)</div>
                <canvas id="topEmployeesChart" style="max-height: 250px;"></canvas>
            </div>
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Davomat Tendentsiyasi (Area)</div>
                <canvas id="attendanceTrendChart" style="max-height: 250px;"></canvas>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px;">
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Davomat Haftalik</div>
                <canvas id="weeklyAttendanceChart" style="max-height: 250px;"></canvas>
            </div>
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 10px;">Davomat Oylik</div>
                <canvas id="monthlyAttendanceChart" style="max-height: 250px;"></canvas>
            </div>
        </div>
    `;

    statisticsContent.innerHTML = html;

    // Initialize charts after HTML is inserted - use setTimeout to avoid blocking main thread
    setTimeout(() => {
        try {
            initializeCharts(stats);
        } catch (error) {
            console.error('Chart initialization error:', error);
        }
    }, 50);
}

// Initialize all charts
function initializeCharts(stats) {
    // Attendance by Day Chart
    const attendanceByDayCtx = document.getElementById('attendanceByDayChart');
    if (attendanceByDayCtx) {
        const labels = stats.charts.attendance_by_day.map(item => {
            const date = new Date(item.date);
            return date.toLocaleDateString('uz-UZ', { month: 'short', day: 'numeric' });
        });
        const entryData = stats.charts.attendance_by_day.map(item => parseInt(item.entry_count));
        const exitData = stats.charts.attendance_by_day.map(item => parseInt(item.exit_count));

        new Chart(attendanceByDayCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Kirish',
                    data: entryData,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    fill: true
                }, {
                    label: 'Chiqish',
                    data: exitData,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            font: {
                                size: 11
                            },
                            padding: 8,
                            boxWidth: 12
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: {
                                size: 10
                            }
                        }
                    },
                    x: {
                        ticks: {
                            font: {
                                size: 10
                            }
                        }
                    }
                }
            }
        });
    }

    // Attendance by Admin Chart
    const attendanceByAdminCtx = document.getElementById('attendanceByAdminChart');
    if (attendanceByAdminCtx) {
        const labels = stats.charts.attendance_by_admin.map(item => item.admin_username);
        const data = stats.charts.attendance_by_admin.map(item => parseInt(item.attendance_count));

        new Chart(attendanceByAdminCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Davomat soni',
                    data: data,
                    backgroundColor: '#667eea',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: {
                                size: 10
                            },
                            stepSize: 1
                        },
                        grid: {
                            color: '#f3f4f6'
                        }
                    },
                    x: {
                        ticks: {
                            font: {
                                size: 10
                            },
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

    // Employees by Admin Chart
    const employeesByAdminCtx = document.getElementById('employeesByAdminChart');
    if (employeesByAdminCtx) {
        const labels = stats.charts.employees_by_admin.map(item => item.admin_username);
        const totalData = stats.charts.employees_by_admin.map(item => parseInt(item.employees_count));
        const activeData = stats.charts.employees_by_admin.map(item => parseInt(item.active_employees_count));

        new Chart(employeesByAdminCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jami',
                    data: totalData,
                    backgroundColor: '#8b5cf6',
                    borderRadius: 8
                }, {
                    label: 'Faol',
                    data: activeData,
                    backgroundColor: '#10b981',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            font: {
                                size: 11
                            },
                            padding: 8,
                            boxWidth: 12
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: {
                                size: 10
                            }
                        }
                    },
                    x: {
                        ticks: {
                            font: {
                                size: 10
                            }
                        }
                    }
                }
            }
        });
    }

    // Verification Modes Chart
    const verificationModesCtx = document.getElementById('verificationModesChart');
    if (verificationModesCtx) {
        const labels = stats.charts.verification_modes.map(item => item.verification_mode || 'Noma\'lum');
        const data = stats.charts.verification_modes.map(item => parseInt(item.count));

        new Chart(verificationModesCtx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#667eea',
                        '#10b981',
                        '#f59e0b',
                        '#ef4444',
                        '#8b5cf6',
                        '#06b6d4'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: {
                                size: 11
                            },
                            padding: 8,
                            boxWidth: 12
                        }
                    }
                }
            }
        });
    }

    // Entry vs Exit Chart
    const entryExitCtx = document.getElementById('entryExitChart');
    if (entryExitCtx) {
        new Chart(entryExitCtx, {
            type: 'pie',
            data: {
                labels: ['Kirish', 'Chiqish'],
                datasets: [{
                    data: [stats.attendance.entry, stats.attendance.exit],
                    backgroundColor: ['#10b981', '#ef4444']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: {
                                size: 11
                            },
                            padding: 8,
                            boxWidth: 12
                        }
                    }
                }
            }
        });
    }

    // Top Employees Chart
    const topEmployeesCtx = document.getElementById('topEmployeesChart');
    if (topEmployeesCtx) {
        const labels = stats.charts.top_employees.map(item => item.employee_name);
        const data = stats.charts.top_employees.map(item => parseInt(item.attendance_count));

        new Chart(topEmployeesCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Davomat soni',
                    data: data,
                    backgroundColor: '#06b6d4',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                indexAxis: 'y',
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            font: {
                                size: 10
                            },
                            stepSize: 1
                        },
                        grid: {
                            color: '#f3f4f6'
                        }
                    },
                    y: {
                        ticks: {
                            font: {
                                size: 10
                            }
                        },
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }

    // Terminals by Admin Chart
    const terminalsByAdminCtx = document.getElementById('terminalsByAdminChart');
    if (terminalsByAdminCtx && stats.charts.terminals_by_admin) {
        const labels = stats.charts.terminals_by_admin.map(item => item.admin_username || 'Noma\'lum');
        const totalData = stats.charts.terminals_by_admin.map(item => parseInt(item.terminals_count || 0));
        const activeData = stats.charts.terminals_by_admin.map(item => parseInt(item.active_terminals_count || 0));

        new Chart(terminalsByAdminCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jami',
                    data: totalData,
                    backgroundColor: '#f59e0b',
                    borderRadius: 8
                }, {
                    label: 'Faol',
                    data: activeData,
                    backgroundColor: '#10b981',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            font: { size: 11 },
                            padding: 8,
                            boxWidth: 12
                        }
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

    // Attendance Trend Chart (Area)
    const attendanceTrendCtx = document.getElementById('attendanceTrendChart');
    if (attendanceTrendCtx && stats.charts.attendance_by_day) {
        const labels = stats.charts.attendance_by_day.map(item => {
            const date = new Date(item.date);
            return date.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' });
        });
        const totalData = stats.charts.attendance_by_day.map(item => parseInt(item.total_count || 0));

        new Chart(attendanceTrendCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jami Davomat',
                    data: totalData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    tension: 0.4,
                    fill: true,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
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

    // Weekly Attendance Chart
    const weeklyAttendanceCtx = document.getElementById('weeklyAttendanceChart');
    if (weeklyAttendanceCtx && stats.charts.attendance_by_day) {
        const weeklyData = {};
        stats.charts.attendance_by_day.forEach(item => {
            const date = new Date(item.date);
            const week = getWeekNumber(date);
            if (!weeklyData[week]) {
                weeklyData[week] = 0;
            }
            weeklyData[week] += parseInt(item.total_count || 0);
        });

        const weekLabels = Object.keys(weeklyData).sort();
        const weekValues = weekLabels.map(w => weeklyData[w]);

        new Chart(weeklyAttendanceCtx, {
            type: 'bar',
            data: {
                labels: weekLabels.map(w => `Hafta ${w}`),
                datasets: [{
                    label: 'Davomat',
                    data: weekValues,
                    backgroundColor: '#8b5cf6',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
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

    // Monthly Attendance Chart
    const monthlyAttendanceCtx = document.getElementById('monthlyAttendanceChart');
    if (monthlyAttendanceCtx && stats.charts.attendance_by_day) {
        const monthlyData = {};
        stats.charts.attendance_by_day.forEach(item => {
            const date = new Date(item.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = 0;
            }
            monthlyData[monthKey] += parseInt(item.total_count || 0);
        });

        const monthLabels = Object.keys(monthlyData).sort();
        const monthValues = monthLabels.map(m => monthlyData[m]);

        new Chart(monthlyAttendanceCtx, {
            type: 'bar',
            data: {
                labels: monthLabels.map(m => {
                    const [year, month] = m.split('-');
                    return new Date(year, month - 1).toLocaleDateString('uz-UZ', { month: 'short', year: 'numeric' });
                }),
                datasets: [{
                    label: 'Davomat',
                    data: monthValues,
                    backgroundColor: '#ec4899',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: false
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
}

// Helper function to get week number
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}


async function loadAdmins() {
    try {
        showLoading(true);
        hideMessages();

        const response = await apiRequest('/api/users');
        if (!response) return;


        if (response.status === 403) {
            showLoading(false);
            const adminSection = document.querySelector('.add-admin-card');
            const adminListCard = document.querySelector('.admins-list-card');
            if (adminSection) adminSection.style.display = 'none';
            if (adminListCard) adminListCard.style.display = 'none';
            return;
        }

        const data = await response.json();
        showLoading(false);

        if (data.success) {
            displayAdmins(data.users);
        } else {
            showError('Adminlarni yuklashda xatolik yuz berdi');
        }
    } catch (error) {
        showLoading(false);
        console.error('Load admins error:', error);
        showError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function displayAdmins(users) {
    adminsList.innerHTML = '';

    if (users.length === 0) {
        emptyMessage.style.display = 'block';
        adminsList.style.display = 'none';
        return;
    }

    emptyMessage.style.display = 'none';
    adminsList.style.display = 'flex';

    users.forEach(user => {
        const adminItem = createAdminItem(user);
        adminsList.appendChild(adminItem);
    });
}

// Load admin statistics - no longer needed in item, only in modal
async function loadAdminStatistics(adminId, adminItemElement) {
    // Statistics are now only shown in modal, not in item
    // This function is kept for backward compatibility but does nothing
    return;
}

// Show admin details modal
async function showAdminDetails(adminId) {
    try {
        showLoading(true);
        hideMessages();

        const [statsResponse, detailsResponse] = await Promise.all([
            apiRequest(`/api/users/${adminId}/statistics`),
            apiRequest(`/api/users/${adminId}/details`)
        ]);

        if (!statsResponse || !detailsResponse) return;

        const statsData = await statsResponse.json();
        const detailsData = await detailsResponse.json();

        if (!statsData.success || !detailsData.success) {
            showError('Ma\'lumotlarni olishda xatolik yuz berdi');
            showLoading(false);
            return;
        }

        showLoading(false);
        displayAdminDetailsModal(statsData, detailsData);
    } catch (error) {
        console.error('Show admin details error:', error);
        showError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
        showLoading(false);
    }
}

// Display admin details modal
function displayAdminDetailsModal(statsData, detailsData) {
    const admin = statsData.admin;
    const stats = statsData.statistics;

    const date = new Date(admin.created_at);
    const formattedDate = date.toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const statusText = admin.is_active ? 'Faol' : 'To\'xtatilgan';
    const statusClass = admin.is_active ? 'status-active' : 'status-inactive';
    const roleText = admin.role === 'super_admin' ? 'Super Admin' : 'Admin';

    const modalHtml = `
        <div class="admin-details-modal" id="adminDetailsModal">
            <div class="admin-details-content">
                <div class="admin-details-header">
                    <h3>${escapeHtml(admin.username)}</h3>
                    <button class="modal-close" onclick="closeAdminDetailsModal()">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="admin-details-body">
                    <div class="admin-info-compact">
                        <div class="info-row">
                            <span class="info-label">Rol:</span>
                            <span class="info-value">${roleText}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Holat:</span>
                            <span class="info-value ${statusClass}">${statusText}</span>
                        </div>
                        <div class="info-row">
                            <span class="info-label">Yaratilgan:</span>
                            <span class="info-value">${formattedDate}</span>
                        </div>
                    </div>

                    <div class="admin-stats-detailed">
                        <div class="stat-item-detailed">
                            <span class="stat-label-detailed">Hodimlar:</span>
                            <span class="stat-value-detailed">${stats.employees.total} (${stats.employees.active} faol)</span>
                        </div>
                        <div class="stat-item-detailed">
                            <span class="stat-label-detailed">Terminallar:</span>
                            <span class="stat-value-detailed">${stats.terminals.total} (${stats.terminals.active} faol)</span>
                        </div>
                        <div class="stat-item-detailed">
                            <span class="stat-label-detailed">Davomat:</span>
                            <span class="stat-value-detailed">${stats.attendance.today} bugun, ${stats.attendance.total} jami</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('adminDetailsModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Show modal with animation
    setTimeout(() => {
        const modal = document.getElementById('adminDetailsModal');
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(() => {
                modal.classList.add('show');
            }, 10);
        }
    }, 10);
}

// Close admin details modal
function closeAdminDetailsModal() {
    const modal = document.getElementById('adminDetailsModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
}


function createAdminItem(user) {
    const item = document.createElement('div');
    item.className = 'admin-item';
    item.setAttribute('data-id', user.id);

    const date = new Date(user.created_at);
    const formattedDate = date.toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const isActive = user.is_active !== false;
    const statusClass = isActive ? 'status-active' : 'status-inactive';
    const statusText = isActive ? 'Faol' : 'To\'xtatilgan';
    const toggleBtnText = isActive ? 'To\'xtatish' : 'Faollashtirish';
    const toggleBtnClass = isActive ? 'btn-disable' : 'btn-enable';

    const roleText = user.role === 'super_admin' ? 'Super Admin' : 'Admin';

    const toggleIcon = isActive ? `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="16"></line>
        </svg>
    ` : `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="16"></line>
            <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
    `;

    item.innerHTML = `
        <div class="admin-info">
            <div class="admin-header-info">
                <div class="username">${escapeHtml(user.username)}</div>
                <div class="admin-meta">
                    <span class="${statusClass}">${statusText}</span>
                    <span class="role-badge">${roleText}</span>
                </div>
            </div>
            <div class="created-date">${formattedDate}</div>
        </div>
        <div class="admin-actions">
            <button class="details-btn" onclick="showAdminDetails(${user.id})" title="Batafsil ko'rish">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
            </button>
            <button class="subscription-btn" onclick="openSubscriptionModal(${user.id}, '${escapeHtml(user.username)}', '${user.subscription_due_date || ''}', '${user.subscription_price || ''}')" title="Obuna">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="5" width="20" height="14" rx="2"></rect>
                    <line x1="2" y1="10" x2="22" y2="10"></line>
                </svg>
            </button>
            <button class="edit-btn" onclick="showEditModal(${user.id}, '${escapeHtml(user.username)}', '${escapeHtml(user.role || 'admin')}')" title="Tahrirlash">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="${toggleBtnClass}" onclick="toggleAdminStatus(${user.id}, ${!isActive})" title="${toggleBtnText}">
                ${toggleIcon}
            </button>
            <button class="delete-btn" onclick="showDeleteModal(${user.id}, '${escapeHtml(user.username)}')" title="O'chirish">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

    // Statistics are now only shown in modal, not in item
    // No need to load statistics for item display

    return item;
}


function showEditModal(userId, username, role) {
    editUserId = userId;
    editUserUsername = username;
    editUsername.value = username;
    editPassword.value = '';
    editRole.value = role || 'admin';
    hideEditMessages();
    editModal.style.display = 'flex';
}


function hideEditModal() {
    editModal.style.display = 'none';
    editUserId = null;
    editUserUsername = null;
    editAdminForm.reset();
}


async function updateAdmin(userId, username, password, role) {
    try {
        const requestBody = { username };
        if (password && password.trim() !== '') {
            requestBody.password = password;
        }
        if (role) {
            requestBody.role = role;
        }

        const response = await apiRequest(`/api/users/${userId}`, {
            method: 'PUT',
            body: JSON.stringify(requestBody)
        });

        if (!response) return;
        const data = await response.json();

        if (data.success) {
            showEditSuccess('Admin muvaffaqiyatli yangilandi');
            hideEditModal();
            loadAdmins();
        } else {
            showEditError(data.message || 'Adminni yangilashda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Update admin error:', error);
        showEditError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function showDeleteModal(userId, username) {
    deleteUserId = userId;
    deleteUsername.textContent = username;
    deleteModal.style.display = 'flex';
}


function hideDeleteModal() {
    deleteModal.style.display = 'none';
    deleteUserId = null;
}


async function toggleAdminStatus(userId, isActive) {
    try {
        const response = await apiRequest(`/api/users/${userId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ is_active: isActive })
        });

        if (!response) return;
        const data = await response.json();

        if (data.success) {
            showSuccess(data.message || (isActive ? 'Admin faollashtirildi' : 'Admin to\'xtatildi'));
            loadAdmins();
        } else {
            showError(data.message || 'Statusni yangilashda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Toggle admin status error:', error);
        showError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


async function deleteAdmin(userId) {
    try {
        const response = await apiRequest(`/api/users/${userId}`, {
            method: 'DELETE'
        });

        if (!response) return;
        const data = await response.json();

        if (data.success) {
            showSuccess('Admin muvaffaqiyatli o\'chirildi');
            hideDeleteModal();
            loadAdmins();
        } else {
            showError(data.message || 'Adminni o\'chirishda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Delete admin error:', error);
        showError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


addAdminForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;

    if (!username || !password) {
        showError('Iltimos, barcha maydonlarni to\'ldiring');
        return;
    }

    if (username.length < 3) {
        showError('Username kamida 3 ta belgidan iborat bo\'lishi kerak');
        return;
    }

    if (password.length < 4) {
        showError('Password kamida 4 ta belgidan iborat bo\'lishi kerak');
        return;
    }

    hideMessages();
    setAddLoading(true);

    try {
        const response = await apiRequest('/api/users', {
            method: 'POST',
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        if (!response) return;
        const data = await response.json();
        setAddLoading(false);

        if (data.success) {
            showSuccess(data.message || 'Yangi admin muvaffaqiyatli qo\'shildi');
            addAdminForm.reset();
            if (addAdminModal) {
                addAdminModal.style.display = 'none';
            }
            loadAdmins();
        } else {
            showError(data.message || 'Admin qo\'shishda xatolik yuz berdi');
        }
    } catch (error) {
        setAddLoading(false);
        console.error('Add admin error:', error);
        showError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
});


refreshBtn.addEventListener('click', function () {
    loadAdmins();
    loadDailyChanges();
});


if (openAddAdminModal) {
    openAddAdminModal.addEventListener('click', function () {
        if (addAdminModal) {
            addAdminModal.style.display = 'flex';
            addAdminForm.reset();
            hideMessages();
        }
    });
}

if (closeAddAdminModal) {
    closeAddAdminModal.addEventListener('click', function () {
        if (addAdminModal) {
            addAdminModal.style.display = 'none';
            addAdminForm.reset();
            hideMessages();
        }
    });
}

if (cancelAddAdmin) {
    cancelAddAdmin.addEventListener('click', function () {
        if (addAdminModal) {
            addAdminModal.style.display = 'none';
            addAdminForm.reset();
            hideMessages();
        }
    });
}

if (addAdminModal) {
    addAdminModal.addEventListener('click', function (e) {
        if (e.target === addAdminModal) {
            addAdminModal.style.display = 'none';
            addAdminForm.reset();
            hideMessages();
        }
    });
}


logoutBtn.addEventListener('click', function () {
    if (confirm('Haqiqatan ham tizimdan chiqmoqchimisiz?')) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userRole');
        window.location.href = '/';
    }
});




const employeesList = document.getElementById('employeesList');
const loadingEmployeesMessage = document.getElementById('loadingEmployeesMessage');
const emptyEmployeesMessage = document.getElementById('emptyEmployeesMessage');
const refreshEmployeesBtn = document.getElementById('refreshEmployeesBtn');
const downloadEmployeesBtn = document.getElementById('downloadEmployeesBtn');
const editEmployeeModal = document.getElementById('editEmployeeModal');

let employeesAutoRefreshInterval = null;
let attendanceAutoRefreshInterval = null;
let isLoadingEmployees = false;
const editEmployeeFormModal = document.getElementById('editEmployeeFormModal');
const cancelEditEmployeeBtn = document.getElementById('cancelEditEmployeeBtn');
const saveEditEmployeeBtn = document.getElementById('saveEditEmployeeBtn');
const editEmployeeLoader = document.getElementById('editEmployeeLoader');
const editEmployeeErrorMessage = document.getElementById('editEmployeeErrorMessage');
const editEmployeeSuccessMessage = document.getElementById('editEmployeeSuccessMessage');
const deleteEmployeeModal = document.getElementById('deleteEmployeeModal');
const deleteEmployeeName = document.getElementById('deleteEmployeeName');
const cancelDeleteEmployeeBtn = document.getElementById('cancelDeleteEmployeeBtn');
const confirmDeleteEmployeeBtn = document.getElementById('confirmDeleteEmployeeBtn');


async function loadEmployees() {

    if (currentUserRole !== 'admin') {
        return;
    }

    // Agar allaqachon yuklanmoqda bo'lsa, yangi so'rovni kutish
    if (isLoadingEmployees) {
        return;
    }

    try {
        isLoadingEmployees = true;
        showEmployeesLoading(true);

        const response = await apiRequest('/api/employees');
        if (!response) {
            isLoadingEmployees = false;
            showEmployeesLoading(false);
            return;
        }

        const data = await response.json();
        showEmployeesLoading(false);
        isLoadingEmployees = false;

        if (data.success) {
            displayEmployees(data.employees);
        } else {
            console.error('Hodimlarni yuklashda xatolik yuz berdi');
        }
    } catch (error) {
        showEmployeesLoading(false);
        isLoadingEmployees = false;
        console.error('Load employees error:', error);
    }
}


async function displayEmployees(employees) {
    const employeesTableBody = document.getElementById('employeesTableBody');
    const employeesTable = document.getElementById('employeesTable');

    if (!employeesTableBody || !employeesTable) {

        employeesList.innerHTML = '';
        if (employees.length === 0) {
            emptyEmployeesMessage.style.display = 'block';
            employeesList.style.display = 'none';
            return;
        }
        emptyEmployeesMessage.style.display = 'none';
        employeesList.style.display = 'flex';
        employees.forEach(employee => {
            const employeeItem = createEmployeeItem(employee);
            employeesList.appendChild(employeeItem);
        });
        return;
    }

    // Avval barcha mavjud qatorlarni tozalash - bu muammoni hal qiladi
    while (employeesTableBody.firstChild) {
        employeesTableBody.removeChild(employeesTableBody.firstChild);
    }
    // Qo'shimcha xavfsizlik uchun innerHTML ham tozalash
    employeesTableBody.innerHTML = '';

    if (employees.length === 0) {
        emptyEmployeesMessage.style.display = 'block';
        employeesTable.style.display = 'none';
        return;
    }

    emptyEmployeesMessage.style.display = 'none';
    employeesTable.style.display = 'table';


    let attendanceData = {};
    let workScheduleData = {};
    try {
        const statsResponse = await apiRequest('/api/attendance/today-stats');
        if (statsResponse) {
            const statsData = await statsResponse.json();
            if (statsData.success) {

                const allEmployeesData = [
                    ...(statsData.came_employees || []),
                    ...(statsData.did_not_come_employees || []),
                    ...(statsData.late_employees || [])
                ];
                allEmployeesData.forEach(emp => {
                    if (emp.id) {
                        attendanceData[emp.id] = emp;

                        if (emp.expected_start) {
                            workScheduleData[emp.id] = {
                                start_time: emp.expected_start,
                                has_schedule: true
                            };
                        }
                    }
                });


                if (statsData.work_schedules) {
                    statsData.work_schedules.forEach(schedule => {
                        if (schedule.employee_id && schedule.has_schedule) {
                            workScheduleData[schedule.employee_id] = {
                                start_time: schedule.start_time,
                                end_time: schedule.end_time,
                                has_schedule: true
                            };
                        } else if (schedule.employee_id) {
                            workScheduleData[schedule.employee_id] = { has_schedule: false };
                        }
                    });
                }


                Object.keys(attendanceData).forEach(empId => {
                    const emp = attendanceData[empId];
                    if (emp.expected_start && !workScheduleData[empId]) {
                        workScheduleData[empId] = {
                            start_time: emp.expected_start,
                            end_time: emp.expected_end || null,
                            has_schedule: true
                        };
                    } else if (emp.has_schedule === false && !workScheduleData[empId]) {
                        workScheduleData[empId] = { has_schedule: false };
                    }
                });


                employees.forEach(emp => {
                    if (!workScheduleData[emp.id]) {
                        workScheduleData[emp.id] = { has_schedule: false };
                    }
                });
            }
        }
    } catch (error) {
        console.error('Failed to load attendance data:', error);
    }

    employees.forEach((employee, index) => {
        // Agar bir xil ID bilan qator mavjud bo'lsa, uni o'chirish
        const existingRow = employeesTableBody.querySelector(`tr[data-id="${employee.id}"]`);
        if (existingRow) {
            existingRow.remove();
        }

        const attendance = attendanceData[employee.id];
        const workSchedule = workScheduleData[employee.id];
        const row = createEmployeeTableRow(employee, attendance, workSchedule, index + 1);
        employeesTableBody.appendChild(row);
    });
}


function createEmployeeTableRow(employee, attendance, workSchedule, rowNumber) {
    const row = document.createElement('tr');
    row.setAttribute('data-id', employee.id);
    row.style.cssText = 'border-bottom: 1px solid #e5e7eb; transition: background 0.2s;';
    row.onmouseenter = () => row.style.background = '#f9fafb';
    row.onmouseleave = () => row.style.background = 'transparent';


    const hasWorkSchedule = workSchedule && workSchedule.has_schedule === true;
    const isWorkDay = hasWorkSchedule && workSchedule.start_time;

    const dayNames = {
        1: 'Dush',
        2: 'Sesh',
        3: 'Chor',
        4: 'Pay',
        5: 'Jum',
        6: 'Shan',
        7: 'Yak'
    };
    const today = new Date();
    const jsDayOfWeek = today.getDay();
    const todayDayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;
    const workDayHtml = isWorkDay
        ? `<span style="color: #10b981; font-weight: 500; font-size: 14px;">${dayNames[todayDayOfWeek]}</span>`
        : `<span style="color: #9ca3af; font-size: 14px;">yoq</span>`;


    let entryTimeHtml = '';

    if (isWorkDay && workSchedule && workSchedule.start_time) {
        const scheduledStart = workSchedule.start_time.substring(0, 5);
        entryTimeHtml = `<span style="color: #6b7280; font-size: 14px;" title="Ish jadvali: ${scheduledStart}">${scheduledStart}</span>`;
    } else if (!isWorkDay) {
        entryTimeHtml = `<span style="color: #9ca3af; font-size: 14px; font-style: italic;">Kelmaydi bugun</span>`;
    } else {
        entryTimeHtml = `<span style="color: #9ca3af; font-size: 14px;">—</span>`;
    }


    let exitTimeHtml = '';

    if (isWorkDay && workSchedule && workSchedule.end_time) {
        const scheduledEnd = workSchedule.end_time.substring(0, 5);
        exitTimeHtml = `<span style="color: #6b7280; font-size: 14px;" title="Ish jadvali: ${scheduledEnd}">${scheduledEnd}</span>`;
    } else if (!isWorkDay) {
        exitTimeHtml = `<span style="color: #9ca3af; font-size: 14px; font-style: italic;">—</span>`;
    } else {
        exitTimeHtml = `<span style="color: #9ca3af; font-size: 14px;">—</span>`;
    }

    row.innerHTML = `
        <td data-label="№" style="padding: 12px 16px; text-align: center;">
            <div style="font-size: 14px; color: #6b7280; font-weight: 500;">${rowNumber}</div>
        </td>
        <td data-label="Hodim" style="padding: 12px 16px;">
            <div style="font-weight: 600; color: #111827; font-size: 14px;">${escapeHtml(employee.full_name || employee.username)}</div>
        </td>
        <td data-label="Lavozim" style="padding: 12px 16px;">
            <div style="font-size: 14px; color: #374151;">${escapeHtml(employee.position || '—')}</div>
        </td>
        <td data-label="Ish kuni" style="padding: 12px 16px;">
            ${workDayHtml}
        </td>
        <td data-label="Keladi" style="padding: 12px 16px;">
            ${entryTimeHtml}
        </td>
        <td data-label="Ketadi" style="padding: 12px 16px;">
            ${exitTimeHtml}
        </td>
        <td data-label="Amallar" style="padding: 12px 16px; text-align: center;">
            <div style="display: flex; gap: 6px; justify-content: center;">
                <button class="edit-btn" onclick="showEditEmployeeModal(${employee.id}, '${escapeHtml(employee.username)}', '${escapeHtml(employee.full_name)}', '${escapeHtml(employee.position)}', '${escapeHtml(employee.phone || '')}', '${escapeHtml(employee.email || '')}')" title="Tahrirlash">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
                <button class="delete-btn" onclick="showDeleteEmployeeModal(${employee.id}, '${escapeHtml(employee.full_name || employee.username)}')" title="O'chirish">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        </td>
    `;

    return row;
}


function createEmployeeItem(employee) {
    const item = document.createElement('div');
    item.className = 'admin-item';
    item.setAttribute('data-id', employee.id);

    const date = new Date(employee.created_at);
    const formattedDate = date.toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    item.innerHTML = `
        <div class="admin-info">
            <div class="username">${escapeHtml(employee.full_name || employee.username)}</div>
            <div class="created-date">
                <div>Username: ${escapeHtml(employee.username || '')}</div>
                <div>Lavozim: ${escapeHtml(employee.position || '')}</div>
                <div>Qo'shilgan: ${formattedDate}</div>
            </div>
        </div>
        <div class="admin-actions">
            <button class="edit-btn" onclick="showEditEmployeeModal(${employee.id}, '${escapeHtml(employee.username)}', '${escapeHtml(employee.full_name)}', '${escapeHtml(employee.position)}', '${escapeHtml(employee.phone || '')}', '${escapeHtml(employee.email || '')}')" title="Tahrirlash">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="delete-btn" onclick="showDeleteEmployeeModal(${employee.id}, '${escapeHtml(employee.full_name || employee.username)}')" title="O'chirish">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

    return item;
}


async function showEditEmployeeModal(id, username, fullName, position, phone, email) {
    editEmployeeId = id;
    document.getElementById('editEmployeeUsername').value = username;
    document.getElementById('editEmployeeFullName').value = fullName;


    const positionSelect = document.getElementById('editEmployeePosition');
    if (positionSelect) {
        positionSelect.value = position || '';
    }

    document.getElementById('editEmployeePhone').value = phone;
    document.getElementById('editEmployeeEmail').value = email;
    document.getElementById('editEmployeePassword').value = '';
    hideEditEmployeeMessages();


    await loadWorkScheduleForEmployee(id);

    editEmployeeModal.style.display = 'flex';
}


function hideEditEmployeeModal() {
    editEmployeeModal.style.display = 'none';
    editEmployeeId = null;
    editEmployeeFormModal.reset();

    const workScheduleContainer = document.getElementById('workScheduleContainer');
    if (workScheduleContainer) {
        workScheduleContainer.innerHTML = '';
    }
}


async function loadWorkScheduleForEmployee(employeeId) {
    const workScheduleContainer = document.getElementById('workScheduleContainer');
    const loadingWorkSchedule = document.getElementById('loadingWorkSchedule');

    if (!workScheduleContainer || !loadingWorkSchedule) return;

    loadingWorkSchedule.style.display = 'block';
    workScheduleContainer.innerHTML = '';

    try {
        const response = await apiRequest(`/api/employees/${employeeId}/work-schedule`);
        if (!response) {
            loadingWorkSchedule.style.display = 'none';
            createDefaultWorkScheduleForm(workScheduleContainer);
            return;
        }

        const data = await response.json();
        loadingWorkSchedule.style.display = 'none';

        if (data.success && data.schedule) {
            createWorkScheduleForm(workScheduleContainer, data.schedule);
        } else {
            createDefaultWorkScheduleForm(workScheduleContainer);
        }
    } catch (error) {
        console.error('Load work schedule error:', error);
        loadingWorkSchedule.style.display = 'none';
        createDefaultWorkScheduleForm(workScheduleContainer);
    }
}


function createWorkScheduleForm(container, schedules) {
    const dayNamesFull = { 1: 'Dushanba', 2: 'Seshanba', 3: 'Chorshanba', 4: 'Payshanba', 5: 'Juma', 6: 'Shanba', 7: 'Yakshanba' };
    const displayOrder = [1, 2, 3, 4, 5, 6, 7];
    const scheduleMap = new Map();


    schedules.forEach(sched => {
        scheduleMap.set(sched.day_of_week, sched);
    });

    container.innerHTML = '';

    displayOrder.forEach((dayOfWeek, index) => {
        const schedule = scheduleMap.get(dayOfWeek);
        const isActive = schedule && schedule.is_active !== false;
        const startTime = schedule ? schedule.start_time.substring(0, 5) : '09:00';
        const endTime = schedule ? schedule.end_time.substring(0, 5) : '18:00';

        const dayItem = document.createElement('div');
        dayItem.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb;';

        dayItem.innerHTML = `
            <div style="min-width: 100px; font-size: 14px; font-weight: 500; color: #374151;">
                ${dayNamesFull[dayOfWeek]}
            </div>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
                <input type="checkbox" 
                       class="work-schedule-checkbox" 
                       data-day="${dayOfWeek}"
                       ${isActive ? 'checked' : ''}
                       style="width: 18px; height: 18px; cursor: pointer;">
                <span style="font-size: 13px; color: #6b7280;">Ish kuni</span>
            </label>
            <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label style="font-size: 13px; color: #6b7280;">Dan:</label>
                    <input type="time" 
                           class="work-schedule-start" 
                           data-day="${dayOfWeek}"
                           value="${startTime}"
                           style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; width: 90px;">
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label style="font-size: 13px; color: #6b7280;">Gacha:</label>
                    <input type="time" 
                           class="work-schedule-end" 
                           data-day="${dayOfWeek}"
                           value="${endTime}"
                           style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; width: 90px;">
                </div>
            </div>
        `;

        container.appendChild(dayItem);
    });
}


function createDefaultWorkScheduleForm(container) {
    const dayNamesFull = { 1: 'Dushanba', 2: 'Seshanba', 3: 'Chorshanba', 4: 'Payshanba', 5: 'Juma', 6: 'Shanba', 7: 'Yakshanba' };
    const displayOrder = [1, 2, 3, 4, 5, 6, 7];

    container.innerHTML = '';

    displayOrder.forEach((dayOfWeek, index) => {
        const dayItem = document.createElement('div');
        dayItem.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb;';


        const isActive = dayOfWeek >= 1 && dayOfWeek <= 5;

        dayItem.innerHTML = `
            <div style="min-width: 100px; font-size: 14px; font-weight: 500; color: #374151;">
                ${dayNamesFull[dayOfWeek]}
            </div>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
                <input type="checkbox" 
                       class="work-schedule-checkbox" 
                       data-day="${dayOfWeek}"
                       ${isActive ? 'checked' : ''}
                       style="width: 18px; height: 18px; cursor: pointer;">
                <span style="font-size: 13px; color: #6b7280;">Ish kuni</span>
            </label>
            <div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label style="font-size: 13px; color: #6b7280;">Dan:</label>
                    <input type="time" 
                           class="work-schedule-start" 
                           data-day="${dayOfWeek}"
                           value="09:00"
                           style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; width: 90px;">
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <label style="font-size: 13px; color: #6b7280;">Gacha:</label>
                    <input type="time" 
                           class="work-schedule-end" 
                           data-day="${dayOfWeek}"
                           value="18:00"
                           style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; width: 90px;">
                </div>
            </div>
        `;

        container.appendChild(dayItem);
    });
}


function getWorkScheduleFromForm() {
    const schedules = [];
    const checkboxes = document.querySelectorAll('.work-schedule-checkbox');

    checkboxes.forEach(checkbox => {
        const dayOfWeek = parseInt(checkbox.getAttribute('data-day'));
        const isActive = checkbox.checked;

        if (isActive) {
            const startInput = document.querySelector(`.work-schedule-start[data-day="${dayOfWeek}"]`);
            const endInput = document.querySelector(`.work-schedule-end[data-day="${dayOfWeek}"]`);

            schedules.push({
                day_of_week: dayOfWeek,
                start_time: startInput ? startInput.value + ':00' : '09:00:00',
                end_time: endInput ? endInput.value + ':00' : '18:00:00',
                is_active: true
            });
        } else {
            schedules.push({
                day_of_week: dayOfWeek,
                start_time: '09:00:00',
                end_time: '18:00:00',
                is_active: false
            });
        }
    });

    return schedules;
}


async function updateEmployee(employeeId, username, password, fullName, position, phone, email) {
    try {
        const requestBody = {
            username: username,
            full_name: fullName,
            position: position,
            phone: phone || null,
            email: email || null
        };

        if (password && password.trim() !== '') {
            requestBody.password = password;
        }

        const response = await apiRequest(`/api/employees/${employeeId}`, {
            method: 'PUT',
            body: JSON.stringify(requestBody)
        });

        if (!response) return;
        const data = await response.json();

        if (data.success) {

            try {
                const schedules = getWorkScheduleFromForm();
                const scheduleResponse = await apiRequest(`/api/employees/${employeeId}/work-schedule`, {
                    method: 'POST',
                    body: JSON.stringify({ schedules: schedules })
                });

                if (scheduleResponse) {
                    const scheduleData = await scheduleResponse.json();
                    if (!scheduleData.success) {
                        console.error('Work schedule save error:', scheduleData.message);
                    }
                }
            } catch (scheduleError) {
                console.error('Save work schedule error:', scheduleError);

            }

            showEditEmployeeSuccess('Hodim muvaffaqiyatli yangilandi');
            hideEditEmployeeModal();

            loadEmployees();
        } else {
            showEditEmployeeError(data.message || 'Hodimni yangilashda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Update employee error:', error);
        showEditEmployeeError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function showDeleteEmployeeModal(employeeId, name) {
    deleteEmployeeId = employeeId;
    deleteEmployeeName.textContent = name;
    deleteEmployeeModal.style.display = 'flex';
}


function hideDeleteEmployeeModal() {
    deleteEmployeeModal.style.display = 'none';
    deleteEmployeeId = null;
}


async function deleteEmployee(employeeId) {
    try {
        const response = await apiRequest(`/api/employees/${employeeId}`, {
            method: 'DELETE'
        });

        if (!response) return;
        const data = await response.json();

        if (data.success) {
            showEmployeeSuccess('Hodim muvaffaqiyatli o\'chirildi');
            hideDeleteEmployeeModal();
            loadEmployees();
        } else {
            console.error('Hodimni o\'chirishda xatolik:', data.message);
        }
    } catch (error) {
        console.error('Delete employee error:', error);
    }
}




editEmployeeFormModal.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!editEmployeeId) {
        showEditEmployeeError('Employee ID topilmadi');
        return;
    }

    const username = document.getElementById('editEmployeeUsername').value.trim();
    const password = document.getElementById('editEmployeePassword').value;
    const full_name = document.getElementById('editEmployeeFullName').value.trim();
    const position = document.getElementById('editEmployeePosition').value.trim();
    const phone = document.getElementById('editEmployeePhone').value.trim();
    const email = document.getElementById('editEmployeeEmail').value.trim();

    if (!username || !full_name || !position) {
        showEditEmployeeError('Username, to\'liq ism va lavozim kiritishingiz kerak');
        return;
    }

    if (password && password.length < 4) {
        showEditEmployeeError('Password kamida 4 ta belgidan iborat bo\'lishi kerak');
        return;
    }

    hideEditEmployeeMessages();
    setEditEmployeeLoading(true);

    try {
        await updateEmployee(editEmployeeId, username, password, full_name, position, phone, email);
        setEditEmployeeLoading(false);
    } catch (error) {
        setEditEmployeeLoading(false);
        console.error('Edit employee form error:', error);
    }
});


refreshEmployeesBtn.addEventListener('click', function () {
    loadEmployees();
    loadDailyChanges();
});


async function downloadEmployeesList() {
    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();
        if (!data.success || !data.employees || data.employees.length === 0) {
            return;
        }

        const employees = data.employees;
        const today = new Date();
        const jsDayOfWeek = today.getDay();
        const todayDayOfWeek = jsDayOfWeek === 0 ? 7 : jsDayOfWeek;

        const dayNames = {
            1: 'Dushanba',
            2: 'Seshanba',
            3: 'Chorshanba',
            4: 'Payshanba',
            5: 'Juma',
            6: 'Shanba',
            7: 'Yakshanba'
        };

        let workScheduleData = {};
        try {
            const statsResponse = await apiRequest('/api/attendance/today-stats');
            if (statsResponse) {
                const statsData = await statsResponse.json();
                if (statsData.success && statsData.work_schedules) {
                    statsData.work_schedules.forEach(schedule => {
                        if (schedule.employee_id && schedule.has_schedule) {
                            workScheduleData[schedule.employee_id] = {
                                start_time: schedule.start_time,
                                end_time: schedule.end_time,
                                has_schedule: true
                            };
                        } else if (schedule.employee_id) {
                            workScheduleData[schedule.employee_id] = { has_schedule: false };
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load attendance data for download:', error);
        }

        let htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
            font-size: 12px;
        }
        th {
            background-color: #667eea;
            color: white;
            font-weight: bold;
            text-align: center;
            padding: 12px 8px;
            border: 1px solid #5568d3;
        }
        td {
            padding: 10px 8px;
            border: 1px solid #e5e7eb;
            text-align: left;
        }
        tr:nth-child(even) {
            background-color: #f9fafb;
        }
        tr:hover {
            background-color: #f3f4f6;
        }
        .number-cell {
            text-align: center;
            font-weight: 600;
            color: #6b7280;
        }
        .name-cell {
            font-weight: 600;
            color: #111827;
        }
        .position-cell {
            color: #374151;
        }
        .workday-cell {
            text-align: center;
            color: #10b981;
            font-weight: 500;
        }
        .time-cell {
            text-align: center;
            color: #6b7280;
        }
    </style>
</head>
<body>
    <table>
        <thead>
            <tr>
                <th style="width: 50px;">№</th>
                <th style="width: 250px;">Hodim</th>
                <th style="width: 150px;">Lavozim</th>
                <th style="width: 120px;">Ish kuni</th>
                <th style="width: 100px;">Keladi</th>
                <th style="width: 100px;">Ketadi</th>
                <th style="width: 150px;">Telefon</th>
                <th style="width: 200px;">Email</th>
            </tr>
        </thead>
        <tbody>
`;

        for (let i = 0; i < employees.length; i++) {
            const emp = employees[i];
            const schedule = workScheduleData[emp.id];

            let workDay = 'yoq';
            let keladi = '—';
            let ketadi = '—';

            if (schedule && schedule.has_schedule) {
                workDay = dayNames[todayDayOfWeek] || 'yoq';
                if (schedule.start_time) {
                    keladi = schedule.start_time.substring(0, 5);
                }
                if (schedule.end_time) {
                    ketadi = schedule.end_time.substring(0, 5);
                }
            }

            const fullName = escapeHtml(emp.full_name || emp.username || '');
            const position = escapeHtml(emp.position || '');
            const phone = escapeHtml(emp.phone || '');
            const email = escapeHtml(emp.email || '');

            htmlContent += `
            <tr>
                <td class="number-cell">${i + 1}</td>
                <td class="name-cell">${fullName}</td>
                <td class="position-cell">${position}</td>
                <td class="workday-cell">${workDay}</td>
                <td class="time-cell">${keladi}</td>
                <td class="time-cell">${ketadi}</td>
                <td>${phone}</td>
                <td>${email}</td>
            </tr>`;
        }

        htmlContent += `
        </tbody>
    </table>
</body>
</html>`;

        const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        const dateStr = today.toISOString().split('T')[0];
        link.setAttribute('href', url);
        link.setAttribute('download', `hodimlar_ro_yxati_${dateStr}.xls`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('Download employees error:', error);
    }
}


if (downloadEmployeesBtn) {
    downloadEmployeesBtn.addEventListener('click', function () {
        downloadEmployeesList();
    });
}


function startEmployeesAutoRefresh() {

    stopEmployeesAutoRefresh();


    employeesAutoRefreshInterval = setInterval(() => {
        const employeesListSection = document.getElementById('employeesListSection');
        if (employeesListSection && employeesListSection.style.display !== 'none') {
            loadEmployees();
        }
    }, 30000);
}

function stopEmployeesAutoRefresh() {
    if (employeesAutoRefreshInterval) {
        clearInterval(employeesAutoRefreshInterval);
        employeesAutoRefreshInterval = null;
    }
}


function startAttendanceAutoRefresh() {

    stopAttendanceAutoRefresh();


    attendanceAutoRefreshInterval = setInterval(() => {
        const attendanceSection = document.getElementById('employeesAttendanceSection');
        if (attendanceSection && attendanceSection.style.display !== 'none') {
            loadAttendance();
        }
    }, 30000);
}

function stopAttendanceAutoRefresh() {
    if (attendanceAutoRefreshInterval) {
        clearInterval(attendanceAutoRefreshInterval);
        attendanceAutoRefreshInterval = null;
    }
}




cancelEditEmployeeBtn.addEventListener('click', hideEditEmployeeModal);
confirmDeleteEmployeeBtn.addEventListener('click', function () {
    if (deleteEmployeeId) {
        deleteEmployee(deleteEmployeeId);
    }
});

cancelDeleteEmployeeBtn.addEventListener('click', hideDeleteEmployeeModal);


editEmployeeModal.addEventListener('click', function (e) {
    if (e.target === editEmployeeModal) {
        hideEditEmployeeModal();
    }
});

deleteEmployeeModal.addEventListener('click', function (e) {
    if (e.target === deleteEmployeeModal) {
        hideDeleteEmployeeModal();
    }
});




function setEditEmployeeLoading(isLoading) {
    saveEditEmployeeBtn.disabled = isLoading;
    const btnText = saveEditEmployeeBtn.querySelector('.btn-text');
    if (isLoading) {
        btnText.textContent = 'Kutilmoqda...';
        editEmployeeLoader.style.display = 'inline-block';
    } else {
        btnText.textContent = 'Saqlash';
        editEmployeeLoader.style.display = 'none';
    }
}

function showEmployeesLoading(show) {
    loadingEmployeesMessage.style.display = show ? 'block' : 'none';
    if (!show) {
        employeesList.style.display = 'flex';
    }
}



function showEmployeeSuccess(message) {
    console.log('Success:', message);

}

function hideEditEmployeeMessages() {
    editEmployeeErrorMessage.style.display = 'none';
    editEmployeeSuccessMessage.style.display = 'none';
}

function showEditEmployeeError(message) {
    hideEditEmployeeMessages();
    editEmployeeErrorMessage.textContent = message;
    editEmployeeErrorMessage.style.display = 'block';
    setTimeout(hideEditEmployeeMessages, 5000);
}

function showEditEmployeeSuccess(message) {
    hideEditEmployeeMessages();
    editEmployeeSuccessMessage.textContent = message;
    editEmployeeSuccessMessage.style.display = 'block';
    setTimeout(hideEditEmployeeMessages, 3000);
}


editAdminForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!editUserId) {
        return;
    }

    const username = editUsername.value.trim();
    const password = editPassword.value;
    const role = editRole.value;

    if (!username) {
        showEditError('Username kiritishingiz kerak');
        return;
    }

    if (username.length < 3) {
        showEditError('Username kamida 3 ta belgidan iborat bo\'lishi kerak');
        return;
    }

    if (password && password.length < 4) {
        showEditError('Password kamida 4 ta belgidan iborat bo\'lishi kerak');
        return;
    }

    if (!role || (role !== 'admin' && role !== 'super_admin')) {
        showEditError('To\'g\'ri rolni tanlang');
        return;
    }

    hideEditMessages();
    setEditLoading(true);

    try {
        await updateAdmin(editUserId, username, password, role);
        setEditLoading(false);
    } catch (error) {
        setEditLoading(false);
        console.error('Edit form error:', error);
    }
});


cancelDeleteBtn.addEventListener('click', hideDeleteModal);
confirmDeleteBtn.addEventListener('click', function () {
    if (deleteUserId) {
        deleteAdmin(deleteUserId);
    }
});


cancelEditBtn.addEventListener('click', hideEditModal);


deleteModal.addEventListener('click', function (e) {
    if (e.target === deleteModal) {
        hideDeleteModal();
    }
});

editModal.addEventListener('click', function (e) {
    if (e.target === editModal) {
        hideEditModal();
    }
});


function setAddLoading(isLoading) {
    addBtn.disabled = isLoading;
    if (isLoading) {
        btnText.textContent = 'Kutilmoqda...';
        addLoader.style.display = 'inline-block';
    } else {
        btnText.textContent = 'Qo\'shish';
        addLoader.style.display = 'none';
    }
}

function showLoading(show) {
    loadingMessage.style.display = show ? 'block' : 'none';
    if (!show) {
        adminsList.style.display = 'flex';
    }
}

function hideMessages() {
    addErrorMessage.style.display = 'none';
    addSuccessMessage.style.display = 'none';
}

function showError(message) {
    hideMessages();
    addErrorMessage.textContent = message;
    addErrorMessage.style.display = 'block';

    setTimeout(hideMessages, 5000);
}

function showSuccess(message) {
    hideMessages();
    addSuccessMessage.textContent = message;
    addSuccessMessage.style.display = 'block';

    setTimeout(hideMessages, 3000);
}

function setEditLoading(isLoading) {
    saveEditBtn.disabled = isLoading;
    const btnText = saveEditBtn.querySelector('.btn-text');
    if (isLoading) {
        btnText.textContent = 'Kutilmoqda...';
        editLoader.style.display = 'inline-block';
    } else {
        btnText.textContent = 'Saqlash';
        editLoader.style.display = 'none';
    }
}

function hideEditMessages() {
    editErrorMessage.style.display = 'none';
    editSuccessMessage.style.display = 'none';
}

function showEditError(message) {
    hideEditMessages();
    editErrorMessage.textContent = message;
    editErrorMessage.style.display = 'block';

    setTimeout(hideEditMessages, 5000);
}

function showEditSuccess(message) {
    hideEditMessages();
    editSuccessMessage.textContent = message;
    editSuccessMessage.style.display = 'block';

    setTimeout(hideEditMessages, 3000);
}




const addPositionForm = document.getElementById('addPositionForm');
const addPositionBtn = document.getElementById('addPositionBtn');
const addPositionLoader = document.getElementById('addPositionLoader');
const addPositionErrorMessage = document.getElementById('addPositionErrorMessage');
const addPositionSuccessMessage = document.getElementById('addPositionSuccessMessage');



let positionsData = [];


async function loadPositions() {

    if (currentUserRole !== 'admin') {
        return;
    }

    try {
        showPositionsLoading(true);
        hidePositionMessages();

        const response = await apiRequest('/api/positions');
        if (!response) return;

        const data = await response.json();
        showPositionsLoading(false);

        if (data.success) {
            positionsData = data.positions;
            displayPositions(data.positions);
            populatePositionDropdowns(data.positions);
        } else {
            showPositionError('Lavozimlarni yuklashda xatolik yuz berdi');
        }
    } catch (error) {
        showPositionsLoading(false);
        console.error('Load positions error:', error);
        showPositionError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function displayPositions(positions) {

    const employeesPositionsSection = document.getElementById('employeesPositionsSection');
    let positionsListEl = null;
    let emptyPositionsMsg = null;

    if (employeesPositionsSection) {

        positionsListEl = employeesPositionsSection.querySelector('#positionsList');
        emptyPositionsMsg = employeesPositionsSection.querySelector('#emptyPositionsMessage');
    }


    if (!positionsListEl) {
        positionsListEl = document.getElementById('positionsList');
    }
    if (!emptyPositionsMsg) {
        emptyPositionsMsg = document.getElementById('emptyPositionsMessage');
    }

    if (!positionsListEl) {
        console.warn('positionsList element not found');
        return;
    }

    positionsListEl.innerHTML = '';

    if (positions.length === 0) {
        if (emptyPositionsMsg) emptyPositionsMsg.style.display = 'block';
        if (positionsListEl) positionsListEl.style.display = 'none';
        return;
    }

    if (emptyPositionsMsg) emptyPositionsMsg.style.display = 'none';
    if (positionsListEl) positionsListEl.style.display = 'grid';

    positions.forEach(position => {
        const positionItem = createPositionItem(position);
        if (positionsListEl) positionsListEl.appendChild(positionItem);
    });
}


function createPositionItem(position) {
    const item = document.createElement('div');
    item.style.cssText = 'padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; display: flex; align-items: center; justify-content: space-between;';
    item.setAttribute('data-id', position.id);

    item.innerHTML = `
        <div style="flex: 1;">
            <div style="font-weight: 500; color: #111827; font-size: 14px; margin-bottom: 2px;">${escapeHtml(position.name)}</div>
            <div style="font-size: 12px; color: #6b7280;">${position.description ? escapeHtml(position.description) : 'Tavsif yo\'q'}</div>
        </div>
        <div style="display: flex; gap: 6px; margin-left: 16px;">
            <button class="edit-btn" onclick="showEditPositionModal(${position.id}, '${escapeHtml(position.name)}', '${escapeHtml((position.description || '').replace(/'/g, "\\'"))}')" title="Tahrirlash">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="delete-btn" onclick="showDeletePositionModal(${position.id}, '${escapeHtml(position.name)}')" title="O'chirish">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

    return item;
}


function populatePositionDropdowns(positions) {
    const employeePositionSelect = document.getElementById('employeePosition');
    const editEmployeePositionSelect = document.getElementById('editEmployeePosition');


    if (employeePositionSelect) {
        while (employeePositionSelect.children.length > 1) {
            employeePositionSelect.removeChild(employeePositionSelect.lastChild);
        }
    }
    if (editEmployeePositionSelect) {
        while (editEmployeePositionSelect.children.length > 1) {
            editEmployeePositionSelect.removeChild(editEmployeePositionSelect.lastChild);
        }
    }

    positions.forEach(position => {
        const option1 = document.createElement('option');
        option1.value = position.name;
        option1.textContent = position.name;
        if (employeePositionSelect) employeePositionSelect.appendChild(option1);

        const option2 = document.createElement('option');
        option2.value = position.name;
        option2.textContent = position.name;
        if (editEmployeePositionSelect) editEmployeePositionSelect.appendChild(option2);
    });
}


addPositionForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const name = document.getElementById('positionName').value.trim();
    const description = document.getElementById('positionDescription').value.trim();

    if (!name) {
        showPositionError('Lavozim nomi kiritishingiz kerak');
        return;
    }

    hidePositionMessages();
    setAddPositionLoading(true);

    try {
        const response = await apiRequest('/api/positions', {
            method: 'POST',
            body: JSON.stringify({
                name,
                description: description || null
            })
        });

        if (!response) return;
        const data = await response.json();
        setAddPositionLoading(false);

        if (data.success) {
            showPositionSuccess(data.message || 'Lavozim muvaffaqiyatli qo\'shildi');
            addPositionForm.reset();
            loadPositions();
        } else {
            showPositionError(data.message || 'Lavozim qo\'shishda xatolik yuz berdi');
        }
    } catch (error) {
        setAddPositionLoading(false);
        console.error('Add position error:', error);
        showPositionError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
});


function setAddPositionLoading(isLoading) {
    addPositionBtn.disabled = isLoading;
    const btnText = addPositionBtn.querySelector('.btn-text');
    if (isLoading) {
        btnText.textContent = 'Kutilmoqda...';
        addPositionLoader.style.display = 'inline-block';
    } else {
        btnText.textContent = 'Qo\'shish';
        addPositionLoader.style.display = 'none';
    }
}

function showPositionsLoading(show) {

    const employeesPositionsSection = document.getElementById('employeesPositionsSection');
    let loadingPositionsMsg = null;

    if (employeesPositionsSection && employeesPositionsSection.style.display !== 'none') {
        loadingPositionsMsg = employeesPositionsSection.querySelector('#loadingPositionsMessage');
    } else {
        loadingPositionsMsg = document.getElementById('loadingPositionsMessage');
    }

    if (loadingPositionsMsg) {
        loadingPositionsMsg.style.display = show ? 'block' : 'none';
    }
    if (!show) {
        const employeesPositionsSection2 = document.getElementById('employeesPositionsSection');
        let positionsListEl = null;
        if (employeesPositionsSection2 && employeesPositionsSection2.style.display !== 'none') {
            positionsListEl = employeesPositionsSection2.querySelector('#positionsList');
        } else {
            positionsListEl = document.getElementById('positionsList');
        }
        if (positionsListEl) {
            positionsListEl.style.display = 'flex';
        }
    }
}

function hidePositionMessages() {
    addPositionErrorMessage.style.display = 'none';
    addPositionSuccessMessage.style.display = 'none';
}

function showPositionError(message) {
    hidePositionMessages();
    addPositionErrorMessage.textContent = message;
    addPositionErrorMessage.style.display = 'block';
    setTimeout(hidePositionMessages, 5000);
}

function showPositionSuccess(message) {
    hidePositionMessages();
    addPositionSuccessMessage.textContent = message;
    addPositionSuccessMessage.style.display = 'block';
    setTimeout(hidePositionMessages, 3000);
}


function showEditPositionModal(id, name, description) {
    const newName = prompt('Yangi lavozim nomi:', name);
    if (newName === null) return;

    const newDescription = prompt('Yangi tavsif:', description || '');

    updatePosition(id, newName.trim(), newDescription ? newDescription.trim() : null);
}

async function updatePosition(positionId, name, description) {
    if (!name) {
        showPositionError('Lavozim nomi kiritishingiz kerak');
        return;
    }

    try {
        const response = await apiRequest(`/api/positions/${positionId}`, {
            method: 'PUT',
            body: JSON.stringify({
                name,
                description: description || null
            })
        });

        if (!response) return;
        const data = await response.json();

        if (data.success) {
            showPositionSuccess('Lavozim muvaffaqiyatli yangilandi');
            loadPositions();
        } else {
            showPositionError(data.message || 'Lavozimni yangilashda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Update position error:', error);
        showPositionError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function showDeletePositionModal(positionId, name) {
    if (confirm(`Haqiqatan ham "${name}" lavozimini o'chirmoqchimisiz?`)) {
        deletePosition(positionId);
    }
}

async function deletePosition(positionId) {
    try {
        const response = await apiRequest(`/api/positions/${positionId}`, {
            method: 'DELETE'
        });

        if (!response) return;
        const data = await response.json();

        if (data.success) {
            showPositionSuccess('Lavozim muvaffaqiyatli o\'chirildi');
            loadPositions();
        } else {
            showPositionError(data.message || 'Lavozimni o\'chirishda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Delete position error:', error);
        showPositionError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function updateEditEmployeePositionSelect(selectedPosition) {
    const editEmployeePositionSelect = document.getElementById('editEmployeePosition');
    if (editEmployeePositionSelect) {
        editEmployeePositionSelect.value = selectedPosition || '';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}




const addSalaryForm = document.getElementById('addSalaryForm');
const salaryEmployee = document.getElementById('salaryEmployee');
const salaryWorkPosition = document.getElementById('salaryWorkPosition');
const salaryAmount = document.getElementById('salaryAmount');
const salaryPeriodType = document.getElementById('salaryPeriodType');
const salaryPeriodDate = document.getElementById('salaryPeriodDate');
const salaryNotes = document.getElementById('salaryNotes');
const addSalaryBtn = document.getElementById('addSalaryBtn');
const addSalaryLoader = document.getElementById('addSalaryLoader');
const addSalaryErrorMessage = document.getElementById('addSalaryErrorMessage');
const addSalarySuccessMessage = document.getElementById('addSalarySuccessMessage');
const salariesList = document.getElementById('salariesList');
const loadingSalariesMessage = document.getElementById('loadingSalariesMessage');
const emptySalariesMessage = document.getElementById('emptySalariesMessage');
const refreshSalariesBtn = document.getElementById('refreshSalariesBtn');
const salaryFilterPeriod = document.getElementById('salaryFilterPeriod');

let editSalaryId = null;
let deleteSalaryId = null;


async function loadEmployeesForSalaries() {
    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.employees) {

            const salaryEmployeeEl = document.getElementById('salaryEmployee');
            if (salaryEmployeeEl) {
                salaryEmployeeEl.innerHTML = '<option value="">Hodimni tanlang</option>';
                data.employees.forEach(emp => {
                    const option = document.createElement('option');
                    option.value = emp.id;
                    option.dataset.position = emp.position;
                    option.textContent = `${emp.full_name} (${emp.position})`;
                    salaryEmployeeEl.appendChild(option);
                });


                salaryEmployeeEl.addEventListener('change', function () {
                    const salaryWorkPositionEl = document.getElementById('salaryWorkPosition');
                    if (salaryWorkPositionEl) {
                        salaryWorkPositionEl.value = '';
                    }
                });
            }


            const editSalaryEmployee = document.getElementById('editSalaryEmployee');
            if (editSalaryEmployee) {
                const currentValue = editSalaryEmployee.value;
                editSalaryEmployee.innerHTML = '<option value="">Hodimni tanlang</option>';
                data.employees.forEach(emp => {
                    const option = document.createElement('option');
                    option.value = emp.id;
                    option.dataset.position = emp.position;
                    option.textContent = `${emp.full_name} (${emp.position})`;
                    editSalaryEmployee.appendChild(option);
                });
                if (currentValue) {
                    editSalaryEmployee.value = currentValue;
                }


                editSalaryEmployee.addEventListener('change', function () {
                    const editWorkPosition = document.getElementById('editSalaryWorkPosition');
                    if (editWorkPosition) {
                        editWorkPosition.value = '';
                    }
                });
            }
        }


        await loadPositionsForSalaries();
    } catch (error) {
        console.error('Error loading employees for salaries:', error);
    }
}


async function loadPositionsForSalaries() {
    try {
        const response = await apiRequest('/api/positions');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.positions) {

            const salaryWorkPositionEl = document.getElementById('salaryWorkPosition');
            if (salaryWorkPositionEl) {
                const currentValue = salaryWorkPositionEl.value;
                salaryWorkPositionEl.innerHTML = '<option value="">O\'z lavozimida (asosiy lavozim)</option>';
                data.positions.forEach(pos => {
                    const option = document.createElement('option');
                    option.value = pos.name;
                    option.textContent = pos.name;
                    salaryWorkPositionEl.appendChild(option);
                });
                if (currentValue) {
                    salaryWorkPositionEl.value = currentValue;
                }
            }


            const editSalaryWorkPosition = document.getElementById('editSalaryWorkPosition');
            if (editSalaryWorkPosition) {
                const currentValue = editSalaryWorkPosition.value;
                editSalaryWorkPosition.innerHTML = '<option value="">Lavozimni tanlang</option>';
                data.positions.forEach(pos => {
                    const option = document.createElement('option');
                    option.value = pos.name;
                    option.textContent = pos.name;
                    editSalaryWorkPosition.appendChild(option);
                });
                if (currentValue) {
                    editSalaryWorkPosition.value = currentValue;
                }
            }
        }
    } catch (error) {
        console.error('Error loading positions for salaries:', error);
    }
}


// Eski salary funksiyalari o'chirildi



function hideSalaryMessages() {
    if (addSalaryErrorMessage) addSalaryErrorMessage.style.display = 'none';
    if (addSalarySuccessMessage) addSalarySuccessMessage.style.display = 'none';
}

function showSalaryError(message) {
    hideSalaryMessages();
    if (addSalaryErrorMessage) {
        addSalaryErrorMessage.textContent = message;
        addSalaryErrorMessage.style.display = 'block';
    }
}

function showSalarySuccess(message) {
    hideSalaryMessages();
    if (addSalarySuccessMessage) {
        addSalarySuccessMessage.textContent = message;
        addSalarySuccessMessage.style.display = 'block';
        setTimeout(() => {
            if (addSalarySuccessMessage) addSalarySuccessMessage.style.display = 'none';
        }, 3000);
    }
}

function showSalariesLoading(loading) {
    if (loadingSalariesMessage) loadingSalariesMessage.style.display = loading ? 'block' : 'none';
}

function setAddSalaryLoading(loading) {
    if (addSalaryBtn) {
        if (loading) {
            addSalaryBtn.disabled = true;
            if (addSalaryLoader) addSalaryLoader.style.display = 'inline-block';
            const btnText = addSalaryBtn.querySelector('.btn-text');
            if (btnText) btnText.style.display = 'none';
        } else {
            addSalaryBtn.disabled = false;
            if (addSalaryLoader) addSalaryLoader.style.display = 'none';
            const btnText = addSalaryBtn.querySelector('.btn-text');
            if (btnText) btnText.style.display = 'inline';
        }
    }
}


if (addSalaryForm) {
    addSalaryForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const salaryEmployeeEl = document.getElementById('salaryEmployee');
        const salaryAmountEl = document.getElementById('salaryAmount');
        const salaryPeriodTypeEl = document.getElementById('salaryPeriodType');
        const salaryPeriodDateEl = document.getElementById('salaryPeriodDate');
        const salaryNotesEl = document.getElementById('salaryNotes');

        const employeeId = salaryEmployeeEl ? salaryEmployeeEl.value : '';
        // Formatlangan qiymatni raqamli qiymatga o'zgartirish (nuqta va bo'shliqlarni olib tashlash)
        const amountRaw = salaryAmountEl ? salaryAmountEl.value.replace(/[^\d]/g, '') : '';
        const amount = amountRaw ? parseFloat(amountRaw) : 0;
        const periodType = salaryPeriodTypeEl ? salaryPeriodTypeEl.value : '';
        const periodDate = salaryPeriodDateEl ? salaryPeriodDateEl.value : '';
        const notes = salaryNotesEl ? salaryNotesEl.value.trim() : '';

        if (!employeeId || !amount || !periodType || !periodDate) {
            showSalaryError('Barcha majburiy maydonlarni to\'ldiring');
            return;
        }

        if (amount <= 0) {
            showSalaryError('Summa musbat son bo\'lishi kerak');
            return;
        }

        const salaryWorkPositionEl = document.getElementById('salaryWorkPosition');
        const workPosition = salaryWorkPositionEl && salaryWorkPositionEl.value ? salaryWorkPositionEl.value : '';

        hideSalaryMessages();
        setAddSalaryLoading(true);

        try {
            const response = await apiRequest('/api/salaries', {
                method: 'POST',
                body: JSON.stringify({
                    employee_id: parseInt(employeeId),
                    amount: amount,
                    period_type: periodType,
                    period_date: periodDate,
                    work_position: workPosition || null,
                    notes: notes || null
                })
            });

            if (!response) {
                setAddSalaryLoading(false);
                return;
            }

            const data = await response.json();
            setAddSalaryLoading(false);

            if (data.success) {
                showSalarySuccess(data.message || 'Maosh muvaffaqiyatli qo\'shildi');
                addSalaryForm.reset();
                loadSalaries();
            } else {
                showSalaryError(data.message || 'Maosh qo\'shishda xatolik yuz berdi');
            }
        } catch (error) {
            setAddSalaryLoading(false);
            console.error('Add salary error:', error);
            showSalaryError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
        }
    });
}


if (refreshSalariesBtn) {
    refreshSalariesBtn.addEventListener('click', function () {
        loadSalaries();
        loadDailyChanges();
    });
}

// Calendar for Salaries Section
let salariesCalendarMonth = new Date().getMonth();
let salariesCalendarYear = new Date().getFullYear();
let salariesSelectedStartDate = null;
let salariesSelectedEndDate = null;
let salariesIsSelectingStartDate = true;
let currentSalariesDateRange = { startDate: null, endDate: null };

const calendarSalariesBtn = document.getElementById('calendarSalariesBtn');
if (calendarSalariesBtn) {
    calendarSalariesBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSalariesCalendar();
    });
}

// Close calendar when clicking outside
document.addEventListener('click', function (e) {
    const calendarWidget = document.getElementById('salariesCalendarWidget');
    const calendarBtn = document.getElementById('calendarSalariesBtn');
    if (calendarWidget && calendarBtn &&
        !calendarWidget.contains(e.target) &&
        !calendarBtn.contains(e.target)) {
        hideSalariesCalendar();
    }
});

function toggleSalariesCalendar() {
    const calendarWidget = document.getElementById('salariesCalendarWidget');
    if (!calendarWidget) return;

    if (calendarWidget.style.display === 'none' || !calendarWidget.style.display) {
        showSalariesCalendar();
    } else {
        hideSalariesCalendar();
    }
}

function showSalariesCalendar() {
    const calendarWidget = document.getElementById('salariesCalendarWidget');
    if (!calendarWidget) return;

    // Reset selection state
    if (currentSalariesDateRange.startDate && currentSalariesDateRange.endDate) {
        salariesSelectedStartDate = new Date(currentSalariesDateRange.startDate);
        salariesSelectedEndDate = new Date(currentSalariesDateRange.endDate);
        salariesCalendarMonth = salariesSelectedStartDate.getMonth();
        salariesCalendarYear = salariesSelectedStartDate.getFullYear();
        salariesIsSelectingStartDate = false;
    } else {
        salariesSelectedStartDate = null;
        salariesSelectedEndDate = null;
        salariesIsSelectingStartDate = true;
        const today = new Date();
        salariesCalendarMonth = today.getMonth();
        salariesCalendarYear = today.getFullYear();
    }

    renderSalariesCalendar();
    calendarWidget.style.display = 'block';
}

function hideSalariesCalendar() {
    const calendarWidget = document.getElementById('salariesCalendarWidget');
    if (calendarWidget) {
        calendarWidget.style.display = 'none';
    }
}

async function renderSalariesCalendar() {
    const calendarWidget = document.getElementById('salariesCalendarWidget');
    if (!calendarWidget) return;

    calendarWidget.onclick = (e) => e.stopPropagation();

    const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
    const weekDays = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

    const firstDay = new Date(salariesCalendarYear, salariesCalendarMonth, 1);
    const lastDay = new Date(salariesCalendarYear, salariesCalendarMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay() === 0 ? 7 : firstDay.getDay();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Maoshlarni yuklab olish (kalendarda ko'rsatish uchun)
    let salariesByDate = new Map();
    try {
        const salariesResponse = await apiRequest('/api/salaries');
        if (salariesResponse) {
            const salariesData = await salariesResponse.json();
            if (salariesData.success && salariesData.salaries) {
                salariesData.salaries.forEach(salary => {
                    const date = new Date(salary.period_date);
                    const dateStr = date.toISOString().split('T')[0];
                    if (!salariesByDate.has(dateStr)) {
                        salariesByDate.set(dateStr, []);
                    }
                    salariesByDate.get(dateStr).push(salary);
                });
            }
        }
    } catch (error) {
        console.error('Error loading salaries for calendar:', error);
    }

    let html = `
        <div style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-size: 16px; font-weight: 600; color: #111827;">${monthNames[salariesCalendarMonth]} ${salariesCalendarYear}</span>
                <div style="display: flex; gap: 4px;">
                    <button id="salariesCalendarPrev" style="background: none; border: none; cursor: pointer; padding: 4px; color: #6b7280;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                    </button>
                    <button id="salariesCalendarNext" style="background: none; border: none; cursor: pointer; padding: 4px; color: #6b7280;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 8px;">
    `;

    weekDays.forEach(day => {
        html += `<div style="text-align: center; font-size: 12px; font-weight: 500; color: #6b7280; padding: 8px;">${day}</div>`;
    });

    html += `</div><div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">`;

    for (let i = 1; i < startingDayOfWeek; i++) {
        html += `<div style="padding: 8px; min-height: 36px;"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(salariesCalendarYear, salariesCalendarMonth, day);
        cellDate.setHours(0, 0, 0, 0);
        const dateStr = cellDate.toISOString().split('T')[0];
        const daySalaries = salariesByDate.get(dateStr) || [];
        const totalAmount = daySalaries.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);

        let cellStyle = 'padding: 6px; min-height: 50px; text-align: center; cursor: pointer; border-radius: 4px; font-size: 13px; font-weight: 500; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative;';

        if (salariesSelectedStartDate && cellDate.getTime() === salariesSelectedStartDate.getTime()) {
            cellStyle += ' background: #3b82f6; color: white;';
        } else if (salariesSelectedEndDate && cellDate.getTime() === salariesSelectedEndDate.getTime()) {
            cellStyle += ' background: #3b82f6; color: white;';
        } else if (salariesSelectedStartDate && salariesSelectedEndDate &&
            cellDate.getTime() > salariesSelectedStartDate.getTime() &&
            cellDate.getTime() < salariesSelectedEndDate.getTime()) {
            cellStyle += ' background: #dbeafe; color: #1e40af;';
        } else if (cellDate.getTime() === today.getTime()) {
            cellStyle += ' background: #f3f4f6; color: #111827; border: 1px solid #3b82f6;';
        } else if (daySalaries.length > 0) {
            cellStyle += ' background: #dcfce7; color: #065f46; border: 1px solid #86efac;';
        } else {
            cellStyle += ' background: white; color: #374151;';
        }

        html += `<div class="salaries-calendar-day" data-date="${dateStr}" style="${cellStyle}">
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 2px;">${day}</div>
            ${daySalaries.length > 0 ? `<div style="font-size: 9px; color: ${cellDate.getTime() === salariesSelectedStartDate?.getTime() || cellDate.getTime() === salariesSelectedEndDate?.getTime() ? 'white' : '#059669'}; font-weight: 600; line-height: 1.2;">${formatCurrency(totalAmount).replace(' so\'m', '').replace(/\s/g, '')}</div>` : ''}
        </div>`;
    }

    html += `
            </div>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
            <button id="salariesCalendarClear" style="padding: 6px 12px; border: 1px solid #d1d5db; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; color: #374151;">Tozalash</button>
            <button id="salariesCalendarApply" style="padding: 6px 12px; border: none; background: #3b82f6; border-radius: 6px; cursor: pointer; font-size: 13px; color: white; font-weight: 500;">Qo'llash</button>
        </div>
    `;

    calendarWidget.innerHTML = html;

    // Event listeners
    const prevBtn = document.getElementById('salariesCalendarPrev');
    const nextBtn = document.getElementById('salariesCalendarNext');
    const clearBtn = document.getElementById('salariesCalendarClear');
    const applyBtn = document.getElementById('salariesCalendarApply');
    const dayCells = calendarWidget.querySelectorAll('.salaries-calendar-day');

    if (prevBtn) {
        prevBtn.onclick = () => {
            if (salariesCalendarMonth === 0) {
                salariesCalendarMonth = 11;
                salariesCalendarYear--;
            } else {
                salariesCalendarMonth--;
            }
            renderSalariesCalendar();
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            if (salariesCalendarMonth === 11) {
                salariesCalendarMonth = 0;
                salariesCalendarYear++;
            } else {
                salariesCalendarMonth++;
            }
            renderSalariesCalendar();
        };
    }

    if (clearBtn) {
        clearBtn.onclick = () => {
            salariesSelectedStartDate = null;
            salariesSelectedEndDate = null;
            salariesIsSelectingStartDate = true;
            currentSalariesDateRange = { startDate: null, endDate: null };
            renderSalariesCalendar();
            loadSalaries();
            hideSalariesCalendar();
        };
    }

    if (applyBtn) {
        applyBtn.onclick = () => {
            if (salariesSelectedStartDate && salariesSelectedEndDate) {
                const startDateStr = salariesSelectedStartDate.toISOString().split('T')[0];
                const endDateStr = salariesSelectedEndDate.toISOString().split('T')[0];

                currentSalariesDateRange = { startDate: startDateStr, endDate: endDateStr };

                // Maoshlarni filtrlash
                loadSalariesByDateRange(startDateStr, endDateStr);
                hideSalariesCalendar();
            } else {
                alert('Iltimos, boshlanish va tugash sanalarini tanlang');
            }
        };
    }

    dayCells.forEach(cell => {
        cell.onclick = () => {
            const dateStr = cell.getAttribute('data-date');
            const date = new Date(dateStr);
            date.setHours(0, 0, 0, 0);

            if (salariesIsSelectingStartDate || !salariesSelectedStartDate) {
                salariesSelectedStartDate = new Date(date);
                salariesSelectedEndDate = null;
                salariesIsSelectingStartDate = false;
            } else {
                if (date.getTime() < salariesSelectedStartDate.getTime()) {
                    salariesSelectedEndDate = new Date(salariesSelectedStartDate);
                    salariesSelectedStartDate = new Date(date);
                } else {
                    salariesSelectedEndDate = new Date(date);
                }
            }

            renderSalariesCalendar();
        };
    });
}

async function loadSalariesByDateRange(startDate, endDate) {
    const salariesEmployeesList = document.getElementById('salariesEmployeesList');
    const loadingMessage = document.getElementById('loadingSalariesMessage');
    const emptyMessage = document.getElementById('emptySalariesMessage');

    if (loadingMessage) loadingMessage.style.display = 'block';
    if (salariesEmployeesList) salariesEmployeesList.innerHTML = '';
    if (emptyMessage) emptyMessage.style.display = 'none';

    try {
        // Hodimlarni yuklash
        const employeesResponse = await apiRequest('/api/employees');
        if (!employeesResponse) {
            if (loadingMessage) loadingMessage.style.display = 'none';
            return;
        }

        const employeesData = await employeesResponse.json();
        if (!employeesData.success || !employeesData.employees) {
            if (loadingMessage) loadingMessage.style.display = 'none';
            if (emptyMessage) {
                emptyMessage.style.display = 'block';
                emptyMessage.textContent = 'Hodimlarni yuklashda xatolik';
            }
            return;
        }

        // Maoshlarni yuklash (sana oraliq bilan)
        const salariesUrl = `/api/salaries?start_date=${startDate}&end_date=${endDate}`;
        const salariesResponse = await apiRequest(salariesUrl);
        if (!salariesResponse) {
            if (loadingMessage) loadingMessage.style.display = 'none';
            return;
        }

        const salariesData = await salariesResponse.json();
        if (loadingMessage) loadingMessage.style.display = 'none';

        if (salariesData.success && salariesData.salaries) {
            if (salariesData.salaries.length === 0) {
                if (emptyMessage) emptyMessage.style.display = 'block';
                if (salariesEmployeesList) salariesEmployeesList.style.display = 'none';
            } else {
                if (emptyMessage) emptyMessage.style.display = 'none';
                if (salariesEmployeesList) {
                    salariesEmployeesList.style.display = 'flex';
                    salariesEmployeesList.style.flexDirection = 'column';
                    displaySalariesByEmployees(employeesData.employees, salariesData.salaries, 'all');
                }
            }
        } else {
            if (emptyMessage) {
                emptyMessage.style.display = 'block';
                emptyMessage.textContent = salariesData.message || 'Maoshlarni yuklashda xatolik';
            }
        }
    } catch (error) {
        if (loadingMessage) loadingMessage.style.display = 'none';
        console.error('Load salaries by date range error:', error);
        if (emptyMessage) {
            emptyMessage.style.display = 'block';
            emptyMessage.textContent = 'Maoshlarni yuklashda xatolik yuz berdi';
        }
    }
}

// Moliya Section Event Listeners
let currentSalaryPeriod = 'all'; // 'all', 'today', 'week', 'month' - default 'all'

// Salary filter buttons
const salaryFilterToday = document.getElementById('salaryFilterToday');
const salaryFilterWeek = document.getElementById('salaryFilterWeek');
const salaryFilterMonth = document.getElementById('salaryFilterMonth');

if (salaryFilterToday) {
    salaryFilterToday.addEventListener('click', function () {
        currentSalaryPeriod = 'today';
        updateSalaryFilterButtons();
        loadSalaries();
    });
}

if (salaryFilterWeek) {
    salaryFilterWeek.addEventListener('click', function () {
        currentSalaryPeriod = 'week';
        updateSalaryFilterButtons();
        loadSalaries();
    });
}

if (salaryFilterMonth) {
    salaryFilterMonth.addEventListener('click', function () {
        currentSalaryPeriod = 'month';
        updateSalaryFilterButtons();
        loadSalaries();
    });
}

function updateSalaryFilterButtons() {
    // Barcha filter button'larni olish
    const allFilterButtons = document.querySelectorAll('.salary-filter-btn, [id^="salaryFilter"]');
    allFilterButtons.forEach(btn => {
        if (btn) {
            btn.classList.remove('active');
        }
    });

    // Jami (all) button'ni topish va active qilish
    if (currentSalaryPeriod === 'all') {
        const allBtn = document.getElementById('salaryFilterAll') || document.querySelector('[data-period="all"]');
        if (allBtn) {
            allBtn.classList.add('active');
        }
    } else if (currentSalaryPeriod === 'today' && salaryFilterToday) {
        salaryFilterToday.classList.add('active');
    } else if (currentSalaryPeriod === 'week' && salaryFilterWeek) {
        salaryFilterWeek.classList.add('active');
    } else if (currentSalaryPeriod === 'month' && salaryFilterMonth) {
        salaryFilterMonth.classList.add('active');
    }
}

// Employee filter for salaries
const salaryEmployeeFilter = document.getElementById('salaryEmployeeFilter');
if (salaryEmployeeFilter) {
    salaryEmployeeFilter.addEventListener('change', function () {
        loadSalaries();
    });
}

// Load employees for salary filter
async function loadEmployeesForSalaryFilter() {
    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.employees && salaryEmployeeFilter) {
            const currentValue = salaryEmployeeFilter.value;
            salaryEmployeeFilter.innerHTML = '<option value="">Barcha hodimlar</option>';

            data.employees.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.id;
                option.textContent = `${emp.full_name} (${emp.position})`;
                salaryEmployeeFilter.appendChild(option);
            });

            if (currentValue) {
                salaryEmployeeFilter.value = currentValue;
            }
        }
    } catch (error) {
        console.error('Error loading employees for salary filter:', error);
    }
}






async function loadOrganizationSettings() {
    if (!organizationSettingsForm) return;

    try {
        const response = await apiRequest('/api/organization');
        if (!response) {
            showOrganizationError('Ma\'lumotlarni yuklashda xatolik yuz berdi');
            return;
        }

        const data = await response.json();
        if (data.success && data.organization) {
            if (organizationName) {
                organizationName.value = data.organization.organization_name || '';
            }
            if (organizationAddress) {
                organizationAddress.value = data.organization.organization_address || '';
            }
            if (organizationPhone) {
                organizationPhone.value = data.organization.organization_phone || '';
            }
            if (organizationEmail) {
                organizationEmail.value = data.organization.organization_email || '';
            }
            if (logoPreview && data.organization.logo_path) {
                logoPreview.src = data.organization.logo_path;
                logoPreview.style.display = 'block';
            } else if (logoPreview) {
                logoPreview.style.display = 'none';
            }

            // Jarima sozlamalarini yuklash
            if (lateThresholdMinutes) {
                lateThresholdMinutes.value = data.organization.late_threshold_minutes || 5;
            }
            if (penaltyPerMinute) {
                penaltyPerMinute.value = data.organization.penalty_per_minute || 1000;
            }
            if (maxPenaltyPerDay) {
                maxPenaltyPerDay.value = data.organization.max_penalty_per_day || 50000;
            }

            updateHeaderWithOrganization(data.organization.organization_name, data.organization.logo_path);
        } else {
            showOrganizationError(data.message || 'Ma\'lumotlarni yuklashda xatolik');
        }
    } catch (error) {
        console.error('Error loading organization settings:', error);
        showOrganizationError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function updateHeaderWithOrganization(orgName, logoPath) {
    if (sidebarTitle && orgName) {
        sidebarTitle.textContent = orgName;
    }
    if (sidebarLogo && logoPath) {
        sidebarLogo.src = logoPath;
        sidebarLogo.style.display = 'block';
    }
}


if (logoUpload && logoPreview) {
    logoUpload.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                showOrganizationError('Rasm hajmi 5MB dan katta bo\'lmasligi kerak');
                logoUpload.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = function (e) {
                logoPreview.src = e.target.result;
                logoPreview.style.display = 'block';
            };
            reader.onerror = function () {
                showOrganizationError('Rasmni o\'qishda xatolik yuz berdi');
                logoUpload.value = '';
            };
            reader.readAsDataURL(file);
        }
    });
}


if (organizationSettingsForm) {
    organizationSettingsForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const orgName = organizationName ? organizationName.value.trim() : '';
        const orgAddress = organizationAddress ? organizationAddress.value.trim() : '';
        const orgPhone = organizationPhone ? organizationPhone.value.trim() : '';
        const orgEmail = organizationEmail ? organizationEmail.value.trim() : '';
        const logoFile = logoUpload ? logoUpload.files[0] : null;
        const lateThreshold = lateThresholdMinutes ? lateThresholdMinutes.value.trim() : '';
        const penaltyPerMin = penaltyPerMinute ? penaltyPerMinute.value.trim() : '';
        const maxPenalty = maxPenaltyPerDay ? maxPenaltyPerDay.value.trim() : '';

        hideOrganizationMessages();
        setOrganizationLoading(true);

        try {
            const updateData = {};
            if (orgName) updateData.organization_name = orgName;
            if (orgAddress) updateData.organization_address = orgAddress;
            if (orgPhone) updateData.organization_phone = orgPhone;
            if (orgEmail) updateData.organization_email = orgEmail;
            if (lateThreshold !== '') updateData.late_threshold_minutes = lateThreshold;
            if (penaltyPerMin !== '') updateData.penalty_per_minute = penaltyPerMin;
            if (maxPenalty !== '') updateData.max_penalty_per_day = maxPenalty;

            if (Object.keys(updateData).length > 0) {
                const response = await apiRequest('/api/organization', {
                    method: 'PUT',
                    body: JSON.stringify(updateData)
                });

                if (!response) {
                    setOrganizationLoading(false);
                    showOrganizationError('Serverga ulanib bo\'lmadi');
                    return;
                }

                const data = await response.json();
                if (!data.success) {
                    showOrganizationError(data.message || 'Tashkilot ma\'lumotlarini yangilashda xatolik');
                    setOrganizationLoading(false);
                    return;
                }

                if (data.organization) {
                    updateHeaderWithOrganization(data.organization.organization_name, data.organization.logo_path);
                }
            }

            if (logoFile) {
                if (logoFile.size > 5 * 1024 * 1024) {
                    setOrganizationLoading(false);
                    showOrganizationError('Rasm hajmi 5MB dan katta bo\'lmasligi kerak');
                    return;
                }

                const formData = new FormData();
                formData.append('logo', logoFile);

                const token = getAuthToken();
                const uploadResponse = await fetch('/api/organization/logo', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });

                if (uploadResponse.status === 401) {
                    localStorage.removeItem('authToken');
                    localStorage.removeItem('userRole');
                    window.location.href = '/';
                    setOrganizationLoading(false);
                    return;
                }

                const uploadData = await uploadResponse.json();
                if (uploadData.success && uploadData.logo_path) {
                    if (logoPreview) {
                        logoPreview.src = uploadData.logo_path;
                        logoPreview.style.display = 'block';
                    }
                    if (sidebarLogo) {
                        sidebarLogo.src = uploadData.logo_path;
                        sidebarLogo.style.display = 'block';
                    }
                } else {
                    showOrganizationError(uploadData.message || 'Logo yuklashda xatolik');
                    setOrganizationLoading(false);
                    return;
                }
            }

            showOrganizationSuccess('Tashkilot sozlamalari muvaffaqiyatli yangilandi');
            if (logoUpload) logoUpload.value = '';
            setOrganizationLoading(false);

        } catch (error) {
            console.error('Error updating organization settings:', error);
            showOrganizationError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
            setOrganizationLoading(false);
        }
    });
}


function hideOrganizationMessages() {
    if (organizationErrorMessage) organizationErrorMessage.style.display = 'none';
    if (organizationSuccessMessage) organizationSuccessMessage.style.display = 'none';
}

function showOrganizationError(message) {
    hideOrganizationMessages();
    if (organizationErrorMessage) {
        organizationErrorMessage.textContent = message;
        organizationErrorMessage.style.display = 'block';
    }
}

function showOrganizationSuccess(message) {
    hideOrganizationMessages();
    if (organizationSuccessMessage) {
        organizationSuccessMessage.textContent = message;
        organizationSuccessMessage.style.display = 'block';
        setTimeout(() => {
            if (organizationSuccessMessage) organizationSuccessMessage.style.display = 'none';
        }, 3000);
    }
}

async function loadSettings() {
    // Settings section loading function
    // Reset forms
    if (changePasswordForm) {
        changePasswordForm.reset();
        hidePasswordMessages();
    }

    // Load admin permissions
    await loadAdminPermissions();
}

const adminPermissionsList = document.getElementById('adminPermissionsList');

const availablePermissions = [
    { id: 'statistics', label: 'Statistika', sectionId: 'statisticsSection' },
    { id: 'employees', label: 'Hodimlar', sectionId: 'employeesSection' },
    { id: 'terminals', label: 'Terminallar', sectionId: 'terminalsManagementSection' },
    { id: 'income', label: 'Moliya', sectionId: 'incomeSection' },
    { id: 'settings', label: 'Sozlamalar', sectionId: 'organizationSettingsSection' }
];

let allAdmins = [];
let selectedAdminId = null;

async function loadAdminPermissions() {
    if (!adminPermissionsList) return;

    try {
        const response = await apiRequest('/api/users');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.users) {
            allAdmins = data.users.filter(user => user.role === 'admin');
            displayAdminSelector();
        }
    } catch (error) {
        console.error('Load admin permissions error:', error);
    }
}

function displayAdminSelector() {
    if (!adminPermissionsList) return;

    adminPermissionsList.innerHTML = '';

    if (allAdmins.length === 0) {
        adminPermissionsList.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 20px;">Adminlar topilmadi</p>';
        return;
    }

    const selectedAdmin = selectedAdminId ? allAdmins.find(a => a.id === selectedAdminId) : null;

    const selectorHtml = `
        <div class="admin-permission-card" style="position: relative;">
            <div class="admin-permission-header">
                <div class="admin-selector-trigger" onclick="toggleAdminDropdown()">
                    ${selectedAdmin ? `
                        <div class="admin-selector-avatar">${escapeHtml(selectedAdmin.username.charAt(0).toUpperCase())}</div>
                        <div class="admin-selector-info-compact">
                            <div class="admin-selector-username-main">${escapeHtml(selectedAdmin.username)}</div>
                            <div class="admin-selector-status-compact ${selectedAdmin.is_active ? 'status-active' : 'status-inactive'}">
                                ${selectedAdmin.is_active ? 'Faol' : 'To\'xtatilgan'}
                            </div>
                        </div>
                    ` : `
                        <div class="admin-selector-placeholder">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            <span>Admin tanlash</span>
                        </div>
                    `}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="admin-selector-arrow-icon">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
            </div>
            <div class="admin-dropdown" id="adminDropdown" style="display: none;">
                <div class="admin-dropdown-filter">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="admin-search-icon">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.35-4.35"></path>
                    </svg>
                    <input 
                        type="text" 
                        id="adminSearchInput" 
                        class="admin-search-input" 
                        placeholder="Admin qidirish..."
                        onkeyup="filterAdmins(this.value)"
                        onfocus="this.parentElement.classList.add('focused')"
                        onblur="setTimeout(() => this.parentElement.classList.remove('focused'), 200)"
                    >
                </div>
                <div class="admin-dropdown-list" id="adminSelectorList">
                    ${allAdmins.map(admin => `
                        <div 
                            class="admin-dropdown-item ${selectedAdminId === admin.id ? 'selected' : ''}" 
                            onclick="event.stopPropagation(); selectAdmin(${admin.id})"
                            data-admin-id="${admin.id}"
                            data-username="${escapeHtml(admin.username.toLowerCase())}"
                        >
                            <div class="admin-dropdown-avatar">${escapeHtml(admin.username.charAt(0).toUpperCase())}</div>
                            <div class="admin-dropdown-info">
                                <div class="admin-dropdown-username">${escapeHtml(admin.username)}</div>
                                <div class="admin-dropdown-status ${admin.is_active ? 'status-active' : 'status-inactive'}">
                                    ${admin.is_active ? 'Faol' : 'To\'xtatilgan'}
                                </div>
                            </div>
                            ${selectedAdminId === admin.id ? `
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="admin-check-icon">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        <div id="adminPermissionsContainer" style="display: none;">
            <!-- Dual listbox bu yerda ko'rsatiladi -->
        </div>
    `;

    adminPermissionsList.innerHTML = selectorHtml;

    if (selectedAdmin) {
        displayAdminPermissions([selectedAdmin]);
    }
}

function toggleAdminDropdown(event) {
    if (event) {
        event.stopPropagation();
    }

    const dropdown = document.getElementById('adminDropdown');
    if (dropdown) {
        const isOpen = dropdown.style.display !== 'none';
        dropdown.style.display = isOpen ? 'none' : 'block';

        if (!isOpen) {
            // Focus search input
            setTimeout(() => {
                const searchInput = document.getElementById('adminSearchInput');
                if (searchInput) {
                    searchInput.focus();
                }
            }, 50);

            // Close dropdown when clicking outside
            setTimeout(() => {
                document.addEventListener('click', closeDropdownOnOutsideClick, true);
            }, 0);
        } else {
            document.removeEventListener('click', closeDropdownOnOutsideClick, true);
        }
    }
}

function closeDropdownOnOutsideClick(event) {
    const dropdown = document.getElementById('adminDropdown');
    const trigger = document.querySelector('.admin-selector-trigger');

    if (dropdown && trigger && !dropdown.contains(event.target) && !trigger.contains(event.target)) {
        dropdown.style.display = 'none';
        document.removeEventListener('click', closeDropdownOnOutsideClick, true);
    }
}

function filterAdmins(searchTerm) {
    const search = searchTerm.toLowerCase().trim();
    const items = document.querySelectorAll('.admin-dropdown-item');

    items.forEach(item => {
        const username = item.getAttribute('data-username') || '';
        if (username.includes(search) || search === '') {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

function selectAdmin(adminId) {
    selectedAdminId = adminId;

    // Close dropdown
    const dropdown = document.getElementById('adminDropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }

    // Clear search input
    const searchInput = document.getElementById('adminSearchInput');
    if (searchInput) {
        searchInput.value = '';
        filterAdmins('');
    }

    // Display permissions for selected admin
    const admin = allAdmins.find(a => a.id === adminId);
    if (admin) {
        displayAdminSelector(); // Refresh to show selected admin
        displayAdminPermissions([admin]);
    }
}

function displayAdminPermissions(admins) {
    const container = document.getElementById('adminPermissionsContainer');
    if (!container) return;

    if (admins.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 20px;">Admin topilmadi</p>';
        container.style.display = 'block';
        return;
    }

    const admin = admins[0];
    container.innerHTML = '';
    container.style.display = 'block';

    const permissions = admin.permissions || {};
    const enabledPermissions = availablePermissions.filter(perm => permissions[perm.id] !== false);
    const disabledPermissions = availablePermissions.filter(perm => permissions[perm.id] === false);

    const adminCard = document.createElement('div');
    adminCard.className = 'admin-permission-card';
    adminCard.setAttribute('data-admin-id', admin.id);

    adminCard.innerHTML = `
            <div class="dual-listbox-container">
                <div class="dual-listbox-panel">
                    <div class="dual-listbox-header">
                        <h4>Mavjud Bo'limlar</h4>
                        <p class="dual-listbox-hint">Bo'limlarni tanlab o'ng tomonga o'tkazing</p>
                    </div>
                    <div class="dual-listbox-filter">
                        <input 
                            type="text" 
                            class="dual-listbox-filter-input" 
                            placeholder="Qidirish..."
                            onkeyup="filterDualListbox(this, 'available-${admin.id}')"
                        >
                    </div>
                    <div class="dual-listbox-actions">
                        <button type="button" class="dual-listbox-action-btn" onclick="selectAllAvailable(${admin.id})">
                            Barchasini tanlash →
                        </button>
                    </div>
                    <select 
                        multiple 
                        class="dual-listbox" 
                        id="available-${admin.id}"
                        size="7"
                    >
                        ${disabledPermissions.map(perm => `
                            <option value="${perm.id}" data-label="${perm.label}">${perm.label}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="dual-listbox-controls">
                    <button 
                        type="button" 
                        class="dual-listbox-transfer-btn" 
                        onclick="transferToSelected(${admin.id})"
                        title="Qo'shish"
                    >
                        →
                    </button>
                    <button 
                        type="button" 
                        class="dual-listbox-transfer-btn" 
                        onclick="transferToAvailable(${admin.id})"
                        title="Olib tashlash"
                    >
                        ←
                    </button>
                </div>
                
                <div class="dual-listbox-panel">
                    <div class="dual-listbox-header selected">
                        <h4>Ruxsat Berilgan Bo'limlar</h4>
                        <p class="dual-listbox-hint">Bo'limlarni tanlab chap tomonga o'tkazing</p>
                    </div>
                    <div class="dual-listbox-filter">
                        <input 
                            type="text" 
                            class="dual-listbox-filter-input" 
                            placeholder="Qidirish..."
                            onkeyup="filterDualListbox(this, 'selected-${admin.id}')"
                        >
                    </div>
                    <div class="dual-listbox-actions">
                        <button type="button" class="dual-listbox-action-btn" onclick="removeAllSelected(${admin.id})">
                            ← Barchasini olib tashlash
                        </button>
                    </div>
                    <select 
                        multiple 
                        class="dual-listbox" 
                        id="selected-${admin.id}"
                        size="7"
                    >
                        ${enabledPermissions.map(perm => `
                            <option value="${perm.id}" data-label="${perm.label}">${perm.label}</option>
                        `).join('')}
                    </select>
                </div>
            </div>
        `;

    container.appendChild(adminCard);
}

function closeAdminPermissions() {
    const container = document.getElementById('adminPermissionsContainer');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    selectedAdminId = null;

    // Reset selector
    displayAdminSelector();
}

function filterDualListbox(input, listboxId) {
    const filter = input.value.toLowerCase();
    const listbox = document.getElementById(listboxId);
    if (!listbox) return;

    const options = listbox.querySelectorAll('option');
    options.forEach(option => {
        const text = option.textContent.toLowerCase();
        option.style.display = text.includes(filter) ? '' : 'none';
    });
}

function selectAllAvailable(adminId) {
    const listbox = document.getElementById(`available-${adminId}`);
    if (!listbox) return;

    const visibleOptions = Array.from(listbox.options).filter(opt => opt.style.display !== 'none');
    visibleOptions.forEach(opt => opt.selected = true);
}

function removeAllSelected(adminId) {
    const listbox = document.getElementById(`selected-${adminId}`);
    if (!listbox) return;

    const visibleOptions = Array.from(listbox.options).filter(opt => opt.style.display !== 'none');
    visibleOptions.forEach(opt => opt.selected = true);
}

async function transferToSelected(adminId) {
    const availableListbox = document.getElementById(`available-${adminId}`);
    const selectedListbox = document.getElementById(`selected-${adminId}`);

    if (!availableListbox || !selectedListbox) return;

    const selectedOptions = Array.from(availableListbox.selectedOptions);

    for (const option of selectedOptions) {
        const permissionId = option.value;
        await updateAdminPermission(adminId, permissionId, true, null);

        // Move to selected
        const newOption = document.createElement('option');
        newOption.value = option.value;
        newOption.textContent = option.textContent;
        newOption.setAttribute('data-label', option.getAttribute('data-label'));
        selectedListbox.appendChild(newOption);
        availableListbox.removeChild(option);
    }
}

async function transferToAvailable(adminId) {
    const availableListbox = document.getElementById(`available-${adminId}`);
    const selectedListbox = document.getElementById(`selected-${adminId}`);

    if (!availableListbox || !selectedListbox) return;

    const selectedOptions = Array.from(selectedListbox.selectedOptions);

    for (const option of selectedOptions) {
        const permissionId = option.value;
        await updateAdminPermission(adminId, permissionId, false, null);

        // Move to available
        const newOption = document.createElement('option');
        newOption.value = option.value;
        newOption.textContent = option.textContent;
        newOption.setAttribute('data-label', option.getAttribute('data-label'));
        availableListbox.appendChild(newOption);
        selectedListbox.removeChild(option);
    }
}

async function updateAdminPermission(adminId, permissionId, enabled, checkboxElement) {
    try {
        const response = await apiRequest(`/api/users/${adminId}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({
                permission: permissionId,
                enabled: enabled
            })
        });

        if (!response) {
            // Revert checkbox
            if (checkboxElement) checkboxElement.checked = !enabled;
            return;
        }

        const data = await response.json();
        if (!data.success) {
            // Revert checkbox
            if (checkboxElement) checkboxElement.checked = !enabled;
            showError(data.message || 'Imkoniyatni yangilashda xatolik');
        } else {
            showSuccess('Imkoniyat muvaffaqiyatli yangilandi');
        }
    } catch (error) {
        console.error('Update admin permission error:', error);
        // Revert checkbox
        if (checkboxElement) checkboxElement.checked = !enabled;
        showError('Serverga ulanib bo\'lmadi');
    }
}

const changePasswordForm = document.getElementById('changePasswordForm');
const currentPassword = document.getElementById('changeCurrentPassword');
const newPassword = document.getElementById('changeNewPassword');
const confirmPassword = document.getElementById('changeConfirmPassword');

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const eyeIcon = button.querySelector('.password-eye');
    const eyeOffIcon = button.querySelector('.password-eye-off');

    if (input.type === 'password') {
        input.type = 'text';
        if (eyeIcon) eyeIcon.style.display = 'none';
        if (eyeOffIcon) eyeOffIcon.style.display = 'block';
    } else {
        input.type = 'password';
        if (eyeIcon) eyeIcon.style.display = 'block';
        if (eyeOffIcon) eyeOffIcon.style.display = 'none';
    }
}
const changePasswordBtn = document.getElementById('changePasswordBtn');
const changePasswordLoader = document.getElementById('changePasswordLoader');
const passwordErrorMessage = document.getElementById('passwordErrorMessage');
const passwordSuccessMessage = document.getElementById('passwordSuccessMessage');

function hidePasswordMessages() {
    if (passwordErrorMessage) passwordErrorMessage.style.display = 'none';
    if (passwordSuccessMessage) passwordSuccessMessage.style.display = 'none';
}

function showPasswordError(message) {
    hidePasswordMessages();
    if (passwordErrorMessage) {
        passwordErrorMessage.textContent = message;
        passwordErrorMessage.style.display = 'block';
    }
}

function showPasswordSuccess(message) {
    hidePasswordMessages();
    if (passwordSuccessMessage) {
        passwordSuccessMessage.textContent = message;
        passwordSuccessMessage.style.display = 'block';
        setTimeout(() => {
            if (passwordSuccessMessage) passwordSuccessMessage.style.display = 'none';
        }, 3000);
    }
}

function setPasswordLoading(loading) {
    if (changePasswordBtn) {
        if (loading) {
            changePasswordBtn.disabled = true;
            if (changePasswordLoader) changePasswordLoader.style.display = 'inline-block';
            const btnText = changePasswordBtn.querySelector('.btn-text');
            if (btnText) btnText.textContent = 'Jarayonda...';
        } else {
            changePasswordBtn.disabled = false;
            if (changePasswordLoader) changePasswordLoader.style.display = 'none';
            const btnText = changePasswordBtn.querySelector('.btn-text');
            if (btnText) btnText.textContent = 'Parolni O\'zgartirish';
        }
    }
}

if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const current = currentPassword ? currentPassword.value.trim() : '';
        const newPass = newPassword ? newPassword.value.trim() : '';
        const confirm = confirmPassword ? confirmPassword.value.trim() : '';

        hidePasswordMessages();

        if (!current || !newPass || !confirm) {
            showPasswordError('Iltimos, barcha maydonlarni to\'ldiring');
            return;
        }

        if (newPass.length < 4) {
            showPasswordError('Yangi parol kamida 4 ta belgidan iborat bo\'lishi kerak');
            return;
        }

        if (newPass !== confirm) {
            showPasswordError('Yangi parol va tasdiqlash paroli mos kelmaydi');
            return;
        }

        setPasswordLoading(true);

        try {
            const response = await apiRequest('/api/users/change-password', {
                method: 'POST',
                body: JSON.stringify({
                    current_password: current,
                    new_password: newPass
                })
            });

            if (!response) {
                setPasswordLoading(false);
                return;
            }

            const data = await response.json();
            setPasswordLoading(false);

            if (data.success) {
                showPasswordSuccess('Parol muvaffaqiyatli o\'zgartirildi');
                changePasswordForm.reset();
            } else {
                showPasswordError(data.message || 'Parolni o\'zgartirishda xatolik yuz berdi');
            }
        } catch (error) {
            console.error('Change password error:', error);
            setPasswordLoading(false);
            showPasswordError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
        }
    });
}

function setOrganizationLoading(loading) {
    if (saveOrganizationBtn) {
        if (loading) {
            saveOrganizationBtn.disabled = true;
            if (saveOrganizationLoader) saveOrganizationLoader.style.display = 'inline-block';
            const btnText = saveOrganizationBtn.querySelector('.btn-text');
            if (btnText) btnText.style.display = 'none';
        } else {
            saveOrganizationBtn.disabled = false;
            if (saveOrganizationLoader) saveOrganizationLoader.style.display = 'none';
            const btnText = saveOrganizationBtn.querySelector('.btn-text');
            if (btnText) btnText.style.display = 'inline';
        }
    }
}




const dailyChangesList = document.getElementById('dailyChangesList');
const loadingDailyChangesMessage = document.getElementById('loadingDailyChangesMessage');
const emptyDailyChangesMessage = document.getElementById('emptyDailyChangesMessage');


async function loadEmployeesForDailyChanges() {
    try {
        const response = await apiRequest('/api/employees');
        if (!response) {
            throw new Error('Serverga javob kelmadi');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Hodimlarni yuklashda xatolik');
        }

        if (data.employees && Array.isArray(data.employees)) {
            // Main employee select
            const mainEmployeeSelect = document.getElementById('modalDailyChangeEmployee');
            if (mainEmployeeSelect) {
                const currentValue = mainEmployeeSelect.value;
                mainEmployeeSelect.innerHTML = '<option value="">Hodimni tanlang</option>';

                // Sort employees by full name
                const sortedEmployees = [...data.employees].sort((a, b) => {
                    return (a.full_name || '').localeCompare(b.full_name || '');
                });

                sortedEmployees.forEach(emp => {
                    const option = document.createElement('option');
                    option.value = emp.id;
                    option.textContent = `${emp.full_name}${emp.position ? ` (${emp.position})` : ''}`;
                    mainEmployeeSelect.appendChild(option);
                });

                if (currentValue) {
                    mainEmployeeSelect.value = currentValue;
                }

                // Update substitute select when main employee changes
                mainEmployeeSelect.addEventListener('change', function () {
                    updateSubstituteEmployeeSelect(data.employees, this.value);
                });
            }

            // Initial load of substitute employee select
            const mainEmployeeId = mainEmployeeSelect?.value || '';
            updateSubstituteEmployeeSelect(data.employees, mainEmployeeId);
        }
    } catch (error) {
        console.error('Load employees for daily changes error:', error);
        const errorMsg = document.getElementById('modalAddDailyChangeErrorMessage');
        if (errorMsg) {
            errorMsg.textContent = `Hodimlarni yuklashda xatolik: ${error.message}`;
            errorMsg.style.display = 'block';
        }
    }
}

function updateSubstituteEmployeeSelect(employees, excludeEmployeeId) {
    const substituteSelect = document.getElementById('modalDailyChangeSubstituteEmployee');
    if (!substituteSelect) return;

    const currentValue = substituteSelect.value;
    substituteSelect.innerHTML = '<option value="">Tanlang</option>';

    // Filter out the main employee and sort
    const filteredEmployees = employees.filter(emp => {
        return !excludeEmployeeId || emp.id.toString() !== excludeEmployeeId.toString();
    }).sort((a, b) => {
        return (a.full_name || '').localeCompare(b.full_name || '');
    });

    filteredEmployees.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.full_name}${emp.position ? ` (${emp.position})` : ''}`;
        substituteSelect.appendChild(option);
    });

    // Restore value if it's still valid
    if (currentValue && filteredEmployees.some(emp => emp.id.toString() === currentValue.toString())) {
        substituteSelect.value = currentValue;
    } else if (currentValue) {
        substituteSelect.value = '';
    }
}


async function loadPositionsForDailyChanges() {
    try {
        const response = await apiRequest('/api/positions');
        if (!response) {
            throw new Error('Serverga javob kelmadi');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Lavozimlarni yuklashda xatolik');
        }

        if (data.positions && Array.isArray(data.positions)) {
            const positionSelect = document.getElementById('modalDailyChangeNewPosition');
            if (positionSelect) {
                const currentValue = positionSelect.value;
                positionSelect.innerHTML = '<option value="">Tanlang</option>';

                // Sort positions alphabetically
                const sortedPositions = [...data.positions].sort((a, b) => {
                    return (a.name || '').localeCompare(b.name || '');
                });

                sortedPositions.forEach(pos => {
                    const option = document.createElement('option');
                    option.value = pos.name;
                    option.textContent = pos.name;
                    positionSelect.appendChild(option);
                });

                if (currentValue) {
                    positionSelect.value = currentValue;
                }
            }
        }
    } catch (error) {
        console.error('Load positions for daily changes error:', error);
        const errorMsg = document.getElementById('modalAddDailyChangeErrorMessage');
        if (errorMsg) {
            const existingError = errorMsg.textContent;
            errorMsg.textContent = existingError
                ? `${existingError}. Lavozimlarni yuklashda xatolik: ${error.message}`
                : `Lavozimlarni yuklashda xatolik: ${error.message}`;
            errorMsg.style.display = 'block';
        }
    }
}


// Daily changes filter state
let dailyChangesFilterState = {
    search: '',
    changeType: '',
    startDate: '',
    endDate: ''
};

let allDailyChanges = [];

async function loadDailyChanges() {
    if (currentUserRole !== 'admin') {
        return;
    }

    try {
        showDailyChangesLoading(true);
        hideDailyChangesMessages();

        // Build query parameters
        const params = new URLSearchParams();
        if (dailyChangesFilterState.startDate) {
            params.append('start_date', dailyChangesFilterState.startDate);
        }
        if (dailyChangesFilterState.endDate) {
            params.append('end_date', dailyChangesFilterState.endDate);
        }
        if (dailyChangesFilterState.changeType) {
            params.append('change_type', dailyChangesFilterState.changeType);
        }

        const queryString = params.toString();
        const url = queryString ? `/api/daily-changes?${queryString}` : '/api/daily-changes';

        const response = await apiRequest(url);
        if (!response) {
            showDailyChangesLoading(false);
            return;
        }

        const data = await response.json();
        showDailyChangesLoading(false);

        if (data.success) {
            allDailyChanges = data.changes || [];

            // Apply client-side filters for display
            // Note: Date filters are already applied by backend, so allDailyChanges contains filtered data
            applyFiltersAndDisplay();

            // Always load all data for accurate statistics
            loadAllDataForStatistics();
        } else {
            showDailyChangesError(data.message || 'Kunlik o\'zgarishlarni yuklashda xatolik yuz berdi');
        }
    } catch (error) {
        showDailyChangesLoading(false);
        console.error('Load daily changes error:', error);
        showDailyChangesError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}

function applyFiltersAndDisplay() {
    // Date filters are already applied by backend, so allDailyChanges contains filtered data
    // We only need to apply client-side filters (search and changeType if no date filter)
    let filtered = [];

    if (!allDailyChanges || !Array.isArray(allDailyChanges)) {
        displayDailyChanges([]);
        return;
    }

    filtered = [...allDailyChanges];

    // Apply search filter
    if (dailyChangesFilterState.search) {
        const searchLower = dailyChangesFilterState.search.toLowerCase();
        filtered = filtered.filter(change =>
            change.employee_name?.toLowerCase().includes(searchLower) ||
            change.employee_position?.toLowerCase().includes(searchLower) ||
            change.notes?.toLowerCase().includes(searchLower)
        );
    }

    // Apply change type filter (if not already applied in backend)
    // If date filters are active, changeType is already applied by backend
    // But if only changeType filter is active (no date filters), apply it client-side
    if (dailyChangesFilterState.changeType) {
        if (!dailyChangesFilterState.startDate && !dailyChangesFilterState.endDate) {
            // No date filters, apply changeType filter client-side
            filtered = filtered.filter(change => change.change_type === dailyChangesFilterState.changeType);
        }
        // If date filters are active, changeType is already filtered by backend
    }

    // Display the filtered results
    displayDailyChanges(filtered);
}

// Load all data for statistics (without date filters)
let allDailyChangesForStats = [];

async function loadAllDataForStatistics() {
    try {
        const response = await apiRequest('/api/daily-changes');
        if (!response) {
            // Fallback to current data
            allDailyChangesForStats = allDailyChanges || [];
            updateStatistics();
            return;
        }

        const data = await response.json();
        if (data.success) {
            allDailyChangesForStats = data.changes || [];
            updateStatistics();
        } else {
            // Fallback to current data
            allDailyChangesForStats = allDailyChanges || [];
            updateStatistics();
        }
    } catch (error) {
        // Fallback to current data
        allDailyChangesForStats = allDailyChanges || [];
        updateStatistics();
    }
}

let currentDailyChangesData = null;
let currentDailyChangesDateRange = { startDate: null, endDate: null };
let dailyChangesCalendarMonth = new Date().getMonth();
let dailyChangesCalendarYear = new Date().getFullYear();
let dailyChangesSelectedStartDate = null;
let dailyChangesSelectedEndDate = null;
let dailyChangesIsSelectingStartDate = true;

function updateStatistics() {
    const statsContainer = document.getElementById('dailyChangesStatsContainer');
    if (!statsContainer) return;

    // Use allDailyChangesForStats for statistics (all data, not filtered)
    const statsData = allDailyChangesForStats.length > 0 ? allDailyChangesForStats : (allDailyChanges || []);

    // If no data, show empty stats with zero counts
    if (!statsData || !Array.isArray(statsData) || statsData.length === 0) {
        // Show stats with zero counts instead of empty
        const totalDiv = document.createElement('div');
        totalDiv.style.cssText = 'background: #f9fafb; padding: 10px 8px; border-radius: 10px; border: 1px solid #e5e7eb; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
        totalDiv.onmouseover = () => { totalDiv.style.background = '#f3f4f6'; totalDiv.style.borderColor = '#d1d5db'; totalDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; totalDiv.style.transform = 'translateY(-1px)'; };
        totalDiv.onmouseout = () => { totalDiv.style.background = '#f9fafb'; totalDiv.style.borderColor = '#e5e7eb'; totalDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; totalDiv.style.transform = 'translateY(0)'; };
        totalDiv.onclick = () => {
            dailyChangesFilterState = { search: '', changeType: '', startDate: '', endDate: '' };
            currentDailyChangesDateRange = { startDate: null, endDate: null };
            const searchInput = document.getElementById('dailyChangesSearch');
            const typeFilter = document.getElementById('dailyChangesTypeFilter');
            if (searchInput) searchInput.value = '';
            if (typeFilter) typeFilter.value = '';
            loadDailyChanges();
        };
        totalDiv.innerHTML = `
            <div style="font-size: 15px; font-weight: 700; color: #0f172a; line-height: 1.2; margin-bottom: 4px;">0</div>
            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Jami</div>
        `;

        const todayDiv = document.createElement('div');
        todayDiv.style.cssText = 'background: #f0fdf4; padding: 10px 8px; border-radius: 10px; border: 1px solid #bbf7d0; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
        todayDiv.onmouseover = () => { todayDiv.style.background = '#dcfce7'; todayDiv.style.borderColor = '#86efac'; todayDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; todayDiv.style.transform = 'translateY(-1px)'; };
        todayDiv.onmouseout = () => { todayDiv.style.background = '#f0fdf4'; todayDiv.style.borderColor = '#bbf7d0'; todayDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; todayDiv.style.transform = 'translateY(0)'; };
        todayDiv.onclick = function () {
            const today = new Date();
            const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const todayStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, '0')}-${String(todayLocal.getDate()).padStart(2, '0')}`;

            dailyChangesFilterState.startDate = todayStr;
            dailyChangesFilterState.endDate = todayStr;
            dailyChangesFilterState.search = '';
            dailyChangesFilterState.changeType = '';

            currentDailyChangesDateRange.startDate = todayStr;
            currentDailyChangesDateRange.endDate = todayStr;

            const searchInput = document.getElementById('dailyChangesSearch');
            const typeFilter = document.getElementById('dailyChangesTypeFilter');
            const startDateInput = document.getElementById('dailyChangesStartDate');
            const endDateInput = document.getElementById('dailyChangesEndDate');

            if (searchInput) searchInput.value = '';
            if (typeFilter) typeFilter.value = '';
            if (startDateInput) startDateInput.value = todayStr;
            if (endDateInput) endDateInput.value = todayStr;

            loadDailyChanges();
        };
        todayDiv.innerHTML = `
            <div style="font-size: 15px; font-weight: 700; color: #10b981; line-height: 1.2; margin-bottom: 4px;">0</div>
            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Bugun</div>
        `;

        const weekDiv = document.createElement('div');
        weekDiv.style.cssText = 'background: #fffbeb; padding: 10px 8px; border-radius: 10px; border: 1px solid #fde68a; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
        weekDiv.onmouseover = () => { weekDiv.style.background = '#fef3c7'; weekDiv.style.borderColor = '#fcd34d'; weekDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; weekDiv.style.transform = 'translateY(-1px)'; };
        weekDiv.onmouseout = () => { weekDiv.style.background = '#fffbeb'; weekDiv.style.borderColor = '#fde68a'; weekDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; weekDiv.style.transform = 'translateY(0)'; };
        weekDiv.onclick = () => {
            const todayDate = new Date().toISOString().split('T')[0];
            const weekAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            dailyChangesFilterState = { search: '', changeType: '', startDate: weekAgoDate, endDate: todayDate };
            currentDailyChangesDateRange = { startDate: weekAgoDate, endDate: todayDate };
            const searchInput = document.getElementById('dailyChangesSearch');
            const typeFilter = document.getElementById('dailyChangesTypeFilter');
            if (searchInput) searchInput.value = '';
            if (typeFilter) typeFilter.value = '';
            loadDailyChanges();
        };
        weekDiv.innerHTML = `
            <div style="font-size: 15px; font-weight: 700; color: #f59e0b; line-height: 1.2; margin-bottom: 4px;">0</div>
            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Hafta</div>
        `;

        const monthDiv = document.createElement('div');
        monthDiv.style.cssText = 'background: #f5f3ff; padding: 10px 8px; border-radius: 10px; border: 1px solid #ddd6fe; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
        monthDiv.onmouseover = () => { monthDiv.style.background = '#ede9fe'; monthDiv.style.borderColor = '#c4b5fd'; monthDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; monthDiv.style.transform = 'translateY(-1px)'; };
        monthDiv.onmouseout = () => { monthDiv.style.background = '#f5f3ff'; monthDiv.style.borderColor = '#ddd6fe'; monthDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; monthDiv.style.transform = 'translateY(0)'; };
        monthDiv.onclick = () => {
            const todayDate = new Date().toISOString().split('T')[0];
            const monthAgoDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            dailyChangesFilterState = { search: '', changeType: '', startDate: monthAgoDate, endDate: todayDate };
            currentDailyChangesDateRange = { startDate: monthAgoDate, endDate: todayDate };
            const searchInput = document.getElementById('dailyChangesSearch');
            const typeFilter = document.getElementById('dailyChangesTypeFilter');
            if (searchInput) searchInput.value = '';
            if (typeFilter) typeFilter.value = '';
            loadDailyChanges();
        };
        monthDiv.innerHTML = `
            <div style="font-size: 15px; font-weight: 700; color: #8b5cf6; line-height: 1.2; margin-bottom: 4px;">0</div>
            <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Oy</div>
        `;

        statsContainer.innerHTML = '';
        statsContainer.appendChild(totalDiv);
        statsContainer.appendChild(todayDiv);
        statsContainer.appendChild(weekDiv);
        statsContainer.appendChild(monthDiv);
        return;
    }

    // Get today's date in local timezone (YYYY-MM-DD format)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Format date in local timezone (not UTC)
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const weekAgoStr = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;

    const monthAgo = new Date(today);
    monthAgo.setDate(today.getDate() - 30);
    const monthAgoStr = `${monthAgo.getFullYear()}-${String(monthAgo.getMonth() + 1).padStart(2, '0')}-${String(monthAgo.getDate()).padStart(2, '0')}`;

    // Extract date part from change_date (in case it includes time)
    // Handle both ISO format (2026-01-15T10:30:00) and date-only format (2026-01-15)
    const todayCount = statsData.filter(c => {
        if (!c.change_date) return false;
        const changeDate = c.change_date.split('T')[0].split(' ')[0]; // Get date part only
        return changeDate === todayStr;
    }).length;

    const yesterdayCount = statsData.filter(c => {
        if (!c.change_date) return false;
        const changeDate = c.change_date.split('T')[0].split(' ')[0]; // Get date part only
        return changeDate === yesterdayStr;
    }).length;

    const weekCount = statsData.filter(c => {
        if (!c.change_date) return false;
        const changeDate = c.change_date.split('T')[0].split(' ')[0]; // Get date part only
        return changeDate >= weekAgoStr;
    }).length;

    const monthCount = statsData.filter(c => {
        if (!c.change_date) return false;
        const changeDate = c.change_date.split('T')[0].split(' ')[0]; // Get date part only
        return changeDate >= monthAgoStr;
    }).length;

    const totalCount = statsData.length;

    currentDailyChangesData = {
        total: statsData,
        today: statsData.filter(c => {
            if (!c.change_date) return false;
            const changeDate = c.change_date.split('T')[0].split(' ')[0]; // Get date part only
            return changeDate === todayStr;
        }),
        yesterday: statsData.filter(c => {
            if (!c.change_date) return false;
            const changeDate = c.change_date.split('T')[0].split(' ')[0]; // Get date part only
            return changeDate === yesterdayStr;
        }),
        week: statsData.filter(c => {
            if (!c.change_date) return false;
            const changeDate = c.change_date.split('T')[0].split(' ')[0]; // Get date part only
            return changeDate >= weekAgoStr;
        }),
        month: statsData.filter(c => {
            if (!c.change_date) return false;
            const changeDate = c.change_date.split('T')[0].split(' ')[0]; // Get date part only
            return changeDate >= monthAgoStr;
        }),
        position_change: statsData.filter(c => c.change_type === 'position_change'),
        substitute: statsData.filter(c => c.change_type === 'substitute'),
        other: statsData.filter(c => c.change_type === 'other')
    };

    // Total Stat Card - Modern Compact
    const totalDiv = document.createElement('div');
    totalDiv.style.cssText = 'background: #f9fafb; padding: 10px 8px; border-radius: 10px; border: 1px solid #e5e7eb; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    totalDiv.onmouseover = () => { totalDiv.style.background = '#f3f4f6'; totalDiv.style.borderColor = '#d1d5db'; totalDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; totalDiv.style.transform = 'translateY(-1px)'; };
    totalDiv.onmouseout = () => { totalDiv.style.background = '#f9fafb'; totalDiv.style.borderColor = '#e5e7eb'; totalDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; totalDiv.style.transform = 'translateY(0)'; };
    totalDiv.onclick = () => {
        dailyChangesFilterState = { search: '', changeType: '', startDate: '', endDate: '' };
        currentDailyChangesDateRange = { startDate: null, endDate: null };

        const searchInput = document.getElementById('dailyChangesSearch');
        const typeFilter = document.getElementById('dailyChangesTypeFilter');
        if (searchInput) searchInput.value = '';
        if (typeFilter) typeFilter.value = '';

        loadDailyChanges();
    };
    totalDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #0f172a; line-height: 1.2; margin-bottom: 4px;">${totalCount}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Jami</div>
    `;

    // Today Stat Card - Modern Compact
    const todayDiv = document.createElement('div');
    todayDiv.style.cssText = 'background: #f0fdf4; padding: 10px 8px; border-radius: 10px; border: 1px solid #bbf7d0; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    todayDiv.onmouseover = () => { todayDiv.style.background = '#dcfce7'; todayDiv.style.borderColor = '#86efac'; todayDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; todayDiv.style.transform = 'translateY(-1px)'; };
    todayDiv.onmouseout = () => { todayDiv.style.background = '#f0fdf4'; todayDiv.style.borderColor = '#bbf7d0'; todayDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; todayDiv.style.transform = 'translateY(0)'; };
    todayDiv.onclick = function () {
        const today = new Date();
        const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, '0')}-${String(todayLocal.getDate()).padStart(2, '0')}`;

        dailyChangesFilterState.startDate = todayStr;
        dailyChangesFilterState.endDate = todayStr;
        dailyChangesFilterState.search = '';
        dailyChangesFilterState.changeType = '';

        currentDailyChangesDateRange.startDate = todayStr;
        currentDailyChangesDateRange.endDate = todayStr;

        const searchInput = document.getElementById('dailyChangesSearch');
        const typeFilter = document.getElementById('dailyChangesTypeFilter');
        const startDateInput = document.getElementById('dailyChangesStartDate');
        const endDateInput = document.getElementById('dailyChangesEndDate');

        if (searchInput) searchInput.value = '';
        if (typeFilter) typeFilter.value = '';
        if (startDateInput) startDateInput.value = todayStr;
        if (endDateInput) endDateInput.value = todayStr;

        loadDailyChanges();
    };
    todayDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #10b981; line-height: 1.2; margin-bottom: 4px;">${todayCount}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Bugun</div>
    `;

    // Week Stat Card - Modern Compact
    const weekDiv = document.createElement('div');
    weekDiv.style.cssText = 'background: #fffbeb; padding: 10px 8px; border-radius: 10px; border: 1px solid #fde68a; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    weekDiv.onmouseover = () => { weekDiv.style.background = '#fef3c7'; weekDiv.style.borderColor = '#fcd34d'; weekDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; weekDiv.style.transform = 'translateY(-1px)'; };
    weekDiv.onmouseout = () => { weekDiv.style.background = '#fffbeb'; weekDiv.style.borderColor = '#fde68a'; weekDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; weekDiv.style.transform = 'translateY(0)'; };
    weekDiv.onclick = () => {
        // Calculate dates when button is clicked (not when statistics are updated)
        const todayDate = new Date().toISOString().split('T')[0];
        const weekAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        dailyChangesFilterState = { search: '', changeType: '', startDate: weekAgoDate, endDate: todayDate };
        currentDailyChangesDateRange = { startDate: weekAgoDate, endDate: todayDate };
        const searchInput = document.getElementById('dailyChangesSearch');
        const typeFilter = document.getElementById('dailyChangesTypeFilter');
        if (searchInput) searchInput.value = '';
        if (typeFilter) typeFilter.value = '';
        loadDailyChanges();
    };
    weekDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #f59e0b; line-height: 1.2; margin-bottom: 4px;">${weekCount}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Hafta</div>
    `;

    // Month Stat Card - Modern Compact
    const monthDiv = document.createElement('div');
    monthDiv.style.cssText = 'background: #f5f3ff; padding: 10px 8px; border-radius: 10px; border: 1px solid #ddd6fe; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    monthDiv.onmouseover = () => { monthDiv.style.background = '#ede9fe'; monthDiv.style.borderColor = '#c4b5fd'; monthDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; monthDiv.style.transform = 'translateY(-1px)'; };
    monthDiv.onmouseout = () => { monthDiv.style.background = '#f5f3ff'; monthDiv.style.borderColor = '#ddd6fe'; monthDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; monthDiv.style.transform = 'translateY(0)'; };
    monthDiv.onclick = () => {
        // Calculate dates when button is clicked (not when statistics are updated)
        const todayDate = new Date().toISOString().split('T')[0];
        const monthAgoDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        dailyChangesFilterState = { search: '', changeType: '', startDate: monthAgoDate, endDate: todayDate };
        currentDailyChangesDateRange = { startDate: monthAgoDate, endDate: todayDate };
        const searchInput = document.getElementById('dailyChangesSearch');
        const typeFilter = document.getElementById('dailyChangesTypeFilter');
        if (searchInput) searchInput.value = '';
        if (typeFilter) typeFilter.value = '';
        loadDailyChanges();
    };
    monthDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #8b5cf6; line-height: 1.2; margin-bottom: 4px;">${monthCount}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Oy</div>
    `;

    statsContainer.innerHTML = '';
    statsContainer.appendChild(totalDiv);
    statsContainer.appendChild(todayDiv);
    statsContainer.appendChild(weekDiv);
    statsContainer.appendChild(monthDiv);
}


function displayDailyChanges(changes) {
    if (!dailyChangesList) return;

    dailyChangesList.innerHTML = '';

    if (!changes || changes.length === 0) {
        if (emptyDailyChangesMessage) {
            emptyDailyChangesMessage.textContent = 'Ma\'lumotlar topilmadi';
            emptyDailyChangesMessage.style.display = 'block';
        }
        if (dailyChangesList) dailyChangesList.style.display = 'none';
        return;
    }

    if (emptyDailyChangesMessage) emptyDailyChangesMessage.style.display = 'none';
    if (dailyChangesList) dailyChangesList.style.display = 'grid';

    changes.forEach(change => {
        if (change) {
            const changeItem = createDailyChangeItem(change);
            dailyChangesList.appendChild(changeItem);
        }
    });
}


function createDailyChangeItem(change) {
    const item = document.createElement('div');
    item.style.cssText = 'background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);';
    item.onmouseover = () => { item.style.borderColor = '#cbd5e1'; item.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; item.style.transform = 'translateY(-1px)'; };
    item.onmouseout = () => { item.style.borderColor = '#e2e8f0'; item.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; item.style.transform = 'translateY(0)'; };

    const changeTypeLabels = {
        'position_change': 'Lavozim almashtirish',
        'substitute': 'O\'rniga ishlash',
        'other': 'Boshqa'
    };

    const changeTypeColors = {
        'position_change': { bg: '#eff6ff', border: '#bfdbfe', dot: '#3b82f6' },
        'substitute': { bg: '#f0fdf4', border: '#bbf7d0', dot: '#10b981' },
        'other': { bg: '#f9fafb', border: '#e5e7eb', dot: '#6b7280' }
    };

    const typeStyle = changeTypeColors[change.change_type] || changeTypeColors.other;

    let details = '';
    if (change.change_type === 'position_change') {
        details = `<div style="font-size: 11px; color: #64748b; margin-top: 4px;">
            <span style="font-weight: 600; color: #475569; margin-right: 4px;">Yangi lavozim:</span>
            <span style="background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 600;">${escapeHtml(change.new_position || '—')}</span>
        </div>`;
    } else if (change.change_type === 'substitute') {
        details = `<div style="font-size: 11px; color: #64748b; margin-top: 4px;">
            <span style="font-weight: 600; color: #475569; margin-right: 4px;">O'rniga ishlaydigan hodim:</span>
            <span style="background: #dbeafe; color: #1e40af; padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 600;">${escapeHtml(change.substitute_employee_name || '—')}</span>
        </div>`;
    }

    item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
            <div style="width: 6px; height: 6px; border-radius: 50%; background: ${typeStyle.dot}; flex-shrink: 0;"></div>
            <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap;">
                    <div style="font-weight: 600; color: #0f172a; font-size: 13px;">${escapeHtml(change.employee_name)}</div>
                    <div style="font-size: 10px; color: #64748b; background: #f1f5f9; padding: 2px 6px; border-radius: 6px; font-weight: 500;">${escapeHtml(change.employee_position)}</div>
                    <div style="font-size: 9px; color: #64748b; background: ${typeStyle.bg}; border: 1px solid ${typeStyle.border}; padding: 2px 6px; border-radius: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">
                        ${changeTypeLabels[change.change_type] || change.change_type}
                    </div>
                </div>
                ${details}
                <div style="font-size: 10px; color: #94a3b8; margin-top: 4px;">
                    ${formatDate(change.change_date)} • ${formatDateTime(change.created_at)}
                    ${change.created_by_username ? ` • ${escapeHtml(change.created_by_username)}` : ''}
                </div>
                ${change.notes ? `<div style="font-size: 11px; color: #64748b; margin-top: 4px; font-style: italic; padding: 6px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">${escapeHtml(change.notes)}</div>` : ''}
            </div>
        </div>
        <div style="display: flex; gap: 4px; flex-shrink: 0;">
            <button class="edit-btn" onclick="showEditDailyChangeModal(${change.id})" title="Tahrirlash" style="padding: 6px; width: 28px; height: 28px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="delete-btn" onclick="deleteDailyChange(${change.id}, '${escapeHtml(change.employee_name)}')" title="O'chirish" style="padding: 6px; width: 28px; height: 28px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

    return item;
}


async function showAddDailyChangeModal() {
    const addDailyChangeModal = document.getElementById('addDailyChangeModal');
    if (!addDailyChangeModal) return;

    // Reset form
    const form = document.getElementById('addDailyChangeModalForm');
    if (form) {
        form.reset();
        // Remove any validation classes
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.classList.remove('error');
        });
    }

    // Hide conditional fields and remove required attributes
    const positionFields = document.getElementById('positionChangeFields');
    const substituteFields = document.getElementById('substituteFields');
    const newPositionSelect = document.getElementById('modalDailyChangeNewPosition');
    const substituteEmployeeSelect = document.getElementById('modalDailyChangeSubstituteEmployee');

    if (positionFields) positionFields.style.display = 'none';
    if (substituteFields) substituteFields.style.display = 'none';
    if (newPositionSelect) {
        newPositionSelect.required = false;
        newPositionSelect.value = '';
    }
    if (substituteEmployeeSelect) {
        substituteEmployeeSelect.required = false;
        substituteEmployeeSelect.value = '';
    }

    // Clear messages
    const errorMsg = document.getElementById('modalAddDailyChangeErrorMessage');
    const successMsg = document.getElementById('modalAddDailyChangeSuccessMessage');
    if (errorMsg) {
        errorMsg.style.display = 'none';
        errorMsg.textContent = '';
    }
    if (successMsg) {
        successMsg.style.display = 'none';
        successMsg.textContent = '';
    }

    // Set default date to today
    const dateInput = document.getElementById('modalDailyChangeDate');
    if (dateInput) {
        const today = new Date().toISOString().split('T')[0];
        dateInput.value = today;
    }

    // Load employees and positions
    try {
        await Promise.all([
            loadEmployeesForDailyChanges(),
            loadPositionsForDailyChanges()
        ]);
    } catch (error) {
        console.error('Error loading data for daily change modal:', error);
        if (errorMsg) {
            errorMsg.textContent = 'Ma\'lumotlarni yuklashda xatolik yuz berdi. Qayta urinib ko\'ring.';
            errorMsg.style.display = 'block';
        }
    }

    // Close button handler
    const closeBtn = document.getElementById('closeAddDailyChangeModalBtn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            hideAddDailyChangeModal();
        };
    }

    // Show modal
    addDailyChangeModal.style.display = 'flex';

    // Setup change type handler
    const changeTypeSelect = document.getElementById('modalDailyChangeType');
    if (changeTypeSelect) {
        // Remove previous listeners
        const newSelect = changeTypeSelect.cloneNode(true);
        changeTypeSelect.parentNode.replaceChild(newSelect, changeTypeSelect);

        newSelect.addEventListener('change', function () {
            const type = this.value;
            toggleConditionalFields(type);
        });
    }

    // Focus on first input
    const firstInput = form?.querySelector('select, input');
    if (firstInput && typeof firstInput.focus === 'function') {
        setTimeout(() => firstInput.focus(), 100);
    }
}

function toggleConditionalFields(changeType) {
    const positionFields = document.getElementById('positionChangeFields');
    const substituteFields = document.getElementById('substituteFields');
    const newPositionSelect = document.getElementById('modalDailyChangeNewPosition');
    const substituteEmployeeSelect = document.getElementById('modalDailyChangeSubstituteEmployee');

    if (changeType === 'position_change') {
        if (positionFields) {
            positionFields.style.display = 'block';
        }
        if (newPositionSelect) {
            newPositionSelect.required = true;
        }

        // Hide and clear substitute fields
        if (substituteFields) {
            substituteFields.style.display = 'none';
        }
        if (substituteEmployeeSelect) {
            substituteEmployeeSelect.required = false;
            substituteEmployeeSelect.value = '';
        }
    } else if (changeType === 'substitute') {
        if (substituteFields) {
            substituteFields.style.display = 'block';
        }
        if (substituteEmployeeSelect) {
            substituteEmployeeSelect.required = true;
        }

        // Hide and clear position fields
        if (positionFields) {
            positionFields.style.display = 'none';
        }
        if (newPositionSelect) {
            newPositionSelect.required = false;
            newPositionSelect.value = '';
        }
    } else {
        // Hide both fields and remove required
        if (positionFields) {
            positionFields.style.display = 'none';
        }
        if (substituteFields) {
            substituteFields.style.display = 'none';
        }
        if (newPositionSelect) {
            newPositionSelect.required = false;
            newPositionSelect.value = '';
        }
        if (substituteEmployeeSelect) {
            substituteEmployeeSelect.required = false;
            substituteEmployeeSelect.value = '';
        }
    }
}


function hideAddDailyChangeModal() {
    const addDailyChangeModal = document.getElementById('addDailyChangeModal');
    if (addDailyChangeModal) {
        addDailyChangeModal.style.display = 'none';
        // Reset form
        const form = document.getElementById('addDailyChangeModalForm');
        if (form) {
            form.reset();
            // Clear error classes
            const inputs = form.querySelectorAll('input, select, textarea');
            inputs.forEach(input => {
                input.classList.remove('error');
            });
        }
    }
}

// Close modal on ESC key
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const addDailyChangeModal = document.getElementById('addDailyChangeModal');
        if (addDailyChangeModal && addDailyChangeModal.style.display === 'flex') {
            hideAddDailyChangeModal();
        }
    }
});

// Close modal on backdrop click
const addDailyChangeModal = document.getElementById('addDailyChangeModal');
if (addDailyChangeModal) {
    addDailyChangeModal.addEventListener('click', function (e) {
        if (e.target === addDailyChangeModal) {
            hideAddDailyChangeModal();
        }
    });
}


const cancelAddDailyChangeModalBtn = document.getElementById('cancelAddDailyChangeModalBtn');
if (cancelAddDailyChangeModalBtn) {
    cancelAddDailyChangeModalBtn.addEventListener('click', hideAddDailyChangeModal);
}


const addDailyChangeModalForm = document.getElementById('addDailyChangeModalForm');
if (addDailyChangeModalForm) {
    addDailyChangeModalForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        // Get form elements
        const employeeSelect = document.getElementById('modalDailyChangeEmployee');
        const dateInput = document.getElementById('modalDailyChangeDate');
        const changeTypeSelect = document.getElementById('modalDailyChangeType');
        const newPositionSelect = document.getElementById('modalDailyChangeNewPosition');
        const substituteEmployeeSelect = document.getElementById('modalDailyChangeSubstituteEmployee');
        const notesTextarea = document.getElementById('modalDailyChangeNotes');

        // Get values
        const employeeId = employeeSelect?.value;
        const changeDate = dateInput?.value;
        const changeType = changeTypeSelect?.value;
        const newPosition = newPositionSelect?.value || null;
        const substituteEmployeeId = substituteEmployeeSelect?.value || null;
        const notes = notesTextarea?.value.trim() || null;

        // Clear previous errors
        const errorMsg = document.getElementById('modalAddDailyChangeErrorMessage');
        const successMsg = document.getElementById('modalAddDailyChangeSuccessMessage');
        if (errorMsg) errorMsg.style.display = 'none';
        if (successMsg) successMsg.style.display = 'none';

        // Remove error classes
        [employeeSelect, dateInput, changeTypeSelect].forEach(el => {
            if (el) el.classList.remove('error');
        });

        // Validate required fields
        let isValid = true;
        const errors = [];

        if (!employeeId) {
            isValid = false;
            errors.push('Hodimni tanlang');
            if (employeeSelect) employeeSelect.classList.add('error');
        }

        if (!changeDate) {
            isValid = false;
            errors.push('Sanani kiriting');
            if (dateInput) dateInput.classList.add('error');
        }

        if (!changeType) {
            isValid = false;
            errors.push('O\'zgarish turini tanlang');
            if (changeTypeSelect) changeTypeSelect.classList.add('error');
        }

        // Validate conditional fields based on change type
        if (changeType === 'position_change') {
            if (!newPosition) {
                isValid = false;
                errors.push('Yangi lavozimni tanlang');
                if (newPositionSelect) newPositionSelect.classList.add('error');
            }
        } else if (changeType === 'substitute') {
            if (!substituteEmployeeId) {
                isValid = false;
                errors.push('O\'rniga ishlaydigan hodimni tanlang');
                if (substituteEmployeeSelect) substituteEmployeeSelect.classList.add('error');
            }
        }

        if (!isValid) {
            if (errorMsg) {
                errorMsg.textContent = errors.join('. ');
                errorMsg.style.display = 'block';
            }
            // Scroll to error message
            if (errorMsg) {
                errorMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            return;
        }

        // Show loading state
        const loader = document.getElementById('modalAddDailyChangeLoader');
        const saveBtn = document.getElementById('saveAddDailyChangeModalBtn');
        const btnText = saveBtn?.querySelector('.btn-text');

        if (loader) loader.style.display = 'inline-block';
        if (btnText) btnText.textContent = 'Saqlanmoqda...';
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.style.cursor = 'not-allowed';
        }

        // Disable form inputs during submission
        const formInputs = addDailyChangeModalForm.querySelectorAll('input, select, textarea, button');
        formInputs.forEach(input => {
            if (input !== saveBtn) input.disabled = true;
        });

        try {
            const response = await apiRequest('/api/daily-changes', {
                method: 'POST',
                body: JSON.stringify({
                    employee_id: parseInt(employeeId),
                    change_date: changeDate,
                    change_type: changeType,
                    old_position: null,
                    new_position: newPosition,
                    substitute_employee_id: substituteEmployeeId ? parseInt(substituteEmployeeId) : null,
                    original_employee_id: null,
                    notes: notes
                })
            });

            if (!response) {
                throw new Error('Serverga javob kelmadi');
            }

            const data = await response.json();

            if (data.success) {
                // Show success message
                if (successMsg) {
                    successMsg.textContent = data.message || 'Kunlik o\'zgarish muvaffaqiyatli qo\'shildi';
                    successMsg.style.display = 'block';
                }

                // Reload daily changes list and update statistics
                await loadDailyChanges();

                // Reset form and close modal after delay
                setTimeout(() => {
                    hideAddDailyChangeModal();
                }, 1500);
            } else {
                // Show error message
                if (errorMsg) {
                    errorMsg.textContent = data.message || 'Kunlik o\'zgarish qo\'shishda xatolik yuz berdi';
                    errorMsg.style.display = 'block';
                    errorMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        } catch (error) {
            console.error('Add daily change error:', error);
            if (errorMsg) {
                errorMsg.textContent = error.message || 'Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.';
                errorMsg.style.display = 'block';
                errorMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        } finally {
            // Restore button state
            if (loader) loader.style.display = 'none';
            if (btnText) btnText.textContent = 'Qo\'shish';
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.cursor = 'pointer';
            }

            // Re-enable form inputs
            formInputs.forEach(input => {
                if (input !== saveBtn) input.disabled = false;
            });
        }
    });
}


function showEditDailyChangeModal(changeId) {

    alert('Tahrirlash funksiyasi keyingi versiyada qo\'shiladi');
}


async function deleteDailyChange(changeId, employeeName) {
    if (!confirm(`"${employeeName}" uchun o'zgarishni o'chirishni tasdiqlaysizmi?`)) {
        return;
    }

    try {
        const response = await apiRequest(`/api/daily-changes/${changeId}`, {
            method: 'DELETE'
        });

        if (!response) return;

        const data = await response.json();

        if (data.success) {
            await loadDailyChanges();
        } else {
            alert(data.message || 'O\'chirishda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Delete daily change error:', error);
        alert('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function showDailyChangesLoading(show) {
    if (loadingDailyChangesMessage) {
        loadingDailyChangesMessage.style.display = show ? 'block' : 'none';
    }
    if (!show && dailyChangesList) {
        dailyChangesList.style.display = 'grid';
    }
}

function hideDailyChangesMessages() {
    if (emptyDailyChangesMessage) emptyDailyChangesMessage.style.display = 'none';
}

function showDailyChangesError(message) {
    if (emptyDailyChangesMessage) {
        emptyDailyChangesMessage.textContent = message;
        emptyDailyChangesMessage.style.display = 'block';
    }
    console.error(message);
}

// Calendar functions for daily changes
function toggleDailyChangesCalendar() {
    const calendarWidget = document.getElementById('dailyChangesCalendarWidget');
    if (!calendarWidget) return;

    if (calendarWidget.style.display === 'none' || !calendarWidget.style.display) {
        showDailyChangesCalendar();
    } else {
        hideDailyChangesCalendar();
    }
}

function showDailyChangesCalendar() {
    const calendarWidget = document.getElementById('dailyChangesCalendarWidget');
    if (!calendarWidget) return;

    // Reset selection state
    if (currentDailyChangesDateRange.startDate && currentDailyChangesDateRange.endDate) {
        dailyChangesSelectedStartDate = new Date(currentDailyChangesDateRange.startDate);
        dailyChangesSelectedEndDate = new Date(currentDailyChangesDateRange.endDate);
        dailyChangesCalendarMonth = dailyChangesSelectedStartDate.getMonth();
        dailyChangesCalendarYear = dailyChangesSelectedStartDate.getFullYear();
        dailyChangesIsSelectingStartDate = false;
    } else {
        dailyChangesSelectedStartDate = null;
        dailyChangesSelectedEndDate = null;
        dailyChangesIsSelectingStartDate = true;
        const today = new Date();
        dailyChangesCalendarMonth = today.getMonth();
        dailyChangesCalendarYear = today.getFullYear();
    }

    renderDailyChangesCalendar();
    calendarWidget.style.display = 'block';
}

function hideDailyChangesCalendar() {
    const calendarWidget = document.getElementById('dailyChangesCalendarWidget');
    if (calendarWidget) {
        calendarWidget.style.display = 'none';
    }
}

function renderDailyChangesCalendar() {
    const calendarWidget = document.getElementById('dailyChangesCalendarWidget');
    if (!calendarWidget) return;

    calendarWidget.onclick = (e) => e.stopPropagation();

    const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
    const weekDays = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

    const firstDay = new Date(dailyChangesCalendarYear, dailyChangesCalendarMonth, 1);
    const lastDay = new Date(dailyChangesCalendarYear, dailyChangesCalendarMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay() === 0 ? 7 : firstDay.getDay();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = `
        <div style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-size: 16px; font-weight: 600; color: #111827;">${monthNames[dailyChangesCalendarMonth]} ${dailyChangesCalendarYear}</span>
                <div style="display: flex; gap: 4px;">
                    <button id="dailyChangesCalendarPrev" style="background: none; border: none; cursor: pointer; padding: 4px; color: #6b7280;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                    </button>
                    <button id="dailyChangesCalendarNext" style="background: none; border: none; cursor: pointer; padding: 4px; color: #6b7280;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 8px;">
    `;

    weekDays.forEach(day => {
        html += `<div style="text-align: center; font-size: 12px; font-weight: 500; color: #6b7280; padding: 8px;">${day}</div>`;
    });

    html += `</div><div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">`;

    for (let i = 1; i < startingDayOfWeek; i++) {
        html += `<div style="padding: 8px; min-height: 36px;"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(dailyChangesCalendarYear, dailyChangesCalendarMonth, day);
        cellDate.setHours(0, 0, 0, 0);

        let cellStyle = 'padding: 8px; min-height: 36px; text-align: center; cursor: pointer; border-radius: 4px; font-size: 14px; font-weight: 500; transition: all 0.2s; display: flex; align-items: center; justify-content: center;';

        if (dailyChangesSelectedStartDate && cellDate.getTime() === dailyChangesSelectedStartDate.getTime()) {
            cellStyle += ' background: #3b82f6; color: white;';
        } else if (dailyChangesSelectedEndDate && cellDate.getTime() === dailyChangesSelectedEndDate.getTime()) {
            cellStyle += ' background: #3b82f6; color: white;';
        } else if (dailyChangesSelectedStartDate && dailyChangesSelectedEndDate &&
            cellDate.getTime() > dailyChangesSelectedStartDate.getTime() &&
            cellDate.getTime() < dailyChangesSelectedEndDate.getTime()) {
            cellStyle += ' background: #dbeafe; color: #1e40af;';
        } else if (cellDate.getTime() === today.getTime()) {
            cellStyle += ' background: #f3f4f6; color: #111827; border: 1px solid #3b82f6;';
        } else {
            cellStyle += ' background: white; color: #374151;';
        }

        html += `<div class="daily-changes-calendar-day" data-date="${cellDate.toISOString().split('T')[0]}" style="${cellStyle}">${day}</div>`;
    }

    html += `
            </div>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
            <button id="dailyChangesCalendarClear" style="padding: 6px 12px; border: 1px solid #d1d5db; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; color: #374151;">Tozalash</button>
            <button id="dailyChangesCalendarApply" style="padding: 6px 12px; border: none; background: #3b82f6; border-radius: 6px; cursor: pointer; font-size: 13px; color: white; font-weight: 500;">Qo'llash</button>
        </div>
    `;

    calendarWidget.innerHTML = html;

    // Event listeners
    const prevBtn = document.getElementById('dailyChangesCalendarPrev');
    const nextBtn = document.getElementById('dailyChangesCalendarNext');
    const clearBtn = document.getElementById('dailyChangesCalendarClear');
    const applyBtn = document.getElementById('dailyChangesCalendarApply');
    const dayCells = calendarWidget.querySelectorAll('.daily-changes-calendar-day');

    if (prevBtn) {
        prevBtn.onclick = () => {
            if (dailyChangesCalendarMonth === 0) {
                dailyChangesCalendarMonth = 11;
                dailyChangesCalendarYear--;
            } else {
                dailyChangesCalendarMonth--;
            }
            renderDailyChangesCalendar();
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            if (dailyChangesCalendarMonth === 11) {
                dailyChangesCalendarMonth = 0;
                dailyChangesCalendarYear++;
            } else {
                dailyChangesCalendarMonth++;
            }
            renderDailyChangesCalendar();
        };
    }

    if (clearBtn) {
        clearBtn.onclick = () => {
            dailyChangesSelectedStartDate = null;
            dailyChangesSelectedEndDate = null;
            dailyChangesIsSelectingStartDate = true;
            currentDailyChangesDateRange = { startDate: null, endDate: null };
            dailyChangesFilterState.startDate = '';
            dailyChangesFilterState.endDate = '';
            renderDailyChangesCalendar();
            loadDailyChanges();
            hideDailyChangesCalendar();
        };
    }

    if (applyBtn) {
        applyBtn.onclick = () => {
            if (dailyChangesSelectedStartDate && dailyChangesSelectedEndDate) {
                const startDateStr = dailyChangesSelectedStartDate.toISOString().split('T')[0];
                const endDateStr = dailyChangesSelectedEndDate.toISOString().split('T')[0];

                currentDailyChangesDateRange = { startDate: startDateStr, endDate: endDateStr };
                dailyChangesFilterState.startDate = startDateStr;
                dailyChangesFilterState.endDate = endDateStr;


                loadDailyChanges();
                hideDailyChangesCalendar();
            } else {
                alert('Iltimos, boshlanish va tugash sanalarini tanlang');
            }
        };
    }

    dayCells.forEach(cell => {
        cell.onclick = () => {
            const dateStr = cell.getAttribute('data-date');
            const date = new Date(dateStr);
            date.setHours(0, 0, 0, 0);

            if (dailyChangesIsSelectingStartDate || !dailyChangesSelectedStartDate) {
                dailyChangesSelectedStartDate = new Date(date);
                dailyChangesSelectedEndDate = null;
                dailyChangesIsSelectingStartDate = false;
            } else {
                if (date.getTime() < dailyChangesSelectedStartDate.getTime()) {
                    dailyChangesSelectedEndDate = new Date(dailyChangesSelectedStartDate);
                    dailyChangesSelectedStartDate = new Date(date);
                } else {
                    dailyChangesSelectedEndDate = new Date(date);
                }
            }

            renderDailyChangesCalendar();
        };
    });
}

// Download daily changes function
async function downloadDailyChangesList() {
    try {
        let startDateStr, endDateStr;

        if (currentDailyChangesDateRange.startDate && currentDailyChangesDateRange.endDate) {
            startDateStr = currentDailyChangesDateRange.startDate;
            endDateStr = currentDailyChangesDateRange.endDate;
        } else if (dailyChangesFilterState.startDate && dailyChangesFilterState.endDate) {
            startDateStr = dailyChangesFilterState.startDate;
            endDateStr = dailyChangesFilterState.endDate;
        } else {
            const today = new Date();
            startDateStr = today.toISOString().split('T')[0];
            endDateStr = startDateStr;
        }

        const params = new URLSearchParams();
        params.append('start_date', startDateStr);
        params.append('end_date', endDateStr);
        if (dailyChangesFilterState.changeType) {
            params.append('change_type', dailyChangesFilterState.changeType);
        }

        const response = await apiRequest(`/api/daily-changes?${params.toString()}`);
        if (!response) return;

        const data = await response.json();
        if (!data.success || !data.changes || data.changes.length === 0) {
            alert('Tanlangan davrda kunlik o\'zgarishlar topilmadi!');
            return;
        }

        const changes = data.changes;
        const changeTypeLabels = {
            'position_change': 'Lavozim almashtirish',
            'substitute': 'O\'rniga ishlash',
            'other': 'Boshqa'
        };

        let htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
            font-size: 12px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #4f46e5;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f9fafb;
        }
    </style>
    <title>Kunlik O'zgarishlar - ${startDateStr} dan ${endDateStr} gacha</title>
</head>
<body>
    <h1 style="text-align: center; color: #111827;">Kunlik O'zgarishlar</h1>
    <p style="text-align: center; color: #6b7280;">Davr: ${startDateStr} dan ${endDateStr} gacha</p>
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Hodim</th>
                <th>Lavozim</th>
                <th>O'zgarish turi</th>
                <th>Tafsilot</th>
                <th>Sana</th>
                <th>Izoh</th>
                <th>Yaratilgan</th>
            </tr>
        </thead>
        <tbody>
        `;

        changes.forEach((change, index) => {
            let detailValue = '—';

            if (change.change_type === 'position_change') {
                detailValue = change.new_position || '—';
            } else if (change.change_type === 'substitute') {
                detailValue = change.substitute_employee_name || '—';
            }

            htmlContent += `
            <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(change.employee_name || '—')}</td>
                <td>${escapeHtml(change.employee_position || '—')}</td>
                <td>${changeTypeLabels[change.change_type] || change.change_type}</td>
                <td>${escapeHtml(detailValue)}</td>
                <td>${formatDate(change.change_date)}</td>
                <td>${escapeHtml(change.notes || '—')}</td>
                <td>${formatDateTime(change.created_at)}</td>
            </tr>
            `;
        });

        htmlContent += `
        </tbody>
    </table>
</body>
</html>
        `;

        const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kunlik_ozgarishlar_${startDateStr}_${endDateStr}.xls`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Download daily changes error:', error);
        alert('Yuklab olishda xatolik yuz berdi');
    }
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Get verification mode display info (icon, color, label)
 * @param {string} mode - Verification mode (Face, Card, Fingerprint, etc.)
 * @returns {object} - {icon, color, bgColor, label}
 */
function getVerificationModeInfo(mode) {
    if (!mode) {
        return {
            icon: '👤',
            color: '#6b7280',
            bgColor: '#f3f4f6',
            label: 'Noma\'lum'
        };
    }

    const modeLower = String(mode).toLowerCase();

    if (modeLower.includes('face') && (modeLower.includes('card') || modeLower.includes('finger'))) {
        // Combined modes
        if (modeLower.includes('card')) {
            return {
                icon: '👤💳',
                color: '#8b5cf6',
                bgColor: '#f3e8ff',
                label: 'Yuz + Karta'
            };
        } else if (modeLower.includes('finger')) {
            return {
                icon: '👤👆',
                color: '#8b5cf6',
                bgColor: '#f3e8ff',
                label: 'Yuz + Barmoq izi'
            };
        }
    } else if (modeLower.includes('face') || modeLower === 'face' || modeLower === 'faceid') {
        return {
            icon: '👤',
            color: '#3b82f6',
            bgColor: '#dbeafe',
            label: 'Yuz'
        };
    } else if (modeLower.includes('card') || modeLower.includes('rfid') || modeLower.includes('nfc')) {
        return {
            icon: '💳',
            color: '#10b981',
            bgColor: '#d1fae5',
            label: 'Karta'
        };
    } else if (modeLower.includes('finger') || modeLower.includes('fp')) {
        return {
            icon: '👆',
            color: '#f59e0b',
            bgColor: '#fef3c7',
            label: 'Barmoq izi'
        };
    } else if (modeLower.includes('password') || modeLower.includes('pwd')) {
        return {
            icon: '🔑',
            color: '#6366f1',
            bgColor: '#e0e7ff',
            label: 'Parol'
        };
    } else if (modeLower.includes('manual')) {
        return {
            icon: '✋',
            color: '#6b7280',
            bgColor: '#f3f4f6',
            label: 'Qo\'lda'
        };
    }

    // Default/Unknown
    return {
        icon: '❓',
        color: '#6b7280',
        bgColor: '#f3f4f6',
        label: String(mode).charAt(0).toUpperCase() + String(mode).slice(1).toLowerCase()
    };
}

function formatDateTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleString('uz-UZ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}


window.showEditDailyChangeModal = showEditDailyChangeModal;
window.deleteDailyChange = deleteDailyChange;
window.showEditSalaryRateModal = showEditSalaryRateModal;
window.deleteSalaryRate = deleteSalaryRate;




const salaryRatesList = document.getElementById('salaryRatesList');
const loadingSalaryRatesMessage = document.getElementById('loadingSalaryRatesMessage');
const emptySalaryRatesMessage = document.getElementById('emptySalaryRatesMessage');


async function loadEmployeesForSalaryRates() {
    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.employees) {
            const select = document.getElementById('modalSalaryRateEmployee');
            if (select) {
                const currentValue = select.value;
                select.innerHTML = '<option value="">Hodimni tanlang</option>';
                data.employees.forEach(emp => {
                    const option = document.createElement('option');
                    option.value = emp.id;
                    option.textContent = `${emp.full_name} (${emp.position})`;
                    select.appendChild(option);
                });
                if (currentValue) {
                    select.value = currentValue;
                }
            }
        }
    } catch (error) {
        console.error('Load employees for salary rates error:', error);
    }
}


async function loadPositionsForSalaryRates() {
    try {
        const response = await apiRequest('/api/positions');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.positions) {
            const select = document.getElementById('modalSalaryRatePosition');
            if (select) {
                const currentValue = select.value;
                select.innerHTML = '<option value="">Lavozimni tanlang</option>';
                data.positions.forEach(pos => {
                    const option = document.createElement('option');
                    option.value = pos.name;
                    option.textContent = pos.name;
                    select.appendChild(option);
                });
                if (currentValue) {
                    select.value = currentValue;
                }
            }
        }
    } catch (error) {
        console.error('Load positions for salary rates error:', error);
    }
}


async function loadSalaryRates() {
    if (currentUserRole !== 'admin') {
        return;
    }

    try {
        showSalaryRatesLoading(true);
        hideSalaryRatesMessages();

        const response = await apiRequest('/api/salary-rates');
        if (!response) return;

        const data = await response.json();
        showSalaryRatesLoading(false);

        if (data.success) {
            displaySalaryRates(data.rates);
        } else {
            showSalaryRatesError('Ish haqqi belgilanishlarini yuklashda xatolik yuz berdi');
        }
    } catch (error) {
        showSalaryRatesLoading(false);
        console.error('Load salary rates error:', error);
        showSalaryRatesError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


function displaySalaryRates(rates) {
    if (!salaryRatesList) return;

    salaryRatesList.innerHTML = '';

    if (rates.length === 0) {
        if (emptySalaryRatesMessage) emptySalaryRatesMessage.style.display = 'block';
        if (salaryRatesList) salaryRatesList.style.display = 'none';
        return;
    }

    if (emptySalaryRatesMessage) emptySalaryRatesMessage.style.display = 'none';
    if (salaryRatesList) salaryRatesList.style.display = 'grid';

    rates.forEach(rate => {
        const rateItem = createSalaryRateItem(rate);
        salaryRatesList.appendChild(rateItem);
    });
}


function createSalaryRateItem(rate) {
    const item = document.createElement('div');
    item.style.cssText = 'padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; display: flex; align-items: center; justify-content: space-between;';

    const periodTypeLabels = {
        'daily': 'Kunlik',
        'weekly': 'Haftalik',
        'monthly': 'Oylik'
    };

    const targetName = rate.employee_name
        ? `${rate.employee_name} (${rate.employee_position})`
        : rate.position_name || '—';

    const targetType = rate.employee_id ? 'Hodim' : 'Lavozim';

    const formattedAmount = new Intl.NumberFormat('uz-UZ', {
        style: 'currency',
        currency: 'UZS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(parseFloat(rate.amount)).replace('UZS', 'so\'m');

    item.innerHTML = `
        <div style="flex: 1;">
            <div style="font-weight: 500; color: #111827; font-size: 14px; margin-bottom: 2px;">
                ${targetType}: ${escapeHtml(targetName)}
            </div>
            <div style="font-size: 12px; color: #6b7280;">
                <span style="color: #10b981; font-weight: 600;">${formattedAmount}</span> • ${periodTypeLabels[rate.period_type] || rate.period_type}
            </div>
            </div>
        <div style="display: flex; gap: 6px; margin-left: 16px;">
            <button class="edit-btn" onclick="showEditSalaryRateModal(${rate.id})" title="Tahrirlash">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="delete-btn" onclick="deleteSalaryRate(${rate.id}, '${escapeHtml(targetName)}')" title="O'chirish">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

    return item;
}


function showAddSalaryRateModal() {
    const addSalaryRateModal = document.getElementById('addSalaryRateModal');
    if (addSalaryRateModal) {

        const form = document.getElementById('addSalaryRateModalForm');
        if (form) form.reset();


        document.getElementById('employeeRateFields').style.display = 'none';
        document.getElementById('positionRateFields').style.display = 'none';


        const errorMsg = document.getElementById('modalAddSalaryRateErrorMessage');
        const successMsg = document.getElementById('modalAddSalaryRateSuccessMessage');
        if (errorMsg) errorMsg.style.display = 'none';
        if (successMsg) successMsg.style.display = 'none';


        loadEmployeesForSalaryRates();
        loadPositionsForSalaryRates();


        addSalaryRateModal.style.display = 'flex';

        // Format qilish
        setupAmountInputFormatting('modalSalaryRateAmount');

        const rateTypeSelect = document.getElementById('modalSalaryRateType');
        if (rateTypeSelect) {
            rateTypeSelect.onchange = function () {
                const type = this.value;
                const employeeFields = document.getElementById('employeeRateFields');
                const positionFields = document.getElementById('positionRateFields');

                if (employeeFields) employeeFields.style.display = type === 'employee' ? 'block' : 'none';
                if (positionFields) positionFields.style.display = type === 'position' ? 'block' : 'none';


                if (type === 'employee') {
                    document.getElementById('modalSalaryRatePosition').value = '';
                } else if (type === 'position') {
                    document.getElementById('modalSalaryRateEmployee').value = '';
                }
            };
        }
    }
}


function hideAddSalaryRateModal() {
    const addSalaryRateModal = document.getElementById('addSalaryRateModal');
    if (addSalaryRateModal) {
        addSalaryRateModal.style.display = 'none';
    }
}


const cancelAddSalaryRateModalBtn = document.getElementById('cancelAddSalaryRateModalBtn');
if (cancelAddSalaryRateModalBtn) {
    cancelAddSalaryRateModalBtn.addEventListener('click', hideAddSalaryRateModal);
}


const addSalaryRateModalForm = document.getElementById('addSalaryRateModalForm');
if (addSalaryRateModalForm) {
    addSalaryRateModalForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const rateType = document.getElementById('modalSalaryRateType').value;
        const employeeId = document.getElementById('modalSalaryRateEmployee').value;
        const positionName = document.getElementById('modalSalaryRatePosition').value;
        // Formatlangan qiymatni raqamli qiymatga o'zgartirish
        const amountRaw = document.getElementById('modalSalaryRateAmount').value.replace(/[^\d]/g, '');
        const amount = amountRaw ? parseFloat(amountRaw) : 0;
        const periodType = document.getElementById('modalSalaryRatePeriodType').value;
        const notes = document.getElementById('modalSalaryRateNotes').value.trim();

        if (!rateType || !amount || !periodType) {
            const errorMsg = document.getElementById('modalAddSalaryRateErrorMessage');
            if (errorMsg) {
                errorMsg.textContent = 'Belgilash turi, summa va davr turi kiritishingiz kerak';
                errorMsg.style.display = 'block';
            }
            return;
        }

        if (rateType === 'employee' && !employeeId) {
            const errorMsg = document.getElementById('modalAddSalaryRateErrorMessage');
            if (errorMsg) {
                errorMsg.textContent = 'Hodimni tanlashingiz kerak';
                errorMsg.style.display = 'block';
            }
            return;
        }

        if (rateType === 'position' && !positionName) {
            const errorMsg = document.getElementById('modalAddSalaryRateErrorMessage');
            if (errorMsg) {
                errorMsg.textContent = 'Lavozimni tanlashingiz kerak';
                errorMsg.style.display = 'block';
            }
            return;
        }


        const errorMsg = document.getElementById('modalAddSalaryRateErrorMessage');
        const successMsg = document.getElementById('modalAddSalaryRateSuccessMessage');
        if (errorMsg) errorMsg.style.display = 'none';
        if (successMsg) successMsg.style.display = 'none';


        const loader = document.getElementById('modalAddSalaryRateLoader');
        const saveBtn = document.getElementById('saveAddSalaryRateModalBtn');
        if (loader) loader.style.display = 'inline-block';
        if (saveBtn) saveBtn.disabled = true;

        try {
            const response = await apiRequest('/api/salary-rates', {
                method: 'POST',
                body: JSON.stringify({
                    employee_id: rateType === 'employee' ? parseInt(employeeId) : null,
                    position_name: rateType === 'position' ? positionName : null,
                    amount: amount,
                    period_type: periodType,
                    notes: notes || null
                })
            });

            if (!response) {
                if (loader) loader.style.display = 'none';
                if (saveBtn) saveBtn.disabled = false;
                return;
            }

            const data = await response.json();

            if (loader) loader.style.display = 'none';
            if (saveBtn) saveBtn.disabled = false;

            if (data.success) {
                if (successMsg) {
                    successMsg.textContent = data.message || 'Ish haqqi muvaffaqiyatli belgilandi';
                    successMsg.style.display = 'block';
                }

                loadSalaryRates();

                setTimeout(() => {
                    hideAddSalaryRateModal();
                }, 1500);
            } else {
                if (errorMsg) {
                    errorMsg.textContent = data.message || 'Ish haqqi belgilashda xatolik yuz berdi';
                    errorMsg.style.display = 'block';
                }
            }
        } catch (error) {
            if (loader) loader.style.display = 'none';
            if (saveBtn) saveBtn.disabled = false;
            console.error('Add salary rate error:', error);
            if (errorMsg) {
                errorMsg.textContent = 'Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.';
                errorMsg.style.display = 'block';
            }
        }
    });
}


let editSalaryRateId = null;

async function showEditSalaryRateModal(rateId) {
    editSalaryRateId = rateId;
    const editModal = document.getElementById('editSalaryRateModal');
    const editAmount = document.getElementById('editSalaryRateAmount');
    const editPeriodType = document.getElementById('editSalaryRatePeriodType');
    const editNotes = document.getElementById('editSalaryRateNotes');
    const errorMsg = document.getElementById('modalEditSalaryRateErrorMessage');
    const successMsg = document.getElementById('modalEditSalaryRateSuccessMessage');

    if (!editModal || !editAmount || !editPeriodType || !editNotes) {
        alert('Modal elementlari topilmadi');
        return;
    }

    // Xabarlarni yashirish
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';

    try {
        // Ma'lumotlarni yuklash
        const response = await apiRequest(`/api/salary-rates/${rateId}`);
        if (!response) {
            alert('Ma\'lumotlarni yuklab bo\'lmadi');
            return;
        }

        const data = await response.json();
        if (!data.success || !data.rate) {
            alert(data.message || 'Ish haqqi ma\'lumotlari topilmadi');
            return;
        }

        const rate = data.rate;

        // Formani to'ldirish
        // Formatlangan ko'rinishda ko'rsatish
        if (editAmount && rate.amount) {
            editAmount.value = new Intl.NumberFormat('uz-UZ', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(parseFloat(rate.amount));
            setupAmountInputFormatting('editSalaryRateAmount');
        }
        editPeriodType.value = rate.period_type || 'daily';
        editNotes.value = rate.notes || '';

        // Modalni ko'rsatish
        editModal.style.display = 'flex';
    } catch (error) {
        console.error('Error loading salary rate:', error);
        alert('Ma\'lumotlarni yuklashda xatolik: ' + error.message);
    }
}

function hideEditSalaryRateModal() {
    const editModal = document.getElementById('editSalaryRateModal');
    if (editModal) {
        editModal.style.display = 'none';
        editSalaryRateId = null;
        const editForm = document.getElementById('editSalaryRateModalForm');
        if (editForm) editForm.reset();
    }
}

async function updateSalaryRate() {
    if (!editSalaryRateId) return;

    const editAmount = document.getElementById('editSalaryRateAmount');
    const editPeriodType = document.getElementById('editSalaryRatePeriodType');
    const editNotes = document.getElementById('editSalaryRateNotes');
    const errorMsg = document.getElementById('modalEditSalaryRateErrorMessage');
    const successMsg = document.getElementById('modalEditSalaryRateSuccessMessage');
    const loader = document.getElementById('modalEditSalaryRateLoader');
    const saveBtn = document.getElementById('saveEditSalaryRateModalBtn');

    if (!editAmount || !editPeriodType || !editNotes) {
        return;
    }

    // Formatlangan qiymatni raqamli qiymatga o'zgartirish
    const amountRaw = editAmount.value.replace(/[^\d]/g, '');
    const amount = amountRaw ? parseFloat(amountRaw) : 0;
    const periodType = editPeriodType.value;
    const notes = editNotes.value.trim();

    if (!amount || amount <= 0) {
        if (errorMsg) {
            errorMsg.textContent = 'Summa musbat son bo\'lishi kerak';
            errorMsg.style.display = 'block';
        }
        return;
    }

    if (!periodType) {
        if (errorMsg) {
            errorMsg.textContent = 'Davr turini tanlang';
            errorMsg.style.display = 'block';
        }
        return;
    }

    // Xabarlarni yashirish
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';

    // Loader ko'rsatish
    if (loader) loader.style.display = 'inline-block';
    if (saveBtn) saveBtn.disabled = true;

    try {
        const response = await apiRequest(`/api/salary-rates/${editSalaryRateId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amount,
                period_type: periodType,
                notes: notes || null
            })
        });

        if (!response) {
            if (loader) loader.style.display = 'none';
            if (saveBtn) saveBtn.disabled = false;
            return;
        }

        const data = await response.json();

        if (loader) loader.style.display = 'none';
        if (saveBtn) saveBtn.disabled = false;

        if (data.success) {
            if (successMsg) {
                successMsg.textContent = data.message || 'Ish haqqi muvaffaqiyatli yangilandi';
                successMsg.style.display = 'block';
            }

            // Ro'yxatni yangilash
            loadSalaryRates();

            // 1.5 soniyadan keyin modalni yopish
            setTimeout(() => {
                hideEditSalaryRateModal();
            }, 1500);
        } else {
            if (errorMsg) {
                errorMsg.textContent = data.message || 'Yangilashda xatolik yuz berdi';
                errorMsg.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Update salary rate error:', error);
        if (loader) loader.style.display = 'none';
        if (saveBtn) saveBtn.disabled = false;
        if (errorMsg) {
            errorMsg.textContent = 'Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.';
            errorMsg.style.display = 'block';
        }
    }
}

// Event listeners
const cancelEditSalaryRateModalBtn = document.getElementById('cancelEditSalaryRateModalBtn');
if (cancelEditSalaryRateModalBtn) {
    cancelEditSalaryRateModalBtn.addEventListener('click', hideEditSalaryRateModal);
}

const editSalaryRateModalForm = document.getElementById('editSalaryRateModalForm');
if (editSalaryRateModalForm) {
    editSalaryRateModalForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        await updateSalaryRate();
    });
}

async function deleteSalaryRate(rateId, targetName) {
    if (!confirm(`"${targetName}" uchun ish haqqi belgilanishini o'chirishni tasdiqlaysizmi?`)) {
        return;
    }

    try {
        const response = await apiRequest(`/api/salary-rates/${rateId}`, {
            method: 'DELETE'
        });

        if (!response) return;

        const data = await response.json();

        if (data.success) {
            // Ro'yxatni avtomatik yangilash
            loadSalaryRates();
            // Maoshlar ro'yxatini ham yangilash (agar Maoshlar bo'limi ochiq bo'lsa)
            const salariesSection = document.getElementById('incomeSection');
            if (salariesSection && salariesSection.style.display !== 'none') {
                loadSalaries();
            }
        } else {
            alert(data.message || 'O\'chirishda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Delete salary rate error:', error);
        alert('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}




// Load terminals debouncing (duplicate muammosini hal qilish)
let loadTerminalsTimeout = null;
let isLoadingTerminals = false;

async function loadTerminals() {
    // Debouncing: agar allaqachon yuklanmoqda bo'lsa, yangi so'rovni kutish
    if (isLoadingTerminals) {
        console.log('⚠️  loadTerminals() allaqachon yuklanmoqda, yangi so\'rov kutmoqda...');
        return;
    }

    // Timeout bo'lsa, bekor qilish (oxirgi so'rovni kutish)
    if (loadTerminalsTimeout) {
        clearTimeout(loadTerminalsTimeout);
    }

    // 100ms debounce (duplicate so'rovlarni oldini olish)
    loadTerminalsTimeout = setTimeout(async () => {
        await loadTerminalsInternal();
    }, 100);
}

async function loadTerminalsInternal() {
    isLoadingTerminals = true;

    const terminalsList = document.getElementById('terminalsList');
    const loadingMessage = document.getElementById('loadingTerminalsMessage');
    const emptyMessage = document.getElementById('emptyTerminalsMessage');

    if (loadingMessage) loadingMessage.style.display = 'block';

    // MUHIM: Oldingi barcha child elementlarni to'liq o'chirish (duplicate muammosini hal qilish)
    if (terminalsList) {
        // innerHTML = '' ishlatishdan ko'ra, child elementlarni aniq o'chirish yaxshiroq
        while (terminalsList.firstChild) {
            terminalsList.removeChild(terminalsList.firstChild);
        }
        terminalsList.innerHTML = ''; // Qo'shimcha xavfsizlik uchun
    }

    if (emptyMessage) emptyMessage.style.display = 'none';

    try {
        const response = await apiRequest('/api/terminals');
        if (!response) return;

        const data = await response.json();

        if (loadingMessage) loadingMessage.style.display = 'none';

        if (!data.success || !data.terminals || data.terminals.length === 0) {
            if (emptyMessage) emptyMessage.style.display = 'block';
            if (terminalsList) {
                terminalsList.style.display = 'none';
                // Empty bo'lsa ham child elementlarni to'liq tozalash
                while (terminalsList.firstChild) {
                    terminalsList.removeChild(terminalsList.firstChild);
                }
            }
            return;
        }

        if (emptyMessage) emptyMessage.style.display = 'none';
        if (terminalsList) {
            terminalsList.style.display = 'flex';
            // Qo'shimcha xavfsizlik uchun yana bir bor tozalash
            while (terminalsList.firstChild) {
                terminalsList.removeChild(terminalsList.firstChild);
            }

            // Yangi terminal'lar ro'yxatini yaratish
            data.terminals.forEach(terminal => {
                const terminalItem = createTerminalItem(terminal);
                terminalsList.appendChild(terminalItem);
            });
        }
    } catch (error) {
        if (loadingMessage) loadingMessage.style.display = 'none';
        console.error('Load terminals error:', error);
        // Xatolik bo'lganda ham ro'yxatni tozalash
        if (terminalsList) {
            while (terminalsList.firstChild) {
                terminalsList.removeChild(terminalsList.firstChild);
            }
        }
    } finally {
        // Loading flag'ni reset qilish
        isLoadingTerminals = false;
    }
}


function createTerminalItem(terminal) {
    const item = document.createElement('div');
    item.style.cssText = 'padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; display: flex; align-items: center; justify-content: space-between; gap: 12px;';

    const typeLabels = {
        'entry': 'Kirish',
        'exit': 'Chiqish'
    };

    const statusBadge = terminal.is_active
        ? '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;">Faol</span>'
        : '<span style="background: #ef4444; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;">Nofaol</span>';

    item.innerHTML = `
        <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                <div style="font-weight: 500; color: #111827; font-size: 14px;">${escapeHtml(terminal.name)}</div>
                ${statusBadge}
            </div>
            <div style="font-size: 13px; color: #6b7280;">
                <span style="font-family: monospace;">${escapeHtml(terminal.ip_address)}</span>
                ${terminal.location ? ` • ${escapeHtml(terminal.location)}` : ''}
                • ${typeLabels[terminal.terminal_type] || terminal.terminal_type}
            </div>
            </div>
        <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
            <button onclick="testTerminalConnection(${terminal.id}); event.stopPropagation();" 
                    title="Test" 
                    style="width: 28px; height: 28px; border-radius: 4px; background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
            </button>
            <button onclick="fetchTerminalUsers(${terminal.id}); event.stopPropagation();" 
                    title="Foydalanuvchilar" 
                    style="width: 28px; height: 28px; border-radius: 4px; background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
            </button>
            <button onclick="syncTerminalEvents(${terminal.id}); event.stopPropagation();" 
                    title="Eventlar" 
                    style="width: 28px; height: 28px; border-radius: 4px; background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            </button>
            <button class="edit-btn" onclick="showEditTerminalModal(${terminal.id}); event.stopPropagation();" 
                    title="Tahrirlash" 
                    style="width: 28px; height: 28px; padding: 0; min-width: 28px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="delete-btn" onclick="deleteTerminal(${terminal.id}, '${escapeHtml(terminal.name)}'); event.stopPropagation();" 
                    title="O'chirish" 
                    style="width: 28px; height: 28px; padding: 0; min-width: 28px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

    return item;
}


function showAddTerminalModal() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'addTerminalModal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Yangi Terminal Qo'shish</h2>
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <form id="addTerminalForm" class="modal-form">
                <div class="form-group">
                    <label for="terminalName">Terminal Nomi *</label>
                    <input type="text" id="terminalName" required placeholder="Masalan: Asosiy Kirish Terminali">
                </div>
                <div class="form-group">
                    <label for="terminalIp">IP Manzil *</label>
                    <input type="text" id="terminalIp" required placeholder="192.168.1.100" pattern="^(\\d{1,3}\\.){3}\\d{1,3}$">
                </div>
                <div class="form-group">
                    <label for="terminalType">Terminal Turi *</label>
                    <select id="terminalType" required>
                        <option value="">Tanlang</option>
                        <option value="entry">Kirish</option>
                        <option value="exit">Chiqish</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="terminalUsername">Username</label>
                    <input type="text" id="terminalUsername" placeholder="admin (ixtiyoriy)">
                </div>
                <div class="form-group">
                    <label for="terminalPassword">Password</label>
                    <input type="password" id="terminalPassword" placeholder="(ixtiyoriy)">
                </div>
                <div class="form-group">
                    <label for="terminalLocation">Joylashuv</label>
                    <input type="text" id="terminalLocation" placeholder="Masalan: Asosiy kirish eshigi">
                </div>
                <div class="modal-actions">
                    <button type="button" class="cancel-btn" onclick="this.closest('.modal').remove()">Bekor qilish</button>
                    <button type="submit" class="add-btn">
                        <span class="btn-text">Qo'shish</span>
                        <span class="btn-loader" style="display: none;"></span>
                    </button>
                </div>
                <div class="error-message" style="display: none;"></div>
                <div class="success-message" style="display: none;"></div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);


    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            modal.remove();
        }
    });

    const form = document.getElementById('addTerminalForm');
    const formSubmitHandler = async function (e) {
        e.preventDefault();

        const loader = form.querySelector('.btn-loader');
        const btnText = form.querySelector('.btn-text');
        const errorMsg = form.querySelector('.error-message');
        const successMsg = form.querySelector('.success-message');
        const submitBtn = form.querySelector('button[type="submit"]');

        if (loader) loader.style.display = 'inline-block';
        if (btnText) btnText.style.display = 'none';
        if (errorMsg) errorMsg.style.display = 'none';
        if (successMsg) successMsg.style.display = 'none';
        submitBtn.disabled = true;

        try {
            const response = await apiRequest('/api/terminals', {
                method: 'POST',
                body: JSON.stringify({
                    name: document.getElementById('terminalName').value.trim(),
                    ip_address: document.getElementById('terminalIp').value.trim(),
                    terminal_type: document.getElementById('terminalType').value,
                    username: document.getElementById('terminalUsername').value.trim() || null,
                    password: document.getElementById('terminalPassword').value || null,
                    location: document.getElementById('terminalLocation').value.trim() || null
                })
            });

            if (!response) return;

            const data = await response.json();

            if (loader) loader.style.display = 'none';
            if (btnText) btnText.style.display = 'inline';
            submitBtn.disabled = false;

            if (data.success) {
                if (successMsg) {
                    successMsg.textContent = data.message || 'Terminal muvaffaqiyatli qo\'shildi';
                    successMsg.style.display = 'block';
                }
                loadTerminals();
                setTimeout(() => {
                    form.removeEventListener('submit', formSubmitHandler);
                    modal.remove();
                }, 1500);
            } else {
                if (errorMsg) {
                    errorMsg.textContent = data.message || 'Terminal qo\'shishda xatolik';
                    errorMsg.style.display = 'block';
                }
            }
        } catch (error) {
            if (loader) loader.style.display = 'none';
            if (btnText) btnText.style.display = 'inline';
            submitBtn.disabled = false;
            console.error('Add terminal error:', error);
            if (errorMsg) {
                errorMsg.textContent = 'Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.';
                errorMsg.style.display = 'block';
            }
        }
    };

    form.addEventListener('submit', formSubmitHandler);
}


async function showEditTerminalModal(terminalId) {
    try {
        const response = await apiRequest(`/api/terminals/${terminalId}`);
        if (!response) return;

        const data = await response.json();
        if (!data.success) {
            alert(data.message || 'Terminal topilmadi');
            return;
        }

        const terminal = data.terminal;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'editTerminalModal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Terminalni Tahrirlash</h2>
                    <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
                </div>
                <form id="editTerminalForm" class="modal-form">
                    <div class="form-group">
                        <label for="editTerminalName">Terminal Nomi *</label>
                        <input type="text" id="editTerminalName" required value="${escapeHtml(terminal.name)}">
                    </div>
                    <div class="form-group">
                        <label for="editTerminalIp">IP Manzil *</label>
                        <input type="text" id="editTerminalIp" required value="${escapeHtml(terminal.ip_address)}" pattern="^(\\d{1,3}\\.){3}\\d{1,3}$">
                    </div>
                    <div class="form-group">
                        <label for="editTerminalType">Terminal Turi *</label>
                        <select id="editTerminalType" required>
                            <option value="entry" ${terminal.terminal_type === 'entry' ? 'selected' : ''}>Kirish</option>
                            <option value="exit" ${terminal.terminal_type === 'exit' ? 'selected' : ''}>Chiqish</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="editTerminalUsername">Username</label>
                        <input type="text" id="editTerminalUsername" value="${escapeHtml(terminal.username || '')}" placeholder="admin">
                    </div>
                    <div class="form-group">
                        <label for="editTerminalPassword">Password</label>
                        <input type="password" id="editTerminalPassword" placeholder="O'zgartirish uchun yangi parol kiriting">
                    </div>
                    <div class="form-group">
                        <label for="editTerminalLocation">Joylashuv</label>
                        <input type="text" id="editTerminalLocation" value="${escapeHtml(terminal.location || '')}" placeholder="Masalan: Asosiy kirish eshigi">
                    </div>
                    <div class="form-group">
                        <label style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="editTerminalActive" ${terminal.is_active ? 'checked' : ''}>
                            <span>Faol</span>
                        </label>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="cancel-btn" onclick="this.closest('.modal').remove()">Bekor qilish</button>
                        <button type="submit" class="add-btn">
                            <span class="btn-text">Saqlash</span>
                            <span class="btn-loader" style="display: none;"></span>
                        </button>
                    </div>
                    <div class="error-message" style="display: none;"></div>
                    <div class="success-message" style="display: none;"></div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);


        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                modal.remove();
            }
        });

        const form = document.getElementById('editTerminalForm');
        const formSubmitHandler = async function (e) {
            e.preventDefault();

            const loader = form.querySelector('.btn-loader');
            const btnText = form.querySelector('.btn-text');
            const errorMsg = form.querySelector('.error-message');
            const successMsg = form.querySelector('.success-message');
            const submitBtn = form.querySelector('button[type="submit"]');

            if (loader) loader.style.display = 'inline-block';
            if (btnText) btnText.style.display = 'none';
            if (errorMsg) errorMsg.style.display = 'none';
            if (successMsg) successMsg.style.display = 'none';
            submitBtn.disabled = true;

            try {
                const updateData = {
                    name: document.getElementById('editTerminalName').value.trim(),
                    ip_address: document.getElementById('editTerminalIp').value.trim(),
                    terminal_type: document.getElementById('editTerminalType').value,
                    username: document.getElementById('editTerminalUsername').value.trim() || null,
                    location: document.getElementById('editTerminalLocation').value.trim() || null,
                    is_active: document.getElementById('editTerminalActive').checked
                };

                const password = document.getElementById('editTerminalPassword').value;
                if (password) {
                    updateData.password = password;
                }

                const response = await apiRequest(`/api/terminals/${terminalId}`, {
                    method: 'PUT',
                    body: JSON.stringify(updateData)
                });

                if (!response) return;

                const data = await response.json();

                if (loader) loader.style.display = 'none';
                if (btnText) btnText.style.display = 'inline';
                submitBtn.disabled = false;

                if (data.success) {
                    if (successMsg) {
                        successMsg.textContent = data.message || 'Terminal muvaffaqiyatli yangilandi';
                        successMsg.style.display = 'block';
                    }
                    loadTerminals();
                    setTimeout(() => {
                        form.removeEventListener('submit', formSubmitHandler);
                        modal.remove();
                    }, 1500);
                } else {
                    if (errorMsg) {
                        errorMsg.textContent = data.message || 'Terminalni yangilashda xatolik';
                        errorMsg.style.display = 'block';
                    }
                }
            } catch (error) {
                if (loader) loader.style.display = 'none';
                if (btnText) btnText.style.display = 'inline';
                submitBtn.disabled = false;
                console.error('Edit terminal error:', error);
                if (errorMsg) {
                    errorMsg.textContent = 'Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.';
                    errorMsg.style.display = 'block';
                }
            }
        };

        form.addEventListener('submit', formSubmitHandler);
    } catch (error) {
        console.error('Load terminal error:', error);
        alert('Terminal ma\'lumotlarini yuklab bo\'lmadi');
    }
}


async function testTerminalConnection(terminalId) {
    if (!confirm('Terminal bilan aloqani test qilishni tasdiqlaysizmi?')) {
        return;
    }

    try {
        const response = await apiRequest(`/api/terminals/${terminalId}/test`, {
            method: 'POST'
        });

        if (!response) return;

        const data = await response.json();

        if (data.success) {
            let message = `✅ ${data.message}\n\n`;
            if (data.details && data.details.deviceInfo) {
                message += `Qurilma ma'lumotlari:\n`;
                if (data.details.deviceInfo.deviceName) {
                    message += `Nom: ${data.details.deviceInfo.deviceName}\n`;
                }
                if (data.details.deviceInfo.model) {
                    message += `Model: ${data.details.deviceInfo.model}\n`;
                }
                if (data.details.deviceInfo.firmwareVersion) {
                    message += `Firmware: ${data.details.deviceInfo.firmwareVersion}\n`;
                }
            }
            alert(message);
        } else {
            alert(`❌ ${data.message}\n\n${data.details && data.details.errorCode ? `Xatolik kodi: ${data.details.errorCode}` : ''}`);
        }
    } catch (error) {
        console.error('Test terminal connection error:', error);
        alert('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


async function fetchTerminalUsers(terminalId) {
    if (!confirm('Terminaldan foydalanuvchilarni va face ID\'larni yuklab olishni xohlaysizmi?\n\nYuklab olingan ma\'lumotlar database\'ga saqlanishi mumkin.')) {
        return;
    }

    const saveToDb = confirm('Database\'ga saqlashni xohlaysizmi?\n\nOK - saqlash, Cancel - faqat ko\'rsatish');

    try {
        const response = await apiRequest(`/api/terminals/${terminalId}/fetch-users`, {
            method: 'POST',
            body: JSON.stringify({ save_to_db: saveToDb })
        });

        if (!response) return;

        const data = await response.json();

        if (data.success) {
            let message = `✅ ${data.total} ta foydalanuvchi topildi\n\n`;
            message += `Foydalanuvchilar: ${data.userCount}\n`;
            message += `Face template'lar: ${data.faceCount}\n`;
            if (saveToDb && data.saved > 0) {
                message += `\n✅ ${data.saved} ta foydalanuvchi database'ga saqlandi`;
            }


            if (data.users && data.users.length > 0) {
                message += `\n\nFoydalanuvchilar ro'yxati:\n\n`;
                data.users.slice(0, 20).forEach((user, index) => {
                    message += `${index + 1}. ${user.name || 'Noma\'lum'} (ID: ${user.employeeNoString || user.employeeNo || '—'})\n`;
                });
                if (data.users.length > 20) {
                    message += `\n... va yana ${data.users.length - 20} ta`;
                }
            }

            alert(message);
            loadTerminals();
        } else {
            alert(`❌ Xatolik: ${data.message || 'Foydalanuvchilarni yuklashda xatolik'}`);
        }
    } catch (error) {
        console.error('Fetch terminal users error:', error);
        alert('❌ Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


// Avtomatik terminal sinxronizatsiyasi (fon jarayoni, xabar ko'rsatmaydi)
async function autoSyncTerminals() {
    try {
        const syncResponse = await apiRequest('/api/terminals/sync-all', {
            method: 'POST'
        });

        if (syncResponse) {
            const syncData = await syncResponse.json();
            if (syncData.success) {
                console.log(`✅ Terminallar avtomatik sinxronlashdi: ${syncData.totalSaved} ta yangi event, ${syncData.totalDuplicates} ta duplikat`);
            } else {
                console.warn('Terminal sinxronlashda xatolik:', syncData.message);
            }
        }
    } catch (error) {
        // Xatolarni faqat konsolga yozish, foydalanuvchiga ko'rsatmaslik
        console.error('Avtomatik terminal sinxronlashda xatolik:', error);
    }
}

async function syncTerminalEvents(terminalId) {
    const startDate = prompt('Boshlang\'ich sana (YYYY-MM-DD formatida, bo\'sh qoldirish - oxirgi 30 kun):');
    const endDate = prompt('Tugash sana (YYYY-MM-DD formatida, bo\'sh qoldirish - bugun):');

    const startDateObj = startDate ? new Date(startDate) : null;
    const endDateObj = endDate ? new Date(endDate) : null;

    if (startDate && isNaN(startDateObj.getTime())) {
        alert('Noto\'g\'ri boshlang\'ich sana format!');
        return;
    }

    if (endDate && isNaN(endDateObj.getTime())) {
        alert('Noto\'g\'ri tugash sana format!');
        return;
    }

    if (!confirm('Terminaldan barcha eventlarni yuklab olishni tasdiqlaysizmi? Bu bir necha daqiqa vaqt olishi mumkin.')) {
        return;
    }

    try {
        const requestBody = {};
        if (startDateObj) requestBody.start_date = startDateObj.toISOString();
        if (endDateObj) requestBody.end_date = endDateObj.toISOString();

        const response = await apiRequest(`/api/terminals/${terminalId}/sync`, {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });

        if (!response) return;

        const data = await response.json();

        if (data.success) {
            let message = `✅ ${data.message}\n\n`;
            if (data.details) {
                message += `Topildi: ${data.details.totalFound} ta\n`;
                message += `Saqlandi: ${data.details.totalSaved} ta\n`;
                message += `Sana oralig'i: ${new Date(data.details.startDate).toLocaleDateString('uz-UZ')} - ${new Date(data.details.endDate).toLocaleDateString('uz-UZ')}\n`;
            }
            alert(message);

            loadTerminals();
        } else {
            alert(`❌ ${data.message}`);
        }
    } catch (error) {
        console.error('Sync terminal events error:', error);
        alert('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}


async function deleteTerminal(terminalId, terminalName) {
    if (!confirm(`"${terminalName}" terminalini o'chirishni tasdiqlaysizmi?`)) {
        return;
    }

    try {
        const response = await apiRequest(`/api/terminals/${terminalId}`, {
            method: 'DELETE'
        });

        if (!response) return;

        const data = await response.json();

        if (data.success) {
            loadTerminals();
        } else {
            alert(data.message || 'O\'chirishda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Delete terminal error:', error);
        alert('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}





let currentStatsData = null;
let currentAttendanceDateRange = {
    startDate: null,
    endDate: null
};

async function loadAttendance() {
    const attendanceList = document.getElementById('attendanceList');
    const loadingMessage = document.getElementById('loadingAttendanceMessage');
    const emptyMessage = document.getElementById('emptyAttendanceMessage');
    const statsContainer = document.getElementById('todayStatsContainer');

    if (loadingMessage) loadingMessage.style.display = 'block';
    if (attendanceList) attendanceList.innerHTML = '';
    if (emptyMessage) emptyMessage.style.display = 'none';

    try {
        // If no date range selected, use today-stats endpoint which includes all employees
        if (!currentAttendanceDateRange.startDate || !currentAttendanceDateRange.endDate) {
            const response = await apiRequest('/api/attendance/today-stats');
            if (response) {
                const data = await response.json();
                console.log('Today stats response:', data);
                if (data.success) {
                    currentStatsData = data;
                    displayTodayStats(data);
                    displayAttendanceList(data, 'all');
                } else {
                    console.error('Today stats API returned success: false, message:', data.message);
                    if (emptyMessage) {
                        emptyMessage.style.display = 'block';
                        emptyMessage.textContent = data.message || 'Ma\'lumotlarni yuklashda xatolik yuz berdi';
                    }
                }
            } else {
                console.error('No response from today-stats API');
                if (emptyMessage) {
                    emptyMessage.style.display = 'block';
                    emptyMessage.textContent = 'Ma\'lumotlarni yuklashda xatolik yuz berdi';
                }
            }
            if (loadingMessage) loadingMessage.style.display = 'none';
            return;
        }

        // For date range, get all employees first, then get attendance logs and work schedules
        const startDate = new Date(currentAttendanceDateRange.startDate);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(currentAttendanceDateRange.endDate);
        endDate.setHours(23, 59, 59, 999);

        const [employeesResponse, attendanceResponse, todayStatsResponse] = await Promise.all([
            apiRequest('/api/employees'),
            apiRequest(`/api/attendance?start_date=${encodeURIComponent(startDate.toISOString().split('T')[0])}&end_date=${encodeURIComponent(endDate.toISOString().split('T')[0] + 'T23:59:59')}&limit=10000`),
            apiRequest('/api/attendance/today-stats') // Get work schedules from today-stats
        ]);

        let allEmployees = [];
        if (employeesResponse) {
            const employeesData = await employeesResponse.json();
            if (employeesData.success && employeesData.employees) {
                allEmployees = employeesData.employees;
            }
        }

        let attendanceLogs = [];
        if (attendanceResponse) {
            const attendanceData = await attendanceResponse.json();
            if (attendanceData.success && attendanceData.attendance) {
                attendanceLogs = attendanceData.attendance;
            }
        }

        // Get work schedules from today-stats response
        // Include both has_schedule true and false to know who should work today
        let workSchedulesMap = new Map();
        if (todayStatsResponse) {
            const todayStatsData = await todayStatsResponse.json();
            if (todayStatsData.success && todayStatsData.work_schedules) {
                todayStatsData.work_schedules.forEach(schedule => {
                    if (schedule.employee_id) {
                        workSchedulesMap.set(schedule.employee_id, {
                            start_time: schedule.start_time,
                            end_time: schedule.end_time,
                            has_schedule: schedule.has_schedule !== false // Default to true if not explicitly false
                        });
                    }
                });
            }
        }

        console.log('Processing attendance data, employees:', allEmployees.length, 'logs:', attendanceLogs.length);
        const statsData = processAttendanceDataWithAllEmployees(attendanceLogs, allEmployees, workSchedulesMap);
        console.log('Processed stats data:', statsData);
        currentStatsData = statsData;
        displayTodayStats(statsData);
        displayAttendanceList(statsData, 'all');

        if (loadingMessage) loadingMessage.style.display = 'none';
    } catch (error) {
        if (loadingMessage) loadingMessage.style.display = 'none';
        console.error('Load attendance error:', error);
        if (emptyMessage) {
            emptyMessage.style.display = 'block';
            emptyMessage.textContent = 'Ma\'lumotlarni yuklashda xatolik yuz berdi';
        }
    }
}

function processAttendanceData(attendance) {
    const employeesMap = new Map();
    const datesSet = new Set();

    attendance.forEach(log => {
        const logDate = new Date(log.event_time);
        const dateStr = logDate.toISOString().split('T')[0];
        datesSet.add(dateStr);

        const empId = log.employee_id || log.employee_name;
        const empKey = empId || 'unknown';

        if (!employeesMap.has(empKey)) {
            employeesMap.set(empKey, {
                id: log.employee_id,
                full_name: log.employee_name || 'Noma\'lum',
                position: log.employee_position || '',
                events: []
            });
        }

        employeesMap.get(empKey).events.push(log);
    });

    const cameEmployees = [];
    const didNotComeEmployees = [];
    const lateEmployees = [];

    employeesMap.forEach((emp, empKey) => {
        const entryEvents = emp.events.filter(e => {
            const eventTime = new Date(e.event_time);
            return eventTime.getHours() < 14;
        }).sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

        const exitEvents = emp.events.filter(e => {
            const eventTime = new Date(e.event_time);
            return eventTime.getHours() >= 14;
        }).sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

        if (entryEvents.length > 0) {
            const firstEntry = entryEvents[0];
            const lastExit = exitEvents.length > 0 ? exitEvents[exitEvents.length - 1] : null;

            cameEmployees.push({
                ...emp,
                entry_time: firstEntry.event_time,
                exit_time: lastExit ? lastExit.event_time : null
            });
        } else {
            didNotComeEmployees.push(emp);
        }
    });

    return {
        success: true,
        total_employees: employeesMap.size,
        came: cameEmployees.length,
        did_not_come: didNotComeEmployees.length,
        late: 0,
        came_employees: cameEmployees,
        did_not_come_employees: didNotComeEmployees,
        late_employees: lateEmployees
    };
}

function processAttendanceDataWithAllEmployees(attendance, allEmployees, workSchedulesMap = new Map()) {
    // Create a map of attendance logs by employee
    const attendanceMap = new Map();

    attendance.forEach(log => {
        const empId = log.employee_id;
        const empName = log.employee_name;
        const key = empId || empName || 'unknown';

        if (!attendanceMap.has(key)) {
            attendanceMap.set(key, []);
        }
        attendanceMap.get(key).push(log);
    });

    const cameEmployees = [];
    const didNotComeEmployees = [];
    const lateEmployees = [];

    // Process all employees, including those with no attendance records
    // But only include employees who should work today (has_schedule !== false)
    allEmployees.forEach(emp => {
        const empKey = emp.id;
        const logs = attendanceMap.get(empKey) || attendanceMap.get(emp.full_name) || [];
        const schedule = workSchedulesMap.get(emp.id);

        // Skip employees who should not work today
        // If schedule exists and has_schedule is false, they don't work today
        if (schedule && schedule.has_schedule === false) {
            return; // Skip this employee
        }

        if (logs.length === 0) {
            // Employee has no attendance records
            // Only include if they should work today (have schedule)
            if (!schedule || schedule.has_schedule !== false) {
                didNotComeEmployees.push({
                    id: emp.id,
                    full_name: emp.full_name,
                    position: emp.position || '',
                    entry_time: null,
                    exit_time: null,
                    expected_start: schedule ? schedule.start_time : null,
                    expected_end: schedule ? schedule.end_time : null,
                    has_schedule: schedule ? schedule.has_schedule : undefined
                });
            }
            return;
        }

        // Process logs for this employee
        const entryEvents = logs.filter(e => {
            if (!e.event_time) return false;
            const eventTime = new Date(e.event_time);
            if (isNaN(eventTime.getTime())) return false;
            return eventTime.getHours() < 14;
        }).sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

        const exitEvents = logs.filter(e => {
            if (!e.event_time) return false;
            const eventTime = new Date(e.event_time);
            if (isNaN(eventTime.getTime())) return false;
            return eventTime.getHours() >= 14;
        }).sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

        if (entryEvents.length > 0) {
            const firstEntry = entryEvents[0];
            const lastExit = exitEvents.length > 0 ? exitEvents[exitEvents.length - 1] : null;

            // Check if late
            let isLate = false;
            if (schedule && schedule.start_time && firstEntry.event_time) {
                const entryTime = new Date(firstEntry.event_time);
                const scheduleStart = new Date(`2000-01-01T${schedule.start_time}`);
                const entryTimeOnly = new Date(`2000-01-01T${entryTime.toTimeString().substring(0, 5)}`);
                if (entryTimeOnly > scheduleStart) {
                    isLate = true;
                }
            }

            const employeeData = {
                id: emp.id,
                full_name: emp.full_name,
                position: emp.position || '',
                entry_time: firstEntry.event_time,
                exit_time: lastExit ? lastExit.event_time : null,
                expected_start: schedule ? schedule.start_time : null,
                expected_end: schedule ? schedule.end_time : null,
                is_late: isLate,
                has_schedule: schedule ? schedule.has_schedule : undefined,
                events: logs // Store all events for verification mode display
            };

            cameEmployees.push(employeeData);
            if (isLate) {
                lateEmployees.push(employeeData);
            }
        } else {
            // Employee has logs but no entry events - didn't come
            // Only include if they should work today
            if (!schedule || schedule.has_schedule !== false) {
                didNotComeEmployees.push({
                    id: emp.id,
                    full_name: emp.full_name,
                    position: emp.position || '',
                    entry_time: null,
                    exit_time: null,
                    expected_start: schedule ? schedule.start_time : null,
                    expected_end: schedule ? schedule.end_time : null,
                    has_schedule: schedule ? schedule.has_schedule : undefined
                });
            }
        }
    });

    return {
        success: true,
        total_employees: allEmployees.length,
        came: cameEmployees.length,
        did_not_come: didNotComeEmployees.length,
        late: lateEmployees.length,
        came_employees: cameEmployees,
        did_not_come_employees: didNotComeEmployees,
        late_employees: lateEmployees
    };
}


function displayTodayStats(stats) {
    const statsContainer = document.getElementById('todayStatsContainer');
    if (!statsContainer) return;

    const exitedCount = (stats.came_employees || []).filter(emp => emp.exit_time).length;

    currentStatsData = stats;

    // Total Stat Card - Modern Compact
    const totalDiv = document.createElement('div');
    totalDiv.style.cssText = 'background: #f9fafb; padding: 10px 8px; border-radius: 10px; border: 1px solid #e5e7eb; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    totalDiv.onmouseover = () => { totalDiv.style.background = '#f3f4f6'; totalDiv.style.borderColor = '#d1d5db'; totalDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; totalDiv.style.transform = 'translateY(-1px)'; };
    totalDiv.onmouseout = () => { totalDiv.style.background = '#f9fafb'; totalDiv.style.borderColor = '#e5e7eb'; totalDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; totalDiv.style.transform = 'translateY(0)'; };
    totalDiv.onclick = () => { if (currentStatsData) displayAttendanceList(currentStatsData, 'all'); };
    totalDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #0f172a; line-height: 1.2; margin-bottom: 4px;">${stats.total_employees}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Jami</div>
    `;

    // Came Stat Card - Modern Compact
    const cameDiv = document.createElement('div');
    cameDiv.style.cssText = 'background: #f0fdf4; padding: 10px 8px; border-radius: 10px; border: 1px solid #bbf7d0; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    cameDiv.onmouseover = () => { cameDiv.style.background = '#dcfce7'; cameDiv.style.borderColor = '#86efac'; cameDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; cameDiv.style.transform = 'translateY(-1px)'; };
    cameDiv.onmouseout = () => { cameDiv.style.background = '#f0fdf4'; cameDiv.style.borderColor = '#bbf7d0'; cameDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; cameDiv.style.transform = 'translateY(0)'; };
    cameDiv.onclick = () => { if (currentStatsData) displayAttendanceList(currentStatsData, 'came'); };
    cameDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #10b981; line-height: 1.2; margin-bottom: 4px;">${stats.came}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Kelgan</div>
    `;

    // Not Came Stat Card - Modern Compact
    const notCameDiv = document.createElement('div');
    notCameDiv.style.cssText = 'background: #fef2f2; padding: 10px 8px; border-radius: 10px; border: 1px solid #fecaca; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    notCameDiv.onmouseover = () => { notCameDiv.style.background = '#fee2e2'; notCameDiv.style.borderColor = '#fca5a5'; notCameDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; notCameDiv.style.transform = 'translateY(-1px)'; };
    notCameDiv.onmouseout = () => { notCameDiv.style.background = '#fef2f2'; notCameDiv.style.borderColor = '#fecaca'; notCameDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; notCameDiv.style.transform = 'translateY(0)'; };
    notCameDiv.onclick = () => { if (currentStatsData) displayAttendanceList(currentStatsData, 'not_came'); };
    notCameDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #ef4444; line-height: 1.2; margin-bottom: 4px;">${stats.did_not_come}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Kelmagan</div>
    `;

    // Exited Stat Card - Modern Compact
    const exitedDiv = document.createElement('div');
    exitedDiv.style.cssText = 'background: #eff6ff; padding: 10px 8px; border-radius: 10px; border: 1px solid #bfdbfe; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    exitedDiv.onmouseover = () => { exitedDiv.style.background = '#dbeafe'; exitedDiv.style.borderColor = '#93c5fd'; exitedDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; exitedDiv.style.transform = 'translateY(-1px)'; };
    exitedDiv.onmouseout = () => { exitedDiv.style.background = '#eff6ff'; exitedDiv.style.borderColor = '#bfdbfe'; exitedDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; exitedDiv.style.transform = 'translateY(0)'; };
    exitedDiv.onclick = () => { if (currentStatsData) displayAttendanceList(currentStatsData, 'exited'); };
    exitedDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #3b82f6; line-height: 1.2; margin-bottom: 4px;">${exitedCount}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Ketgan</div>
    `;

    // Late Stat Card - Modern Compact
    const lateDiv = document.createElement('div');
    lateDiv.style.cssText = 'background: #fffbeb; padding: 10px 8px; border-radius: 10px; border: 1px solid #fde68a; cursor: pointer; transition: all 0.2s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); text-align: center;';
    lateDiv.onmouseover = () => { lateDiv.style.background = '#fef3c7'; lateDiv.style.borderColor = '#fcd34d'; lateDiv.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.06)'; lateDiv.style.transform = 'translateY(-1px)'; };
    lateDiv.onmouseout = () => { lateDiv.style.background = '#fffbeb'; lateDiv.style.borderColor = '#fde68a'; lateDiv.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.03)'; lateDiv.style.transform = 'translateY(0)'; };
    lateDiv.onclick = () => { if (currentStatsData) displayAttendanceList(currentStatsData, 'late'); };
    lateDiv.innerHTML = `
        <div style="font-size: 15px; font-weight: 700; color: #f59e0b; line-height: 1.2; margin-bottom: 4px;">${stats.late}</div>
        <div style="font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Kech qolgan</div>
    `;

    statsContainer.innerHTML = '';
    statsContainer.appendChild(totalDiv);
    statsContainer.appendChild(cameDiv);
    statsContainer.appendChild(notCameDiv);
    statsContainer.appendChild(exitedDiv);
    statsContainer.appendChild(lateDiv);
}


function displayAttendanceList(stats, filterType = 'all') {
    const attendanceList = document.getElementById('attendanceList');
    const emptyMessage = document.getElementById('emptyAttendanceMessage');

    if (!attendanceList) {
        console.error('attendanceList element not found');
        return;
    }

    console.log('Displaying attendance list, filterType:', filterType);
    console.log('Stats object keys:', Object.keys(stats || {}));
    console.log('Stats came_employees:', stats?.came_employees?.length || 0);
    console.log('Stats did_not_come_employees:', stats?.did_not_come_employees?.length || 0);
    console.log('Stats late_employees:', stats?.late_employees?.length || 0);
    console.log('Full stats object:', stats);

    let employeesToShow = [];

    switch (filterType) {
        case 'came':
            employeesToShow = stats?.came_employees || [];
            break;
        case 'not_came':
            employeesToShow = stats?.did_not_come_employees || [];
            break;
        case 'late':
            employeesToShow = stats?.late_employees || [];
            break;
        case 'exited':
            employeesToShow = (stats?.came_employees || []).filter(emp => emp.exit_time);
            break;
        default:
            employeesToShow = [
                ...(stats?.came_employees || []),
                ...(stats?.did_not_come_employees || [])
            ];
    }

    // Filter out employees who should not work today
    // Only show employees who have a work schedule (expected_start) or who actually came
    employeesToShow = employeesToShow.filter(emp => {
        // If employee has entry_time, they came - always show them
        if (emp.entry_time) {
            return true;
        }

        // Check if employee has work schedule (should work today)
        // If has_schedule exists and is false, they don't work today - filter them out
        if (emp.has_schedule === false) {
            return false;
        }

        // If expected_start exists, they have a schedule - show them
        if (emp.expected_start) {
            return true;
        }

        // Check work_schedules array in stats if available
        if (stats?.work_schedules && Array.isArray(stats.work_schedules)) {
            const empId = emp.id || emp.employee_id;
            const schedule = stats.work_schedules.find(s => s.employee_id === empId);
            if (schedule) {
                // If has_schedule is explicitly false, filter them out
                return schedule.has_schedule !== false;
            }
        }

        // If no schedule info and no attendance, filter them out (likely don't work today)
        return false;
    });

    console.log('Employees to show (after filtering):', employeesToShow.length);
    console.log('First 3 employees:', employeesToShow.slice(0, 3));

    if (employeesToShow.length === 0) {
        if (emptyMessage) {
            emptyMessage.style.display = 'block';
            emptyMessage.textContent = 'Keldi-ketdi yozuvlari topilmadi';
        }
        attendanceList.style.display = 'none';
        return;
    }

    if (emptyMessage) emptyMessage.style.display = 'none';

    // Clear and show attendance list
    attendanceList.innerHTML = '';
    attendanceList.style.display = 'grid';
    attendanceList.style.visibility = 'visible';
    attendanceList.style.opacity = '1';

    console.log('Creating items for', employeesToShow.length, 'employees');

    employeesToShow.forEach((emp, index) => {
        try {
            console.log(`Processing employee ${index + 1}:`, {
                id: emp.id || emp.employee_id,
                name: emp.full_name || emp.employee_name || emp.username,
                hasEntry: !!emp.entry_time,
                hasExit: !!emp.exit_time
            });

            const item = createAttendanceEmployeeItem(emp, stats);
            if (item) {
                attendanceList.appendChild(item);
                const empName = emp.full_name || emp.employee_name || emp.username || 'Noma\'lum';
                console.log(`Item ${index + 1} created and appended for employee:`, empName);
            } else {
                console.error('createAttendanceEmployeeItem returned null for employee:', emp);
            }
        } catch (error) {
            console.error('Error creating item for employee:', emp, error);
            console.error('Error stack:', error.stack);
        }
    });

    const finalCount = attendanceList.children.length;
    console.log('Attendance list displayed, expected:', employeesToShow.length, 'actual DOM children:', finalCount);

    if (finalCount === 0 && employeesToShow.length > 0) {
        console.error('WARNING: No items were added to DOM despite having employees to show!');
        console.error('Check browser console for errors above');
    }
}


function createAttendanceEmployeeItem(emp, stats) {
    if (!emp) {
        console.error('Invalid employee data: emp is null or undefined');
        return null;
    }

    // Handle both id and employee_id
    const empId = emp.id || emp.employee_id;
    if (!empId) {
        console.error('Invalid employee data: no id or employee_id', emp);
        return null;
    }

    const item = document.createElement('div');
    item.style.cssText = 'padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; display: flex; align-items: center; justify-content: space-between;';

    const entryTime = emp.entry_time ? new Date(emp.entry_time) : null;
    const exitTime = emp.exit_time ? new Date(emp.exit_time) : null;
    const expectedStart = emp.expected_start ? (typeof emp.expected_start === 'string' ? emp.expected_start.substring(0, 5) : emp.expected_start) : null;
    const expectedEnd = emp.expected_end ? (typeof emp.expected_end === 'string' ? emp.expected_end.substring(0, 5) : emp.expected_end) : null;

    // Get verification modes from events
    let entryVerificationMode = null;
    let exitVerificationMode = null;
    if (emp.events && Array.isArray(emp.events)) {
        const entryEvents = emp.events.filter(e => {
            const eventTime = new Date(e.event_time);
            return eventTime.getHours() < 14;
        }).sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

        const exitEvents = emp.events.filter(e => {
            const eventTime = new Date(e.event_time);
            return eventTime.getHours() >= 14;
        }).sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

        if (entryEvents.length > 0 && entryEvents[0].verification_mode) {
            entryVerificationMode = entryEvents[0].verification_mode;
        }
        if (exitEvents.length > 0 && exitEvents[exitEvents.length - 1].verification_mode) {
            exitVerificationMode = exitEvents[exitEvents.length - 1].verification_mode;
        }
    }

    // Get employee name - handle both full_name and employee_name
    const empName = emp.full_name || emp.employee_name || emp.username || 'Noma\'lum';
    const empPosition = emp.position || '';

    let statusDot = '';
    if (!entryTime) {
        statusDot = '<div style="width: 6px; height: 6px; border-radius: 50%; background: #ef4444; margin-right: 8px; flex-shrink: 0;"></div>';
    } else if (emp.is_late) {
        statusDot = '<div style="width: 6px; height: 6px; border-radius: 50%; background: #f59e0b; margin-right: 8px; flex-shrink: 0;"></div>';
    } else {
        statusDot = '<div style="width: 6px; height: 6px; border-radius: 50%; background: #10b981; margin-right: 8px; flex-shrink: 0;"></div>';
    }

    const entryTimeStr = entryTime ? entryTime.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : null;
    const exitTimeStr = exitTime ? exitTime.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : null;

    // Helper function to calculate time difference in minutes
    function getTimeDifference(actualTime, expectedTime) {
        if (!actualTime || !expectedTime) return null;

        try {
            const actual = actualTime.split(':').map(Number);
            const expected = expectedTime.split(':').map(Number);
            if (actual.length < 2 || expected.length < 2) return null;
            const actualMinutes = actual[0] * 60 + actual[1];
            const expectedMinutes = expected[0] * 60 + expected[1];
            return actualMinutes - expectedMinutes;
        } catch (error) {
            console.error('Error calculating time difference:', error);
            return null;
        }
    }

    // Format entry time with color and difference
    let entryTimeHtml = '';
    if (entryTimeStr) {
        const entryDiff = expectedStart ? getTimeDifference(entryTimeStr, expectedStart) : null;
        let entryColor = '#10b981'; // green - on time
        let entryDiffText = '';

        if (entryDiff !== null) {
            if (entryDiff > 0) {
                entryColor = '#f59e0b'; // orange - late
                entryDiffText = ` <span style="color: ${entryColor};">[+${entryDiff}]</span>`;
            } else if (entryDiff < 0) {
                entryColor = '#10b981'; // green - early
                entryDiffText = ` <span style="color: ${entryColor};">[${entryDiff}]</span>`;
            }
        }

        entryTimeHtml = `
            <div style="font-size: 12px; font-weight: 600; color: ${entryColor};">
                ${entryTimeStr}${entryDiffText}
            </div>
        `;
    } else {
        entryTimeHtml = '<div style="font-size: 12px; color: #94a3b8;">—</div>';
    }

    // Format exit time with color and difference
    let exitTimeHtml = '';
    if (exitTimeStr) {
        const exitDiff = expectedEnd ? getTimeDifference(exitTimeStr, expectedEnd) : null;
        let exitColor = '#10b981'; // green - on time
        let exitDiffText = '';

        if (exitDiff !== null) {
            if (exitDiff > 0) {
                exitColor = '#f59e0b'; // orange - late exit
                exitDiffText = ` <span style="color: ${exitColor};">[+${exitDiff}]</span>`;
            } else if (exitDiff < 0) {
                exitColor = '#ef4444'; // red - early exit
                exitDiffText = ` <span style="color: ${exitColor};">[${exitDiff}]</span>`;
            }
        }

        exitTimeHtml = `
            <div style="font-size: 12px; font-weight: 600; color: ${exitColor};">
                ${exitTimeStr}${exitDiffText}
            </div>
        `;
    } else {
        exitTimeHtml = '<div style="font-size: 12px; color: #94a3b8;">—</div>';
    }

    // Format schedule (Reja)
    let scheduleHtml = '';
    if (expectedStart && expectedEnd) {
        scheduleHtml = `<div style="font-size: 12px; font-weight: 600; color: #64748b;">${expectedStart}-${expectedEnd}</div>`;
    } else if (expectedStart) {
        scheduleHtml = `<div style="font-size: 12px; font-weight: 600; color: #64748b;">${expectedStart}</div>`;
    } else {
        scheduleHtml = '<div style="font-size: 12px; color: #94a3b8;">—</div>';
    }

    // Face image HTML
    let faceImageHtml = '';
    if (emp.picture_url) {
        // Handle different URL formats:
        // 1. Local path: /uploads/faces/filename.jpg
        // 2. Full URL: http://192.168.1.10/LOCALS/pic/...@WEB...
        let imageUrl = emp.picture_url;

        if (imageUrl.startsWith('/')) {
            // Local path - use as is
            imageUrl = imageUrl;
        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            // Full URL - try to extract path or use proxy endpoint
            // For now, we'll create a proxy endpoint or use the URL directly
            // But better to download it first using the download-images endpoint
            imageUrl = `/api/attendance/image-proxy?url=${encodeURIComponent(imageUrl)}`;
        } else {
            // Relative path
            imageUrl = `/uploads/faces/${emp.picture_url}`;
        }

        faceImageHtml = `
        <div style="width: 40px; height: 40px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; flex-shrink: 0; background: #f8fafc; display: flex; align-items: center; justify-content: center; cursor: pointer;" onclick="if(event.stopPropagation) event.stopPropagation(); showImageModal('${imageUrl}')">
          <img src="${imageUrl}" 
               alt="Face ID" 
               style="width: 100%; height: 100%; object-fit: cover;"
               onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'color: #94a3b8; font-size: 18px;\\'>👤</div>';">
        </div>
      `;
    } else {
        faceImageHtml = `
        <div style="width: 40px; height: 40px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; flex-shrink: 0; background: #f8fafc; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 18px;">
          👤
        </div>
      `;
    }

    item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; flex: 1; cursor: pointer;" onclick="showEmployeeAttendanceDetails(${empId}, '${escapeHtml(empName)}')">
            ${faceImageHtml}
            ${statusDot}
            <div style="flex: 1;">
                <div style="font-weight: 600; color: #0f172a; font-size: 13px; margin-bottom: 2px;">${escapeHtml(empName)}</div>
                <div style="font-size: 10px; color: #64748b; font-weight: 500;">${escapeHtml(empPosition)}</div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; align-items: flex-start; min-width: 260px;">
                <div>
                    <div style="font-size: 9px; color: #64748b; margin-bottom: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Reja</div>
                    ${scheduleHtml}
                </div>
                <div>
                    <div style="font-size: 9px; color: #64748b; margin-bottom: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Keldi</div>
                    ${entryTimeHtml}
                    ${(() => {
            if (entryVerificationMode) {
                const vmInfo = getVerificationModeInfo(entryVerificationMode);
                return `<div style="margin-top: 3px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 5px; background: ${vmInfo.bgColor}; color: ${vmInfo.color}; border-radius: 6px; font-size: 9px; font-weight: 600;">
                                <span>${vmInfo.icon}</span>
                                <span>${vmInfo.label}</span>
                            </div>`;
            }
            return '';
        })()}
                </div>
                <div>
                    <div style="font-size: 9px; color: #64748b; margin-bottom: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Ketdi</div>
                    ${exitTimeHtml}
                    ${(() => {
            if (exitVerificationMode) {
                const vmInfo = getVerificationModeInfo(exitVerificationMode);
                return `<div style="margin-top: 3px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 5px; background: ${vmInfo.bgColor}; color: ${vmInfo.color}; border-radius: 6px; font-size: 9px; font-weight: 600;">
                                <span>${vmInfo.icon}</span>
                                <span>${vmInfo.label}</span>
                            </div>`;
            }
            return '';
        })()}
                </div>
            </div>
        </div>
        <div style="display: flex; gap: 4px; margin-left: 12px; flex-shrink: 0;">
            <button class="btn-secondary" onclick="markEmployeeAttendance(${empId}, '${escapeHtml(empName)}')" style="padding: 6px 10px; font-size: 11px; border-radius: 6px; background: #10b981; color: white; border: none; font-weight: 600; white-space: nowrap;">
                Keldi-Ketdi
            </button>
        </div>
    `;

    return item;
}

async function downloadAttendanceList() {
    try {
        let startDateStr, endDateStr;

        if (currentAttendanceDateRange.startDate && currentAttendanceDateRange.endDate) {
            startDateStr = currentAttendanceDateRange.startDate;
            endDateStr = currentAttendanceDateRange.endDate;
        } else {
            const today = new Date();
            startDateStr = today.toISOString().split('T')[0];
            endDateStr = startDateStr;
        }

        const response = await apiRequest(`/api/attendance?start_date=${startDateStr}&end_date=${endDateStr}&limit=10000`);
        if (!response) return;

        const data = await response.json();
        if (!data.success || !data.attendance || data.attendance.length === 0) {
            alert('Tanlangan davrda keldi-ketdi yozuvlari topilmadi!');
            return;
        }

        const attendance = data.attendance;
        const employeesMap = new Map();

        attendance.forEach(log => {
            const empId = log.employee_id || log.employee_name;
            if (!employeesMap.has(empId)) {
                employeesMap.set(empId, {
                    id: log.employee_id,
                    name: log.employee_name || 'Noma\'lum',
                    position: log.employee_position || '',
                    events: []
                });
            }
            employeesMap.get(empId).events.push(log);
        });

        let htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        table {
            border-collapse: collapse;
            width: 100%;
            font-family: Arial, sans-serif;
            font-size: 12px;
        }
        th {
            background-color: #667eea;
            color: white;
            font-weight: bold;
            text-align: center;
            padding: 12px 8px;
            border: 1px solid #5568d3;
        }
        td {
            padding: 10px 8px;
            border: 1px solid #e5e7eb;
            text-align: left;
        }
        tr:nth-child(even) {
            background-color: #f9fafb;
        }
        tr:hover {
            background-color: #f3f4f6;
        }
        .number-cell {
            text-align: center;
            font-weight: 600;
            color: #6b7280;
        }
        .name-cell {
            font-weight: 600;
            color: #111827;
        }
        .position-cell {
            color: #374151;
        }
        .date-cell {
            text-align: center;
            color: #6b7280;
        }
        .time-cell {
            text-align: center;
            color: #6b7280;
        }
        .terminal-cell {
            color: #374151;
        }
    </style>
</head>
<body>
    <table>
        <thead>
            <tr>
                <th style="width: 50px;">№</th>
                <th style="width: 250px;">Hodim</th>
                <th style="width: 150px;">Lavozim</th>
                <th style="width: 120px;">Sana</th>
                <th style="width: 100px;">Vaqt</th>
                <th style="width: 150px;">Terminal</th>
                <th style="width: 120px;">Tasdiqlash</th>
            </tr>
        </thead>
        <tbody>
`;

        let rowNumber = 1;
        employeesMap.forEach((emp, empId) => {
            emp.events.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

            emp.events.forEach(event => {
                const eventDate = new Date(event.event_time);
                const dateStr = eventDate.toLocaleDateString('uz-UZ', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });
                const timeStr = eventDate.toLocaleTimeString('uz-UZ', {
                    hour: '2-digit',
                    minute: '2-digit'
                });

                const name = escapeHtml(emp.name);
                const position = escapeHtml(emp.position);
                const terminal = escapeHtml(event.terminal_name || '');
                const verification = escapeHtml(event.verification_mode || '');

                htmlContent += `
            <tr>
                <td class="number-cell">${rowNumber++}</td>
                <td class="name-cell">${name}</td>
                <td class="position-cell">${position}</td>
                <td class="date-cell">${dateStr}</td>
                <td class="time-cell">${timeStr}</td>
                <td class="terminal-cell">${terminal}</td>
                <td class="terminal-cell">${verification}</td>
            </tr>`;
            });
        });

        htmlContent += `
        </tbody>
    </table>
</body>
</html>`;

        const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        const fileName = `keldi_ketdi_${startDateStr}_${endDateStr}.xls`;
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('Download attendance error:', error);
        alert('Yuklab olishda xatolik yuz berdi!');
    }
}

// Attendance Calendar State
let calendarCurrentMonth = new Date().getMonth();
let calendarCurrentYear = new Date().getFullYear();
let selectedStartDate = null;
let selectedEndDate = null;
let isSelectingStartDate = true;

function toggleAttendanceCalendar() {
    const calendarWidget = document.getElementById('attendanceCalendarWidget');
    if (!calendarWidget) return;

    if (calendarWidget.style.display === 'none' || !calendarWidget.style.display) {
        showAttendanceCalendar();
    } else {
        hideAttendanceCalendar();
    }
}

function showAttendanceCalendar() {
    const calendarWidget = document.getElementById('attendanceCalendarWidget');
    if (!calendarWidget) return;

    // Initialize calendar state from current date range
    if (currentAttendanceDateRange && currentAttendanceDateRange.startDate && currentAttendanceDateRange.endDate) {
        selectedStartDate = new Date(currentAttendanceDateRange.startDate);
        selectedEndDate = new Date(currentAttendanceDateRange.endDate);
        calendarCurrentMonth = selectedStartDate.getMonth();
        calendarCurrentYear = selectedStartDate.getFullYear();
        isSelectingStartDate = false;
    } else {
        selectedStartDate = null;
        selectedEndDate = null;
        isSelectingStartDate = true;
        const today = new Date();
        calendarCurrentMonth = today.getMonth();
        calendarCurrentYear = today.getFullYear();
    }

    renderAttendanceCalendar();
    calendarWidget.style.display = 'block';
}

function hideAttendanceCalendar() {
    const calendarWidget = document.getElementById('attendanceCalendarWidget');
    if (calendarWidget) {
        calendarWidget.style.display = 'none';
    }
}

function renderAttendanceCalendar() {
    const calendarWidget = document.getElementById('attendanceCalendarWidget');
    if (!calendarWidget) return;

    // Prevent calendar clicks from closing the widget
    calendarWidget.onclick = function (e) {
        e.stopPropagation();
    };

    const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
        'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
    const weekDays = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

    // Calculate month calendar data
    const firstDay = new Date(calendarCurrentYear, calendarCurrentMonth, 1);
    const lastDay = new Date(calendarCurrentYear, calendarCurrentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay() === 0 ? 7 : firstDay.getDay();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build calendar HTML
    let html = '<div style="margin-bottom: 12px;">';

    // Header with month/year and navigation
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">';
    html += `<div style="display: flex; align-items: center; gap: 8px;">`;
    html += `<span style="font-size: 16px; font-weight: 600; color: #111827;">${monthNames[calendarCurrentMonth]} ${calendarCurrentYear}</span>`;
    html += '</div>';
    html += '<div style="display: flex; gap: 4px;">';
    html += '<button id="calendarPrevMonth" style="background: none; border: none; cursor: pointer; padding: 4px; color: #6b7280;">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    html += '</button>';
    html += '<button id="calendarNextMonth" style="background: none; border: none; cursor: pointer; padding: 4px; color: #6b7280;">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    html += '</button>';
    html += '</div>';
    html += '</div>';

    // Weekday headers
    html += '<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 8px;">';
    weekDays.forEach(day => {
        html += `<div style="text-align: center; font-size: 12px; font-weight: 500; color: #6b7280; padding: 8px;">${day}</div>`;
    });
    html += '</div>';

    // Calendar days grid
    html += '<div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;">';

    // Empty cells before month starts
    for (let i = 1; i < startingDayOfWeek; i++) {
        html += '<div style="padding: 8px; min-height: 36px;"></div>';
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(calendarCurrentYear, calendarCurrentMonth, day);
        cellDate.setHours(0, 0, 0, 0);
        const dateStr = cellDate.toISOString().split('T')[0];

        let cellStyle = 'padding: 8px; min-height: 36px; text-align: center; cursor: pointer; border-radius: 4px; font-size: 14px; font-weight: 500; transition: all 0.2s; display: flex; align-items: center; justify-content: center;';

        const isStartDate = selectedStartDate && cellDate.getTime() === selectedStartDate.getTime();
        const isEndDate = selectedEndDate && cellDate.getTime() === selectedEndDate.getTime();
        const isInRange = selectedStartDate && selectedEndDate &&
            cellDate.getTime() > selectedStartDate.getTime() &&
            cellDate.getTime() < selectedEndDate.getTime();
        const isToday = cellDate.getTime() === today.getTime();

        if (isStartDate || isEndDate) {
            cellStyle += ' background: #3b82f6; color: white;';
        } else if (isInRange) {
            cellStyle += ' background: #dbeafe; color: #1e40af;';
        } else if (isToday) {
            cellStyle += ' background: #f3f4f6; color: #111827; border: 1px solid #3b82f6;';
        } else {
            cellStyle += ' background: white; color: #374151;';
        }

        html += `<div class="calendar-day" data-date="${dateStr}" style="${cellStyle}">${day}</div>`;
    }

    // Fill remaining cells for grid alignment
    const totalCells = startingDayOfWeek - 1 + daysInMonth;
    const remainingCells = 42 - totalCells;
    for (let i = 0; i < remainingCells && i < 7; i++) {
        html += '<div style="padding: 8px; min-height: 36px; text-align: center; color: #d1d5db; font-size: 14px;"></div>';
    }

    html += '</div>';
    html += '</div>';

    // Footer buttons
    html += '<div style="display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid #e5e7eb; margin-top: 12px;">';
    html += '<button id="calendarClearBtn" style="background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 14px; padding: 4px 8px;">Tozalash</button>';
    html += '<button id="calendarTodayBtn" style="background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 14px; padding: 4px 8px;">Bugun</button>';
    html += '<button id="calendarApplyBtn" style="background: #3b82f6; border: none; color: white; cursor: pointer; font-size: 14px; padding: 6px 12px; border-radius: 4px;">Qo\'llash</button>';
    html += '</div>';

    calendarWidget.innerHTML = html;

    // Attach event listeners
    attachCalendarEventListeners();
}

function attachCalendarEventListeners() {
    // Day cell clicks
    setTimeout(function () {
        const dayCells = document.querySelectorAll('.calendar-day');
        dayCells.forEach(function (cell) {
            const dateStr = cell.getAttribute('data-date');
            if (!dateStr) return;

            const cellDate = new Date(dateStr);
            cellDate.setHours(0, 0, 0, 0);

            cell.addEventListener('click', function (e) {
                e.stopPropagation();
                selectCalendarDate(new Date(cellDate));
            });

            cell.addEventListener('mouseenter', function () {
                const isSelected = (selectedStartDate && cellDate.getTime() === selectedStartDate.getTime()) ||
                    (selectedEndDate && cellDate.getTime() === selectedEndDate.getTime());
                const isInRange = selectedStartDate && selectedEndDate &&
                    cellDate.getTime() > selectedStartDate.getTime() &&
                    cellDate.getTime() < selectedEndDate.getTime();
                if (!isSelected && !isInRange) {
                    this.style.background = '#f3f4f6';
                }
            });

            cell.addEventListener('mouseleave', function () {
                const isSelected = (selectedStartDate && cellDate.getTime() === selectedStartDate.getTime()) ||
                    (selectedEndDate && cellDate.getTime() === selectedEndDate.getTime());
                const isInRange = selectedStartDate && selectedEndDate &&
                    cellDate.getTime() > selectedStartDate.getTime() &&
                    cellDate.getTime() < selectedEndDate.getTime();
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const isToday = cellDate.getTime() === today.getTime();

                if (isSelected) {
                    this.style.background = '#3b82f6';
                } else if (isInRange) {
                    this.style.background = '#dbeafe';
                } else if (isToday) {
                    this.style.background = '#f3f4f6';
                } else {
                    this.style.background = 'white';
                }
            });
        });
    }, 0);

    // Previous month button
    const prevBtn = document.getElementById('calendarPrevMonth');
    if (prevBtn) {
        prevBtn.onclick = function (e) {
            e.stopPropagation();
            calendarCurrentMonth--;
            if (calendarCurrentMonth < 0) {
                calendarCurrentMonth = 11;
                calendarCurrentYear--;
            }
            renderAttendanceCalendar();
        };
    }

    // Next month button
    const nextBtn = document.getElementById('calendarNextMonth');
    if (nextBtn) {
        nextBtn.onclick = function (e) {
            e.stopPropagation();
            calendarCurrentMonth++;
            if (calendarCurrentMonth > 11) {
                calendarCurrentMonth = 0;
                calendarCurrentYear++;
            }
            renderAttendanceCalendar();
        };
    }

    // Clear button
    const clearBtn = document.getElementById('calendarClearBtn');
    if (clearBtn) {
        clearBtn.onclick = function (e) {
            e.stopPropagation();
            selectedStartDate = null;
            selectedEndDate = null;
            isSelectingStartDate = true;
            if (currentAttendanceDateRange) {
                currentAttendanceDateRange.startDate = null;
                currentAttendanceDateRange.endDate = null;
            }
            renderAttendanceCalendar();
            loadAttendance();
            hideAttendanceCalendar();
        };
    }

    // Today button
    const todayBtn = document.getElementById('calendarTodayBtn');
    if (todayBtn) {
        todayBtn.onclick = function (e) {
            e.stopPropagation();
            const today = new Date();
            calendarCurrentMonth = today.getMonth();
            calendarCurrentYear = today.getFullYear();
            renderAttendanceCalendar();
        };
    }

    // Apply button
    const applyBtn = document.getElementById('calendarApplyBtn');
    if (applyBtn) {
        applyBtn.onclick = function (e) {
            e.stopPropagation();
            if (selectedStartDate && selectedEndDate) {
                const startDateStr = selectedStartDate.toISOString().split('T')[0];
                const endDateStr = selectedEndDate.toISOString().split('T')[0];

                if (currentAttendanceDateRange) {
                    currentAttendanceDateRange.startDate = startDateStr;
                    currentAttendanceDateRange.endDate = endDateStr;
                }

                hideAttendanceCalendar();
                loadAttendance();
            }
        };
    }
}

function selectCalendarDate(date) {
    if (!date) return;

    date.setHours(0, 0, 0, 0);

    // If selecting start date or no start date selected
    if (isSelectingStartDate || !selectedStartDate) {
        selectedStartDate = new Date(date);
        selectedEndDate = null;
        isSelectingStartDate = false;
        renderAttendanceCalendar();
    }
    // If selecting end date
    else {
        // If clicked date is before start date, swap them
        if (date.getTime() < selectedStartDate.getTime()) {
            selectedEndDate = new Date(selectedStartDate);
            selectedStartDate = new Date(date);
        }
        // If same date clicked, reset selection
        else if (date.getTime() === selectedStartDate.getTime()) {
            selectedStartDate = null;
            selectedEndDate = null;
            isSelectingStartDate = true;
            renderAttendanceCalendar();
            return;
        }
        // Normal end date selection
        else {
            selectedEndDate = new Date(date);
        }

        renderAttendanceCalendar();
    }
}


let currentEmployeeDetailsFilter = 'today';
let currentEmployeeDetailsId = null;
let currentEmployeeDetailsName = null;

async function showEmployeeAttendanceDetails(employeeId, employeeName) {
    const modal = document.getElementById('employeeAttendanceDetailsModal');
    const title = document.getElementById('employeeAttendanceDetailsTitle');
    const dateDiv = document.getElementById('employeeAttendanceDetailsDate');

    if (!modal) return;

    currentEmployeeDetailsId = employeeId;
    currentEmployeeDetailsName = employeeName;
    currentEmployeeDetailsFilter = 'today';

    modal.style.display = 'flex';
    if (title) title.textContent = employeeName || 'Davomat Tafsilotlari';

    // Setup filter buttons
    const filterTodayBtn = document.getElementById('filterTodayBtn');
    const filterMonthlyBtn = document.getElementById('filterMonthlyBtn');
    const filterYearlyBtn = document.getElementById('filterYearlyBtn');
    const filterAllBtn = document.getElementById('filterAllBtn');

    const updateFilterButtons = () => {
        const buttons = [filterTodayBtn, filterMonthlyBtn, filterYearlyBtn, filterAllBtn];
        buttons.forEach(btn => {
            if (btn) {
                const isActive = btn.id === `filter${currentEmployeeDetailsFilter.charAt(0).toUpperCase() + currentEmployeeDetailsFilter.slice(1)}Btn`;
                btn.classList.toggle('active', isActive);
            }
        });
    };

    if (filterTodayBtn) {
        filterTodayBtn.onclick = () => {
            currentEmployeeDetailsFilter = 'today';
            updateFilterButtons();
            loadEmployeeAttendanceDetails();
        };
    }

    if (filterMonthlyBtn) {
        filterMonthlyBtn.onclick = () => {
            currentEmployeeDetailsFilter = 'monthly';
            updateFilterButtons();
            loadEmployeeAttendanceDetails();
        };
    }

    if (filterYearlyBtn) {
        filterYearlyBtn.onclick = () => {
            currentEmployeeDetailsFilter = 'yearly';
            updateFilterButtons();
            loadEmployeeAttendanceDetails();
        };
    }

    if (filterAllBtn) {
        filterAllBtn.onclick = () => {
            currentEmployeeDetailsFilter = 'all';
            updateFilterButtons();
            loadEmployeeAttendanceDetails();
        };
    }

    updateFilterButtons();

    // Close button
    const closeBtn = document.getElementById('closeEmployeeAttendanceDetailsBtn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };
    }

    modal.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };

    // Load data immediately
    await loadEmployeeAttendanceDetails();
}

async function loadEmployeeAttendanceDetails() {
    if (!currentEmployeeDetailsId) return;

    const dateDiv = document.getElementById('employeeAttendanceDetailsDate');
    const listDiv = document.getElementById('employeeAttendanceDetailsList');
    const emptyDiv = document.getElementById('emptyEmployeeAttendanceDetails');
    const loadingDiv = document.getElementById('loadingEmployeeAttendanceDetails');

    loadingDiv.style.display = 'block';
    listDiv.style.display = 'none';
    emptyDiv.style.display = 'none';
    listDiv.innerHTML = '';

    try {
        let url = '';
        let dateRangeText = '';
        const today = new Date();

        switch (currentEmployeeDetailsFilter) {
            case 'today':
                // Mahalliy vaqt zonasida bugungi sanani olish (UTC emas)
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const day = String(today.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;
                url = `/api/attendance/employee/${currentEmployeeDetailsId}/daily?date=${dateStr}`;
                dateRangeText = `Sana: ${today.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' })}`;
                break;
            case 'monthly':
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                url = `/api/attendance?employee_id=${currentEmployeeDetailsId}&start_date=${monthStart.toISOString().split('T')[0]}&end_date=${monthEnd.toISOString().split('T')[0]}&limit=10000`;
                dateRangeText = `Oy: ${today.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long' })}`;
                break;
            case 'yearly':
                const yearStart = new Date(today.getFullYear(), 0, 1);
                const yearEnd = new Date(today.getFullYear(), 11, 31);
                url = `/api/attendance?employee_id=${currentEmployeeDetailsId}&start_date=${yearStart.toISOString().split('T')[0]}&end_date=${yearEnd.toISOString().split('T')[0]}&limit=10000`;
                dateRangeText = `Yil: ${today.getFullYear()}`;
                break;
            case 'all':
                url = `/api/attendance?employee_id=${currentEmployeeDetailsId}&limit=10000`;
                dateRangeText = 'Barcha vaqt';
                break;
        }

        if (dateDiv) dateDiv.textContent = dateRangeText;

        const response = await apiRequest(url);

        if (!response) {
            loadingDiv.style.display = 'none';
            emptyDiv.style.display = 'block';
            emptyDiv.innerHTML = '<span>Ma\'lumotlarni yuklashda xatolik yuz berdi</span>';
            listDiv.style.display = 'none';
            return;
        }

        const data = await response.json();
        loadingDiv.style.display = 'none';

        let events = [];
        if (data.success) {
            if (data.events) {
                events = data.events;
            } else if (data.attendance) {
                events = data.attendance.map(att => {
                    // Determine event type based on time or event_type
                    let eventType = att.event_type;
                    if (!eventType && att.event_time) {
                        const eventTime = new Date(att.event_time);
                        eventType = eventTime.getHours() < 14 ? 'entry' : 'exit';
                    }
                    return {
                        event_time: att.event_time,
                        event_type: eventType || 'entry',
                        verification_mode: att.verification_mode,
                        terminal_name: att.terminal_name,
                        terminal_location: att.terminal_location,
                        face_match_score: att.face_match_score,
                        picture_url: att.picture_url,
                        employee_name: att.employee_name || currentEmployeeDetailsName
                    };
                });
            }
        } else {
            emptyDiv.style.display = 'block';
            emptyDiv.innerHTML = `<span>${data.message || 'Ma\'lumotlarni yuklashda xatolik yuz berdi'}</span>`;
            listDiv.style.display = 'none';
            return;
        }

        // Sort events by time (yangi yozuvlar yuqorida, eski yozuvlar pastda)
        events.sort((a, b) => new Date(b.event_time) - new Date(a.event_time));

        if (events.length > 0) {
            emptyDiv.style.display = 'none';
            listDiv.style.display = 'block';

            // Calculate statistics
            const entryEvents = events.filter(e => (e.event_type === 'entry' || !e.event_type));
            const exitEvents = events.filter(e => e.event_type === 'exit');

            let totalWorkTime = 0;
            const dailyStats = new Map();

            events.forEach(event => {
                const eventDate = new Date(event.event_time).toISOString().split('T')[0];
                if (!dailyStats.has(eventDate)) {
                    dailyStats.set(eventDate, { entries: [], exits: [] });
                }
                if (event.event_type === 'entry' || !event.event_type) {
                    dailyStats.get(eventDate).entries.push(new Date(event.event_time));
                } else if (event.event_type === 'exit') {
                    dailyStats.get(eventDate).exits.push(new Date(event.event_time));
                }
            });

            dailyStats.forEach((dayData, date) => {
                if (dayData.entries.length > 0 && dayData.exits.length > 0) {
                    const firstEntry = dayData.entries[0];
                    const lastExit = dayData.exits[dayData.exits.length - 1];
                    totalWorkTime += (lastExit.getTime() - firstEntry.getTime());
                }
            });

            const totalHours = Math.floor(totalWorkTime / (1000 * 60 * 60));
            const totalMinutes = Math.floor((totalWorkTime % (1000 * 60 * 60)) / (1000 * 60));

            // Statistics summary - Modern compact design
            let summaryHtml = `
                <div class="attendance-summary">
                    <div class="attendance-summary-item">
                        <div class="summary-label">Jami kunlar</div>
                        <div class="summary-value">${dailyStats.size}</div>
                    </div>
                    <div class="attendance-summary-item">
                        <div class="summary-label">Jami kirish</div>
                        <div class="summary-value">${entryEvents.length}</div>
                    </div>
                    <div class="attendance-summary-item">
                        <div class="summary-label">Jami chiqish</div>
                        <div class="summary-value">${exitEvents.length}</div>
                    </div>
                    <div class="attendance-summary-item">
                        <div class="summary-label">Jami ish vaqti</div>
                        <div class="summary-value">${totalHours}s ${totalMinutes}d</div>
                    </div>
                </div>
            `;

            listDiv.innerHTML = summaryHtml;

            // Group events by date
            const eventsByDate = new Map();
            events.forEach(event => {
                const eventDate = new Date(event.event_time).toISOString().split('T')[0];
                if (!eventsByDate.has(eventDate)) {
                    eventsByDate.set(eventDate, []);
                }
                eventsByDate.get(eventDate).push(event);
            });

            // Display events grouped by date
            const sortedDates = Array.from(eventsByDate.entries()).sort((a, b) => b[0].localeCompare(a[0]));

            sortedDates.forEach(([date, dayEvents], dateIndex) => {
                const dateObj = new Date(date + 'T00:00:00'); // Local timezone uchun
                const dateStr = dateObj.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' });
                const weekdayStr = dateObj.toLocaleDateString('uz-UZ', { weekday: 'long' });

                // Kun almashganini aniqlash - oldingi kun bilan solishtirish
                const isNewDay = dateIndex > 0;

                const dateGroup = document.createElement('div');
                dateGroup.className = 'attendance-date-group';
                if (isNewDay) {
                    dateGroup.style.marginTop = '24px';
                    dateGroup.style.paddingTop = '24px';
                    dateGroup.style.borderTop = '2px solid #e5e7eb';
                }

                // Sana va vaqt header - Modern compact design
                const dateHeader = document.createElement('div');
                dateHeader.className = 'attendance-date-header';

                const dateInfo = document.createElement('div');
                dateInfo.style.cssText = 'display: flex; flex-direction: column; gap: 3px; flex: 1;';

                const dateText = document.createElement('div');
                dateText.style.cssText = 'font-weight: 600; font-size: 13px; color: #0f172a; line-height: 1.3;';
                dateText.textContent = `${weekdayStr}, ${dateStr}`;

                // Bu kun uchun birinchi va oxirgi event vaqtini ko'rsatish
                const sortedDayEvents = [...dayEvents].sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
                if (sortedDayEvents.length > 0) {
                    const firstEventTime = new Date(sortedDayEvents[0].event_time);
                    const lastEventTime = new Date(sortedDayEvents[sortedDayEvents.length - 1].event_time);
                    const firstTimeStr = firstEventTime.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    const lastTimeStr = lastEventTime.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                    const timeText = document.createElement('div');
                    timeText.style.cssText = 'font-size: 10px; color: #64748b; font-weight: 500;';
                    timeText.textContent = `${firstTimeStr} - ${lastTimeStr}`;
                    dateInfo.appendChild(dateText);
                    dateInfo.appendChild(timeText);
                } else {
                    dateInfo.appendChild(dateText);
                }

                // Event count badge - Modern compact
                const eventCount = document.createElement('div');
                eventCount.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 5px 11px; border-radius: 14px; font-size: 10px; font-weight: 600; box-shadow: 0 1px 3px rgba(102, 126, 234, 0.35); white-space: nowrap;';
                eventCount.textContent = `${dayEvents.length} ta`;

                dateHeader.appendChild(dateInfo);
                dateHeader.appendChild(eventCount);
                dateGroup.appendChild(dateHeader);

                const eventsContainer = document.createElement('div');
                eventsContainer.className = 'attendance-events-container';

                // Har bir kun ichidagi yozuvlarni vaqt bo'yicha teskari tartiblash (yangi yuqorida)
                dayEvents.sort((a, b) => new Date(b.event_time) - new Date(a.event_time));

                dayEvents.forEach((event) => {
                    const eventItem = document.createElement('div');
                    eventItem.className = 'attendance-event-item';

                    const eventTime = new Date(event.event_time);
                    const timeStr = eventTime.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
                    const secondsStr = eventTime.toLocaleTimeString('uz-UZ', { second: '2-digit' });

                    // Har bir event uchun to'liq sana va vaqt (tooltip uchun)
                    const fullDateTimeStr = eventTime.toLocaleString('uz-UZ', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        weekday: 'long'
                    });

                    // Har bir event uchun qisqa sana (kun va oy)
                    const shortDateStr = eventTime.toLocaleDateString('uz-UZ', {
                        day: 'numeric',
                        month: 'short'
                    });

                    const typeLabel = event.event_type === 'exit' ? 'Chiqish' : 'Kirish';
                    const typeColor = event.event_type === 'exit' ? '#ef4444' : '#10b981';
                    const typeBgColor = event.event_type === 'exit' ? '#fef2f2' : '#f0fdf4';

                    // Face image HTML
                    let faceImageHtml = '';
                    if (event.picture_url) {
                        let imageUrl = event.picture_url;
                        if (imageUrl.startsWith('/')) {
                            imageUrl = imageUrl;
                        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                            imageUrl = `/api/attendance/image-proxy?url=${encodeURIComponent(imageUrl)}`;
                        } else {
                            imageUrl = `/uploads/faces/${event.picture_url}`;
                        }

                        faceImageHtml = `
                            <div class="attendance-face-image" style="border-color: ${typeColor};" onclick="if(event.stopPropagation) event.stopPropagation(); showImageModal('${imageUrl}')">
                                <img src="${imageUrl}" alt="Face ID" onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'color: #9ca3af; font-size: 24px;\\'>👤</div>';">
                            </div>
                        `;
                    } else {
                        faceImageHtml = `
                            <div class="attendance-face-placeholder" style="border-color: ${typeColor}; background: ${typeBgColor};">
                                <div style="width: 32px; height: 32px; border-radius: 8px; background: ${typeColor}; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 16px;">
                                    ${event.event_type === 'exit' ? '→' : '←'}
                                </div>
                            </div>
                        `;
                    }

                    let verificationBadge = '';
                    if (event.verification_mode) {
                        const vmInfo = getVerificationModeInfo(event.verification_mode);
                        verificationBadge = `<span class="verification-badge" style="background: ${vmInfo.bgColor}; color: ${vmInfo.color};">
                            <span>${vmInfo.icon}</span>
                            <span>${vmInfo.label}</span>
                        </span>`;
                    }

                    let faceScoreBadge = '';
                    if (event.face_match_score) {
                        faceScoreBadge = `<span class="face-score-badge">${Math.round(event.face_match_score)}%</span>`;
                    }

                    let terminalInfo = '';
                    if (event.terminal_name) {
                        terminalInfo = `
                            <div class="terminal-info">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="2" y="2" width="20" height="20" rx="2" ry="2"></rect>
                                    <path d="M8 2v20M16 2v20M2 8h20M2 16h20"></path>
                                </svg>
                                <span>${escapeHtml(event.terminal_name)}${event.terminal_location ? ` (${escapeHtml(event.terminal_location)})` : ''}</span>
                            </div>
                        `;
                    }

                    eventItem.innerHTML = `
                        <div class="attendance-event-content">
                            ${faceImageHtml}
                            <div class="attendance-event-details">
                                <div class="attendance-event-badges">
                                    <span class="event-type-badge" style="background: ${typeColor};">${typeLabel}</span>
                                    ${verificationBadge}
                                    ${faceScoreBadge}
                                </div>
                                <div class="attendance-event-time" title="${fullDateTimeStr}">
                                    <div style="display: flex; align-items: baseline; gap: 6px;">
                                        <span class="time-main">${timeStr}</span>
                                        <span class="time-seconds">:${secondsStr}</span>
                                        <span style="font-size: 11px; color: #9ca3af; font-weight: 500;">${shortDateStr}</span>
                                    </div>
                                </div>
                                ${terminalInfo}
                            </div>
                        </div>
                    `;

                    eventsContainer.appendChild(eventItem);
                });

                dateGroup.appendChild(eventsContainer);
                listDiv.appendChild(dateGroup);
            });
        } else {
            emptyDiv.style.display = 'block';
            listDiv.style.display = 'none';
        }
    } catch (error) {
        loadingDiv.style.display = 'none';
        emptyDiv.style.display = 'block';
        emptyDiv.innerHTML = `<span>Ma\'lumotlarni yuklashda xatolik yuz berdi: ${error.message || 'Noma\'lum xatolik'}</span>`;
        listDiv.style.display = 'none';
    }
}


async function markEmployeeAttendance(employeeId, employeeName) {
    if (!confirm(`${employeeName} uchun hozirgi vaqtda keldi va ketdi belgilab yuborilsinmi?`)) {
        return;
    }

    try {
        // Get first available terminal or create a manual one
        const terminalsResponse = await apiRequest('/api/terminals');
        let terminalId = null;

        if (terminalsResponse) {
            const terminalsData = await terminalsResponse.json();
            if (terminalsData.success && terminalsData.terminals && terminalsData.terminals.length > 0) {
                terminalId = terminalsData.terminals[0].id;
            }
        }

        if (!terminalId) {
            alert('Terminal topilmadi. Iltimos, avval terminal qo\'shing.');
            return;
        }

        const now = new Date();
        const eventTime = now.toISOString();

        // Create entry (keldi)
        const entryResponse = await apiRequest('/api/attendance', {
            method: 'POST',
            body: JSON.stringify({
                employee_id: employeeId,
                terminal_id: terminalId,
                event_type: 'entry',
                event_time: eventTime,
                verification_mode: 'Manual'
            })
        });

        if (!entryResponse) {
            alert('Keldi yozuvini yaratishda xatolik yuz berdi');
            return;
        }

        const entryData = await entryResponse.json();

        if (!entryData.success) {
            alert('Keldi yozuvini yaratishda xatolik: ' + (entryData.message || 'Noma\'lum xatolik'));
            return;
        }

        // Create exit (ketdi) - 1 hour later (or end of day if less than 1 hour remaining)
        const exitTime = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
        const exitResponse = await apiRequest('/api/attendance', {
            method: 'POST',
            body: JSON.stringify({
                employee_id: employeeId,
                terminal_id: terminalId,
                event_type: 'exit',
                event_time: exitTime,
                verification_mode: 'Manual'
            })
        });

        if (!exitResponse) {
            alert('Keldi yozuvi yaratildi, lekin ketdi yozuvini yaratishda xatolik yuz berdi');
            return;
        }

        const exitData = await exitResponse.json();

        if (!exitData.success) {
            alert('Keldi yozuvi yaratildi, lekin ketdi yozuvini yaratishda xatolik: ' + (exitData.message || 'Noma\'lum xatolik'));
            return;
        }

        if (entryData.success && exitData.success) {
            alert(`${employeeName} uchun keldi va ketdi muvaffaqiyatli belgilandi!`);
            // Reload attendance list
            loadAttendance();
        } else {
            alert('Keldi-ketdi belgilashda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Mark attendance error:', error);
        alert('Keldi-ketdi belgilashda xatolik yuz berdi: ' + error.message);
    }
}

async function showEmployeeWorkSchedule(employeeId, employeeName) {

    alert(`Ish jadvali sozlash funksiyasi keyingi versiyada qo'shiladi.\n\nHodim: ${employeeName}\nID: ${employeeId}`);

}


function createAttendanceItem(record) {
    const item = document.createElement('div');
    item.className = 'admin-item';
    item.style.cssText = 'padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; display: flex; align-items: center; gap: 12px;';

    const typeLabels = {
        'entry': 'Kirish',
        'exit': 'Chiqish'
    };

    const typeColors = {
        'entry': '#10b981',
        'exit': '#ef4444'
    };

    const typeBadge = `<span style="background: ${typeColors[record.event_type] || '#6b7280'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">${typeLabels[record.event_type] || record.event_type || 'Noma\'lum'}</span>`;

    // Face image HTML
    let faceImageHtml = '';
    if (record.picture_url) {
        // Handle different URL formats
        let imageUrl = record.picture_url;

        if (imageUrl.startsWith('/')) {
            // Local path - use as is
            imageUrl = imageUrl;
        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            // Full URL - use proxy endpoint
            imageUrl = `/api/attendance/image-proxy?url=${encodeURIComponent(imageUrl)}`;
        } else {
            // Relative path
            imageUrl = `/uploads/faces/${record.picture_url}`;
        }

        faceImageHtml = `
        <div style="width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 2px solid #e5e7eb; flex-shrink: 0; background: #f3f4f6; display: flex; align-items: center; justify-content: center; cursor: pointer;" onclick="if(event.stopPropagation) event.stopPropagation(); showImageModal('${imageUrl}')">
          <img src="${imageUrl}" 
               alt="Face ID" 
               style="width: 100%; height: 100%; object-fit: cover;"
               onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'color: #9ca3af; font-size: 24px;\\'>👤</div>';">
        </div>
      `;
    } else {
        faceImageHtml = `
        <div style="width: 56px; height: 56px; border-radius: 8px; overflow: hidden; border: 2px solid #e5e7eb; flex-shrink: 0; background: #f3f4f6; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 24px;">
          👤
        </div>
      `;
    }

    item.innerHTML = `
        ${faceImageHtml}
        <div style="flex: 1;">
            <div style="font-weight: 600; color: #111827; margin-bottom: 4px;">
                ${escapeHtml(record.employee_name)} ${typeBadge}
            </div>
            <div style="font-size: 14px; color: #6b7280; margin-bottom: 4px;">
                Terminal: ${escapeHtml(record.terminal_name)} (${escapeHtml(record.terminal_location || '—')})
            </div>
            <div style="font-size: 12px; color: #9ca3af; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span>Vaqt: ${formatDateTime(record.event_time)}</span>
                ${record.face_match_score ? `<span>| Yuz mosligi: ${record.face_match_score}%</span>` : ''}
                ${(() => {
            if (record.verification_mode) {
                const vmInfo = getVerificationModeInfo(record.verification_mode);
                return `<span style="display: inline-flex; align-items: center; gap: 4px; color: ${vmInfo.color};">
                            <span>${vmInfo.icon}</span>
                            <span>${vmInfo.label}</span>
                        </span>`;
            }
            return '';
        })()}
            </div>
        </div>
    `;

    return item;
}


function showImageModal(imageUrl) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center; cursor: pointer;';
    modal.onclick = () => modal.remove();

    // Create image container
    const imgContainer = document.createElement('div');
    imgContainer.style.cssText = 'max-width: 90%; max-height: 90%; position: relative;';
    imgContainer.onclick = (e) => e.stopPropagation();

    // Create image
    const img = document.createElement('img');
    img.src = imageUrl;
    img.style.cssText = 'max-width: 100%; max-height: 90vh; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);';
    img.onerror = () => {
        imgContainer.innerHTML = '<div style="color: white; padding: 20px; text-align: center;">Rasm yuklab bo\'lmadi</div>';
    };

    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'position: absolute; top: -40px; right: 0; background: rgba(255,255,255,0.2); color: white; border: none; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center;';
    closeBtn.onclick = () => modal.remove();

    imgContainer.appendChild(img);
    imgContainer.appendChild(closeBtn);
    modal.appendChild(imgContainer);
    document.body.appendChild(modal);
}

async function loadEmployeesForAttendanceFilter() {
    const select = document.getElementById('attendanceEmployeeFilter');
    if (!select) return;

    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();


        select.innerHTML = '<option value="">Barchasi</option>';

        if (data.success && data.employees) {
            data.employees.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.id;
                option.textContent = `${emp.full_name} (${emp.position})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Load employees for filter error:', error);
    }
}


async function loadTerminalsForAttendanceFilter() {
    const select = document.getElementById('attendanceTerminalFilter');
    if (!select) return;

    try {
        const response = await apiRequest('/api/terminals');
        if (!response) return;

        const data = await response.json();


        select.innerHTML = '<option value="">Barchasi</option>';

        if (data.success && data.terminals) {
            data.terminals.forEach(term => {
                const option = document.createElement('option');
                option.value = term.id;
                option.textContent = `${term.name} (${term.ip_address})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Load terminals for filter error:', error);
    }
}


function showSalaryRatesLoading(show) {
    if (loadingSalaryRatesMessage) {
        loadingSalaryRatesMessage.style.display = show ? 'block' : 'none';
    }
    if (!show && salaryRatesList) {
        salaryRatesList.style.display = 'flex';
    }
}

function hideSalaryRatesMessages() {
    if (emptySalaryRatesMessage) emptySalaryRatesMessage.style.display = 'none';
}

function showSalaryRatesError(message) {
    console.error(message);
}

// ==================== MOLIYA SECTION (MAOSHLAR) ====================

// YANGI FUNKSIYA - incomeSection uchun (asosiy maoshlar bo'limi)
async function loadSalaries() {
    const salariesEmployeesList = document.getElementById('salariesEmployeesList');
    const loadingMessage = document.getElementById('loadingSalariesMessage');
    const emptyMessage = document.getElementById('emptySalariesMessage');

    if (loadingMessage) loadingMessage.style.display = 'block';
    if (salariesEmployeesList) salariesEmployeesList.innerHTML = '';
    if (emptyMessage) emptyMessage.style.display = 'none';

    try {
        // Avval maoshlarni avtomatik hisoblash (faqat tanlangan davr uchun)
        await autoCalculateSalariesForPeriod();

        // Hodimlarni yuklash
        const employeesResponse = await apiRequest('/api/employees');
        if (!employeesResponse) {
            if (loadingMessage) loadingMessage.style.display = 'none';
            return;
        }

        const employeesData = await employeesResponse.json();
        if (!employeesData.success || !employeesData.employees) {
            if (loadingMessage) loadingMessage.style.display = 'none';
            if (emptyMessage) {
                emptyMessage.style.display = 'block';
                emptyMessage.textContent = 'Hodimlarni yuklashda xatolik';
            }
            return;
        }

        // Hodimlar filtrlash dropdown ni to'ldirish
        await loadEmployeesForSalaryFilter();

        // Maoshlarni yuklash (filtr bilan)
        const selectedEmployeeId = salaryEmployeeFilter ? salaryEmployeeFilter.value : '';
        let salariesUrl = '/api/salaries';
        let periodType = null; // Default - barcha davrlar (null = barcha davrlar)

        // Agar "all" tanlanmagan bo'lsa, faqat tanlangan davrni yuklash
        if (currentSalaryPeriod !== 'all') {
            periodType = currentSalaryPeriod === 'today' ? 'daily' : currentSalaryPeriod === 'week' ? 'weekly' : 'monthly';
            salariesUrl += `?period_type=${periodType}`;
            if (selectedEmployeeId) {
                salariesUrl += `&employee_id=${selectedEmployeeId}`;
            }
        } else {
            // "all" tanlangan bo'lsa, barcha davrlarni yuklash (period_type ni yubormaslik)
            periodType = 'all'; // displaySalariesByEmployees uchun
            if (selectedEmployeeId) {
                salariesUrl += `?employee_id=${selectedEmployeeId}`;
            }
        }
        const salariesResponse = await apiRequest(salariesUrl);
        if (!salariesResponse) {
            if (loadingMessage) loadingMessage.style.display = 'none';
            return;
        }

        const salariesData = await salariesResponse.json();
        if (loadingMessage) loadingMessage.style.display = 'none';

        // Ko'rsatgichlarni yuklash va ko'rsatish
        await displaySalaryStats();

        if (salariesData.success && salariesData.salaries) {
            // Agar "all" tanlanmagan bo'lsa, faqat tanlangan davrda ish haqqi oladigan hodimlarni filtrlash
            let employeesToShow = employeesData.employees;

            if (currentSalaryPeriod !== 'all' && periodType) {
                // Salary rates ni yuklash - qaysi hodim qaysi davrda ish haqqi oladi
                const salaryRatesResponse = await apiRequest('/api/salary-rates');
                if (salaryRatesResponse) {
                    const salaryRatesData = await salaryRatesResponse.json();
                    if (salaryRatesData.success && salaryRatesData.rates) {
                        // Tanlangan davr uchun ish haqqi oladigan hodimlar ID lari
                        const employeeIdsForPeriod = new Set();
                        salaryRatesData.rates.forEach(rate => {
                            if (rate.period_type === periodType && rate.employee_id) {
                                employeeIdsForPeriod.add(rate.employee_id);
                            }
                        });

                        // Faqat tanlangan davrda ish haqqi oladigan hodimlarni filtrlash
                        employeesToShow = employeesData.employees.filter(emp => {
                            return employeeIdsForPeriod.has(emp.id);
                        });
                    }
                }
            }

            // Agar hodim tanlangan bo'lsa, faqat o'sha hodimni ko'rsatish
            if (selectedEmployeeId) {
                employeesToShow = employeesToShow.filter(emp => String(emp.id) === String(selectedEmployeeId));
            }

            if (employeesToShow.length === 0) {
                if (emptyMessage) emptyMessage.style.display = 'block';
                if (salariesEmployeesList) salariesEmployeesList.style.display = 'none';
            } else {
                if (emptyMessage) emptyMessage.style.display = 'none';
                if (salariesEmployeesList) {
                    salariesEmployeesList.style.display = 'flex';
                    salariesEmployeesList.style.flexDirection = 'column';
                    displaySalariesByEmployees(employeesToShow, salariesData.salaries, periodType || 'all');
                }
            }
        } else {
            console.error('Failed to load salaries:', salariesData.message);
            if (emptyMessage) {
                emptyMessage.style.display = 'block';
                emptyMessage.textContent = salariesData.message || 'Maoshlarni yuklashda xatolik';
            }
        }
    } catch (error) {
        if (loadingMessage) loadingMessage.style.display = 'none';
        console.error('Load salaries error:', error);
        if (emptyMessage) {
            emptyMessage.style.display = 'block';
            emptyMessage.textContent = 'Maoshlarni yuklashda xatolik yuz berdi';
        }
    }
}

// Faqat tanlangan davr uchun maoshlarni avtomatik hisoblash (optimallashtirilgan)
async function autoCalculateSalariesForPeriod() {
    try {
        // Faqat tanlangan davr uchun hisoblash (barcha davrlar emas)
        if (currentSalaryPeriod === 'all') {
            // "All" tanlangan bo'lsa, hisoblamaymiz (juda og'ir bo'ladi)
            return;
        }

        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        // Faqat tanlangan davr uchun hisoblash
        const periodType = currentSalaryPeriod === 'today' ? 'daily' : currentSalaryPeriod === 'week' ? 'weekly' : 'monthly';

        try {
            const response = await apiRequest('/api/salaries/calculate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    period_type: periodType,
                    period_date: todayStr
                })
            });

            if (response) {
                const data = await response.json();
                if (data.success) {
                    console.log(`✅ ${periodType} maoshlar muvaffaqiyatli hisoblandi (${data.calculated || 0} ta)`);
                } else {
                    console.warn(`⚠️ ${periodType} maoshlarni hisoblashda xatolik: ${data.message || 'Noma\'lum xatolik'}`);
                }
            }
        } catch (error) {
            console.error(`❌ ${periodType} maoshlarni hisoblashda xatolik:`, error);
            // Xatolik bo'lsa ham davom etamiz
        }
    } catch (error) {
        console.error('Auto calculate salaries error:', error);
        // Xatolik bo'lsa ham maoshlarni yuklash davom etadi
    }
}

async function displaySalaryStats() {
    const statsContainer = document.getElementById('salaryStatsContainer');
    if (!statsContainer) return;

    try {
        // HAQIQIY MAOSHLARNI olish - salaries jadvalidan (salary_rates emas!)
        const salariesResponse = await apiRequest('/api/salaries');
        if (!salariesResponse) {
            // Xatolik bo'lsa bosh ko'rsatgichlarni ko'rsatish - kichikroq
            statsContainer.innerHTML = `
                <div style="background: #f9fafb; padding: 10px 12px; border-radius: 6px; border: 1px solid #e5e7eb;">
                    <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                    <div style="font-size: 11px; color: #6b7280;">Jami</div>
                </div>
                <div style="background: #f0fdf4; padding: 10px 12px; border-radius: 6px; border: 1px solid #bbf7d0;">
                    <div style="font-size: 16px; font-weight: 600; color: #10b981; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                    <div style="font-size: 11px; color: #6b7280;">Kunlik</div>
                </div>
                <div style="background: #eff6ff; padding: 10px 12px; border-radius: 6px; border: 1px solid #bfdbfe;">
                    <div style="font-size: 16px; font-weight: 600; color: #3b82f6; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                    <div style="font-size: 11px; color: #6b7280;">Haftalik</div>
                </div>
                <div style="background: #fffbeb; padding: 10px 12px; border-radius: 6px; border: 1px solid #fde68a;">
                    <div style="font-size: 16px; font-weight: 600; color: #f59e0b; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                    <div style="font-size: 11px; color: #6b7280;">Oylik</div>
                </div>
            `;
            return;
        }

        const salariesData = await salariesResponse.json();
        if (!salariesData.success || !salariesData.salaries) {
            // Xatolik bo'lsa bosh ko'rsatgichlarni ko'rsatish - kichikroq
            statsContainer.innerHTML = `
                <div style="background: #f9fafb; padding: 10px 12px; border-radius: 6px; border: 1px solid #e5e7eb;">
                    <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                    <div style="font-size: 11px; color: #6b7280;">Jami</div>
                </div>
                <div style="background: #f0fdf4; padding: 10px 12px; border-radius: 6px; border: 1px solid #bbf7d0;">
                    <div style="font-size: 16px; font-weight: 600; color: #10b981; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                    <div style="font-size: 11px; color: #6b7280;">Kunlik</div>
                </div>
                <div style="background: #eff6ff; padding: 10px 12px; border-radius: 6px; border: 1px solid #bfdbfe;">
                    <div style="font-size: 16px; font-weight: 600; color: #3b82f6; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                    <div style="font-size: 11px; color: #6b7280;">Haftalik</div>
                </div>
                <div style="background: #fffbeb; padding: 10px 12px; border-radius: 6px; border: 1px solid #fde68a;">
                    <div style="font-size: 16px; font-weight: 600; color: #f59e0b; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                    <div style="font-size: 11px; color: #6b7280;">Oylik</div>
                </div>
            `;
            return;
        }

        const salaries = salariesData.salaries || [];

        // Har bir davr uchun maoshlarni hisoblash
        let dailyTotal = 0;
        let weeklyTotal = 0;
        let monthlyTotal = 0;
        let dailyCount = 0;
        let weeklyCount = 0;
        let monthlyCount = 0;

        salaries.forEach(salary => {
            const amount = parseFloat(salary.amount || 0);
            if (salary.period_type === 'daily') {
                dailyTotal += amount;
                dailyCount++;
            } else if (salary.period_type === 'weekly') {
                weeklyTotal += amount;
                weeklyCount++;
            } else if (salary.period_type === 'monthly') {
                monthlyTotal += amount;
                monthlyCount++;
            }
        });

        // Jami - barcha davrlar yig'indisi
        const totalAmount = dailyTotal + weeklyTotal + monthlyTotal;
        const totalCount = salaries.length;

        // formatCurrency funksiyasi allaqachon global funksiya sifatida mavjud

        // Jami Stat Card - kichikroq dizayn
        const totalDiv = document.createElement('div');
        totalDiv.style.cssText = 'background: #f9fafb; padding: 10px 12px; border-radius: 6px; border: 1px solid #e5e7eb; cursor: pointer; transition: all 0.2s;';
        totalDiv.onmouseover = () => totalDiv.style.background = '#f3f4f6';
        totalDiv.onmouseout = () => totalDiv.style.background = '#f9fafb';
        totalDiv.onclick = () => {
            currentSalaryPeriod = 'all';
            updateSalaryFilterButtons();
            loadSalaries();
        };
        totalDiv.innerHTML = `
            <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 2px; line-height: 1.2;">${formatCurrency(totalAmount)}</div>
            <div style="font-size: 11px; color: #6b7280;">Jami (${totalCount})</div>
        `;

        // Kunlik Stat Card - kichikroq dizayn
        const dailyDiv = document.createElement('div');
        dailyDiv.style.cssText = 'background: #f0fdf4; padding: 10px 12px; border-radius: 6px; border: 1px solid #bbf7d0; cursor: pointer; transition: all 0.2s;';
        dailyDiv.onmouseover = () => dailyDiv.style.background = '#dcfce7';
        dailyDiv.onmouseout = () => dailyDiv.style.background = '#f0fdf4';
        dailyDiv.onclick = () => {
            currentSalaryPeriod = 'today';
            updateSalaryFilterButtons();
            loadSalaries();
        };
        dailyDiv.innerHTML = `
            <div style="font-size: 16px; font-weight: 600; color: #10b981; margin-bottom: 2px; line-height: 1.2;">${formatCurrency(dailyTotal)}</div>
            <div style="font-size: 11px; color: #6b7280;">Kunlik (${dailyCount})</div>
        `;

        // Haftalik Stat Card - kichikroq dizayn
        const weeklyDiv = document.createElement('div');
        weeklyDiv.style.cssText = 'background: #eff6ff; padding: 10px 12px; border-radius: 6px; border: 1px solid #bfdbfe; cursor: pointer; transition: all 0.2s;';
        weeklyDiv.onmouseover = () => weeklyDiv.style.background = '#dbeafe';
        weeklyDiv.onmouseout = () => weeklyDiv.style.background = '#eff6ff';
        weeklyDiv.onclick = () => {
            currentSalaryPeriod = 'week';
            updateSalaryFilterButtons();
            loadSalaries();
        };
        weeklyDiv.innerHTML = `
            <div style="font-size: 16px; font-weight: 600; color: #3b82f6; margin-bottom: 2px; line-height: 1.2;">${formatCurrency(weeklyTotal)}</div>
            <div style="font-size: 11px; color: #6b7280;">Haftalik (${weeklyCount})</div>
        `;

        // Oylik Stat Card - kichikroq dizayn
        const monthlyDiv = document.createElement('div');
        monthlyDiv.style.cssText = 'background: #fffbeb; padding: 10px 12px; border-radius: 6px; border: 1px solid #fde68a; cursor: pointer; transition: all 0.2s;';
        monthlyDiv.onmouseover = () => monthlyDiv.style.background = '#fef3c7';
        monthlyDiv.onmouseout = () => monthlyDiv.style.background = '#fffbeb';
        monthlyDiv.onclick = () => {
            currentSalaryPeriod = 'month';
            updateSalaryFilterButtons();
            loadSalaries();
        };
        monthlyDiv.innerHTML = `
            <div style="font-size: 16px; font-weight: 600; color: #f59e0b; margin-bottom: 2px; line-height: 1.2;">${formatCurrency(monthlyTotal)}</div>
            <div style="font-size: 11px; color: #6b7280;">Oylik (${monthlyCount})</div>
        `;

        statsContainer.innerHTML = '';
        statsContainer.appendChild(totalDiv);
        statsContainer.appendChild(dailyDiv);
        statsContainer.appendChild(weeklyDiv);
        statsContainer.appendChild(monthlyDiv);
    } catch (error) {
        console.error('Display salary stats error:', error);
        // Xatolik bo'lsa ham bosh ko'rsatgichlarni ko'rsatish
        // Xatolik bo'lsa ham kichikroq dizayn bilan bosh ko'rsatgichlarni ko'rsatish
        statsContainer.innerHTML = `
            <div style="background: #f9fafb; padding: 10px 12px; border-radius: 6px; border: 1px solid #e5e7eb;">
                <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                <div style="font-size: 11px; color: #6b7280;">Jami</div>
            </div>
            <div style="background: #f0fdf4; padding: 10px 12px; border-radius: 6px; border: 1px solid #bbf7d0;">
                <div style="font-size: 16px; font-weight: 600; color: #10b981; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                <div style="font-size: 11px; color: #6b7280;">Kunlik</div>
            </div>
            <div style="background: #eff6ff; padding: 10px 12px; border-radius: 6px; border: 1px solid #bfdbfe;">
                <div style="font-size: 16px; font-weight: 600; color: #3b82f6; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                <div style="font-size: 11px; color: #6b7280;">Haftalik</div>
            </div>
            <div style="background: #fffbeb; padding: 10px 12px; border-radius: 6px; border: 1px solid #fde68a;">
                <div style="font-size: 16px; font-weight: 600; color: #f59e0b; margin-bottom: 2px; line-height: 1.2;">0 so'm</div>
                <div style="font-size: 11px; color: #6b7280;">Oylik</div>
            </div>
        `;
    }
}

function displaySalariesByEmployees(employees, salaries, periodType) {
    const salariesEmployeesList = document.getElementById('salariesEmployeesList');
    if (!salariesEmployeesList) return;

    salariesEmployeesList.innerHTML = '';

    // Salaries ni employee_id bo'yicha guruhlash
    const salariesByEmployee = new Map();
    salaries.forEach(salary => {
        if (!salariesByEmployee.has(salary.employee_id)) {
            salariesByEmployee.set(salary.employee_id, []);
        }
        salariesByEmployee.get(salary.employee_id).push(salary);
    });

    let cardNumber = 1; // Raqamlanish uchun counter

    // Agar "all" bo'lsa, har bir hodimning maoshlarini period_type bo'yicha guruhlash
    if (periodType === 'all') {
        employees.forEach(employee => {
            const allEmployeeSalaries = salariesByEmployee.get(employee.id) || [];

            // Salaries ni period_type bo'yicha guruhlash
            const salariesByPeriod = new Map();
            allEmployeeSalaries.forEach(salary => {
                if (!salariesByPeriod.has(salary.period_type)) {
                    salariesByPeriod.set(salary.period_type, []);
                }
                salariesByPeriod.get(salary.period_type).push(salary);
            });

            // Har bir davr uchun alohida kartochka yaratish
            salariesByPeriod.forEach((employeeSalaries, period) => {
                const card = createEmployeeSalaryCard(employee, employeeSalaries, period, cardNumber);
                salariesEmployeesList.appendChild(card);
                cardNumber++;
            });
        });
    } else {
        // Agar bitta davr tanlangan bo'lsa, odatdagidek
        employees.forEach(employee => {
            const employeeSalaries = salariesByEmployee.get(employee.id) || [];
            const card = createEmployeeSalaryCard(employee, employeeSalaries, periodType, cardNumber);
            salariesEmployeesList.appendChild(card);
            cardNumber++;
        });
    }
}

function createEmployeeSalaryCard(employee, salaries, periodType, cardNumber = null) {
    const card = document.createElement('div');
    card.style.cssText = 'padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s;';
    card.onmouseover = function () {
        card.style.backgroundColor = '#f9fafb';
        card.style.borderColor = '#d1d5db';
    };
    card.onmouseout = function () {
        card.style.backgroundColor = 'white';
        card.style.borderColor = '#e5e7eb';
    };
    card.onclick = function (e) {
        e.stopPropagation();
        showEmployeeSalaryDetails(employee.id, card);
    };

    const periodTypeText = {
        'daily': 'Kunlik',
        'weekly': 'Haftalik',
        'monthly': 'Oylik'
    }[periodType] || periodType;

    // Jami maosh
    const totalAmount = salaries.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
    const formattedTotal = new Intl.NumberFormat('uz-UZ', {
        style: 'currency',
        currency: 'UZS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(totalAmount).replace('UZS', 'so\'m');

    // Employee picture - kichikroq
    const empPicture = employee.picture_url || '';
    let faceImageHtml = '';
    if (empPicture) {
        let imageUrl = empPicture;
        if (imageUrl.startsWith('/')) {
            imageUrl = imageUrl;
        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            imageUrl = `/api/attendance/image-proxy?url=${encodeURIComponent(imageUrl)}`;
        } else {
            imageUrl = `/uploads/faces/${empPicture}`;
        }

        faceImageHtml = `
            <div style="width: 40px; height: 40px; border-radius: 6px; overflow: hidden; border: 1px solid #e5e7eb; flex-shrink: 0; background: #f3f4f6; display: flex; align-items: center; justify-content: center;">
                <img src="${imageUrl}" 
                     alt="Employee" 
                     style="width: 100%; height: 100%; object-fit: cover;"
                     onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'color: #9ca3af; font-size: 16px;\\'>👤</div>';">
            </div>
        `;
    } else {
        faceImageHtml = `
            <div style="width: 40px; height: 40px; border-radius: 6px; overflow: hidden; border: 1px solid #e5e7eb; flex-shrink: 0; background: #f3f4f6; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 16px;">
                👤
            </div>
        `;
    }

    // Raqam ko'rsatgichi - kichikroq
    const numberBadge = cardNumber !== null ? `
        <div style="width: 28px; height: 28px; border-radius: 5px; background: #f3f4f6; border: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-weight: 600; font-size: 12px; color: #6b7280;">
            ${cardNumber}
        </div>
    ` : '';

    card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
            ${numberBadge}
            ${faceImageHtml}
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; color: #111827; font-size: 13px; margin-bottom: 2px; line-height: 1.3;">${escapeHtml(employee.full_name || 'Noma\'lum')}</div>
                <div style="font-size: 11px; color: #6b7280; line-height: 1.3;">${escapeHtml(employee.position || 'Lavozim belgilanmagan')}</div>
            </div>
            <div style="display: flex; gap: 20px; align-items: flex-start; flex-shrink: 0;">
                <div style="min-width: 70px; flex-shrink: 0;">
                    <div style="font-size: 10px; color: #6b7280; margin-bottom: 2px; font-weight: 500;">Davr</div>
                    <div style="font-size: 12px; font-weight: 500; color: #6b7280; white-space: nowrap;">${periodTypeText}</div>
                    <div style="font-size: 10px; color: #9ca3af; margin-top: 1px;">${salaries.length} ta</div>
                </div>
                <div style="min-width: 100px; flex-shrink: 0; text-align: right;">
                    <div style="font-size: 11px; color: #6b7280; margin-bottom: 2px; font-weight: 500;">Jami</div>
                    <div style="font-size: 14px; font-weight: 600; color: #10b981; white-space: nowrap; word-break: keep-all; line-height: 1.2;">${formattedTotal}</div>
                </div>
            </div>
        </div>
    `;

    return card;
}

function createEmployeeSalaryItem(salary) {
    const date = new Date(salary.period_date);
    const formattedDate = date.toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    const formattedAmount = new Intl.NumberFormat('uz-UZ', {
        style: 'currency',
        currency: 'UZS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(salary.amount).replace('UZS', 'so\'m');

    let workInfo = '';
    if (salary.notes) {
        workInfo = salary.notes;
    }

    return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;">
            <div style="flex: 1;">
                <div style="font-weight: 500; color: #111827; font-size: 14px; margin-bottom: 4px;">
                    ${formattedDate}
                </div>
                ${workInfo ? `<div style="font-size: 12px; color: #6b7280;">
                    ${escapeHtml(workInfo)}
                </div>` : ''}
            </div>
            <div style="text-align: right; margin-left: 16px;">
                <div style="font-weight: 600; color: #10b981; font-size: 16px; font-variant-numeric: tabular-nums;">
                    ${formattedAmount}
                </div>
                <div style="display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end;">
                    <button class="edit-btn" onclick="editSalary(${salary.id})" title="Tahrirlash">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="delete-btn" onclick="deleteSalary(${salary.id})" title="O'chirish">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

function createSalaryListItem(salary) {
    const item = document.createElement('div');
    item.style.cssText = 'padding: 16px; border: 1px solid #e5e7eb; border-radius: 12px; background: white; transition: all 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';
    item.onmouseover = function () {
        this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        this.style.borderColor = '#d1d5db';
    };
    item.onmouseout = function () {
        this.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
        this.style.borderColor = '#e5e7eb';
    };

    const date = new Date(salary.period_date);
    const formattedDate = date.toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    const periodTypeText = {
        'daily': 'Kunlik',
        'weekly': 'Haftalik',
        'monthly': 'Oylik'
    }[salary.period_type] || salary.period_type;

    const periodTypeColor = {
        'daily': '#10b981',
        'weekly': '#3b82f6',
        'monthly': '#8b5cf6'
    }[salary.period_type] || '#6b7280';

    const formattedAmount = new Intl.NumberFormat('uz-UZ', {
        style: 'currency',
        currency: 'UZS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(salary.amount).replace('UZS', 'so\'m');

    // Notes dan ishlagan vaqt ma'lumotlarini ajratish
    let workInfo = '';
    if (salary.notes) {
        workInfo = salary.notes;
    }

    item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
            <div style="flex: 1;">
                <div style="font-weight: 600; color: #111827; font-size: 18px; margin-bottom: 6px;">
                    ${escapeHtml(salary.full_name || 'Noma\'lum')}
                </div>
                <div style="font-size: 14px; color: #6b7280; margin-bottom: 8px;">
                    ${escapeHtml(salary.work_position || salary.employee_position || 'Lavozim belgilanmagan')}
                </div>
                ${workInfo ? `<div style="font-size: 13px; color: #6b7280; padding: 8px 12px; background: #f9fafb; border-radius: 6px; margin-top: 8px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.6;">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        <span>${escapeHtml(workInfo)}</span>
            </div>
                </div>` : ''}
            </div>
            <div style="text-align: right; margin-left: 16px;">
                <div style="font-weight: 700; color: #10b981; font-size: 24px; margin-bottom: 6px; font-variant-numeric: tabular-nums;">
                    ${formattedAmount}
                </div>
                <div style="display: inline-block; background: ${periodTypeColor}15; color: ${periodTypeColor}; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;">
                    ${periodTypeText}
                </div>
                <div style="font-size: 12px; color: #9ca3af; margin-top: 8px;">
                    ${formattedDate}
            </div>
        </div>
            </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid #f3f4f6;">
            <button class="edit-btn" onclick="editSalary(${salary.id})" title="Tahrirlash">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="delete-btn" onclick="deleteSalary(${salary.id})" title="O'chirish">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </div>
    `;

    return item;
}

// Edit va Delete funksiyalari (global scope da)
async function editSalary(id) {
    // Tahrirlash modalini yaratish va ko'rsatish
    const response = await apiRequest(`/api/salaries/${id}`);
    if (!response) return;

    const data = await response.json();
    if (!data.success || !data.salary) {
        alert('Maosh ma\'lumotlarini olishda xatolik');
        return;
    }

    const salary = data.salary;
    const newAmount = prompt(`Yangi summani kiriting (Hozirgi: ${salary.amount.toLocaleString()} so'm):`, salary.amount);

    if (newAmount === null) return;

    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount < 0) {
        alert('Noto\'g\'ri summa kiritildi');
        return;
    }

    try {
        const updateResponse = await apiRequest(`/api/salaries/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ amount })
        });

        if (!updateResponse) return;

        const updateData = await updateResponse.json();
        if (updateData.success) {
            loadSalaries();
        } else {
            alert('Maoshni yangilashda xatolik: ' + (updateData.message || 'Noma\'lum xatolik'));
        }
    } catch (error) {
        console.error('Edit salary error:', error);
        alert('Maoshni yangilashda xatolik yuz berdi');
    }
}

async function deleteSalary(id) {
    if (!confirm('Haqiqatan ham bu maoshni o\'chirmoqchimisiz?')) {
        return;
    }

    try {
        const response = await apiRequest(`/api/salaries/${id}`, {
            method: 'DELETE'
        });

        if (!response) return;

        const data = await response.json();
        if (data.success) {
            loadSalaries();
        } else {
            alert('Maoshni o\'chirishda xatolik: ' + (data.message || 'Noma\'lum xatolik'));
        }
    } catch (error) {
        console.error('Delete salary error:', error);
        alert('Maoshni o\'chirishda xatolik yuz berdi');
    }
}

// Show employee salary details modal
async function showEmployeeSalaryDetails(employeeId) {
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal';

    // Set loading state
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 900px; width: 90%; max-height: 90vh; padding: 0; display: flex; flex-direction: column; border-radius: 16px; overflow: hidden;">
            <div style="text-align: center; padding: 40px; color: #6b7280;">Yuklanmoqda...</div>
        </div>
    `;

    document.body.appendChild(modal);

    // Backdrop click handler
    modal.addEventListener('click', function (e) {
        if (e.target === modal) {
            modal.remove();
            document.body.style.overflow = '';
        }
    });

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    const modalContent = modal.querySelector('.modal-content');

    try {
        // Hodim ma'lumotlarini olish
        const employeeResponse = await apiRequest(`/api/employees/${employeeId}`);
        if (!employeeResponse) {
            modalContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #ef4444;">Xatolik: Hodim ma\'lumotlarini yuklab bo\'lmadi</div>';
            return;
        }

        const employeeData = await employeeResponse.json();
        if (!employeeData.success || !employeeData.employee) {
            modalContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #ef4444;">Hodim topilmadi</div>';
            return;
        }

        const employee = employeeData.employee;

        // Maoshlar, bonuslar, jarimalar, KPI, kunlik o'zgarishlar ma'lumotlarini olish
        const [salariesRes, bonusesRes, penaltiesRes, kpiRes, dailyChangesRes, salaryRatesRes] = await Promise.all([
            apiRequest('/api/salaries?employee_id=' + employeeId),
            apiRequest('/api/bonuses?employee_id=' + employeeId),
            apiRequest('/api/penalties?employee_id=' + employeeId),
            apiRequest('/api/kpi?employee_id=' + employeeId),
            apiRequest('/api/daily-changes?employee_id=' + employeeId),
            apiRequest('/api/salary-rates?employee_id=' + employeeId)
        ]);

        const salaries = salariesRes ? (await salariesRes.json()).salaries || [] : [];
        const bonuses = bonusesRes ? (await bonusesRes.json()).bonuses || [] : [];
        const penalties = penaltiesRes ? (await penaltiesRes.json()).penalties || [] : [];
        const kpi = kpiRes ? (await kpiRes.json()).kpi || [] : [];
        const dailyChanges = dailyChangesRes ? (await dailyChangesRes.json()).changes || [] : [];
        const salaryRates = salaryRatesRes ? (await salaryRatesRes.json()).rates || [] : [];

        // Faqat lavozim o'zgarishlarini filtrlash
        const positionChanges = dailyChanges.filter(change => change.change_type === 'position_change');

        // Asosiy ish haqqini olish (oylik maosh)
        const baseSalaryRate = salaryRates.find(rate => rate.employee_id === employeeId && rate.period_type === 'monthly');
        const baseSalary = baseSalaryRate ? parseFloat(baseSalaryRate.amount || 0) : 0;

        // Jami hisoblash
        const totalSalary = salaries.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
        const totalBonus = bonuses.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
        const totalPenalty = penalties.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        const totalKPI = kpi.reduce((sum, k) => sum + parseFloat(k.amount || 0), 0);
        const netAmount = totalSalary + totalBonus + totalKPI - totalPenalty;

        // formatCurrency funksiyasi allaqachon global funksiya sifatida mavjud

        // Kalendar uchun maoshlar ro'yxatini olish (oylik)
        const monthlySalaries = salaries.filter(s => s.period_type === 'monthly');

        modalContent.innerHTML = `
            <div class="modal-header" style="padding: 24px 28px 20px; border-bottom: 1px solid #e5e7eb; background: #ffffff; flex-shrink: 0; position: relative;">
                <h3 style="margin: 0; font-size: 20px; font-weight: 600; color: #111827; letter-spacing: -0.3px;">${escapeHtml(employee.full_name || 'Hodim')}</h3>
                <button class="modal-close" onclick="this.closest('.modal').remove(); document.body.style.overflow = '';" style="position: absolute; top: 20px; right: 20px; background: none; border: none; font-size: 28px; cursor: pointer; color: #6b7280; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.background='#f3f4f6'; this.style.color='#111827';" onmouseout="this.style.background='none'; this.style.color='#6b7280';">&times;</button>
            </div>
            <div class="modal-body" style="padding: 24px 28px; overflow-y: auto; flex: 1; scrollbar-width: thin; scrollbar-color: #d1d5db #f9fafb;">
                <div style="display: flex; flex-direction: column; gap: 20px;">
                <!-- Summary Cards - Minimalistic -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px; font-weight: 500;">Maosh</div>
                        <div style="font-size: 16px; font-weight: 600; color: #111827;">${formatCurrency(baseSalary)}</div>
                    </div>
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px; font-weight: 500;">Bonus</div>
                        <div style="font-size: 16px; font-weight: 600; color: #16a34a;">${formatCurrency(totalBonus)}</div>
                    </div>
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px; font-weight: 500;">Jarima</div>
                        <div style="font-size: 16px; font-weight: 600; color: #dc2626;">${formatCurrency(totalPenalty)}</div>
                    </div>
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
                        <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px; font-weight: 500;">KPI</div>
                        <div style="font-size: 16px; font-weight: 600; color: #d97706;">${formatCurrency(totalKPI)}</div>
                    </div>
                    <div style="background: #111827; border-radius: 8px; padding: 16px; color: white;">
                        <div style="font-size: 12px; opacity: 0.8; margin-bottom: 6px; font-weight: 500;">Jamiy</div>
                        <div style="font-size: 16px; font-weight: 600;">${formatCurrency(netAmount)}</div>
                    </div>
                </div>
                
                <!-- Detailed Lists - Minimalistic -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
                    <!-- Salaries List -->
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
                        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #111827;">Maoshlar</h4>
                        <div style="max-height: 280px; overflow-y: auto;">
                            ${salaries.length === 0 ? '<div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 13px;">Ma\'lumotlar yo\'q</div>' :
                salaries.map(s => `
                                <div style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <div style="font-size: 13px; font-weight: 500; color: #111827;">${new Date(s.period_date).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
                                            <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${s.period_type === 'daily' ? 'Kunlik' : s.period_type === 'weekly' ? 'Haftalik' : 'Oylik'}</div>
                                        </div>
                                        <div style="font-size: 14px; font-weight: 600; color: #111827;">${formatCurrency(s.amount)}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    <!-- Bonuses List -->
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
                        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #111827;">Bonuslar</h4>
                        <div style="max-height: 280px; overflow-y: auto;">
                            ${bonuses.length === 0 ? '<div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 13px;">Ma\'lumotlar yo\'q</div>' :
                bonuses.map(b => `
                                <div style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div style="flex: 1; min-width: 0; margin-right: 12px;">
                                            <div style="font-size: 13px; font-weight: 500; color: #111827;">${new Date(b.bonus_date).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
                                            <div style="font-size: 11px; color: #6b7280; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${b.reason || '—'}</div>
                                        </div>
                                        <div style="font-size: 14px; font-weight: 600; color: #16a34a; flex-shrink: 0;">${formatCurrency(b.amount)}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    <!-- Penalties List -->
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
                        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #111827;">Jarimalar</h4>
                        <div style="max-height: 280px; overflow-y: auto;">
                            ${penalties.length === 0 ? '<div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 13px;">Ma\'lumotlar yo\'q</div>' :
                penalties.map(p => `
                                <div style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div style="flex: 1; min-width: 0; margin-right: 12px;">
                                            <div style="font-size: 13px; font-weight: 500; color: #111827;">${new Date(p.penalty_date).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
                                            <div style="font-size: 11px; color: #6b7280; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(p.reason || '—')}</div>
                                        </div>
                                        <div style="font-size: 14px; font-weight: 600; color: #dc2626; flex-shrink: 0;">${formatCurrency(p.amount)}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    <!-- KPI List -->
                    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;">
                        <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #111827;">KPI</h4>
                        <div style="max-height: 280px; overflow-y: auto;">
                            ${kpi.length === 0 ? '<div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 13px;">Ma\'lumotlar yo\'q</div>' :
                kpi.map(k => `
                                <div style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div style="flex: 1; min-width: 0; margin-right: 12px;">
                                            <div style="font-size: 13px; font-weight: 500; color: #111827;">${new Date(k.kpi_date).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
                                            <div style="font-size: 11px; color: #6b7280; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${k.score} ball ${escapeHtml(k.reason ? '| ' + k.reason : '')}</div>
                                        </div>
                                        <div style="font-size: 14px; font-weight: 600; color: #d97706; flex-shrink: 0;">${formatCurrency(k.amount)}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <!-- Calendar Container -->
                <div id="employeeSalaryCalendar" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px;"></div>
            </div>
            </div>
        `;

        // Generate calendar
        generateEmployeeSalaryCalendar(employeeId, monthlySalaries);

    } catch (error) {
        console.error('Error loading employee salary details:', error);
        modalContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #ef4444;">Xatolik yuz berdi: ' + escapeHtml(error.message) + '</div>';
    }
}

// Generate calendar for employee
function generateEmployeeSalaryCalendar(employeeId, monthlySalaries) {
    const calendarContainer = document.getElementById('employeeSalaryCalendar');
    if (!calendarContainer) return;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    // Get days in month
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay();
    const adjustedFirstDay = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Monday = 0

    // Weekday headers
    const weekdays = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
    let calendarHTML = weekdays.map(day => `<div style="text-align: center; font-weight: 600; color: #6b7280; padding: 8px; font-size: 12px;">${day}</div>`).join('');

    // Empty cells for days before month starts
    for (let i = 0; i < adjustedFirstDay; i++) {
        calendarHTML += '<div></div>';
    }

    // Create a map of dates with salaries
    const salaryDatesMap = new Map();
    monthlySalaries.forEach(salary => {
        const date = new Date(salary.period_date);
        const day = date.getDate();
        salaryDatesMap.set(day, salary);
    });

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const salary = salaryDatesMap.get(day);
        const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();

        let dayStyle = 'text-align: center; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: white;';
        if (salary) {
            dayStyle += ' background: #dbeafe; border-color: #3b82f6; font-weight: 600;';
        }
        if (isToday) {
            dayStyle += ' border: 2px solid #10b981;';
        }

        calendarHTML += `
            <div style="${dayStyle}" 
                 onclick="showDayDetails(${employeeId}, ${day}, ${currentMonth + 1}, ${currentYear})"
                 onmouseover="this.style.background='${salary ? '#bfdbfe' : '#f9fafb'}'; this.style.transform='scale(1.05)'"
                 onmouseout="this.style.background='${salary ? '#dbeafe' : 'white'}'; this.style.transform='scale(1)'">
                <div style="font-size: 14px; color: ${salary ? '#1e40af' : '#111827'}; margin-bottom: 4px;">${day}</div>
                ${salary ? `<div style="font-size: 10px; color: #3b82f6;">Maosh</div>` : ''}
            </div>
        `;
    }

    calendarContainer.innerHTML = calendarHTML;
}

// Show day details
async function showDayDetails(employeeId, day, month, year) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    try {
        // Get salaries, bonuses, penalties, KPI for this day
        const [salariesRes, bonusesRes, penaltiesRes, kpiRes] = await Promise.all([
            apiRequest(`/api/salaries?employee_id=${employeeId}&period_date=${dateStr}`),
            apiRequest(`/api/bonuses?employee_id=${employeeId}&bonus_date=${dateStr}`),
            apiRequest(`/api/penalties?employee_id=${employeeId}&penalty_date=${dateStr}`),
            apiRequest(`/api/kpi?employee_id=${employeeId}&kpi_date=${dateStr}`)
        ]);

        const salaries = salariesRes ? (await salariesRes.json()).salaries || [] : [];
        const bonuses = bonusesRes ? (await bonusesRes.json()).bonuses || [] : [];
        const penalties = penaltiesRes ? (await penaltiesRes.json()).penalties || [] : [];
        const kpi = kpiRes ? (await kpiRes.json()).kpi || [] : [];

        // formatCurrency funksiyasi allaqachon global funksiya sifatida mavjud

        const date = new Date(year, month - 1, day);
        const formattedDate = date.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' });

        alert(`${formattedDate} kunidagi ma'lumotlar:\n\n` +
            `Maoshlar: ${formatCurrency(salaries.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0))}\n` +
            `Bonuslar: ${formatCurrency(bonuses.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0))}\n` +
            `Jarimalar: ${formatCurrency(penalties.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0))}\n` +
            `KPI: ${formatCurrency(kpi.reduce((sum, k) => sum + parseFloat(k.amount || 0), 0))}`
        );
    } catch (error) {
        console.error('Error loading day details:', error);
        alert('Kun ma\'lumotlarini yuklashda xatolik');
    }
}

// Global scope ga qo'shish
window.editSalary = editSalary;
window.deleteSalary = deleteSalary;
window.showDayDetails = showDayDetails;

// ==================== BONUSES SECTION ====================

// DOM Elements
const addBonusIconBtn = document.getElementById('addBonusIconBtn');
const refreshBonusesBtn = document.getElementById('refreshBonusesBtn');
const bonusesList = document.getElementById('bonusesList');
const loadingBonusesMessage = document.getElementById('loadingBonusesMessage');
const emptyBonusesMessage = document.getElementById('emptyBonusesMessage');
const bonusEmployeeFilter = document.getElementById('bonusEmployeeFilter');
const bonusPeriodTypeFilter = document.getElementById('bonusPeriodTypeFilter');
const bonusDateFilter = document.getElementById('bonusDateFilter');

// Old modal elements (for compatibility)
const addBonusModal = document.getElementById('addBonusModal');
const addBonusModalForm = document.getElementById('addBonusModalForm');
const cancelAddBonusModalBtn = document.getElementById('cancelAddBonusModalBtn');
const saveAddBonusModalBtn = document.getElementById('saveAddBonusModalBtn');
const modalAddBonusLoader = document.getElementById('modalAddBonusLoader');
const modalAddBonusErrorMessage = document.getElementById('modalAddBonusErrorMessage');
const modalAddBonusSuccessMessage = document.getElementById('modalAddBonusSuccessMessage');

// Event Listeners
if (addBonusIconBtn) {
    addBonusIconBtn.addEventListener('click', function () {
        openAddBonusModal();
    });
}

// Bonus Modal Event Listeners
const bonusForm = document.getElementById('bonusForm');
const cancelBonusBtn = document.getElementById('cancelBonusBtn');

if (bonusForm) {
    bonusForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        await saveBonus();
    });
}

if (cancelBonusBtn) {
    cancelBonusBtn.addEventListener('click', function () {
        closeBonusModal();
    });
}

if (refreshBonusesBtn) {
    refreshBonusesBtn.addEventListener('click', function () {
        loadBonuses();
        loadDailyChanges();
    });
}

if (cancelAddBonusModalBtn) {
    cancelAddBonusModalBtn.addEventListener('click', function () {
        closeAddBonusModal();
    });
}

// Old modal form (for compatibility)
if (addBonusModalForm) {
    addBonusModalForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        await saveBonus();
    });
}

if (cancelAddBonusModalBtn) {
    cancelAddBonusModalBtn.addEventListener('click', function () {
        closeBonusModal();
    });
}

if (bonusEmployeeFilter) {
    bonusEmployeeFilter.addEventListener('change', function () {
        loadBonuses();
    });
}

if (bonusPeriodTypeFilter) {
    bonusPeriodTypeFilter.addEventListener('change', function () {
        loadBonuses();
    });
}

if (bonusDateFilter) {
    bonusDateFilter.addEventListener('change', function () {
        loadBonuses();
    });
}

// Functions
function openAddBonusModal() {
    const bonusModal = document.getElementById('bonusModal');
    if (!bonusModal) return;

    // Reset form
    const form = document.getElementById('bonusForm');
    if (form) form.reset();

    // Set modal title
    const title = document.getElementById('bonusModalTitle');
    if (title) title.textContent = 'Yangi Bonus Qo\'shish';

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    const bonusDate = document.getElementById('bonusDate');
    const bonusPeriodDate = document.getElementById('bonusPeriodDate');
    if (bonusDate) bonusDate.value = today;
    if (bonusPeriodDate) bonusPeriodDate.value = today;

    // Load employees
    loadEmployeesForBonusModal();

    // Hide messages
    hideBonusModalMessages();

    // Set edit mode to false
    window.currentBonusId = null;

    // Format qilish
    const bonusAmountInput = document.getElementById('bonusAmount');
    if (bonusAmountInput) {
        setupAmountInputFormatting('bonusAmount');
    }

    bonusModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

async function showEditBonusModal(id, employeeId, amount, bonusDate, periodType, periodDate, reason) {
    const bonusModal = document.getElementById('bonusModal');
    if (!bonusModal) return;

    // Set modal title
    const title = document.getElementById('bonusModalTitle');
    if (title) title.textContent = 'Bonusni Tahrirlash';

    // Hide messages
    hideBonusModalMessages();

    // Set edit mode
    window.currentBonusId = id;

    // Load employees first, then fill form
    await loadEmployeesForBonusModal();

    // Format dates for input type="date" (YYYY-MM-DD format)
    const formatDateForInput = (dateStr) => {
        if (!dateStr) return '';
        // If it's already in YYYY-MM-DD format, return as is
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
        }
        // If it's a full ISO date string, extract YYYY-MM-DD
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Fill form after employees are loaded
    const employeeSelect = document.getElementById('bonusEmployee');
    const amountInput = document.getElementById('bonusAmount');
    const dateInput = document.getElementById('bonusDate');
    const periodTypeSelect = document.getElementById('bonusPeriodType');
    const periodDateInput = document.getElementById('bonusPeriodDate');
    const reasonTextarea = document.getElementById('bonusReason');

    if (employeeSelect) employeeSelect.value = employeeId;
    if (amountInput) {
        amountInput.value = amount;
        formatAmountInput(amountInput);
        setupAmountInputFormatting('bonusAmount');
    }
    if (dateInput) dateInput.value = formatDateForInput(bonusDate);
    if (periodTypeSelect) periodTypeSelect.value = periodType;
    if (periodDateInput) periodDateInput.value = formatDateForInput(periodDate);
    if (reasonTextarea) reasonTextarea.value = reason || '';

    bonusModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeBonusModal() {
    const bonusModal = document.getElementById('bonusModal');
    if (!bonusModal) return;
    bonusModal.style.display = 'none';
    document.body.style.overflow = '';
    const form = document.getElementById('bonusForm');
    if (form) form.reset();
    hideBonusModalMessages();
    window.currentBonusId = null;
}

function hideBonusModalMessages() {
    const errorMsg = document.getElementById('bonusErrorMessage');
    const successMsg = document.getElementById('bonusSuccessMessage');
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';
}

async function loadEmployeesForBonusModal() {
    const employeeSelect = document.getElementById('bonusEmployee');
    if (!employeeSelect) return;

    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.employees) {
            const currentValue = employeeSelect.value;
            employeeSelect.innerHTML = '<option value="">Hodimni tanlang</option>';
            data.employees.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.id;
                option.textContent = `${emp.full_name || emp.username}${emp.position ? ` - ${emp.position}` : ''}`;
                employeeSelect.appendChild(option);
            });
            if (currentValue) employeeSelect.value = currentValue;
        }
    } catch (error) {
        console.error('Load employees for bonus modal error:', error);
    }
}

// Old function - keep for compatibility
function closeAddBonusModal() {
    closeBonusModal();
}

function hideBonusMessages() {
    if (modalAddBonusErrorMessage) modalAddBonusErrorMessage.style.display = 'none';
    if (modalAddBonusSuccessMessage) modalAddBonusSuccessMessage.style.display = 'none';
}

// Old function - redirect to new modal
async function loadEmployeesForBonuses() {
    loadEmployeesForBonusModal();
}

async function loadBonuses() {
    if (!bonusesList || !loadingBonusesMessage || !emptyBonusesMessage) return;

    showBonusesLoading(true);
    bonusesList.innerHTML = '';
    emptyBonusesMessage.style.display = 'none';

    try {
        const params = new URLSearchParams();

        if (bonusEmployeeFilter && bonusEmployeeFilter.value) {
            params.append('employee_id', bonusEmployeeFilter.value);
        }

        if (bonusPeriodTypeFilter && bonusPeriodTypeFilter.value) {
            params.append('period_type', bonusPeriodTypeFilter.value);
        }

        if (bonusDateFilter && bonusDateFilter.value) {
            params.append('period_date', bonusDateFilter.value);
        }

        const response = await apiRequest(`/api/bonuses?${params.toString()}`);
        if (!response) {
            showBonusesLoading(false);
            return;
        }

        const data = await response.json();
        showBonusesLoading(false);

        if (data.success && data.bonuses && data.bonuses.length > 0) {
            displayBonuses(data.bonuses);
            emptyBonusesMessage.style.display = 'none';
        } else {
            bonusesList.innerHTML = '';
            emptyBonusesMessage.style.display = 'block';
        }
    } catch (error) {
        showBonusesLoading(false);
        console.error('Load bonuses error:', error);
        emptyBonusesMessage.style.display = 'block';
        emptyBonusesMessage.textContent = 'Bonuslarni yuklashda xatolik yuz berdi';
    }
}

function displayBonuses(bonuses) {
    if (!bonusesList) return;

    bonusesList.innerHTML = '';

    // Group bonuses by employee_id
    const bonusesByEmployee = new Map();

    bonuses.forEach(bonus => {
        const empId = bonus.employee_id;
        if (!bonusesByEmployee.has(empId)) {
            bonusesByEmployee.set(empId, []);
        }
        bonusesByEmployee.get(empId).push(bonus);
    });

    // Display one card per employee with aggregated data
    bonusesByEmployee.forEach((employeeBonuses, employeeId) => {
        // Sort by period_date (newest first)
        employeeBonuses.sort((a, b) => new Date(b.period_date) - new Date(a.period_date));

        const firstBonus = employeeBonuses[0];
        const totalAmount = employeeBonuses.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);

        // Store all data for modal
        window.bonusData = window.bonusData || {};
        window.bonusData[employeeId] = {
            bonuses: employeeBonuses,
            totalAmount: totalAmount
        };

        const bonusItem = document.createElement('div');
        bonusItem.style.cssText = 'background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; transition: all 0.2s;';
        bonusItem.setAttribute('data-employee-id', employeeId);

        const latestPeriodDate = new Date(firstBonus.period_date);
        const formattedLatestDate = latestPeriodDate.toLocaleDateString('uz-UZ', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        const periodTypeLabels = {
            'daily': 'Kunlik',
            'weekly': 'Haftalik',
            'monthly': 'Oylik'
        };

        bonusItem.innerHTML = `
            <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;">
                <div style="width: 28px; height: 28px; border-radius: 6px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 12px; flex-shrink: 0;">
                    +
                </div>
                <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <div style="min-width: 0; flex: 0 0 auto;">
                        <div style="font-size: 13px; font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                            ${escapeHtml(firstBonus.full_name || 'Noma\'lum')}
                        </div>
                        <div style="font-size: 10px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                            ${escapeHtml(firstBonus.position || '')}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; min-width: 0; justify-content: flex-end;">
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <span style="font-size: 11px; color: #9ca3af;">Jami summa:</span>
                            <span style="font-size: 15px; font-weight: 700; color: #10b981; white-space: nowrap;">
                                ${formatCurrency(totalAmount)}
                            </span>
                        </div>
                        <div style="width: 1px; height: 16px; background: #e5e7eb; flex-shrink: 0;"></div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <span style="font-size: 11px; color: #9ca3af;">Davrlar:</span>
                            <span style="font-size: 12px; font-weight: 500; color: #374151; white-space: nowrap;">
                                ${employeeBonuses.length} ta
                            </span>
                        </div>
                        <div style="width: 1px; height: 16px; background: #e5e7eb; flex-shrink: 0;"></div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <span style="font-size: 11px; color: #9ca3af;">Oxirgi:</span>
                            <span style="font-size: 12px; color: #6b7280; white-space: nowrap;">
                                ${formattedLatestDate}
                            </span>
                        </div>
                        <button onclick="showBonusDetailsModal(${employeeId})" style="padding: 4px 10px; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: all 0.2s; flex-shrink: 0; line-height: 1.3;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
                            Batafsil
                        </button>
                    </div>
                </div>
                <div style="display: flex; gap: 4px; flex-shrink: 0;">
                    <button class="edit-btn" onclick="showEditBonusModal(${firstBonus.id}, ${firstBonus.employee_id}, ${firstBonus.amount}, '${firstBonus.bonus_date}', '${firstBonus.period_type}', '${firstBonus.period_date}', '${escapeHtml(firstBonus.reason || '')}')" title="Tahrirlash">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="delete-btn" onclick="deleteAllEmployeeBonuses(${employeeId}, '${escapeHtml(firstBonus.full_name || '')}')" title="O'chirish">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        bonusesList.appendChild(bonusItem);
    });
}

function showBonusesLoading(show) {
    if (loadingBonusesMessage) loadingBonusesMessage.style.display = show ? 'block' : 'none';
    if (bonusesList) bonusesList.style.display = show ? 'none' : 'grid';
}

async function saveBonus() {
    const form = document.getElementById('bonusForm');
    if (!form) return;

    const employeeId = document.getElementById('bonusEmployee')?.value;
    // Formatlangan qiymatni raqamli qiymatga o'zgartirish
    const amountRaw = document.getElementById('bonusAmount')?.value.replace(/[^\d]/g, '') || '';
    const amount = amountRaw ? parseFloat(amountRaw) : 0;
    const bonusDate = document.getElementById('bonusDate')?.value;
    const periodType = document.getElementById('bonusPeriodType')?.value;
    const periodDate = document.getElementById('bonusPeriodDate')?.value;
    const reason = document.getElementById('bonusReason')?.value;

    if (!employeeId || !amount || !bonusDate || !periodType || !periodDate) {
        showBonusModalError('Barcha majburiy maydonlarni to\'ldiring');
        return;
    }

    if (isNaN(amount) || amount <= 0) {
        showBonusModalError('Summa musbat son bo\'lishi kerak');
        return;
    }

    setBonusModalLoading(true);
    hideBonusModalMessages();

    try {
        const isEdit = window.currentBonusId !== null;
        const url = isEdit ? `/api/bonuses/${window.currentBonusId}` : '/api/bonuses';
        const method = isEdit ? 'PUT' : 'POST';

        const response = await apiRequest(url, {
            method: method,
            body: JSON.stringify({
                employee_id: parseInt(employeeId),
                amount: amount,
                bonus_date: bonusDate,
                period_type: periodType,
                period_date: periodDate,
                reason: reason || null
            })
        });

        if (!response) {
            setBonusModalLoading(false);
            showBonusModalError('Serverga ulanib bo\'lmadi');
            return;
        }

        const data = await response.json();
        setBonusModalLoading(false);

        if (data.success) {
            showBonusModalSuccess(isEdit ? 'Bonus muvaffaqiyatli yangilandi' : 'Bonus muvaffaqiyatli qo\'shildi');
            setTimeout(() => {
                closeBonusModal();
                loadBonuses();
            }, 1500);
        } else {
            showBonusModalError(data.message || 'Xatolik yuz berdi');
        }
    } catch (error) {
        setBonusModalLoading(false);
        console.error('Save bonus error:', error);
        showBonusModalError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}

async function deleteBonus(id, employeeName) {
    if (!confirm(`Haqiqatan ham "${employeeName}" ning bonusini o'chirmoqchimisiz?`)) {
        return;
    }

    try {
        const response = await apiRequest(`/api/bonuses/${id}`, {
            method: 'DELETE'
        });

        if (!response) {
            alert('Serverga ulanib bo\'lmadi');
            return;
        }

        const data = await response.json();

        if (data.success) {
            loadBonuses();
        } else {
            alert(data.message || 'Bonusni o\'chirishda xatolik');
        }
    } catch (error) {
        console.error('Delete bonus error:', error);
        alert('Serverga ulanib bo\'lmadi');
    }
}

async function deleteAllEmployeeBonuses(employeeId, employeeName) {
    const bonusData = window.bonusData && window.bonusData[employeeId];
    if (!bonusData || !bonusData.bonuses) {
        alert('Ma\'lumotlar topilmadi');
        return;
    }

    const bonusesCount = bonusData.bonuses.length;
    if (!confirm(`Haqiqatan ham "${employeeName}" ning barcha ${bonusesCount} ta bonusini o'chirmoqchimisiz?`)) {
        return;
    }

    try {
        // Delete all bonuses for this employee
        let successCount = 0;
        let failCount = 0;

        for (const bonus of bonusData.bonuses) {
            try {
                const response = await apiRequest(`/api/bonuses/${bonus.id}`, { method: 'DELETE' });
                if (response) {
                    const data = await response.json();
                    if (data.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error(`Error deleting bonus ${bonus.id}:`, error);
                failCount++;
            }
        }

        if (failCount === 0) {
            loadBonuses();
        } else if (successCount > 0) {
            alert(`${successCount} ta bonus o'chirildi, ${failCount} tasida xatolik yuz berdi`);
            loadBonuses();
        } else {
            alert('Bonuslarni o\'chirishda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Delete all employee bonuses error:', error);
        alert('Serverga ulanib bo\'lmadi');
    }
}

function setBonusModalLoading(loading) {
    const saveBtn = document.getElementById('saveBonusBtn');
    const loader = document.getElementById('bonusLoader');
    if (saveBtn) {
        saveBtn.disabled = loading;
        const btnText = saveBtn.querySelector('.btn-text');
        if (btnText) btnText.style.display = loading ? 'none' : 'inline';
    }
    if (loader) loader.style.display = loading ? 'inline-block' : 'none';
}

function showBonusModalError(message) {
    const errorMsg = document.getElementById('bonusErrorMessage');
    const successMsg = document.getElementById('bonusSuccessMessage');
    if (errorMsg) {
        errorMsg.textContent = message;
        errorMsg.style.display = 'block';
    }
    if (successMsg) successMsg.style.display = 'none';
}

function showBonusModalSuccess(message) {
    const errorMsg = document.getElementById('bonusErrorMessage');
    const successMsg = document.getElementById('bonusSuccessMessage');
    if (successMsg) {
        successMsg.textContent = message;
        successMsg.style.display = 'block';
    }
    if (errorMsg) errorMsg.style.display = 'none';
}

// Bonus Details Modal Functions
function showBonusDetailsModal(employeeId) {
    const modal = document.getElementById('bonusDetailsModal');
    const title = document.getElementById('bonusDetailsTitle');
    const content = document.getElementById('bonusDetailsContent');

    if (!modal || !content) return;

    const bonusData = window.bonusData && window.bonusData[employeeId];
    if (!bonusData) {
        alert('Ma\'lumotlar topilmadi');
        return;
    }

    const { bonuses, totalAmount } = bonusData;

    const periodTypeLabels = {
        'daily': 'Kunlik',
        'weekly': 'Haftalik',
        'monthly': 'Oylik'
    };

    // Sort by period_date (newest first)
    const sortedBonuses = [...bonuses].sort((a, b) => new Date(b.period_date) - new Date(a.period_date));

    // Set title
    if (title) {
        title.textContent = `${bonuses[0].full_name || 'Noma\'lum'} - Barcha bonuslar`;
    }

    // Build content
    content.innerHTML = `
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 16px; border-radius: 8px; margin-bottom: 16px; color: white;">
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                <div>
                    <div style="font-size: 11px; color: rgba(255, 255, 255, 0.8); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px;">Jami summa</div>
                    <div style="font-size: 20px; font-weight: 700;">${formatCurrency(totalAmount)}</div>
                </div>
                <div>
                    <div style="font-size: 11px; color: rgba(255, 255, 255, 0.8); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px;">Davrlar soni</div>
                    <div style="font-size: 20px; font-weight: 700;">${bonuses.length}</div>
                </div>
            </div>
        </div>
        
        <div style="margin-bottom: 12px;">
            <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 8px;">Barcha bonuslar:</div>
            <div style="display: grid; gap: 8px; max-height: 400px; overflow-y: auto;">
                ${sortedBonuses.map(bonus => {
        const bonusDateObj = new Date(bonus.bonus_date);
        const periodDateObj = new Date(bonus.period_date);
        const formattedBonusDate = bonusDateObj.toLocaleDateString('uz-UZ', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const formattedPeriodDate = periodDateObj.toLocaleDateString('uz-UZ', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        return `
                        <div style="padding: 12px; background: white; border: 1px solid #e5e7eb; border-radius: 6px; transition: all 0.2s;" onmouseover="this.style.borderColor='#10b981'; this.style.background='#f0fdf4'" onmouseout="this.style.borderColor='#e5e7eb'; this.style.background='white'">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <div>
                                    <div style="font-size: 12px; font-weight: 600; color: #111827; margin-bottom: 2px;">${periodTypeLabels[bonus.period_type] || bonus.period_type}</div>
                                    <div style="font-size: 11px; color: #6b7280;">Davr: ${formattedPeriodDate}</div>
                                    <div style="font-size: 11px; color: #6b7280;">Sana: ${formattedBonusDate}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 16px; font-weight: 700; color: #10b981;">${formatCurrency(bonus.amount)}</div>
                                </div>
                            </div>
                            ${bonus.reason ? `
                                <div style="font-size: 11px; color: #4b5563; padding: 8px; background: #f9fafb; border-radius: 6px; border-left: 3px solid #10b981; margin-top: 8px; line-height: 1.4;">
                                    ${escapeHtml(bonus.reason)}
                                </div>
                            ` : ''}
                        </div>
                    `;
    }).join('')}
            </div>
        </div>
    `;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeBonusDetailsModal() {
    const modal = document.getElementById('bonusDetailsModal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

// Old functions - redirect to new functions
function setAddBonusLoading(loading) {
    setBonusModalLoading(loading);
}

function showBonusError(message) {
    showBonusModalError(message);
}

function showBonusSuccess(message) {
    showBonusModalSuccess(message);
}

function hideBonusMessages() {
    hideBonusModalMessages();
}

// Load employees for filter dropdown
async function loadEmployeesForBonuses() {
    if (!bonusEmployeeFilter) return;

    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.employees) {
            const currentValue = bonusEmployeeFilter.value;
            bonusEmployeeFilter.innerHTML = '<option value="">Barcha hodimlar</option>';
            data.employees.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.id;
                option.textContent = `${emp.full_name || emp.username}${emp.position ? ` - ${emp.position}` : ''}`;
                bonusEmployeeFilter.appendChild(option);
            });
            if (currentValue) bonusEmployeeFilter.value = currentValue;
        }
    } catch (error) {
        console.error('Load employees for bonuses filter error:', error);
    }
}

// ==================== PENALTIES SECTION ====================

// DOM Elements
const addPenaltyIconBtn = document.getElementById('addPenaltyIconBtn');
const refreshPenaltiesBtn = document.getElementById('refreshPenaltiesBtn');
const penaltiesList = document.getElementById('penaltiesList');
const loadingPenaltiesMessage = document.getElementById('loadingPenaltiesMessage');
const emptyPenaltiesMessage = document.getElementById('emptyPenaltiesMessage');
const penaltyEmployeeFilter = document.getElementById('penaltyEmployeeFilter');
const penaltyPeriodTypeFilter = document.getElementById('penaltyPeriodTypeFilter');
const penaltyDateFilter = document.getElementById('penaltyDateFilter');

// Event Listeners
if (addPenaltyIconBtn) {
    addPenaltyIconBtn.addEventListener('click', function () {
        openAddPenaltyModal();
    });
}

if (refreshPenaltiesBtn) {
    refreshPenaltiesBtn.addEventListener('click', function () {
        loadPenalties();
        loadDailyChanges();
    });
}

if (penaltyEmployeeFilter) {
    penaltyEmployeeFilter.addEventListener('change', function () {
        loadPenalties();
    });
}

if (penaltyPeriodTypeFilter) {
    penaltyPeriodTypeFilter.addEventListener('change', function () {
        loadPenalties();
    });
}

if (penaltyDateFilter) {
    penaltyDateFilter.addEventListener('change', function () {
        loadPenalties();
    });
}

// Penalty Modal Event Listeners
const penaltyForm = document.getElementById('penaltyForm');
const cancelPenaltyBtn = document.getElementById('cancelPenaltyBtn');

if (penaltyForm) {
    penaltyForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        await savePenalty();
    });
}

if (cancelPenaltyBtn) {
    cancelPenaltyBtn.addEventListener('click', function () {
        closePenaltyModal();
    });
}

// Penalties Functions
function openAddPenaltyModal() {
    const penaltyModal = document.getElementById('penaltyModal');
    if (!penaltyModal) return;

    // Reset form
    const form = document.getElementById('penaltyForm');
    if (form) form.reset();

    // Set modal title
    const title = document.getElementById('penaltyModalTitle');
    if (title) title.textContent = 'Yangi Jarima Qo\'shish';

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    const penaltyDate = document.getElementById('penaltyDate');
    const penaltyPeriodDate = document.getElementById('penaltyPeriodDate');
    if (penaltyDate) penaltyDate.value = today;
    if (penaltyPeriodDate) penaltyPeriodDate.value = today;

    // Load employees
    loadEmployeesForPenaltyModal();

    // Hide messages
    hidePenaltyModalMessages();

    // Set edit mode to false
    window.currentPenaltyId = null;

    // Format qilish
    const penaltyAmountInput = document.getElementById('penaltyAmount');
    if (penaltyAmountInput) {
        setupAmountInputFormatting('penaltyAmount');
    }

    penaltyModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

async function showEditPenaltyModal(id, employeeId, amount, penaltyDate, periodType, periodDate, reason) {
    const penaltyModal = document.getElementById('penaltyModal');
    if (!penaltyModal) return;

    // Set modal title
    const title = document.getElementById('penaltyModalTitle');
    if (title) title.textContent = 'Jarimani Tahrirlash';

    // Hide messages
    hidePenaltyModalMessages();

    // Set edit mode
    window.currentPenaltyId = id;

    // Load employees first, then fill form
    await loadEmployeesForPenaltyModal();

    // Format dates for input type="date" (YYYY-MM-DD format)
    const formatDateForInput = (dateStr) => {
        if (!dateStr) return '';
        // If it's already in YYYY-MM-DD format, return as is
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return dateStr;
        }
        // If it's a full ISO date string, extract YYYY-MM-DD
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Fill form after employees are loaded
    const employeeSelect = document.getElementById('penaltyEmployee');
    const amountInput = document.getElementById('penaltyAmount');
    const dateInput = document.getElementById('penaltyDate');
    const periodTypeSelect = document.getElementById('penaltyPeriodType');
    const periodDateInput = document.getElementById('penaltyPeriodDate');
    const reasonTextarea = document.getElementById('penaltyReason');

    if (employeeSelect) employeeSelect.value = employeeId;
    if (amountInput) {
        amountInput.value = amount;
        formatAmountInput(amountInput);
        setupAmountInputFormatting('penaltyAmount');
    }
    if (dateInput) dateInput.value = formatDateForInput(penaltyDate);
    if (periodTypeSelect) periodTypeSelect.value = periodType;
    if (periodDateInput) periodDateInput.value = formatDateForInput(periodDate);
    if (reasonTextarea) reasonTextarea.value = reason || '';

    penaltyModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closePenaltyModal() {
    const penaltyModal = document.getElementById('penaltyModal');
    if (!penaltyModal) return;
    penaltyModal.style.display = 'none';
    document.body.style.overflow = '';
    const form = document.getElementById('penaltyForm');
    if (form) form.reset();
    hidePenaltyModalMessages();
    window.currentPenaltyId = null;
}

function hidePenaltyModalMessages() {
    const errorMsg = document.getElementById('penaltyErrorMessage');
    const successMsg = document.getElementById('penaltySuccessMessage');
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';
}

async function loadEmployeesForPenaltyModal() {
    const employeeSelect = document.getElementById('penaltyEmployee');
    if (!employeeSelect) return;

    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.employees) {
            const currentValue = employeeSelect.value;
            employeeSelect.innerHTML = '<option value="">Hodimni tanlang</option>';
            data.employees.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.id;
                option.textContent = `${emp.full_name || emp.username}${emp.position ? ` - ${emp.position}` : ''}`;
                employeeSelect.appendChild(option);
            });
            if (currentValue) employeeSelect.value = currentValue;
        }
    } catch (error) {
        console.error('Load employees for penalty modal error:', error);
    }
}

async function loadPenalties() {
    if (!penaltiesList || !loadingPenaltiesMessage || !emptyPenaltiesMessage) return;

    showPenaltiesLoading(true);
    penaltiesList.innerHTML = '';
    emptyPenaltiesMessage.style.display = 'none';

    try {
        const params = new URLSearchParams();

        if (penaltyEmployeeFilter && penaltyEmployeeFilter.value) {
            params.append('employee_id', penaltyEmployeeFilter.value);
        }

        if (penaltyPeriodTypeFilter && penaltyPeriodTypeFilter.value) {
            params.append('period_type', penaltyPeriodTypeFilter.value);
        }

        if (penaltyDateFilter && penaltyDateFilter.value) {
            params.append('period_date', penaltyDateFilter.value);
        }

        const response = await apiRequest(`/api/penalties?${params.toString()}`);
        if (!response) {
            showPenaltiesLoading(false);
            return;
        }

        const data = await response.json();
        showPenaltiesLoading(false);

        if (data.success && data.penalties && data.penalties.length > 0) {
            displayPenalties(data.penalties);
            emptyPenaltiesMessage.style.display = 'none';
        } else {
            penaltiesList.innerHTML = '';
            emptyPenaltiesMessage.style.display = 'block';
        }
    } catch (error) {
        showPenaltiesLoading(false);
        console.error('Load penalties error:', error);
        emptyPenaltiesMessage.style.display = 'block';
        emptyPenaltiesMessage.textContent = 'Jarimalarni yuklashda xatolik yuz berdi';
    }
}

function displayPenalties(penalties) {
    if (!penaltiesList) return;

    penaltiesList.innerHTML = '';

    // Group penalties by employee_id
    const penaltiesByEmployee = new Map();

    penalties.forEach(penalty => {
        const empId = penalty.employee_id;
        if (!penaltiesByEmployee.has(empId)) {
            penaltiesByEmployee.set(empId, []);
        }
        penaltiesByEmployee.get(empId).push(penalty);
    });

    // Display one card per employee with aggregated data
    penaltiesByEmployee.forEach((employeePenalties, employeeId) => {
        // Sort by period_date (newest first)
        employeePenalties.sort((a, b) => new Date(b.period_date) - new Date(a.period_date));

        const firstPenalty = employeePenalties[0];
        const totalAmount = employeePenalties.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

        // Parse all reasons to get all late entries
        let allLateData = [];
        let totalLateDays = 0;
        let totalLateMinutes = 0;

        employeePenalties.forEach(penalty => {
            if (penalty.reason) {
                try {
                    const reasonParts = penalty.reason.split('; ');
                    const lateEntries = reasonParts.filter(r => r.includes('Kech qolgan:'));

                    lateEntries.forEach(entry => {
                        const match = entry.match(/(\d{4}-\d{2}-\d{2}):\s*Kech qolgan:\s*(\d+)\s*minut/i);
                        if (match) {
                            allLateData.push({
                                date: match[1],
                                minutes: parseInt(match[2]),
                                periodDate: penalty.period_date,
                                periodType: penalty.period_type,
                                amount: parseFloat(penalty.amount || 0)
                            });
                        }
                    });
                } catch (error) {
                    console.error('Error parsing penalty reason:', error);
                }
            }
        });

        if (allLateData.length > 0) {
            totalLateDays = new Set(allLateData.map(d => d.date)).size;
            totalLateMinutes = allLateData.reduce((sum, d) => sum + d.minutes, 0);
        }

        const avgLateMinutes = totalLateDays > 0 ? Math.round(totalLateMinutes / totalLateDays) : 0;

        // Store all data for modal
        window.penaltyLateData = window.penaltyLateData || {};
        window.penaltyLateData[employeeId] = {
            lateData: allLateData,
            employeeName: firstPenalty.full_name || 'Noma\'lum',
            penalties: employeePenalties,
            totalAmount: totalAmount
        };

        const penaltyItem = document.createElement('div');
        penaltyItem.style.cssText = 'background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; transition: all 0.2s;';
        penaltyItem.setAttribute('data-employee-id', employeeId);

        const latestPeriodDate = new Date(firstPenalty.period_date);
        const formattedLatestDate = latestPeriodDate.toLocaleDateString('uz-UZ', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        const periodTypeLabels = {
            'daily': 'Kunlik',
            'weekly': 'Haftalik',
            'monthly': 'Oylik'
        };

        penaltyItem.innerHTML = `
            <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;">
                <div style="width: 28px; height: 28px; border-radius: 6px; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 12px; flex-shrink: 0;">
                    −
                </div>
                <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <div style="min-width: 0; flex: 0 0 auto;">
                        <div style="font-size: 13px; font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                            ${escapeHtml(firstPenalty.full_name || 'Noma\'lum')}
                        </div>
                        <div style="font-size: 10px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                            ${escapeHtml(firstPenalty.position || '')}
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; min-width: 0; justify-content: flex-end;">
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <span style="font-size: 11px; color: #9ca3af;">Jami summa:</span>
                            <span style="font-size: 15px; font-weight: 700; color: #dc2626; white-space: nowrap;">
                                ${formatCurrency(totalAmount)}
                            </span>
                        </div>
                        <div style="width: 1px; height: 16px; background: #e5e7eb; flex-shrink: 0;"></div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <span style="font-size: 11px; color: #9ca3af;">Davrlar:</span>
                            <span style="font-size: 12px; font-weight: 500; color: #374151; white-space: nowrap;">
                                ${employeePenalties.length} ta
                            </span>
                        </div>
                        <div style="width: 1px; height: 16px; background: #e5e7eb; flex-shrink: 0;"></div>
                        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                            <span style="font-size: 11px; color: #9ca3af;">Oxirgi:</span>
                            <span style="font-size: 12px; color: #6b7280; white-space: nowrap;">
                                ${formattedLatestDate}
                            </span>
                        </div>
                        ${allLateData.length > 0 ? `
                            <div style="width: 1px; height: 16px; background: #e5e7eb; flex-shrink: 0;"></div>
                            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                                <span style="font-size: 11px; color: #9ca3af;">Kechikish:</span>
                                <span style="font-size: 12px; font-weight: 600; color: #dc2626; white-space: nowrap;">
                                    ${totalLateDays} kun, ${avgLateMinutes} min
                                </span>
                            </div>
                            <button onclick="showPenaltyDetailsModal(${employeeId})" style="padding: 4px 10px; background: #dc2626; color: white; border: none; border-radius: 4px; font-size: 10px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: all 0.2s; flex-shrink: 0; line-height: 1.3;" onmouseover="this.style.background='#b91c1c'" onmouseout="this.style.background='#dc2626'">
                                Batafsil
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 4px; flex-shrink: 0;">
                    <button class="edit-btn" onclick="showEditPenaltyModal(${firstPenalty.id}, ${firstPenalty.employee_id}, ${firstPenalty.amount}, '${firstPenalty.penalty_date}', '${firstPenalty.period_type}', '${firstPenalty.period_date}', '${escapeHtml(firstPenalty.reason || '')}')" title="Tahrirlash">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="delete-btn" onclick="deleteAllEmployeePenalties(${employeeId}, '${escapeHtml(firstPenalty.full_name || '')}')" title="O'chirish">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        penaltiesList.appendChild(penaltyItem);
    });
}

function showPenaltiesLoading(show) {
    if (loadingPenaltiesMessage) loadingPenaltiesMessage.style.display = show ? 'block' : 'none';
    if (penaltiesList) penaltiesList.style.display = show ? 'none' : 'grid';
}

async function savePenalty() {
    const form = document.getElementById('penaltyForm');
    if (!form) return;

    const employeeId = document.getElementById('penaltyEmployee')?.value;
    // Formatlangan qiymatni raqamli qiymatga o'zgartirish
    const amountRaw = document.getElementById('penaltyAmount')?.value.replace(/[^\d]/g, '') || '';
    const amount = amountRaw ? parseFloat(amountRaw) : 0;
    const penaltyDate = document.getElementById('penaltyDate')?.value;
    const periodType = document.getElementById('penaltyPeriodType')?.value;
    const periodDate = document.getElementById('penaltyPeriodDate')?.value;
    const reason = document.getElementById('penaltyReason')?.value;

    if (!employeeId || !amount || !penaltyDate || !periodType || !periodDate) {
        showPenaltyModalError('Barcha majburiy maydonlarni to\'ldiring');
        return;
    }

    if (isNaN(amount) || amount <= 0) {
        showPenaltyModalError('Summa musbat son bo\'lishi kerak');
        return;
    }

    setPenaltyModalLoading(true);
    hidePenaltyModalMessages();

    try {
        const isEdit = window.currentPenaltyId !== null;
        const url = isEdit ? `/api/penalties/${window.currentPenaltyId}` : '/api/penalties';
        const method = isEdit ? 'PUT' : 'POST';

        const response = await apiRequest(url, {
            method: method,
            body: JSON.stringify({
                employee_id: parseInt(employeeId),
                amount: amount,
                penalty_date: penaltyDate,
                period_type: periodType,
                period_date: periodDate,
                reason: reason || null
            })
        });

        if (!response) {
            setPenaltyModalLoading(false);
            showPenaltyModalError('Serverga ulanib bo\'lmadi');
            return;
        }

        const data = await response.json();
        setPenaltyModalLoading(false);

        if (data.success) {
            showPenaltyModalSuccess(isEdit ? 'Jarima muvaffaqiyatli yangilandi' : 'Jarima muvaffaqiyatli qo\'shildi');
            setTimeout(() => {
                closePenaltyModal();
                loadPenalties();
            }, 1500);
        } else {
            showPenaltyModalError(data.message || 'Xatolik yuz berdi');
        }
    } catch (error) {
        setPenaltyModalLoading(false);
        console.error('Save penalty error:', error);
        showPenaltyModalError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
    }
}

async function deletePenalty(id, employeeName) {
    if (!confirm(`Haqiqatan ham "${employeeName}" ning jarimasini o'chirmoqchimisiz?`)) {
        return;
    }

    try {
        const response = await apiRequest(`/api/penalties/${id}`, {
            method: 'DELETE'
        });

        if (!response) {
            alert('Serverga ulanib bo\'lmadi');
            return;
        }

        const data = await response.json();

        if (data.success) {
            loadPenalties();
        } else {
            alert(data.message || 'Jarimani o\'chirishda xatolik');
        }
    } catch (error) {
        console.error('Delete penalty error:', error);
        alert('Serverga ulanib bo\'lmadi');
    }
}

async function deleteAllEmployeePenalties(employeeId, employeeName) {
    const penaltyData = window.penaltyLateData && window.penaltyLateData[employeeId];
    if (!penaltyData || !penaltyData.penalties) {
        alert('Ma\'lumotlar topilmadi');
        return;
    }

    const penaltiesCount = penaltyData.penalties.length;
    if (!confirm(`Haqiqatan ham "${employeeName}" ning barcha ${penaltiesCount} ta jarimasini o'chirmoqchimisiz?`)) {
        return;
    }

    try {
        // Delete all penalties for this employee
        let successCount = 0;
        let failCount = 0;

        for (const penalty of penaltyData.penalties) {
            try {
                const response = await apiRequest(`/api/penalties/${penalty.id}`, { method: 'DELETE' });
                if (response) {
                    const data = await response.json();
                    if (data.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error(`Error deleting penalty ${penalty.id}:`, error);
                failCount++;
            }
        }

        if (failCount === 0) {
            loadPenalties();
        } else if (successCount > 0) {
            alert(`${successCount} ta jarima o'chirildi, ${failCount} tasida xatolik yuz berdi`);
            loadPenalties();
        } else {
            alert('Jarimalarni o\'chirishda xatolik yuz berdi');
        }
    } catch (error) {
        console.error('Delete all employee penalties error:', error);
        alert('Serverga ulanib bo\'lmadi');
    }
}

function setPenaltyModalLoading(loading) {
    const saveBtn = document.getElementById('savePenaltyBtn');
    const loader = document.getElementById('penaltyLoader');
    if (saveBtn) {
        saveBtn.disabled = loading;
        const btnText = saveBtn.querySelector('.btn-text');
        if (btnText) btnText.style.display = loading ? 'none' : 'inline';
    }
    if (loader) loader.style.display = loading ? 'inline-block' : 'none';
}

function showPenaltyModalError(message) {
    const errorMsg = document.getElementById('penaltyErrorMessage');
    const successMsg = document.getElementById('penaltySuccessMessage');
    if (errorMsg) {
        errorMsg.textContent = message;
        errorMsg.style.display = 'block';
    }
    if (successMsg) successMsg.style.display = 'none';
}

function showPenaltyModalSuccess(message) {
    const errorMsg = document.getElementById('penaltyErrorMessage');
    const successMsg = document.getElementById('penaltySuccessMessage');
    if (successMsg) {
        successMsg.textContent = message;
        successMsg.style.display = 'block';
    }
    if (errorMsg) errorMsg.style.display = 'none';
}

// Penalty Details Modal Functions
function showPenaltyDetailsModal(employeeId) {
    const modal = document.getElementById('penaltyDetailsModal');
    const title = document.getElementById('penaltyDetailsTitle');
    const content = document.getElementById('penaltyDetailsContent');

    if (!modal || !content) return;

    const penaltyData = window.penaltyLateData && window.penaltyLateData[employeeId];
    if (!penaltyData) {
        alert('Ma\'lumotlar topilmadi');
        return;
    }

    const { lateData, employeeName, penalties, totalAmount } = penaltyData;

    const periodTypeLabels = {
        'daily': 'Kunlik',
        'weekly': 'Haftalik',
        'monthly': 'Oylik'
    };

    // Calculate statistics
    const uniqueLateDays = new Set(lateData.map(d => d.date)).size;
    const totalLateMinutes = lateData.reduce((sum, d) => sum + d.minutes, 0);
    const avgLateMinutes = uniqueLateDays > 0 ? Math.round(totalLateMinutes / uniqueLateDays) : 0;
    const maxLate = lateData.length > 0 ? Math.max(...lateData.map(d => d.minutes)) : 0;
    const minLate = lateData.length > 0 ? Math.min(...lateData.map(d => d.minutes)) : 0;

    // Group late data by period
    const lateDataByPeriod = new Map();
    lateData.forEach(d => {
        const key = `${d.periodDate}_${d.periodType}`;
        if (!lateDataByPeriod.has(key)) {
            lateDataByPeriod.set(key, {
                periodDate: d.periodDate,
                periodType: d.periodType,
                lateEntries: [],
                periodAmount: d.amount
            });
        }
        lateDataByPeriod.get(key).lateEntries.push(d);
    });

    // Sort by date (newest first)
    const sortedLateData = [...lateData].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Set title
    if (title) {
        title.textContent = `${employeeName} - Barcha jarimalar va kechikishlar`;
    }

    // Build content
    content.innerHTML = `
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 16px; border-radius: 8px; margin-bottom: 16px; color: white;">
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                <div>
                    <div style="font-size: 11px; color: rgba(255, 255, 255, 0.8); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px;">Jami summa</div>
                    <div style="font-size: 20px; font-weight: 700;">${formatCurrency(totalAmount)}</div>
                </div>
                <div>
                    <div style="font-size: 11px; color: rgba(255, 255, 255, 0.8); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px;">Davrlar soni</div>
                    <div style="font-size: 20px; font-weight: 700;">${penalties.length}</div>
                </div>
                <div>
                    <div style="font-size: 11px; color: rgba(255, 255, 255, 0.8); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px;">Kechikish kunlar</div>
                    <div style="font-size: 20px; font-weight: 700;">${uniqueLateDays}</div>
                </div>
                <div>
                    <div style="font-size: 11px; color: rgba(255, 255, 255, 0.8); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.3px;">O'rtacha kechikish</div>
                    <div style="font-size: 20px; font-weight: 700;">${avgLateMinutes} min</div>
                </div>
            </div>
        </div>
        
        ${lateData.length > 0 ? `
            <div style="margin-bottom: 16px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 8px;">Statistika:</div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                    <div style="padding: 10px; background: #fef2f2; border-radius: 6px; border-left: 3px solid #dc2626;">
                        <div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">Maksimal kechikish</div>
                        <div style="font-size: 16px; font-weight: 700; color: #dc2626;">${maxLate} min</div>
                    </div>
                    <div style="padding: 10px; background: #fef2f2; border-radius: 6px; border-left: 3px solid #dc2626;">
                        <div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">Minimal kechikish</div>
                        <div style="font-size: 16px; font-weight: 700; color: #dc2626;">${minLate} min</div>
                    </div>
                </div>
            </div>
        ` : ''}
        
        <div style="margin-bottom: 12px;">
            <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 8px;">Davrlar bo'yicha:</div>
            <div style="display: grid; gap: 8px; max-height: 300px; overflow-y: auto;">
                ${Array.from(lateDataByPeriod.entries()).sort((a, b) => new Date(b[1].periodDate) - new Date(a[1].periodDate)).map(([key, periodData]) => {
        const periodDateObj = new Date(periodData.periodDate);
        const formattedPeriodDate = periodDateObj.toLocaleDateString('uz-UZ', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const periodLateDays = new Set(periodData.lateEntries.map(e => e.date)).size;
        const periodLateMinutes = periodData.lateEntries.reduce((sum, e) => sum + e.minutes, 0);
        const periodAvgLate = periodLateDays > 0 ? Math.round(periodLateMinutes / periodLateDays) : 0;

        return `
                        <div style="padding: 12px; background: white; border: 1px solid #e5e7eb; border-radius: 6px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <div>
                                    <div style="font-size: 12px; font-weight: 600; color: #111827;">${periodTypeLabels[periodData.periodType] || periodData.periodType}</div>
                                    <div style="font-size: 11px; color: #6b7280;">${formattedPeriodDate}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 12px; font-weight: 700; color: #dc2626;">${formatCurrency(periodData.periodAmount)}</div>
                                </div>
                            </div>
                            <div style="font-size: 11px; color: #6b7280;">
                                ${periodLateDays} kun kechikish, o'rtacha ${periodAvgLate} min
                            </div>
                        </div>
                    `;
    }).join('')}
            </div>
        </div>
        
        ${lateData.length > 0 ? `
            <div style="margin-bottom: 12px;">
                <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 8px;">Barcha kechikishlar (${sortedLateData.length} ta):</div>
                <div style="display: grid; gap: 6px; max-height: 300px; overflow-y: auto;">
                    ${sortedLateData.map(d => {
        const dateObj = new Date(d.date);
        const dateStr = dateObj.toLocaleDateString('uz-UZ', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'short'
        });
        return `
                            <div style="padding: 10px 12px; background: white; border: 1px solid #e5e7eb; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s;" onmouseover="this.style.borderColor='#dc2626'; this.style.background='#fef2f2'" onmouseout="this.style.borderColor='#e5e7eb'; this.style.background='white'">
                                <div>
                                    <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 2px;">${dateStr}</div>
                                    <div style="font-size: 11px; color: #6b7280;">${d.date}</div>
                                </div>
                                <div style="background: #fee2e2; color: #dc2626; padding: 6px 12px; border-radius: 6px; font-size: 14px; font-weight: 700;">
                                    ${d.minutes} min
                                </div>
                            </div>
                        `;
    }).join('')}
                </div>
            </div>
        ` : ''}
    `;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closePenaltyDetailsModal() {
    const modal = document.getElementById('penaltyDetailsModal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

// Load employees for penalty filter
async function loadEmployeesForPenaltyFilter() {
    if (!penaltyEmployeeFilter) return;

    try {
        const response = await apiRequest('/api/employees');
        if (!response) return;

        const data = await response.json();
        if (data.success && data.employees) {
            const currentValue = penaltyEmployeeFilter.value;
            penaltyEmployeeFilter.innerHTML = '<option value="">Barcha hodimlar</option>';
            data.employees.forEach(emp => {
                const option = document.createElement('option');
                option.value = emp.id;
                option.textContent = `${emp.full_name || emp.username}${emp.position ? ` - ${emp.position}` : ''}`;
                penaltyEmployeeFilter.appendChild(option);
            });
            if (currentValue) penaltyEmployeeFilter.value = currentValue;
        }
    } catch (error) {
        console.error('Load employees for penalty filter error:', error);
    }
}

// Make functions global
window.showEditBonusModal = showEditBonusModal;
window.deleteBonus = deleteBonus;
window.showEditPenaltyModal = showEditPenaltyModal;
window.deletePenalty = deletePenalty;
window.loadEmployees = loadEmployees;

// ==================== SUBSCRIPTION SYSTEM ====================

function checkSubscriptionStatus(user) {
    if (!user.subscription_due_date) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(user.subscription_due_date);
    dueDate.setHours(0, 0, 0, 0);

    const timeDiff = dueDate.getTime() - today.getTime();
    const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));

    console.log(`📅 Obuna holati: ${daysLeft} kun qoldi (${user.subscription_due_date})`);

    if (daysLeft <= 0) {
        // Obuna tugagan - Bloklash
        showSubscriptionBlocking(daysLeft, user.subscription_due_date);
    } else if (daysLeft <= 7) {
        // 7 kun qoldi - Ogohlantirish
        showSubscriptionWarning(daysLeft, user.subscription_due_date);
    }
}

function showSubscriptionWarning(daysLeft, dueDate) {
    // Agar oldin ko'rsatilgan bo'lsa, qayta ko'rsatmaslik (cookie yoki localStorage)
    const todayStr = new Date().toISOString().split('T')[0];
    const lastShown = localStorage.getItem('subscriptionWarningShown');
    if (lastShown === todayStr) return;

    const formattedDate = new Date(dueDate).toLocaleDateString('uz-UZ');

    // Ogohlantirish banneri
    const banner = document.createElement('div');
    banner.className = 'subscription-warning-banner';
    banner.innerHTML = `
        <div style="background: #fffbeb; border-bottom: 1px solid #fcd34d; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; position: fixed; top: 0; left: 0; right: 0; z-index: 9999; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="display: flex; align-items: center; gap: 12px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <div>
                    <strong style="color: #92400e; font-size: 14px;">Diqqat! Obuna muddati tugamoqda.</strong>
                    <div style="color: #b45309; font-size: 13px;">Sizning obunangiz ${daysLeft} kundan keyin (${formattedDate}) tugaydi. Iltimos, to'lovni amalga oshiring.</div>
                </div>
            </div>
            <button onclick="this.parentElement.remove(); localStorage.setItem('subscriptionWarningShown', '${todayStr}');" style="background: transparent; border: none; cursor: pointer; color: #92400e;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `;
    document.body.appendChild(banner);

    // Asosiy contentni pastga tushirish
    const adminContainer = document.querySelector('.admin-container');
    if (adminContainer) adminContainer.style.marginTop = '50px';
}

function showSubscriptionBlocking(daysLeft, dueDate) {
    const formattedDate = new Date(dueDate).toLocaleDateString('uz-UZ');

    // Bloklash overlay
    const overlay = document.createElement('div');
    overlay.id = 'subscriptionBlockingOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
    `;

    overlay.innerHTML = `
        <div style="background: white; padding: 40px; border-radius: 16px; max-width: 500px; width: 90%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);">
            <div style="width: 80px; height: 80px; background: #fee2e2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
            </div>
            <h2 style="font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 12px;">Xizmat ko'rsatish to'xtatildi</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">
                Sizning obuna muddatingiz <strong>${formattedDate}</strong> kunida tugagan. 
                Platformadan foydalanishni davom ettirish uchun to'lovni amalga oshiring va Superadmin bilan bog'laning.
            </p>
            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                <div style="font-size: 14px; color: #6b7280; margin-bottom: 4px;">Admin ID:</div>
                <div style="font-size: 18px; font-weight: 600; color: #111827; letter-spacing: 1px;">${currentUserRole === 'admin' ? 'Tekshirilmoqda...' : 'N/A'}</div>
            </div>
            <button onclick="window.location.reload()" style="background: #2563eb; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 16px; cursor: pointer; transition: background 0.2s;">
                Sahifani yangilash
            </button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Agar mobile menu ochiq bo'lsa yopish
    const sidebar = document.getElementById('adminSidebar');
    const overlay2 = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay2) overlay2.classList.remove('active');
}

// Superadmin functions
function openSubscriptionModal(adminId, adminUsername, currentDate, currentPrice) {
    const modal = document.getElementById('subscriptionModal');
    if (!modal) return;

    const adminIdInput = document.getElementById('subscriptionAdminId');
    const adminNameInput = document.getElementById('subscriptionAdminName');
    const dateInput = document.getElementById('subscriptionDate');
    const priceInput = document.getElementById('subscriptionPrice');
    const errorMsg = document.getElementById('subscriptionErrorMessage');
    const successMsg = document.getElementById('subscriptionSuccessMessage');

    if (adminIdInput) adminIdInput.value = adminId;
    if (adminNameInput) adminNameInput.value = adminUsername;

    // Sanani formatlash (YYYY-MM-DD)
    if (dateInput) {
        if (currentDate) {
            const date = new Date(currentDate);
            dateInput.value = date.toISOString().split('T')[0];
        } else {
            // Default 1 oy
            const date = new Date();
            date.setMonth(date.getMonth() + 1);
            dateInput.value = date.toISOString().split('T')[0];
        }
    }

    if (priceInput) priceInput.value = currentPrice || '';

    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';

    modal.style.display = 'flex';
}

function closeSubscriptionModal() {
    const modal = document.getElementById('subscriptionModal');
    if (modal) modal.style.display = 'none';
}

document.getElementById('closeSubscriptionModal')?.addEventListener('click', closeSubscriptionModal);
document.getElementById('cancelSubscription')?.addEventListener('click', closeSubscriptionModal);

document.getElementById('subscriptionForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();

    const adminId = document.getElementById('subscriptionAdminId').value;
    const dueDate = document.getElementById('subscriptionDate').value;
    const price = document.getElementById('subscriptionPrice').value.replace(/[^\d]/g, '');

    const btn = document.getElementById('saveSubscriptionBtn');
    const loader = document.getElementById('subscriptionLoader');
    const errorMsg = document.getElementById('subscriptionErrorMessage');
    const successMsg = document.getElementById('subscriptionSuccessMessage');

    if (btn) btn.disabled = true;
    if (loader) loader.style.display = 'inline-block';
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';

    try {
        const response = await apiRequest(`/api/users/${adminId}/subscription`, {
            method: 'POST',
            body: JSON.stringify({
                due_date: dueDate,
                price: price
            })
        });

        if (response) {
            const data = await response.json();
            if (data.success) {
                if (successMsg) {
                    successMsg.textContent = data.message;
                    successMsg.style.display = 'block';
                }

                // Ro'yxatni yangilash
                loadAdmins();

                setTimeout(() => {
                    closeSubscriptionModal();
                }, 1500);
            } else {
                if (errorMsg) {
                    errorMsg.textContent = data.message;
                    errorMsg.style.display = 'block';
                }
            }
        }
    } catch (error) {
        if (errorMsg) {
            errorMsg.textContent = 'Xatolik yuz berdi';
            errorMsg.style.display = 'block';
        }
    } finally {
        if (btn) btn.disabled = false;
        if (loader) loader.style.display = 'none';
    }
});
