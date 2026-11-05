(function () {
    const translations = {
        en: {
            brand_title: 'BALAJI SAI AUTOMOBILES',
            brand_sub: 'Bill Manager — Auto Mobiles',
            brand_lead: 'Manage bills, inventory and stock — fast and simple.',
            welcome_back: 'Welcome back',
            sign_in_muted: 'Sign in to continue to your dashboard',
            label_email: 'Username',
            label_password: 'Password',
            remember_me: 'Remember me',
            forgot: 'Forgot?',
            sign_in_btn: 'Sign In',
            auth_note: 'New here? Contact the administrator to create an account.',
            nav_dashboard: 'Dashboard',
            nav_purchases: 'Purchases',
            nav_reports: 'Reports',
            nav_bills: 'Bills',
            nav_inventory: 'Inventory',
            nav_stock: 'Stock Management',
            nav_export: 'Export'
        },
        te: {
            brand_title: 'బాలాజీ సాయ్ ఆటోమొబైల్స్',
            brand_sub: 'బిల్ మేనేజర్ — ఆటో మొబైల్స్',
            brand_lead: 'బిల్లులు, ఇన్వెంటరీ మరియు స్టాక్‌ను సులభంగా నిర్వహించండి.',
            welcome_back: 'ఫిర్యాదు చేసిన వారికి స్వాగతం',
            sign_in_muted: 'డ్యాష్‌బోర్డ్‌కు ప్రవేశించడానికి సైన్ ఇన్ చేయండి',
            label_email: 'యూజర్‌నేమ్',
            label_password: 'పాస్వర్డ్',
            remember_me: 'నన్ను గుర్తుంచుకోండి',
            forgot: 'మర్చిపోయారా?',
            sign_in_btn: 'సైన్ ఇన్',
            auth_note: 'కొత్తవారా? అకౌంట్ సృష్టించడానికి అడ్మిన్‌ని సంప్రదించండి.',
            nav_dashboard: 'డ్యాష్‌బోర్డ్',
            nav_purchases: 'కొనుగోళ్లు',
            nav_reports: 'నివేదికలు',
            nav_bills: 'బిల్లులు',
            nav_inventory: 'ఇన్వెంటరీ',
            nav_stock: 'స్టాక్ నిర్వహణ',
            nav_export: 'ఎక్స్‌పోర్ట్'
        }
    };

    function applyTranslations(lang) {
        const dict = translations[lang] || translations['en'];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (!key) return;
            const text = (dict[key] !== undefined) ? dict[key] : (translations['en'][key] || el.textContent);
            el.textContent = text;
        });
    }

    function setLanguage(lang) {
        localStorage.setItem('lang', lang);
        applyTranslations(lang);
        // update all language selectors on the page
        document.querySelectorAll('.language-select').forEach(s => { s.value = lang; });
    }

    function initI18n() {
        const stored = localStorage.getItem('lang');
        const browser = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
        const preferred = stored || (browser.startsWith('te') ? 'te' : 'en');
        // initialize any language selectors and wire change events
        document.querySelectorAll('.language-select').forEach(sel => {
            sel.value = preferred;
            sel.addEventListener('change', (e) => setLanguage(e.target.value));
        });
        applyTranslations(preferred);
    }

    document.addEventListener('DOMContentLoaded', initI18n);

    window.setLanguage = setLanguage;
})();
