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

        // If the user landed here from an email auth link, consume the URL and store the session
        try {
            const { data: urlData, error: urlError } = await auth.getSessionFromUrl({ storeSession: true });
            if (urlError) {
                console.warn('getSessionFromUrl error:', urlError.message);
            } else if (urlData && urlData.session) {
                // Session was recovered from URL and stored by the client
                console.info('Auth session restored from URL');
            }
        } catch (e) {
            console.error('Error processing auth redirect:', e);
        }

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

        // Password reset helper: prompts for email when not supplied
        window.sendPasswordReset = async function (email) {
            try {
                if (!email) {
                    email = prompt('Enter your account email to receive a password reset link:');
                }
                if (!email) return;

                // Ensure reset links redirect to the deployed site so users complete recovery there
                const productionRedirect = 'https://bill-manager-gamma.vercel.app';
                const redirectTo = productionRedirect;
                const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
                if (error) {
                    alert('Unable to send reset email: ' + error.message);
                } else {
                    alert('If an account exists for that email, a password reset email has been sent.');
                }
            } catch (err) {
                console.error('Password reset error:', err);
                alert('Password reset failed. See console for details.');
            }
        };

        // Attach click handler(s) for any "Forgot password?" links on the page
        try {
            document.querySelectorAll('.forgot').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.sendPasswordReset();
                });
            });
        } catch (attachErr) {
            // safe to ignore during early init
        }

        // Initial UI update
        updateUI();
    } catch (err) {
        console.error('Supabase init error:', err);
    }
})();
