// Searchable dropdowns everywhere: every <select> gets a "search and pick" popup.
// The native <select> stays in the DOM (hidden), so existing code that reads .value or listens for
// 'change' keeps working unchanged; programmatic .value = ... and option changes are picked up too.
(function () {
    'use strict';

    const SEARCH_MIN = 6;               // show the search box when a list has at least this many options
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

    let pop = null, popState = null;     // the single open popup

    function tokens(q) { return String(q || '').toLowerCase().split(/\s+/).filter(Boolean); }
    function hl(text, toks) {
        const safe = esc(text);
        if (!toks.length) return safe;
        const re = new RegExp('(' + toks.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
        return safe.replace(re, '<mark>$1</mark>');
    }

    // ---------------------------------------------------------------- popup
    function ensurePop() {
        if (pop) return pop;
        pop = document.createElement('div');
        pop.className = 'ss-pop'; pop.hidden = true;
        pop.innerHTML = '<div class="ss-searchwrap"><input class="ss-search" type="text" placeholder="Search…" autocomplete="off" aria-label="Search options"></div><div class="ss-list" role="listbox" tabindex="-1"></div>';
        document.body.appendChild(pop);
        pop.addEventListener('mousedown', e => { if (!e.target.closest('.ss-search')) e.preventDefault(); });
        pop.addEventListener('click', e => {
            const o = e.target.closest('.ss-opt'); if (!o || o.classList.contains('dis') || !popState) return;
            choose(popState, +o.dataset.i);
        });
        pop.querySelector('.ss-search').addEventListener('input', () => { if (popState) { popState.active = 0; renderList(popState, true); } });
        pop.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', e => { if (popState && !pop.contains(e.target) && !popState.trigger.contains(e.target)) closePop(); }, true);
        window.addEventListener('resize', closePop);
        window.addEventListener('scroll', e => { if (popState && !pop.contains(e.target)) place(popState); }, true);
        return pop;
    }

    function optionsOf(sel) {
        const out = [];
        [...sel.children].forEach(ch => {
            if (ch.tagName === 'OPTGROUP') { out.push({ group: ch.label }); [...ch.children].forEach(o => out.push(opt(o))); }
            else if (ch.tagName === 'OPTION') out.push(opt(ch));
        });
        return out;
        function opt(o) { return { value: o.value, text: o.textContent.trim(), disabled: o.disabled, index: o.index }; }
    }

    function renderList(st, keepScroll) {
        const list = pop.querySelector('.ss-list');
        const toks = tokens(pop.querySelector('.ss-search').value);
        const all = optionsOf(st.sel);
        const shown = [];
        let pendingGroup = null;
        all.forEach(o => {
            if (o.group != null) { pendingGroup = o.group; return; }
            if (toks.length && !toks.every(t => (o.text + ' ' + o.value).toLowerCase().includes(t))) return;
            if (pendingGroup) { shown.push({ group: pendingGroup }); pendingGroup = null; }
            shown.push(o);
        });
        st.rows = shown.filter(o => o.group == null);
        if (st.active >= st.rows.length) st.active = Math.max(0, st.rows.length - 1);
        let ri = -1;
        list.innerHTML = shown.map(o => {
            if (o.group != null) return `<div class="ss-group">${esc(o.group)}</div>`;
            ri++;
            const selected = o.index === st.sel.selectedIndex;
            const placeholder = o.value === '' ;
            return `<div class="ss-opt${selected ? ' on' : ''}${ri === st.active ? ' act' : ''}${o.disabled ? ' dis' : ''}${placeholder ? ' ph' : ''}" role="option" aria-selected="${selected}" data-i="${ri}"><span class="ss-txt">${hl(o.text || '—', toks)}</span>${selected ? '<svg class="ic ss-check" viewBox="0 0 24 24"><path d="m9 16.2-3.5-3.5L4 14.1l5 5 11-11-1.4-1.4L9 16.2z" fill="currentColor"/></svg>' : ''}</div>`;
        }).join('') || '<div class="ss-empty">No matches</div>';
        const act = list.querySelector('.ss-opt.act');
        if (act && !keepScroll) act.scrollIntoView({ block: 'nearest' });
        else if (act) act.scrollIntoView({ block: 'nearest' });
    }

    function place(st) {
        if (!st.trigger.isConnected) return closePop();
        const r = st.trigger.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return closePop();
        const width = Math.max(r.width, 220);
        pop.style.minWidth = width + 'px';
        pop.style.maxWidth = Math.min(560, window.innerWidth - 16) + 'px';
        pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - Math.max(width, pop.offsetWidth) - 8)) + 'px';
        const h = pop.offsetHeight, below = window.innerHeight - r.bottom - 8, above = r.top - 8;
        if (h > below && above > below) { pop.style.top = 'auto'; pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'; pop.style.setProperty('--ss-max', Math.min(320, above - 56) + 'px'); }
        else { pop.style.bottom = 'auto'; pop.style.top = (r.bottom + 4) + 'px'; pop.style.setProperty('--ss-max', Math.min(320, below - 56) + 'px'); }
    }

    function openPop(st) {
        if (st.sel.disabled) return;
        ensurePop();
        if (popState && popState !== st) closePop();
        popState = st;
        const n = optionsOf(st.sel).filter(o => o.group == null && o.value !== '').length;
        const mode = st.sel.dataset.search;
        const searchable = mode === 'always' || (mode !== 'never' && n >= SEARCH_MIN);
        const input = pop.querySelector('.ss-search');
        pop.querySelector('.ss-searchwrap').hidden = !searchable;
        input.value = '';
        st.active = Math.max(0, st.sel.selectedIndex);
        pop.hidden = false; st.trigger.setAttribute('aria-expanded', 'true');
        renderList(st);
        // keep the highlighted row aligned with the current value
        const idx = st.rows.findIndex(o => o.index === st.sel.selectedIndex); if (idx >= 0) { st.active = idx; renderList(st); }
        place(st);
        (searchable ? input : pop.querySelector('.ss-list')).focus({ preventScroll: true });
    }
    function closePop(refocus) {
        if (!popState) return;
        const st = popState; popState = null;
        pop.hidden = true; st.trigger.setAttribute('aria-expanded', 'false');
        if (refocus && st.trigger.isConnected) st.trigger.focus({ preventScroll: true });
    }
    function choose(st, ri) {
        const o = st.rows[ri]; if (!o || o.disabled) return;
        const changed = st.sel.selectedIndex !== o.index;
        indexDesc.set.call(st.sel, o.index);
        refresh(st);
        closePop(true);
        if (changed) { st.sel.dispatchEvent(new Event('input', { bubbles: true })); st.sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    function onKey(e) {
        const st = popState; if (!st) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); st.active = Math.min(st.rows.length - 1, st.active + 1); renderList(st); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); st.active = Math.max(0, st.active - 1); renderList(st); }
        else if (e.key === 'Home') { e.preventDefault(); st.active = 0; renderList(st); }
        else if (e.key === 'End') { e.preventDefault(); st.active = st.rows.length - 1; renderList(st); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); choose(st, st.active); }
        else if (e.key === 'Tab') closePop();
    }

    // ---------------------------------------------------------------- enhancing a <select>
    function refresh(st) {
        const sel = st.sel, o = sel.options[sel.selectedIndex];
        const text = o ? o.textContent.trim() : '';
        st.label.textContent = text || ' ';
        st.trigger.classList.toggle('ph', !o || o.value === '');
        st.trigger.disabled = sel.disabled;
        st.trigger.classList.toggle('chk', sel.classList.contains('chk'));
    }

    function enhance(sel) {
        if (sel._ss || sel.hidden || sel.multiple || sel.size > 1 || sel.dataset.native != null) return;
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = ['ss-trigger'].concat([...sel.classList].filter(c => c !== 'ss-native')).join(' ');
        trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
        if (sel.getAttribute('aria-label')) trigger.setAttribute('aria-label', sel.getAttribute('aria-label'));
        if (sel.id) trigger.dataset.for = sel.id;
        trigger.innerHTML = '<span class="ss-label"></span><svg class="ss-caret" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
        const st = { sel, trigger, label: trigger.querySelector('.ss-label'), active: 0, rows: [] };
        sel._ss = st;
        sel.classList.add('ss-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
        sel.insertAdjacentElement('afterend', trigger);

        // programmatic changes: select.value = x / selectedIndex = n / options replaced / disabled toggled
        Object.defineProperty(sel, 'value', { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); refresh(st); } });
        Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return indexDesc.get.call(this); }, set(v) { indexDesc.set.call(this, v); refresh(st); } });
        new MutationObserver(() => { refresh(st); if (popState === st && !pop.hidden) renderList(st); })
            .observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class'] });
        sel.addEventListener('change', () => refresh(st));
        const form = sel.form; if (form) form.addEventListener('reset', () => setTimeout(() => refresh(st), 0));

        trigger.addEventListener('click', () => { if (popState === st) closePop(); else openPop(st); });
        trigger.addEventListener('keydown', e => {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openPop(st); }
            else if (e.key === 'Escape' && popState === st) { e.stopPropagation(); closePop(); }
        });
        // a <label for=...> or invalid-state focus on the native control should land on the visible one
        sel.addEventListener('focus', () => { trigger.focus(); });
        refresh(st);
    }

    function enhanceAll(root) {
        (root.querySelectorAll ? root.querySelectorAll('select') : []).forEach(enhance);
        if (root.tagName === 'SELECT') enhance(root);
    }

    function start() {
        enhanceAll(document);
        new MutationObserver(muts => {
            muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) enhanceAll(n); }));
            if (popState && !popState.trigger.isConnected) closePop();
        }).observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    window.SearchSelect = { enhance, refresh: (sel) => sel._ss && refresh(sel._ss) };
})();
