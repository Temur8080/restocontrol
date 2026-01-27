/**
 * MOBIL VERSION - KUCHLI DEBUG VA FIX
 * Scroll va Button'lar 100% ishlaydi
 * Overlay muammosini hal qilish
 * Performance optimizatsiyalari
 */

(function() {
    'use strict';

    const MOBILE_BREAKPOINT = 750;
    
    // Image lazy loading
    function initLazyLoading() {
        if (!isMobile()) return;
        
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        observer.unobserve(img);
                    }
                }
            });
        }, {
            rootMargin: '50px' // 50px oldindan yuklash
        });
        
        // Barcha lazy image'larni topish
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
        
        // Dynamic content uchun MutationObserver
        const contentObserver = new MutationObserver(() => {
            document.querySelectorAll('img[data-src]').forEach(img => {
                if (!img.dataset.observed) {
                    imageObserver.observe(img);
                    img.dataset.observed = 'true';
                }
            });
        });
        
        contentObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Request debouncing
    const requestQueue = new Map();
    const REQUEST_DEBOUNCE = 300; // 300ms
    
    function debounceRequest(key, fn) {
        if (requestQueue.has(key)) {
            clearTimeout(requestQueue.get(key));
        }
        
        const timeoutId = setTimeout(() => {
            fn();
            requestQueue.delete(key);
        }, REQUEST_DEBOUNCE);
        
        requestQueue.set(key, timeoutId);
    }

    // Mobil ekran tekshirish - cache bilan
    let cachedIsMobile = null;
    let cachedWidth = null;
    
    const isMobile = () => {
        const currentWidth = window.innerWidth;
        if (cachedWidth !== currentWidth) {
            cachedWidth = currentWidth;
            cachedIsMobile = currentWidth <= MOBILE_BREAKPOINT;
        }
        return cachedIsMobile;
    };

    // Overlay muammosini hal qilish - ENG MUHIM
    function fixOverlayIssues() {
        if (!isMobile()) return;

        // Sidebar overlay - faqat sidebar ochiq bo'lganda ko'rinadi
        const sidebarOverlay = document.getElementById('sidebarOverlay');
        if (sidebarOverlay) {
            // Overlay'ni faqat sidebar ochiq bo'lganda ko'rsatish
            const observer = new MutationObserver(() => {
                const sidebar = document.querySelector('.admin-sidebar');
                if (sidebar && sidebar.classList.contains('mobile-open')) {
                    sidebarOverlay.style.display = 'block';
                    sidebarOverlay.style.pointerEvents = 'auto';
                } else {
                    sidebarOverlay.style.display = 'none';
                    sidebarOverlay.style.pointerEvents = 'none';
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
            
            // Dastlabki sozlash
            const sidebar = document.querySelector('.admin-sidebar');
            if (sidebar && !sidebar.classList.contains('mobile-open')) {
                sidebarOverlay.style.display = 'none';
                sidebarOverlay.style.pointerEvents = 'none';
            }
        }

        // Barcha overlay'larni tekshirish
        document.querySelectorAll('.modal-overlay, .sidebar-overlay').forEach(overlay => {
            // Overlay faqat kerak bo'lganda ko'rinadi
            if (!overlay.classList.contains('show') && !overlay.closest('.modal.show')) {
                overlay.style.display = 'none';
                overlay.style.pointerEvents = 'none';
            }
        });
    }

    // Viewport height tuzatish
    function fixViewport() {
        if (!isMobile()) return;
        
        let rafId = null;
        const setVH = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const height = window.innerHeight;
                document.documentElement.style.setProperty('--vh', `${height * 0.01}px`);
                rafId = null;
            });
        };
        
        setVH();
        
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(setVH, 100);
        }, { passive: true });
        
        window.addEventListener('orientationchange', () => {
            cachedWidth = null;
            cachedIsMobile = null;
            setTimeout(setVH, 100);
        }, { passive: true });
    }

    // Button'lar uchun kuchli touch handler
    function setupButtons() {
        if (!isMobile()) return;

        const selectors = [
            'button', 'a[href]', '[onclick]', '[role="button"]',
            '.btn', '.icon-btn', '.action-btn', '.sidebar-menu-link',
            '.submenu-link', '.submenu-container', '.logout-btn',
            '.refresh-btn', '.add-icon-btn', '.edit-btn', '.delete-btn',
            '.details-btn', '.modal-close', '.btn-save', '.btn-cancel',
            '.btn-delete', '.add-btn', '.password-change-btn',
            '.password-toggle', '.mobile-menu-toggle', '.close-details-btn'
        ];

        const selectorString = selectors.join(', ');

        // CSS sozlash
        const applyStyles = () => {
            document.querySelectorAll(selectorString).forEach(el => {
                if (!el.disabled && el.style.pointerEvents !== 'none') {
                    el.style.touchAction = 'manipulation';
                    el.style.webkitTapHighlightColor = 'transparent';
                    el.style.cursor = 'pointer';
                    el.style.pointerEvents = 'auto';
                    el.style.position = 'relative';
                    el.style.zIndex = '10';
                }
            });
        };

        // Touch tracking
        let touchData = {
            element: null,
            startX: 0,
            startY: 0,
            startTime: 0
        };

        // Touch start
        document.addEventListener('touchstart', (e) => {
            const target = e.target.closest(selectorString);
            
            if (target && !target.disabled && target.style.pointerEvents !== 'none') {
                // Overlay'ni tekshirish - agar overlay bo'lsa, button'ni bloklash
                const overlay = e.target.closest('.sidebar-overlay, .modal-overlay');
                if (overlay && !overlay.classList.contains('show')) {
                    return;
                }
                
                const touch = e.touches[0];
                touchData = {
                    element: target,
                    startX: touch.clientX,
                    startY: touch.clientY,
                    startTime: Date.now()
                };
                
                target.style.opacity = '0.7';
                target.style.transform = 'scale(0.98)';
            }
        }, { passive: true });

        // Touch end
        document.addEventListener('touchend', (e) => {
            if (!touchData.element) return;

            const target = touchData.element;
            const touch = e.changedTouches[0];
            
            const distance = Math.sqrt(
                Math.pow(touch.clientX - touchData.startX, 2) +
                Math.pow(touch.clientY - touchData.startY, 2)
            );
            
            const duration = Date.now() - touchData.startTime;
            const isClick = distance < 10 && duration < 300;
            
            target.style.opacity = '';
            target.style.transform = '';
            
            if (isClick && !target.disabled) {
                e.preventDefault();
                e.stopPropagation();
                
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    detail: 1,
                    buttons: 1,
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                
                if (target.hasAttribute('onclick')) {
                    try {
                        const code = target.getAttribute('onclick');
                        new Function('event', code).call(target, clickEvent);
                    } catch (err) {
                        console.warn('onclick error:', err);
                    }
                }
                
                target.dispatchEvent(clickEvent);
            }
            
            touchData = {
                element: null,
                startX: 0,
                startY: 0,
                startTime: 0
            };
        }, { passive: false });

        // Touch cancel
        document.addEventListener('touchcancel', () => {
            if (touchData.element) {
                touchData.element.style.opacity = '';
                touchData.element.style.transform = '';
                touchData = {
                    element: null,
                    startX: 0,
                    startY: 0,
                    startTime: 0
                };
            }
        }, { passive: true });

        // Click fallback
        document.addEventListener('click', (e) => {
            const target = e.target.closest(selectorString);
            if (target && !target.disabled) {
                target.style.pointerEvents = 'auto';
            }
        }, true);

        // DOM observer
        const observer = new MutationObserver(() => {
            applyStyles();
            fixOverlayIssues();
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        applyStyles();
    }

    // Scroll tuzatish - kuchli versiya
    function setupScroll() {
        if (!isMobile()) return;

        // HTML va Body scroll - ENG MUHIM
        document.documentElement.style.overflow = 'visible';
        document.documentElement.style.overflowX = 'hidden';
        document.documentElement.style.overflowY = 'auto';
        document.documentElement.style.height = 'auto';
        document.documentElement.style.minHeight = '100vh';
        document.documentElement.style.scrollBehavior = 'smooth';
        document.documentElement.style.webkitOverflowScrolling = 'touch';
        
        document.body.style.overflow = 'visible'; // Admin-styles.css'dagi overflow: hidden ni override
        document.body.style.overflowX = 'hidden';
        document.body.style.overflowY = 'auto';
        document.body.style.position = 'relative';
        document.body.style.height = 'auto';
        document.body.style.minHeight = '100vh';
        document.body.style.webkitOverflowScrolling = 'touch';
        document.body.style.scrollBehavior = 'smooth';
        
        // Admin container - scroll ishlashi uchun
        const adminContainer = document.querySelector('.admin-container');
        if (adminContainer) {
            adminContainer.style.overflow = 'visible';
            adminContainer.style.overflowX = 'hidden';
            adminContainer.style.overflowY = 'visible';
            adminContainer.style.height = 'auto';
            adminContainer.style.minHeight = '100vh';
            adminContainer.style.display = 'block';
        }
        
        // Admin container > main
        const adminMain = document.querySelector('.admin-container > main');
        if (adminMain) {
            adminMain.style.overflow = 'visible';
            adminMain.style.overflowX = 'hidden';
            adminMain.style.overflowY = 'visible';
            adminMain.style.height = 'auto';
            adminMain.style.minHeight = '100vh';
            adminMain.style.display = 'block';
        }
        
        // Admin content wrapper - asosiy scroll container
        const adminContentWrapper = document.querySelector('.admin-content-wrapper');
        if (adminContentWrapper) {
            adminContentWrapper.style.overflow = 'visible';
            adminContentWrapper.style.overflowX = 'hidden';
            adminContentWrapper.style.overflowY = 'visible';
            adminContentWrapper.style.height = 'auto';
            adminContentWrapper.style.minHeight = '100vh';
            adminContentWrapper.style.webkitOverflowScrolling = 'touch';
            adminContentWrapper.style.touchAction = 'pan-y';
            adminContentWrapper.style.position = 'relative';
            adminContentWrapper.style.pointerEvents = 'auto';
        }
        
        // Sidebar va modal scroll container'lar
        const setupScrollContainer = (container) => {
            if (container) {
                container.style.webkitOverflowScrolling = 'touch';
                container.style.touchAction = 'pan-y';
                container.style.overflowY = 'auto';
                container.style.overflowX = 'hidden';
                container.style.position = 'relative';
                container.style.pointerEvents = 'auto';
            }
        };
        
        // Sidebar va modal scroll container'lar
        document.querySelectorAll('.sidebar-nav, .sidebar-menu, .modal-content').forEach(setupScrollContainer);
        
        // Yangi container'lar uchun observer
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        if (node.matches && node.matches('.sidebar-nav, .sidebar-menu, .modal-content')) {
                            setupScrollContainer(node);
                        }
                        node.querySelectorAll && node.querySelectorAll('.sidebar-nav, .sidebar-menu, .modal-content').forEach(setupScrollContainer);
                    }
                });
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('✅ Scroll sozlandi - body scroll ishlaydi');
    }

    // Image lazy loading - mobile performance uchun
    function initLazyLoading() {
        if (!isMobile()) return;
        
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        observer.unobserve(img);
                    }
                }
            });
        }, {
            rootMargin: '50px' // 50px oldindan yuklash
        });
        
        // Barcha lazy image'larni topish
        document.querySelectorAll('img[data-src]').forEach(img => {
            imageObserver.observe(img);
        });
        
        // Dynamic content uchun MutationObserver
        const contentObserver = new MutationObserver(() => {
            document.querySelectorAll('img[data-src]').forEach(img => {
                if (!img.dataset.observed) {
                    imageObserver.observe(img);
                    img.dataset.observed = 'true';
                }
            });
        });
        
        contentObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Request debouncing - mobile performance uchun (faqat bir marta e'lon qilish)
    // requestQueue allaqachon yuqorida e'lon qilingan, shuning uchun bu qismni olib tashlaymiz
    
    // Input'lar uchun sozlash
    function setupInputs() {
        if (!isMobile()) return;

        const setupInput = (input) => {
            input.style.touchAction = 'manipulation';
            input.style.webkitTapHighlightColor = 'transparent';
            if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
                input.style.fontSize = '16px';
            }
        };

        document.querySelectorAll('input, textarea, select').forEach(setupInput);
        
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        if (node.matches && node.matches('input, textarea, select')) {
                            setupInput(node);
                        }
                        node.querySelectorAll && node.querySelectorAll('input, textarea, select').forEach(setupInput);
                    }
                });
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Asosiy initialization
    function init() {
        if (!isMobile()) return;

        fixOverlayIssues();
        fixViewport();
        setupButtons();
        setupScroll();
        setupInputs();
        initLazyLoading(); // Lazy loading qo'shildi

        console.log('✅ Mobil versiya sozlandi (kuchli debug + performance optimizatsiyalari)');
    }

    // DOM yuklanganda
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            cachedWidth = null;
            cachedIsMobile = null;
            if (isMobile()) {
                fixOverlayIssues();
                fixViewport();
                setupButtons();
                setupScroll();
            }
        }, 100);
    }, { passive: true });

    // Orientation change
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            cachedWidth = null;
            cachedIsMobile = null;
            if (isMobile()) {
                fixOverlayIssues();
                fixViewport();
                setupScroll();
            }
        }, 100);
    }, { passive: true });

})();
