// Sign-in + data sync.  Replaces the old local demo mode.
//  - Login:  POST /api/login (cookie session).  The password lives in the server's environment.
//  - Load:   GET  /api/state  (current + previous financial year; older years on demand)
//  - Save:   every saveState() call is diffed against the last known copy and only the changed
//            records are POSTed to /api/save, which commits them to the data repository.
//  - Unsynced changes are kept in localStorage (bm_pending) and re-sent after a reload / reconnect.
(function () {
    'use strict';

    const COLLS = ['bills', 'purchases', 'stockHistory', 'inventory'];
    const PENDING_KEY = 'bm_pending', CACHE_KEY = 'bm_cache', LEGACY_KEY = 'bm_demo_state';
    const CHUNK_BYTES = 600_000;

    let head = null, meta = { maxInvoiceNo: 0, openingStock: {} }, scope = 'recent', fys = [], loadedFys = [], storage = '';
    let snap = {};                         // coll -> Map(id -> { json, refKey })
    let pending = emptyPending();          // changes not yet confirmed by the server
    let running = false, again = false, timer = null, retryTimer = null, retryDelay = 5000;
    let status = 'idle', lastSaved = null, lastError = '', lastCheck = 0, booted = false, signedIn = false;

    const $ = (id) => document.getElementById(id);
    function emptyPending() { const p = {}; COLLS.forEach(c => { p[c] = { upserts: new Map(), removes: new Map() }; }); p.meta = {}; return p; }
    const isEmpty = (p) => COLLS.every(c => !p[c].upserts.size && !p[c].removes.size) && !Object.keys(p.meta).length;
    const countPending = () => COLLS.reduce((n, c) => n + pending[c].upserts.size + pending[c].removes.size, 0) + (Object.keys(pending.meta).length ? 1 : 0);
    const refOf = (r) => { const o = {}; ['date', 'timestamp', 'createdAt'].forEach(k => { if (typeof r[k] === 'string') o[k] = r[k]; }); return o; };
    const arrays = () => ({ bills, purchases, stockHistory, inventory });

    // ------------------------------------------------------------------ http
    async function api(path, opts) {
        const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opts, headers: { ...(opts && opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts && opts.headers) } });
        let data = null; try { data = await res.json(); } catch (e) { }
        if (res.status === 401 && path !== '/api/login') { handleSignedOut(); }
        if (!res.ok) { const err = new Error((data && data.error) || ('Request failed (' + res.status + ')')); err.status = res.status; throw err; }
        return data;
    }

    // ------------------------------------------------------------------ diff / pending
    function takeSnapshot(state) {
        snap = {};
        COLLS.forEach(c => { snap[c] = new Map((state[c] || []).map(r => [r.id, { json: JSON.stringify(r), refKey: JSON.stringify(refOf(r)), ref: refOf(r) }])); });
    }
    // Compare live arrays with the snapshot and move differences into `pending`.
    function diffIntoPending() {
        const cur = arrays();
        COLLS.forEach(c => {
            const old = snap[c] || (snap[c] = new Map()), seen = new Set();
            (cur[c] || []).forEach(r => {
                if (!r || !r.id) return;
                seen.add(r.id);
                const json = JSON.stringify(r), prev = old.get(r.id);
                if (prev && prev.json === json) return;
                const ref = refOf(r), refKey = JSON.stringify(ref);
                if (prev && prev.refKey !== refKey) pending[c].removes.set(r.id, prev.ref);     // moved to another month
                pending[c].upserts.set(r.id, json);
                old.set(r.id, { json, refKey, ref });
            });
            [...old.keys()].forEach(id => {
                if (seen.has(id)) return;
                pending[c].upserts.delete(id); pending[c].removes.set(id, old.get(id).ref); old.delete(id);
            });
        });
    }
    function persistPending() {
        try {
            if (isEmpty(pending)) { localStorage.removeItem(PENDING_KEY); return; }
            const o = { meta: pending.meta };
            COLLS.forEach(c => { o[c] = { upserts: [...pending[c].upserts.values()], removes: [...pending[c].removes].map(([id, ref]) => ({ id, ref })) }; });
            localStorage.setItem(PENDING_KEY, JSON.stringify(o));
        } catch (e) { }
    }
    function restorePending() {
        try {
            const o = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); if (!o) return;
            COLLS.forEach(c => {
                ((o[c] || {}).upserts || []).forEach(j => { try { pending[c].upserts.set(JSON.parse(j).id, j); } catch (e) { } });
                ((o[c] || {}).removes || []).forEach(r => pending[c].removes.set(r.id, r.ref || {}));
            });
            pending.meta = o.meta || {};
        } catch (e) { }
    }
    function applyPendingTo(state) {
        COLLS.forEach(c => {
            const arr = state[c] || (state[c] = []);
            pending[c].removes.forEach((_, id) => { const i = arr.findIndex(r => r.id === id); if (i >= 0) arr.splice(i, 1); });
            pending[c].upserts.forEach((json) => {
                const rec = JSON.parse(json), i = arr.findIndex(r => r.id === rec.id);
                if (i >= 0) arr[i] = rec; else if (c === 'inventory') arr.push(rec); else arr.unshift(rec);
            });
        });
        state.meta = { ...state.meta, openingStock: { ...(state.meta.openingStock || {}), ...(pending.meta.openingStock || {}) } };
        Object.keys(state.meta.openingStock).forEach(k => { if (state.meta.openingStock[k] === null) delete state.meta.openingStock[k]; });
    }

    // Build one request-sized chunk out of `pending` (does not remove anything yet)
    function nextChunk() {
        const ch = { meta: {} }; let bytes = 0, n = 0;
        COLLS.forEach(c => { ch[c] = { upserts: [], removes: [] }; });
        for (const c of COLLS) {
            for (const [id, ref] of pending[c].removes) { ch[c].removes.push({ id, ref }); bytes += 120; n++; }
            for (const [id, json] of pending[c].upserts) {
                if (n && bytes + json.length > CHUNK_BYTES) return { ch, full: true };
                ch[c].upserts.push({ id, json }); bytes += json.length; n++;
            }
        }
        if (pending.meta.openingStock) ch.meta.openingStock = pending.meta.openingStock;
        return { ch, full: false };
    }

    // ------------------------------------------------------------------ saving
    function save() {
        clearTimeout(timer);
        timer = setTimeout(flush, 350);
        if (status !== 'saving') setStatus('saving');
    }
    async function flush() {
        if (!signedIn) return;
        if (running) { again = true; return; }
        running = true; clearTimeout(retryTimer);
        try {
            do {
                again = false;
                diffIntoPending(); persistPending();
                while (!isEmpty(pending)) {
                    setStatus('saving');
                    const { ch } = nextChunk();
                    const body = { changes: {}, baseHead: head };
                    COLLS.forEach(c => { body.changes[c] = { upserts: ch[c].upserts.map(u => JSON.parse(u.json)), removes: ch[c].removes }; });
                    body.changes.meta = ch.meta;
                    let res;
                    try { res = await api('/api/save', { method: 'POST', body: JSON.stringify(body) }); }
                    catch (e) { return failed(e); }
                    // drop what was sent (unless it changed again while the request was in flight)
                    COLLS.forEach(c => {
                        ch[c].upserts.forEach(u => { if (pending[c].upserts.get(u.id) === u.json) pending[c].upserts.delete(u.id); });
                        ch[c].removes.forEach(r => { if (pending[c].removes.has(r.id)) pending[c].removes.delete(r.id); });
                    });
                    if (ch.meta.openingStock && pending.meta.openingStock === ch.meta.openingStock) delete pending.meta.openingStock;
                    persistPending();
                    head = res.head || head;
                    if (res.meta) meta = { ...meta, maxInvoiceNo: res.meta.maxInvoiceNo, openingStock: res.meta.openingStock || meta.openingStock };
                    if (res.renumbered && res.renumbered.length) applyRenumbered(res.renumbered);
                    if (res.behind && isEmpty(pending)) setTimeout(() => refresh(true), 200);
                    retryDelay = 5000;
                }
            } while (again);
            lastSaved = new Date(); lastError = ''; setStatus('saved');
        } finally { running = false; }
    }
    function failed(e) {
        lastError = e.message || 'Could not save';
        if (e.status === 401) { setStatus('error'); return; }
        const transient = !e.status || e.status >= 500 || e.status === 409 || e.status === 429;
        setStatus(transient ? 'offline' : 'error');
        if (transient) { retryTimer = setTimeout(flush, retryDelay); retryDelay = Math.min(retryDelay * 2, 60_000); }
        else if (window.toast) window.toast('Could not save: ' + lastError, 'error');
    }
    function applyRenumbered(list) {
        list.forEach(x => {
            const b = bills.find(y => y.id === x.id); if (!b) return;
            b.invoiceNo = x.to;
            stockHistory.forEach(h => { if (h.reason === 'Bill: ' + x.from && h.timestamp === b.timestamp) h.reason = 'Bill: ' + x.to; });
            if (window.toast) window.toast(`Invoice number ${x.from} was already taken on another device - saved as ${x.to}`, 'warn');
        });
        snap.bills && list.forEach(x => snap.bills.delete(x.id));       // force re-diff so the new number is saved too
        if (window.loadBills) window.loadBills();
        save();
    }

    // ------------------------------------------------------------------ loading
    function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; } }
    function writeCache(state) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ head, scope, fys, loadedFys, storage, state })); }
        catch (e) { try { localStorage.removeItem(CACHE_KEY); } catch (e2) { } }
    }

    async function fetchState(wantScope, useCache) {
        const cache = useCache ? readCache() : null;
        const q = 'scope=' + wantScope + (cache && cache.scope === wantScope && cache.head ? '&since=' + encodeURIComponent(cache.head) : '');
        const r = await api('/api/state?' + q);
        if (r.unchanged && cache) return { head: cache.head, fys: cache.fys, loadedFys: cache.loadedFys, storage: cache.storage, state: cache.state, scope: wantScope };
        return r;
    }
    function adopt(r) {
        head = r.head; scope = r.scope || scope; fys = r.fys || []; loadedFys = r.loadedFys || []; storage = r.storage || storage;
        meta = { maxInvoiceNo: 0, openingStock: {}, ...(r.state.meta || {}) };
        const state = { bills: r.state.bills || [], purchases: r.state.purchases || [], stockHistory: r.state.stockHistory || [], inventory: r.state.inventory || [], meta };
        writeCache(JSON.parse(JSON.stringify(state)));
        applyPendingTo(state);                    // local changes the server has not confirmed yet stay visible
        takeSnapshot(state);
        return state;
    }

    // Called by app.js loadAllData()
    async function load() {
        showBoot('Loading your data…');
        try {
            restorePending();
            const r = await fetchState('recent', true);
            const state = adopt(r);
            await maybeImportLegacy(state, r);
            hideBoot(); startBackground();
            if (!isEmpty(pending)) setTimeout(flush, 600);
            else setStatus('saved');
            return state;
        } catch (e) {
            hideBoot();
            if (e.status === 401) throw e;
            // offline start: fall back to the cached copy
            const cache = readCache();
            if (cache) { const state = adopt({ ...cache, scope: cache.scope }); setStatus('offline'); lastError = 'Offline - showing the last copy from this device'; startBackground(); return state; }
            showLoadError(e); throw e;
        }
    }

    // Pull changes made on another device (only when nothing is waiting to be saved)
    async function refresh(force) {
        if (!signedIn || running || !isEmpty(pending)) return;
        const now = Date.now(); if (!force && now - lastCheck < 15_000) return; lastCheck = now;
        try {
            const r = await api('/api/state?scope=' + scope + '&since=' + encodeURIComponent(head || ''));
            if (r.unchanged) return;
            const state = adopt(r);
            window.applyLoadedState(state); window.renderAllData(false);
            if (window.toast) window.toast('Updated with changes from another device', 'info');
        } catch (e) { }
    }
    async function loadAllHistory() {
        try {
            showBoot('Loading all older years…');
            const r = await api('/api/state?scope=all');
            const state = adopt(r);
            window.applyLoadedState(state); window.renderAllData(false);
            if (window.toast) window.toast('All years loaded (' + r.loadedFys.length + ')', 'success');
        } catch (e) { if (window.toast) window.toast('Could not load older years: ' + e.message, 'error'); }
        finally { hideBoot(); closePopover(); }
    }

    // One-time import of the data that used to live only in this browser
    async function maybeImportLegacy(state, r) {
        let legacy = null; try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch (e) { }
        if (!legacy) return;
        const n = ['bills', 'inventory', 'purchases', 'stockHistory'].reduce((s, c) => s + ((legacy[c] || []).length), 0);
        const serverEmpty = !state.bills.length && !state.inventory.length && !state.purchases.length && !state.stockHistory.length && !(fys || []).length;
        if (!n) { try { localStorage.removeItem(LEGACY_KEY); } catch (e) { } return; }
        if (!serverEmpty) return;                     // server already has data: never overwrite it silently
        hideBoot();
        const ok = window.uiConfirm
            ? await window.uiConfirm('Upload the data stored in this browser?', `Found ${(legacy.bills || []).length} bills, ${(legacy.purchases || []).length} purchases and ${(legacy.inventory || []).length} inventory items saved on this device. They will be saved to your online data store.`, 'Upload now')
            : window.confirm('Upload the data stored in this browser to the online data store?');
        if (!ok) return;
        COLLS.forEach(c => { (legacy[c] || []).forEach(rec => { if (rec && rec.id) state[c].push(rec); }); });
        ['bills', 'purchases', 'stockHistory'].forEach(c => state[c].sort((a, b) => String(b.timestamp || b.createdAt || b.date || '').localeCompare(String(a.timestamp || a.createdAt || a.date || ''))));
        try { localStorage.setItem(LEGACY_KEY + '_uploaded', localStorage.getItem(LEGACY_KEY)); localStorage.removeItem(LEGACY_KEY); } catch (e) { }
        const mx = Math.max(0, ...state.bills.map(b => parseInt(String(b.invoiceNo || '').replace(/\D/g, ''), 10) || 0));
        meta.maxInvoiceNo = Math.max(meta.maxInvoiceNo || 0, mx);
        showBoot('Uploading your data…');
        window.applyLoadedState(state);
        diffIntoPending(); persistPending();
        await flush();
        hideBoot();
        if (window.toast && status === 'saved') window.toast('Your data is now stored online', 'success');
    }

    // ------------------------------------------------------------------ clear local cache
    // Removes the copy of your data and the view settings kept in this browser, then reloads from the online store.
    // Theme choice and the safety copy of data uploaded from the old browser-only version are kept.
    async function clearCache() {
        closePopover();
        if (running || !isEmpty(pending)) {
            if (window.toast) window.toast(`${countPending() || 'Some'} change(s) have not been saved online yet. Save them first (click the Saved/Not saved pill), then clear the cache.`, 'error');
            return;
        }
        const ok = window.uiConfirm
            ? await window.uiConfirm('Clear local cache?', 'This removes the copy of your data and the table / filter preferences stored in this browser, then reloads everything fresh from the online store. Your data online is not touched and you stay signed in.', 'Clear and reload')
            : true;
        if (!ok) return;
        try {
            const drop = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k === CACHE_KEY || k === PENDING_KEY || k === 'bm_section' || k === 'bm_dash_period' || k === 'bm_report_tab' || /^bm_tbl_/.test(k) || /^bm_opening_stock_/.test(k)) drop.push(k);
            }
            drop.forEach(k => localStorage.removeItem(k));
        } catch (e) { }
        try { sessionStorage.clear(); } catch (e) { }
        location.reload();
    }

    // ------------------------------------------------------------------ meta (opening stock)
    function getMeta(key) { return meta[key]; }
    function setOpeningStock(fy, value) {
        const k = String(fy);
        meta.openingStock = { ...(meta.openingStock || {}) };
        if (value == null) delete meta.openingStock[k]; else meta.openingStock[k] = Number(value);
        pending.meta.openingStock = { ...(pending.meta.openingStock || {}), [k]: value == null ? null : Number(value) };
        persistPending(); save();
    }
    const getOpeningStock = (fy) => (meta.openingStock || {})[String(fy)];

    // ------------------------------------------------------------------ sign in / out
    function showAuth(msg) {
        const auth = $('auth-container'), app = $('app-container');
        if (auth) auth.style.display = 'flex'; if (app) app.style.display = 'none';
        const e = $('authError'); if (e) { e.textContent = msg || ''; e.hidden = !msg; }
        hideBoot();
    }
    async function showApp(user) {
        signedIn = true;
        $('auth-container').style.display = 'none';
        $('app-container').style.display = 'grid';
        const u = $('user-email'); if (u) u.textContent = user || '';
        const av = $('userAvatar'); if (av) av.textContent = (user || 'U').trim().charAt(0).toUpperCase();
        if (window.loadAllData) await window.loadAllData();
    }
    function handleSignedOut() {
        if (!signedIn) return;
        signedIn = false; showAuth('Your session ended. Please sign in again.');
    }

    window.signIn = window.supabaseSignIn = async function (username, password) {
        const btn = document.querySelector('#auth-container button[type="submit"]'); const e = $('authError');
        if (e) e.hidden = true; if (btn) btn.disabled = true;
        try {
            const remember = !!($('rememberMe') && $('rememberMe').checked);
            const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password, remember }) });
            const pw = $('login-password'); if (pw) pw.value = '';
            await showApp(r.user);
        } catch (err) { showAuth(err.message); }
        finally { if (btn) btn.disabled = false; }
    };
    window.signOut = window.supabaseSignOut = async function () {
        if (!isEmpty(pending) || running) {
            const ok = window.uiConfirm ? await window.uiConfirm('Unsaved changes', `${countPending()} change(s) have not reached the online store yet. If you log out now they stay on this device and upload the next time you sign in. Log out anyway?`, 'Log out') : true;
            if (!ok) return;
        }
        try { await api('/api/logout', { method: 'POST' }); } catch (e) { }
        signedIn = false; stopBackground();
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { }
        location.reload();
    };
    window.sendPasswordReset = function () { if (window.toast) window.toast('The login is set by the administrator in the server settings (APP_USERNAME / APP_PASSWORD).', 'info'); };
    window.completePasswordReset = function () { $('password-reset-modal').style.display = 'none'; };

    // ------------------------------------------------------------------ UI: boot splash, status pill
    function showBoot(msg) {
        let b = $('bootSplash');
        if (!b) { b = document.createElement('div'); b.id = 'bootSplash'; b.className = 'boot-splash'; b.innerHTML = '<div class="boot-card"><div class="spinner"></div><p></p></div>'; document.body.appendChild(b); }
        b.querySelector('p').textContent = msg || 'Loading…'; b.hidden = false;
    }
    function hideBoot() { const b = $('bootSplash'); if (b) b.hidden = true; }
    function showLoadError(e) {
        showBoot('');
        const b = $('bootSplash'); b.querySelector('.boot-card').innerHTML = `<h3>Couldn't load your data</h3><p>${String(e.message || e).replace(/[<>&]/g, '')}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button>`;
    }

    const LABEL = { idle: 'Ready', saving: 'Saving…', saved: 'Saved', offline: 'Not saved', error: 'Error' };
    function setStatus(s) {
        status = s;
        const pill = $('syncPill'); if (!pill) return;
        pill.dataset.state = s;
        const n = countPending();
        pill.querySelector('.sync-label').textContent = s === 'offline' ? `Not saved (${n})` : s === 'error' ? 'Save error' : LABEL[s];
        pill.title = s === 'offline' ? lastError || 'Waiting to reconnect' : s === 'saved' && lastSaved ? 'Last saved ' + lastSaved.toLocaleTimeString() : '';
    }
    function ensurePill() {
        if ($('syncPill')) return;
        const host = document.querySelector('.topbar-actions'); if (!host) return;
        const b = document.createElement('button');
        b.id = 'syncPill'; b.type = 'button'; b.className = 'sync-pill'; b.dataset.state = 'idle';
        b.innerHTML = '<span class="sync-dot"></span><span class="sync-label">Ready</span>';
        b.addEventListener('click', togglePopover);
        host.insertBefore(b, host.firstChild);
    }
    let popCleanup = null;
    function closePopover() { if (popCleanup) { popCleanup(); popCleanup = null; } const p = $('syncPop'); if (p) p.remove(); }
    function togglePopover() {
        if ($('syncPop')) return closePopover();
        const pill = $('syncPill'), r = pill.getBoundingClientRect();
        const p = document.createElement('div'); p.id = 'syncPop'; p.className = 'sync-pop';
        const from = loadedFys.length ? loadedFys[loadedFys.length - 1] : '';
        p.innerHTML = `
            <h4>Data storage</h4>
            <dl>
                <dt>Stored in</dt><dd>${storage || 'online store'}</dd>
                <dt>Status</dt><dd>${status === 'saved' ? 'All changes saved' : status === 'saving' ? 'Saving…' : status === 'offline' ? countPending() + ' change(s) waiting - ' + (lastError || 'offline') : status === 'error' ? lastError : 'Ready'}</dd>
                <dt>Years loaded</dt><dd>${scope === 'all' ? 'All (' + fys.length + ')' : loadedFys.length ? 'FY ' + loadedFys[loadedFys.length - 1] + ' to FY ' + loadedFys[0] : 'Current'}${scope !== 'all' && fys.length > loadedFys.length ? ' - ' + (fys.length - loadedFys.length) + ' older available' : ''}</dd>
            </dl>
            <div class="sync-actions">
                <button class="btn btn-sm" data-act="sync">${isEmpty(pending) ? 'Check for updates' : 'Retry saving now'}</button>
                ${scope !== 'all' && fys.length > loadedFys.length ? '<button class="btn btn-sm" data-act="all">Load older years</button>' : ''}
                <button class="btn btn-sm" data-act="clear">Clear local cache</button>
            </div>`;
        document.body.appendChild(p);
        p.style.top = (r.bottom + 6) + 'px'; p.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
        p.addEventListener('click', e => {
            const a = e.target.closest('[data-act]'); if (!a) return;
            if (a.dataset.act === 'all') loadAllHistory();
            else if (a.dataset.act === 'clear') clearCache();
            else { closePopover(); retryDelay = 5000; if (!isEmpty(pending)) flush(); else refresh(true); }
        });
        const off = (e) => { if (!p.contains(e.target) && !pill.contains(e.target)) closePopover(); };
        document.addEventListener('mousedown', off);
        popCleanup = () => document.removeEventListener('mousedown', off);
    }

    // ------------------------------------------------------------------ background work
    let poll = null;
    function startBackground() {
        ensurePill();
        if (poll) return;
        poll = setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, 60_000);
    }
    function stopBackground() { clearInterval(poll); poll = null; }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && signedIn) refresh(false); });
    window.addEventListener('online', () => { if (signedIn && !isEmpty(pending)) { retryDelay = 5000; flush(); } });
    window.addEventListener('beforeunload', (e) => { if (signedIn && (running || !isEmpty(pending))) { e.preventDefault(); e.returnValue = ''; } });

    // ------------------------------------------------------------------ start
    async function boot() {
        if (booted) return; booted = true;
        const auth = $('auth-container'), app = $('app-container');
        if (auth) auth.style.display = 'none'; if (app) app.style.display = 'none';
        showBoot('Checking your sign-in…');
        try {
            const me = await api('/api/me');
            if (me.authenticated) await showApp(me.user); else showAuth('');
        } catch (e) { showAuth('Cannot reach the server. ' + (e.message || '')); }
    }

    window.Sync = { save, load, refresh, loadAllHistory, clearCache, getMeta, getOpeningStock, setOpeningStock, get meta() { return meta; }, get status() { return status; }, get pendingCount() { return countPending(); }, flush };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
