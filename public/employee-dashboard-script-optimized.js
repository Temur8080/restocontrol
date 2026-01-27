// ==================== AUTHENTICATION ====================
// Format va API funksiyalari utils.js da mavjud
function checkAuth() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = '/employee-login';
        return false;
    }
    return true;
}

// ==================== STATE MANAGEMENT ====================
let currentEmployeeId = null;
let dashboardData = null;

// ==================== DOM ELEMENTS ====================
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const mainContent = document.getElementById('mainContent');
const employeeName = document.getElementById('employeeName');
const statsGrid = document.getElementById('statsGrid');
const personalInfo = document.getElementById('personalInfo');
const workSchedule = document.getElementById('workSchedule');
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
const detailModal = document.getElementById('detailModal');
const detailModalTitle = document.getElementById('detailModalTitle');
const detailModalBody = document.getElementById('detailModalBody');
const closeDetailModal = document.getElementById('closeDetailModal');
const dateRange = document.getElementById('dateRange');

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async function() {
    if (!checkAuth()) return;

    initMenuNavigation();
    initDetailModal();
    showLoading();
    await Promise.all([
        loadEmployeeInfo(),
        loadDashboard()
    ]);
    hideLoading();
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
                s.classList.remove('active');
            });

            const targetSection = document.getElementById(`${sectionId}Section`);
            if (targetSection) {
                targetSection.style.display = 'block';
                targetSection.classList.add('active');
            }
        });
    });
}

// ==================== DETAIL MODAL ====================
function initDetailModal() {
    if (closeDetailModal) {
        closeDetailModal.addEventListener('click', function() {
            closeModal();
        });
    }

    if (detailModal) {
        detailModal.addEventListener('click', function(e) {
            if (e.target === detailModal) {
                closeModal();
            }
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && detailModal && detailModal.classList.contains('show')) {
            closeModal();
        }
    });
}

function showModal(title, content) {
    if (detailModalTitle) detailModalTitle.textContent = title;
    if (detailModalBody) detailModalBody.innerHTML = content;
    if (detailModal) {
        detailModal.style.display = 'flex';
        setTimeout(() => {
            detailModal.classList.add('show');
        }, 10);
        document.body.style.overflow = 'hidden';
    }
}

function closeModal() {
    if (detailModal) {
        detailModal.classList.remove('show');
        setTimeout(() => {
            detailModal.style.display = 'none';
            document.body.style.overflow = '';
        }, 300);
    }
}

// ==================== LOAD EMPLOYEE INFO ====================
async function loadEmployeeInfo() {
    try {
        const response = await apiRequest('/api/me');
        if (!response) {
            showError('Serverga ulanib bo\'lmadi');
            return;
        }

        const data = await response.json();
        if (!data.success || !data.user) {
            showError('Ma\'lumotlarni yuklashda xatolik');
            return;
        }

        currentEmployeeId = data.user.id;
        displayPersonalInfo(data.user);
        populateEditForm(data.user);
        
        const headerLogo = document.getElementById('headerLogo');
        const headerTitle = document.getElementById('headerTitle');
        if (data.user.organization_name && headerTitle) {
            headerTitle.textContent = data.user.organization_name;
        }
        if (data.user.logo_path && headerLogo) {
            headerLogo.src = data.user.logo_path;
            headerLogo.style.display = 'block';
        }
    } catch (error) {
        console.error('Load employee info error:', error);
        showError('Serverga ulanib bo\'lmadi');
    }
}

function displayPersonalInfo(employee) {
    if (!personalInfo) return;

    personalInfo.innerHTML = `
        <div class="employee-info-item">
            <strong>Username:</strong> ${escapeHtml(employee.username || '')}
        </div>
        <div class="employee-info-item">
            <strong>To'liq Ism:</strong> ${escapeHtml(employee.full_name || '')}
        </div>
        <div class="employee-info-item">
            <strong>Lavozim:</strong> ${escapeHtml(employee.position || '')}
        </div>
        <div class="employee-info-item">
            <strong>Telefon:</strong> ${escapeHtml(employee.phone || 'Kiritilmagan')}
        </div>
        <div class="employee-info-item">
            <strong>Email:</strong> ${escapeHtml(employee.email || 'Kiritilmagan')}
        </div>
        <div class="employee-info-item">
            <strong>Qo'shilgan sana:</strong> ${formatDate(employee.created_at)}
        </div>
    `;
}

// ==================== LOAD DASHBOARD ====================
async function loadDashboard() {
    try {
        const response = await apiRequest('/api/employee/dashboard');
        if (!response) {
            showError('Serverga ulanib bo\'lmadi');
            return;
        }

        if (response.status === 404) {
            showError('Endpoint topilmadi. Server qayta ishga tushirilishi kerak.');
            return;
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API Error:', response.status, errorText);
            showError(`Xatolik: ${response.status}`);
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showError(data.message || 'Ma\'lumotlarni yuklashda xatolik');
            return;
        }

        dashboardData = data;
        displayDashboard(data);
    } catch (error) {
        console.error('Load dashboard error:', error);
        showError('Serverga ulanib bo\'lmadi');
    }
}

function displayDashboard(data) {
    const emp = data.employee || {};
    const totals = data.totals || {};

    if (employeeName) {
        employeeName.textContent = `${escapeHtml(emp.full_name || emp.username || '')}${emp.position ? ` • ${escapeHtml(emp.position)}` : ''}`;
    }
    if (dateRange && data.range) {
        dateRange.textContent = `Davomat: ${data.range.attendance_from} → ${data.range.attendance_to} | Oy: ${data.range.month_from} → ${data.range.month_to}`;
    }

    displayStats(totals);
    displayWorkSchedule(data.work_schedule || [], data.weekly_attendance || []);
    displayWorkScheduleCompact(data.work_schedule || []);
    displayAttendance(data.attendance_days || []);
    displaySalaries(data.salaries || [], totals);
    displayBonuses(data.bonuses || [], totals);
    displayPenalties(data.penalties || [], totals);
}

function displayStats(totals) {
    if (!statsGrid) return;

    const workHours = totals.total_work_hours_30d || 0;
    const lateMinutes = totals.total_late_minutes_30d || 0;
    const salary = totals.total_salary_month || 0;
    const bonus = totals.total_bonus_month || 0;
    const penalty = totals.total_penalty_month || 0;
    const net = totals.net_amount_month || 0;

    statsGrid.innerHTML = `
        <div class="stat-card-modern stat-card-primary">
            <div class="stat-card-icon">⏱</div>
            <div class="stat-card-content">
                <div class="stat-card-label">Ishlagan Soatlar (30 kun)</div>
                <div class="stat-card-value">${typeof workHours === 'number' ? workHours.toFixed(1) : workHours}</div>
                <div class="stat-card-subtitle">soat</div>
            </div>
        </div>
        <div class="stat-card-modern stat-card-warning">
            <div class="stat-card-icon">⏰</div>
            <div class="stat-card-content">
                <div class="stat-card-label">Kechikish (30 kun)</div>
                <div class="stat-card-value">${lateMinutes}</div>
                <div class="stat-card-subtitle">daqiqa</div>
            </div>
        </div>
        <div class="stat-card-modern stat-card-success">
            <div class="stat-card-icon">💰</div>
            <div class="stat-card-content">
                <div class="stat-card-label">Jami Maosh (oy)</div>
                <div class="stat-card-value">${formatMoney(salary)}</div>
                <div class="stat-card-subtitle">so'm</div>
            </div>
        </div>
        <div class="stat-card-modern stat-card-info">
            <div class="stat-card-icon">📌</div>
            <div class="stat-card-content">
                <div class="stat-card-label">Jami Summa (oy)</div>
                <div class="stat-card-value">${formatMoney(net)}</div>
                <div class="stat-card-subtitle">maosh+bonus-jarima</div>
            </div>
        </div>
    `;
}

function displayWorkSchedule(schedules, weeklyAttendance) {
    if (!workSchedule) return;

    const dayNames = {
        1: 'Dushanba',
        2: 'Seshanba',
        3: 'Chorshanba',
        4: 'Payshanba',
        5: 'Juma',
        6: 'Shanba',
        7: 'Yakshanba'
    };

    const attendanceMap = new Map();
    if (weeklyAttendance && weeklyAttendance.length > 0) {
        weeklyAttendance.forEach(att => {
            attendanceMap.set(att.day_of_week, att);
        });
    }

    const scheduleMap = new Map();
    if (schedules && schedules.length > 0) {
        schedules.forEach(s => {
            scheduleMap.set(Number(s.day_of_week), s);
        });
    }

    const rows = [];
    const today = new Date();
    
    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
        const dayName = dayNames[dayOfWeek] || `Kun ${dayOfWeek}`;
        
        const schedule = scheduleMap.get(dayOfWeek);
        const attendance = attendanceMap.get(dayOfWeek);
        
        const hasSchedule = schedule && schedule.has_schedule === true;
        const startTime = schedule && schedule.start_time ? String(schedule.start_time).slice(0, 5) : '—';
        const endTime = schedule && schedule.end_time ? String(schedule.end_time).slice(0, 5) : '—';
        const scheduleTime = hasSchedule ? `${startTime} - ${endTime}` : 'Dam';
        
        const dateStr = date.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' });
        
        let attendanceInfo = '';
        if (attendance) {
            const entry = attendance.entry_time ? formatTime(attendance.entry_time) : null;
            const exit = attendance.exit_time ? formatTime(attendance.exit_time) : null;
            
            if (entry && exit) {
                attendanceInfo = `<span style="color: #10b981; font-size: 12px;">${entry} - ${exit}</span>`;
            } else if (entry) {
                attendanceInfo = `<span style="color: #f59e0b; font-size: 12px;">${entry} (kirish)</span>`;
            } else {
                attendanceInfo = `<span style="color: #6b7280; font-size: 12px;">Davomat yo'q</span>`;
            }
        } else {
            attendanceInfo = `<span style="color: #6b7280; font-size: 12px;">Davomat yo'q</span>`;
        }
        
        const badge = hasSchedule 
            ? '<span class="employee-badge success">Ish</span>' 
            : '<span class="employee-badge muted">Dam</span>';
        
        rows.push(`
            <div class="employee-mini-row clickable-row" onclick="showScheduleDetail()" style="border-bottom: 1px solid #e5e7eb; padding: 8px 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                            <span class="label" style="font-weight: 500;">${dayName} (${dateStr})</span>
                            ${badge}
                        </div>
                        <div style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">
                            Jadval: ${scheduleTime}
                        </div>
                        <div style="font-size: 12px;">
                            ${attendanceInfo}
                        </div>
                    </div>
                </div>
            </div>
        `);
    }

    workSchedule.innerHTML = rows.length > 0 ? rows.join('') : `
        <div class="employee-mini-row clickable-row" onclick="showScheduleDetail()">
            <span class="label">Ish Jadvali</span>
            <span class="value">Ish jadvali kiritilmagan</span>
        </div>
    `;
}

function displayWorkScheduleCompact(schedules) {
    if (!workScheduleCompact) return;

    const dayNames = {
        1: 'Du', 2: 'Se', 3: 'Ch', 4: 'Pa', 5: 'Ju', 6: 'Sh', 7: 'Ya'
    };

    if (!schedules || schedules.length === 0) {
        workScheduleCompact.innerHTML = `
            <div class="employee-mini-row clickable-row" onclick="showScheduleDetail()">
                <span class="label">Ish Jadvali</span>
                <span class="value">Kiritilmagan</span>
            </div>
        `;
        return;
    }

    const workingDays = schedules.filter(s => s.has_schedule === true).slice(0, 3);
    const summary = workingDays.length > 0 
        ? workingDays.map(s => dayNames[Number(s.day_of_week)] || s.day_of_week).join(', ')
        : 'Dam';

    workScheduleCompact.innerHTML = `
        <div class="employee-mini-row clickable-row" onclick="showScheduleDetail()">
            <span class="label">Ish kunlari</span>
            <span class="value">${summary} <span class="view-details-badge">→</span></span>
        </div>
    `;
}

function showScheduleDetail() {
    if (!dashboardData || !dashboardData.work_schedule) return;
    
    const schedules = dashboardData.work_schedule || [];
    const dayNames = {
        1: 'Dushanba', 2: 'Seshanba', 3: 'Chorshanba', 4: 'Payshanba',
        5: 'Juma', 6: 'Shanba', 7: 'Yakshanba'
    };

    let content = '<div class="admin-details-section"><h3>Ish Jadvali</h3>';
    
    if (schedules.length === 0) {
        content += '<p>Ish jadvali kiritilmagan</p>';
    } else {
        content += '<div class="details-table-container"><table class="details-table"><thead><tr><th>Kun</th><th>Vaqt</th><th>Holat</th></tr></thead><tbody>';
        
        schedules.forEach(s => {
            const dayName = dayNames[Number(s.day_of_week)] || `Kun ${s.day_of_week}`;
            const hasSchedule = s.has_schedule === true;
            const startTime = s.start_time ? String(s.start_time).slice(0, 5) : '—';
            const endTime = s.end_time ? String(s.end_time).slice(0, 5) : '—';
            const time = hasSchedule ? `${startTime} - ${endTime}` : 'Dam';
            const status = hasSchedule ? '<span class="employee-badge success">Ish</span>' : '<span class="employee-badge muted">Dam</span>';
            
            content += `<tr><td>${dayName}</td><td>${time}</td><td>${status}</td></tr>`;
        });
        
        content += '</tbody></table></div>';
    }
    
    content += '</div>';
    showModal('Ish Jadvali - Batafsil', content);
}

function displayAttendance(attendanceDays) {
    if (!attendanceList) return;

    if (!attendanceDays || attendanceDays.length === 0) {
        attendanceList.innerHTML = `
            <div class="employee-mini-row">
                <span class="label">Davomat</span>
                <span class="value">Ma'lumot yo'q</span>
            </div>
        `;
        return;
    }

    const sorted = [...attendanceDays].reverse().slice(0, 30);
    const compactItems = sorted.slice(0, 5);
    const rows = compactItems.map(day => {
        const entry = formatTime(day.entry_time);
        const exit = formatTime(day.exit_time);
        const hasBoth = day.entry_time && day.exit_time;
        const badge = hasBoth 
            ? '<span class="employee-badge success">To\'liq</span>' 
            : '<span class="employee-badge muted">To\'liq emas</span>';
        
        return `
            <div class="employee-mini-row clickable-row" onclick="showAttendanceDetail()">
                <span class="label">${day.date}</span>
                <span class="value">${entry} → ${exit} ${badge}</span>
            </div>
        `;
    }).join('');

    if (sorted.length > 5) {
        rows += `
            <div class="employee-mini-row clickable-row" onclick="showAttendanceDetail()" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 2px dashed #cbd5e1;">
                <span class="label">Ko'proq ko'rsatish</span>
                <span class="value"><span class="view-details-badge">${sorted.length - 5} ta yana →</span></span>
            </div>
        `;
    }

    attendanceList.innerHTML = rows;
}

function displaySalaries(salaries, totals) {
    if (!salariesList) return;

    const total = totals.total_salary_month || 0;
    const header = `
        <div class="employee-mini-row">
            <span class="label">Jami Maosh (oy)</span>
            <span class="value">
                <span class="employee-badge success">${formatMoney(total)} so'm</span>
            </span>
        </div>
    `;

    if (!salaries || salaries.length === 0) {
        salariesList.innerHTML = header + `
            <div class="employee-mini-row">
                <span class="label">Maoshlar</span>
                <span class="value">Bu oyda maosh yo'q</span>
            </div>
        `;
        return;
    }

    const sorted = [...salaries].sort((a, b) => {
        return new Date(b.period_date) - new Date(a.period_date);
    });

    const compactItems = sorted.slice(0, 5);
    const rows = compactItems.map(s => {
        const periodType = formatPeriodType(s.period_type);
        const workPosition = s.work_position ? ` (${escapeHtml(s.work_position)})` : '';
        
        return `
            <div class="employee-mini-row clickable-row" onclick="showSalaryDetail(${s.id})">
                <span class="label">${s.period_date} • ${periodType}${workPosition}</span>
                <span class="value">
                    ${formatMoney(s.amount)} so'm
                    <span class="view-details-badge">→</span>
                </span>
            </div>
        `;
    }).join('');

    if (sorted.length > 5) {
        rows += `
            <div class="employee-mini-row clickable-row" onclick="showSalariesDetail()" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 2px dashed #cbd5e1;">
                <span class="label">Ko'proq ko'rsatish</span>
                <span class="value"><span class="view-details-badge">${sorted.length - 5} ta yana →</span></span>
            </div>
        `;
    }

    salariesList.innerHTML = header + rows;
}

function displayBonuses(bonuses, totals) {
    if (!bonusesList) return;

    const total = totals.total_bonus_month || 0;
    const header = `
        <div class="employee-mini-row">
            <span class="label">Jami Bonuslar (oy)</span>
            <span class="value">
                <span class="employee-badge info">${formatMoney(total)} so'm</span>
            </span>
        </div>
    `;

    if (!bonuses || bonuses.length === 0) {
        bonusesList.innerHTML = header + `
            <div class="employee-mini-row">
                <span class="label">Bonuslar</span>
                <span class="value">Bu oyda bonus yo'q</span>
            </div>
        `;
        return;
    }

    const sorted = [...bonuses].sort((a, b) => {
        return new Date(b.bonus_date || b.period_date) - new Date(a.bonus_date || a.period_date);
    });

    const compactItems = sorted.slice(0, 5);
    const rows = compactItems.map(b => {
        const periodType = formatPeriodType(b.period_type);
        const reason = b.reason ? escapeHtml(b.reason.substring(0, 30)) : '—';
        
        return `
            <div class="employee-mini-row clickable-row" onclick="showBonusDetail(${b.id})">
                <span class="label">${b.bonus_date || b.period_date} • ${periodType}</span>
                <span class="value">
                    ${formatMoney(b.amount)} so'm
                    <span class="employee-badge info">${reason}${b.reason && b.reason.length > 30 ? '...' : ''}</span>
                    <span class="view-details-badge">→</span>
                </span>
            </div>
        `;
    }).join('');

    if (sorted.length > 5) {
        rows += `
            <div class="employee-mini-row clickable-row" onclick="showBonusesDetail()" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 2px dashed #cbd5e1;">
                <span class="label">Ko'proq ko'rsatish</span>
                <span class="value"><span class="view-details-badge">${sorted.length - 5} ta yana →</span></span>
            </div>
        `;
    }

    bonusesList.innerHTML = header + rows;
}

function displayPenalties(penalties, totals) {
    if (!penaltiesList) return;

    const total = totals.total_penalty_month || 0;
    const header = `
        <div class="employee-mini-row">
            <span class="label">Jami Jarimalar (oy)</span>
            <span class="value">
                <span class="employee-badge danger">${formatMoney(total)} so'm</span>
            </span>
        </div>
    `;

    if (!penalties || penalties.length === 0) {
        penaltiesList.innerHTML = header + `
            <div class="employee-mini-row">
                <span class="label">Jarimalar</span>
                <span class="value">Bu oyda jarima yo'q</span>
            </div>
        `;
        return;
    }

    const sorted = [...penalties].sort((a, b) => {
        return new Date(b.penalty_date || b.period_date) - new Date(a.penalty_date || a.period_date);
    });

    const compactItems = sorted.slice(0, 5);
    const rows = compactItems.map(p => {
        const periodType = formatPeriodType(p.period_type);
        const reason = p.reason ? escapeHtml(p.reason.substring(0, 30)) : '—';
        
        return `
            <div class="employee-mini-row clickable-row" onclick="showPenaltyDetail(${p.id})">
                <span class="label">${p.penalty_date || p.period_date} • ${periodType}</span>
                <span class="value">
                    -${formatMoney(p.amount)} so'm
                    <span class="employee-badge danger">${reason}${p.reason && p.reason.length > 30 ? '...' : ''}</span>
                    <span class="view-details-badge">→</span>
                </span>
            </div>
        `;
    }).join('');

    if (sorted.length > 5) {
        rows += `
            <div class="employee-mini-row clickable-row" onclick="showPenaltiesDetail()" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 2px dashed #cbd5e1;">
                <span class="label">Ko'proq ko'rsatish</span>
                <span class="value"><span class="view-details-badge">${sorted.length - 5} ta yana →</span></span>
            </div>
        `;
    }

    penaltiesList.innerHTML = header + rows;
}

// ==================== EDIT FORM ====================
function populateEditForm(employee) {
    if (!employee) return;
    
    const fullNameInput = document.getElementById('editFullName');
    const positionInput = document.getElementById('editPosition');
    const phoneInput = document.getElementById('editPhone');
    const emailInput = document.getElementById('editEmail');

    if (fullNameInput) fullNameInput.value = employee.full_name || '';
    if (positionInput) positionInput.value = employee.position || '';
    if (phoneInput) phoneInput.value = employee.phone || '';
    if (emailInput) emailInput.value = employee.email || '';
}

if (editForm) {
    editForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        if (!currentEmployeeId) {
            showEditError('Employee ID topilmadi');
            return;
        }

        const full_name = document.getElementById('editFullName')?.value.trim() || '';
        const position = document.getElementById('editPosition')?.value.trim() || '';
        const phone = document.getElementById('editPhone')?.value.trim() || '';
        const email = document.getElementById('editEmail')?.value.trim() || '';

        if (!full_name || !position) {
            showEditError('To\'liq ism va lavozim kiritishingiz kerak');
            return;
        }

        hideEditMessages();
        setSaveLoading(true);

        try {
            const response = await apiRequest(`/api/employees/${currentEmployeeId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    full_name,
                    position,
                    phone: phone || null,
                    email: email || null
                })
            });

            if (!response) {
                setSaveLoading(false);
                showEditError('Serverga ulanib bo\'lmadi');
                return;
            }

            const data = await response.json();
            setSaveLoading(false);

            if (data.success) {
                showEditSuccess('Ma\'lumotlar muvaffaqiyatli yangilandi');
                await Promise.all([
                    loadEmployeeInfo(),
                    loadDashboard()
                ]);
            } else {
                showEditError(data.message || 'Ma\'lumotlarni yangilashda xatolik yuz berdi');
            }
        } catch (error) {
            setSaveLoading(false);
            console.error('Update employee error:', error);
            showEditError('Serverga ulanib bo\'lmadi. Internet aloqasini tekshiring.');
        }
    });
}

// ==================== UI HELPERS ====================
function showLoading() {
    if (loadingState) loadingState.style.display = 'block';
    if (errorState) errorState.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
}

function hideLoading() {
    if (loadingState) loadingState.style.display = 'none';
    if (errorState) errorState.style.display = 'none';
    if (mainContent) mainContent.style.display = 'block';
}

function showError(message) {
    if (loadingState) loadingState.style.display = 'none';
    if (errorState) {
        errorState.textContent = message || 'Xatolik yuz berdi';
        errorState.style.display = 'block';
    }
    if (mainContent) mainContent.style.display = 'none';
}

function setSaveLoading(isLoading) {
    if (!saveBtn) return;
    
    saveBtn.disabled = isLoading;
    const btnText = saveBtn.querySelector('.btn-text');
    if (btnText) {
        btnText.textContent = isLoading ? 'Kutilmoqda...' : 'Saqlash';
    }
    if (saveLoader) {
        saveLoader.style.display = isLoading ? 'inline-block' : 'none';
    }
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
    setTimeout(hideEditMessages, 5000);
}

function showEditSuccess(message) {
    hideEditMessages();
    if (editSuccess) {
        editSuccess.textContent = message;
        editSuccess.style.display = 'block';
    }
    setTimeout(hideEditMessages, 3000);
}

// ==================== DETAIL FUNCTIONS ====================
function showAttendanceDetail() {
    if (!dashboardData || !dashboardData.attendance_days) return;
    
    const attendanceDays = [...dashboardData.attendance_days].reverse();
    let content = '<div class="admin-details-section"><h3>Davomat (Oxirgi 30 kun)</h3>';
    content += '<div class="details-table-container"><table class="details-table"><thead><tr><th>Sana</th><th>Kirish</th><th>Chiqish</th><th>Holat</th></tr></thead><tbody>';
    
    attendanceDays.forEach(day => {
        const entry = formatTime(day.entry_time);
        const exit = formatTime(day.exit_time);
        const hasBoth = day.entry_time && day.exit_time;
        const status = hasBoth 
            ? '<span class="employee-badge success">To\'liq</span>' 
            : '<span class="employee-badge muted">To\'liq emas</span>';
        
        content += `<tr><td>${day.date}</td><td>${entry}</td><td>${exit}</td><td>${status}</td></tr>`;
    });
    
    content += '</tbody></table></div></div>';
    showModal('Davomat - Batafsil', content);
}

function showSalaryDetail(salaryId) {
    if (!dashboardData || !dashboardData.salaries) return;
    
    const salary = dashboardData.salaries.find(s => s.id === salaryId);
    if (!salary) return;
    
    let content = '<div class="admin-details-section"><h3>Maosh - Batafsil</h3>';
    content += '<div class="details-grid">';
    content += `<div class="detail-item"><div class="detail-label">Sana</div><div class="detail-value">${salary.period_date}</div></div>`;
    content += `<div class="detail-item"><div class="detail-label">Davr Turi</div><div class="detail-value">${formatPeriodType(salary.period_type)}</div></div>`;
    content += `<div class="detail-item"><div class="detail-label">Summa</div><div class="detail-value">${formatMoney(salary.amount)} so'm</div></div>`;
    if (salary.work_position) {
        content += `<div class="detail-item"><div class="detail-label">Ishlagan Lavozim</div><div class="detail-value">${escapeHtml(salary.work_position)}</div></div>`;
    }
    if (salary.notes) {
        content += `<div class="detail-item" style="grid-column: 1 / -1;"><div class="detail-label">Izoh</div><div class="detail-value">${escapeHtml(salary.notes)}</div></div>`;
    }
    content += '</div></div>';
    showModal('Maosh - Batafsil', content);
}

function showSalariesDetail() {
    if (!dashboardData || !dashboardData.salaries) return;
    
    const salaries = [...dashboardData.salaries].sort((a, b) => new Date(b.period_date) - new Date(a.period_date));
    let content = '<div class="admin-details-section"><h3>Barcha Maoshlar</h3>';
    content += '<div class="details-table-container"><table class="details-table"><thead><tr><th>Sana</th><th>Davr</th><th>Lavozim</th><th>Summa</th><th>Izoh</th></tr></thead><tbody>';
    
    salaries.forEach(s => {
        content += `<tr onclick="showSalaryDetail(${s.id})" style="cursor: pointer;">
            <td>${s.period_date}</td>
            <td>${formatPeriodType(s.period_type)}</td>
            <td>${escapeHtml(s.work_position || '—')}</td>
            <td><strong>${formatMoney(s.amount)} so'm</strong></td>
            <td>${escapeHtml(s.notes || '—')}</td>
        </tr>`;
    });
    
    content += '</tbody></table></div></div>';
    showModal('Barcha Maoshlar', content);
}

function showBonusDetail(bonusId) {
    if (!dashboardData || !dashboardData.bonuses) return;
    
    const bonus = dashboardData.bonuses.find(b => b.id === bonusId);
    if (!bonus) return;
    
    let content = '<div class="admin-details-section"><h3>Bonus - Batafsil</h3>';
    content += '<div class="details-grid">';
    content += `<div class="detail-item"><div class="detail-label">Sana</div><div class="detail-value">${bonus.bonus_date || bonus.period_date}</div></div>`;
    content += `<div class="detail-item"><div class="detail-label">Davr Turi</div><div class="detail-value">${formatPeriodType(bonus.period_type)}</div></div>`;
    content += `<div class="detail-item"><div class="detail-label">Summa</div><div class="detail-value">${formatMoney(bonus.amount)} so'm</div></div>`;
    if (bonus.reason) {
        content += `<div class="detail-item" style="grid-column: 1 / -1;"><div class="detail-label">Sabab</div><div class="detail-value">${escapeHtml(bonus.reason)}</div></div>`;
    }
    content += '</div></div>';
    showModal('Bonus - Batafsil', content);
}

function showBonusesDetail() {
    if (!dashboardData || !dashboardData.bonuses) return;
    
    const bonuses = [...dashboardData.bonuses].sort((a, b) => new Date(b.bonus_date || b.period_date) - new Date(a.bonus_date || a.period_date));
    let content = '<div class="admin-details-section"><h3>Barcha Bonuslar</h3>';
    content += '<div class="details-table-container"><table class="details-table"><thead><tr><th>Sana</th><th>Davr</th><th>Summa</th><th>Sabab</th></tr></thead><tbody>';
    
    bonuses.forEach(b => {
        content += `<tr onclick="showBonusDetail(${b.id})" style="cursor: pointer;">
            <td>${b.bonus_date || b.period_date}</td>
            <td>${formatPeriodType(b.period_type)}</td>
            <td><strong>${formatMoney(b.amount)} so'm</strong></td>
            <td>${escapeHtml(b.reason || '—')}</td>
        </tr>`;
    });
    
    content += '</tbody></table></div></div>';
    showModal('Barcha Bonuslar', content);
}

function showPenaltyDetail(penaltyId) {
    if (!dashboardData || !dashboardData.penalties) return;
    
    const penalty = dashboardData.penalties.find(p => p.id === penaltyId);
    if (!penalty) return;
    
    let content = '<div class="admin-details-section"><h3>Jarima - Batafsil</h3>';
    content += '<div class="details-grid">';
    content += `<div class="detail-item"><div class="detail-label">Sana</div><div class="detail-value">${penalty.penalty_date || penalty.period_date}</div></div>`;
    content += `<div class="detail-item"><div class="detail-label">Davr Turi</div><div class="detail-value">${formatPeriodType(penalty.period_type)}</div></div>`;
    content += `<div class="detail-item"><div class="detail-label">Summa</div><div class="detail-value">-${formatMoney(penalty.amount)} so'm</div></div>`;
    if (penalty.reason) {
        content += `<div class="detail-item" style="grid-column: 1 / -1;"><div class="detail-label">Sabab</div><div class="detail-value">${escapeHtml(penalty.reason)}</div></div>`;
    }
    content += '</div></div>';
    showModal('Jarima - Batafsil', content);
}

function showPenaltiesDetail() {
    if (!dashboardData || !dashboardData.penalties) return;
    
    const penalties = [...dashboardData.penalties].sort((a, b) => new Date(b.penalty_date || b.period_date) - new Date(a.penalty_date || a.period_date));
    let content = '<div class="admin-details-section"><h3>Barcha Jarimalar</h3>';
    content += '<div class="details-table-container"><table class="details-table"><thead><tr><th>Sana</th><th>Davr</th><th>Summa</th><th>Sabab</th></tr></thead><tbody>';
    
    penalties.forEach(p => {
        content += `<tr onclick="showPenaltyDetail(${p.id})" style="cursor: pointer;">
            <td>${p.penalty_date || p.period_date}</td>
            <td>${formatPeriodType(p.period_type)}</td>
            <td><strong>-${formatMoney(p.amount)} so'm</strong></td>
            <td>${escapeHtml(p.reason || '—')}</td>
        </tr>`;
    });
    
    content += '</tbody></table></div></div>';
    showModal('Barcha Jarimalar', content);
}

// ==================== LOGOUT ====================
if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
        if (confirm('Haqiqatan ham tizimdan chiqmoqchimisiz?')) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('userRole');
            window.location.href = '/employee-login';
        }
    });
}
