// LOCAL DEMO MODE: replaces Supabase auth + /api/state with browser localStorage.
// To go back to Supabase, restore the Supabase <script> tags in index.html and
// the fetch-based loadAllData/saveState in app.js (see git history).
(function () {
    const SESSION_KEY = 'bm_demo_session';
    const getSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } };

    function updateUI() {
        const session = getSession();
        const auth = document.getElementById('auth-container');
        const app = document.getElementById('app-container');
        if (session) {
            auth.style.display = 'none';
            app.style.display = 'block';
            document.getElementById('user-email').textContent = session.email;
            if (window.loadAllData) window.loadAllData();
        } else {
            auth.style.display = 'flex';
            app.style.display = 'none';
        }
    }

    // Any email/password works in demo mode.
    window.supabaseSignIn = window.signIn = function (email) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ email: email || 'demo@local' }));
        updateUI();
    };
    window.supabaseSignOut = window.signOut = function () {
        localStorage.removeItem(SESSION_KEY);
        updateUI();
    };
    window.sendPasswordReset = function () {
        alert('Demo mode: any email and password will sign you in. No reset needed.');
    };
    window.completePasswordReset = function () {
        document.getElementById('password-reset-modal').style.display = 'none';
    };

    document.addEventListener('DOMContentLoaded', updateUI);
    if (document.readyState !== 'loading') updateUI();
})();
