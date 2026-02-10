// Client-side Supabase initialization. Fetches public keys from /api/config
(async function () {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error('Unable to load Supabase config');
        const cfg = await res.json();

        // Load UMD supabase available as `supabase` global from CDN
        if (!window.supabase) {
            console.error('Supabase client library not loaded. Include CDN script first.');
            return;
        }

        window.supabaseClient = window.supabase.createClient(cfg.url, cfg.anon);

        // Expose helper methods for auth
        const auth = window.supabaseClient.auth;

        // Update UI based on session
        const updateUI = async () => {
            const { data } = await auth.getSession();
            const session = data.session;
            if (session && session.user) {
                document.getElementById('auth-container').style.display = 'none';
                document.getElementById('app-container').style.display = 'block';
                document.getElementById('user-email').textContent = session.user.email || session.user.id;
                // Load app data after authenticated
                if (window.loadAllData) window.loadAllData();
            } else {
                document.getElementById('auth-container').style.display = 'block';
                document.getElementById('app-container').style.display = 'none';
            }
        };

        // Listen for auth changes
        auth.onAuthStateChange((_event, _session) => {
            updateUI();
        });

        // Attach sign in/out functions globally for existing HTML
        window.supabaseSignIn = async function (email, password) {
            const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
            if (error) alert('Sign in failed: ' + error.message);
        };

        window.supabaseSignOut = async function () {
            await window.supabaseClient.auth.signOut();
        };

        // Backwards-compatible aliases used in HTML
        window.signOut = window.supabaseSignOut;
        window.signIn = function (email, password) { return window.supabaseSignIn(email, password); };

        // Initial UI update
        updateUI();
    } catch (err) {
        console.error('Supabase init error:', err);
    }
})();
