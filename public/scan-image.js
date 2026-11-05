// Image clean-up for OCR of photographed bills: straighten, even out lighting (adaptive threshold)
// and erase the ruled table lines that confuse text recognition.
(function (root) {
    'use strict';

    function grayOf(img) {
        const n = img.width * img.height, g = new Uint8ClampedArray(n), d = img.data;
        for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
        return g;
    }

    // adaptive threshold: a pixel is "ink" when clearly darker than its neighbourhood
    function binarize(g, w, h, radius, k) {
        const W = w + 1, I = new Float64Array(W * (h + 1));
        for (let y = 0; y < h; y++) {
            let row = 0;
            for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
        }
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
            for (let x = 0; x < w; x++) {
                const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
                const area = (x1 - x0) * (y1 - y0);
                const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / area;
                out[y * w + x] = g[y * w + x] < mean * (1 - k) ? 1 : 0;
            }
        }
        return out;
    }

    // skew angle (degrees) that makes rows of ink line up best — table rules give a very sharp peak
    function estimateSkew(bin, w, h) {
        const step = 4, pts = [];
        for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (bin[y * w + x]) pts.push(x, y);
        if (pts.length < 400) return 0;
        const score = (a) => {
            const t = Math.tan(a * Math.PI / 180), hist = new Map();
            for (let i = 0; i < pts.length; i += 2) { const b = Math.round((pts[i + 1] - pts[i] * t) / step); hist.set(b, (hist.get(b) || 0) + 1); }
            let s = 0; hist.forEach(v => { s += v * v; }); return s;
        };
        let best = 0, bs = -1;
        for (let a = -5; a <= 5.001; a += 0.25) { const s = score(a); if (s > bs) { bs = s; best = a; } }
        const c = best; best = c; bs = -1;
        for (let a = c - 0.25; a <= c + 0.2501; a += 0.05) { const s = score(a); if (s > bs) { bs = s; best = a; } }
        return best;
    }

    // erase long thin horizontal / vertical strokes (table borders)
    function removeLines(bin, w, h) {
        const minH = Math.max(60, Math.round(w * 0.03)), minV = Math.max(80, Math.round(h * 0.025));
        const kill = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            let run = 0;
            for (let x = 0; x <= w; x++) {
                if (x < w && bin[y * w + x]) run++;
                else { if (run >= minH) for (let k = x - run; k < x; k++) kill[y * w + k] = 1; run = 0; }
            }
        }
        for (let x = 0; x < w; x++) {
            let run = 0;
            for (let y = 0; y <= h; y++) {
                if (y < h && bin[y * w + x]) run++;
                else { if (run >= minV) for (let k = y - run; k < y; k++) kill[k * w + x] = 1; run = 0; }
            }
        }
        // grow the erased lines by 1px so anti-aliased edges do not remain
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!bin[i]) continue;
            let near = kill[i];
            if (!near && x > 0 && kill[i - 1]) near = 1;
            if (!near && x < w - 1 && kill[i + 1]) near = 1;
            if (!near && y > 0 && kill[i - w]) near = 1;
            if (!near && y < h - 1 && kill[i + w]) near = 1;
            out[i] = near ? 0 : 1;
        }
        return out;
    }

    // canvas in -> { canvas (black text on white), skew }
    function preprocess(src, opts) {
        opts = opts || {};
        const w0 = src.width, h0 = src.height;
        const ctx0 = src.getContext('2d');
        let img = ctx0.getImageData(0, 0, w0, h0);
        let g = grayOf(img);
        const radius = Math.max(12, Math.round(w0 / 90));
        let skew = 0;
        if (opts.deskew !== false) {
            // rough binary at reduced cost for angle estimation
            const rough = binarize(g, w0, h0, radius, 0.12);
            skew = estimateSkew(rough, w0, h0);
        }
        let canvas = src;
        if (Math.abs(skew) > 0.05) {
            const rc = document.createElement('canvas'); rc.width = w0; rc.height = h0;
            const x = rc.getContext('2d');
            x.fillStyle = '#fff'; x.fillRect(0, 0, w0, h0);
            x.translate(w0 / 2, h0 / 2); x.rotate(-skew * Math.PI / 180); x.drawImage(src, -w0 / 2, -h0 / 2);
            canvas = rc;
            img = rc.getContext('2d').getImageData(0, 0, w0, h0);
            g = grayOf(img);
        }
        let bin = binarize(g, w0, h0, radius, 0.14);
        if (opts.removeLines !== false) bin = removeLines(bin, w0, h0);
        const out = document.createElement('canvas'); out.width = w0; out.height = h0;
        const ox = out.getContext('2d'), od = ox.createImageData(w0, h0);
        for (let i = 0, j = 0; i < bin.length; i++, j += 4) { const v = bin[i] ? 0 : 255; od.data[j] = od.data[j + 1] = od.data[j + 2] = v; od.data[j + 3] = 255; }
        ox.putImageData(od, 0, 0);
        // hard black/white edges make the recogniser drop small marks such as decimal points; soften slightly
        const blur = opts.blur == null ? 1 : opts.blur;
        if (blur > 0) {
            const sc = document.createElement('canvas'); sc.width = w0; sc.height = h0;
            const sx = sc.getContext('2d');
            sx.fillStyle = '#fff'; sx.fillRect(0, 0, w0, h0);
            sx.filter = 'blur(' + blur + 'px)'; sx.drawImage(out, 0, 0);
            return { canvas: sc, skew };
        }
        return { canvas: out, skew };
    }

    root.BillScanImage = { preprocess };
})(window);
