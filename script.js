document.addEventListener('DOMContentLoaded', () => {

    // ---- Arabic PDF support (font + plugin loader) ----
    // Ensures Arabic text renders correctly in jsPDF exports (connected letters + RTL)
    const ARABIC_FONT_URL = 'https://cdn.jsdelivr.net/gh/alif-type/amiri-font@master/ttf/Amiri-Regular.ttf';
    const ARABIC_FONT_BOLD_URL = 'https://cdn.jsdelivr.net/gh/alif-type/amiri-font@master/ttf/Amiri-Bold.ttf';
    const ARABIC_PLUGIN_CANDIDATES = [
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.plugin.arabic.js',
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/plugins/arabic.js',
        'https://cdn.jsdelivr.net/npm/jspdf/dist/plugins/arabic.js'
    ];
    window.__ARABIC_FONT_TTF = window.__ARABIC_FONT_TTF || 'Amiri-Regular.ttf';
    window.__ARABIC_FONT_BOLD_TTF = window.__ARABIC_FONT_BOLD_TTF || 'Amiri-Bold.ttf';
    window.__ARABIC_FONT_NAME = window.__ARABIC_FONT_NAME || 'Amiri';

    function loadScript(url){
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = url; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load '+url));
            document.head.appendChild(s);
        });
    }

    async function fetchAsBase64(url){
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) throw new Error('Font fetch failed: ' + res.status);
        const buf = await res.arrayBuffer();
        let binary = '';
        const bytes = new Uint8Array(buf);
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    async function ensureArabicPDFBase64(){
        try {
            if (!window.__JSPDF_ARABIC_PLUGIN_LOADED) {
                try {
                    let loaded = false;
                    for (const url of ARABIC_PLUGIN_CANDIDATES) {
                        try { await loadScript(url); loaded = true; if (window.DEBUG) console.info('jsPDF Arabic plugin loaded from', url); break; } catch(_) {}
                    }
                    window.__JSPDF_ARABIC_PLUGIN_LOADED = loaded;
                } catch(e){
                    console.warn('Arabic plugin load failed (continuing):', e);
                }
            }
            if (!window.__ARABIC_FONT_BASE64) {
                window.__ARABIC_FONT_BASE64 = await fetchAsBase64(ARABIC_FONT_URL);
            }
            if (!window.__ARABIC_FONT_BOLD_BASE64) {
                try { window.__ARABIC_FONT_BOLD_BASE64 = await fetchAsBase64(ARABIC_FONT_BOLD_URL); } catch(e){ console.warn('Bold Arabic font fetch failed (continuing with regular):', e); }
            }
        } catch(e){
            console.warn('Arabic PDF support (font/plugin) setup warning:', e);
        }
    }

    async function applyArabicFontToDoc(doc){
        try {
            await ensureArabicPDFBase64();
            if (window.__ARABIC_FONT_BASE64) {
                doc.addFileToVFS(window.__ARABIC_FONT_TTF, window.__ARABIC_FONT_BASE64);
                doc.addFont(window.__ARABIC_FONT_TTF, window.__ARABIC_FONT_NAME, 'normal');
                if (window.__ARABIC_FONT_BOLD_BASE64) {
                    try {
                        doc.addFileToVFS(window.__ARABIC_FONT_BOLD_TTF, window.__ARABIC_FONT_BOLD_BASE64);
                        doc.addFont(window.__ARABIC_FONT_BOLD_TTF, window.__ARABIC_FONT_NAME, 'bold');
                    } catch (e) { console.warn('Failed to register bold Arabic font:', e); }
                }
                doc.setFont(window.__ARABIC_FONT_NAME, 'normal');
                if (typeof doc.setR2L === 'function') { try { doc.setR2L(true); } catch(_){} }
                if (window.DEBUG) { try { console.info('Arabic font applied to jsPDF', { font: window.__ARABIC_FONT_NAME, pluginLoaded: !!window.__JSPDF_ARABIC_PLUGIN_LOADED }); } catch(_){} }
                if (!window.__JSPDF_ARABIC_PLUGIN_LOADED) { console.warn('Arabic shaping plugin not loaded; relying on font + RTL flags only.'); }
                if (doc.autoTableSetDefaults) {
                    doc.autoTableSetDefaults({
                        styles: { font: window.__ARABIC_FONT_NAME },
                        didParseCell: (data) => {
                            try {
                                const cell = data.cell || {};
                                const txt = Array.isArray(cell.text) ? cell.text.join(' ') : String(cell.text || '');
                                if (window.__containsArabic && window.__containsArabic(txt)) {
                                    cell.styles = cell.styles || {};
                                    cell.styles.halign = cell.styles.halign || 'right';
                                    if (!window.__JSPDF_ARABIC_PLUGIN_LOADED) {
                                        // Store original text and suppress default text drawing
                                        cell.__origText = txt;
                                        cell.text = [''];
                                    }
                                }
                            } catch(_){}
                        },
                        didDrawCell: (data) => {
                            try {
                                const cell = data.cell || {};
                                if (!window.__JSPDF_ARABIC_PLUGIN_LOADED && cell.__origText) {
                                    const align = (cell.styles && cell.styles.halign) || 'right';
                                    const xLeft = cell.x + 2;
                                    const xRight = cell.x + cell.width - 2;
                                    const xCenter = cell.x + cell.width / 2;
                                    let anchorX = xLeft;
                                    if (align === 'right') anchorX = xRight;
                                    else if (align === 'center') anchorX = xCenter;
                                    const baselineY = cell.y + cell.height / 2 + 2; // approx baseline
                                    __drawTextAsImage(data.doc || doc, cell.__origText, anchorX, baselineY, { align });
                                }
                            } catch(_){}
                        }
                    });
                }
            }
        } catch(e){
            console.warn('Failed to apply Arabic font to PDF doc:', e);
        }
    }

    // Helper for RTL detection
    function containsArabic(text){
        return /[\u0600-\u06FF]/.test(String(text || ''));
    }

    // Expose to other functions
    window.__ensureArabicPDFBase64 = ensureArabicPDFBase64;
    window.__applyArabicFontToDoc = applyArabicFontToDoc;
    window.__containsArabic = containsArabic;

    // Unit helpers for canvas-based Arabic fallback
    function __ptToPx(pt){ return pt * (96/72); }
    function __pxToMm(px){ return px * (25.4/96); }

    // Draw Arabic text as an image on the PDF (browser renders glyph shaping correctly)
    function __drawTextAsImage(doc, text, x, y, options = {}){
        try{
            const lines = Array.isArray(text) ? text.map(t=>String(t ?? '')) : String(text ?? '').split(/\r?\n/);
            const fontSizePt = (typeof doc.getFontSize === 'function') ? doc.getFontSize() : 12;
            const fontSizePx = Math.max(10, Math.round(__ptToPx(fontSizePt)));
            const lineHeightPx = Math.round(fontSizePx * 1.35);
            const fontFamily = (window.__ARABIC_FONT_NAME || 'Amiri') + ", 'Noto Naskh Arabic', 'Segoe UI', Arial, sans-serif";

            // First pass: measure
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.font = `${fontSizePx}px ${fontFamily}`;
            ctx.direction = 'rtl';
            ctx.textAlign = 'right';
            let maxWidthPx = 0;
            for (const line of lines){
                const m = ctx.measureText(line);
                maxWidthPx = Math.max(maxWidthPx, m.width || 0);
            }
            canvas.width = Math.ceil(maxWidthPx + 8);
            canvas.height = Math.ceil(lines.length * lineHeightPx + 6);

            // Second pass: draw
            ctx.clearRect(0,0,canvas.width,canvas.height);
            ctx.font = `${fontSizePx}px ${fontFamily}`;
            ctx.direction = 'rtl';
            ctx.textAlign = 'right';
            ctx.fillStyle = '#000';
            lines.forEach((line, i)=>{
                // Draw with small top padding; y baseline approx at 0.8 * lineHeight
                ctx.fillText(line, canvas.width - 3, 3 + (i + 0.85) * lineHeightPx);
            });

            const imgData = canvas.toDataURL('image/png');
            const imgWmm = __pxToMm(canvas.width);
            const imgHmm = __pxToMm(canvas.height);

            // Alignment handling
            let drawX = x;
            const align = (options.align || (options.isInputRtl ? 'right' : 'left'));
            if (align === 'center') drawX = x - imgWmm/2;
            else if (align === 'right') drawX = x - imgWmm;

            // y provided is baseline; approximate top Y
            const yTop = y - imgHmm + __pxToMm(lineHeightPx * 0.25);
            doc.addImage(imgData, 'PNG', drawX, yTop, imgWmm, imgHmm);
            return true;
        }catch(err){
            console.warn('Arabic image-fallback draw failed:', err);
            return false;
        }
    }

    // Smart text writer with RTL/Arabic handling (with canvas fallback if plugin missing)
    function writeTextSmart(doc, text, x, y, opts = {}) {
        try {
            const isArr = Array.isArray(text);
            const raw = isArr ? text.join(' ') : String(text ?? '');
            const hasAr = (window.__containsArabic && window.__containsArabic(raw));
            const options = { ...opts };
            const pageWidth = (doc.internal && doc.internal.pageSize && doc.internal.pageSize.getWidth) ? doc.internal.pageSize.getWidth() : 210;
            let anchorX = x;
            if (hasAr) {
                options.isInputRtl = true;
                if (!options.align) {
                    options.align = 'right';
                    if (typeof x === 'number' && x <= 30) {
                        anchorX = pageWidth - 12;
                    }
                }
                // If Arabic plugin isn't loaded, draw as image to preserve shaping
                if (!window.__JSPDF_ARABIC_PLUGIN_LOADED) {
                    const ok = __drawTextAsImage(doc, text, anchorX, y, options);
                    if (ok) return; // already drawn
                }
            }
            return doc.text(text, anchorX, y, options);
        } catch (e) {
            try { return doc.text(String(text ?? ''), x, y, opts || {}); } catch(_) { console.warn('writeTextSmart failed:', e); }
        }
    }
    window.__writeTextSmart = writeTextSmart;


    // Debug utilities
    window.DEBUG = window.DEBUG ?? true;
    window.addEventListener('error', function (e) {
        try { console.error('Global error captured:', e.error || e.message, e); } catch (_) { }
        try { if (typeof showNotification === 'function') showNotification((e.error?.message || e.message || 'Unknown error'), 'error', 6000); } catch (_) { }
    });
    window.addEventListener('unhandledrejection', function (e) {
        try { console.error('Unhandled promise rejection:', e.reason); } catch (_) { }
        try { if (typeof showNotification === 'function') showNotification((e.reason?.message || String(e.reason)), 'error', 6000); } catch (_) { }
    });

    // Global variables for tare values
    var tare1 = 0;
    var tare2 = 0;
    var standardWeight = 0;
    var currentPalletId = 1;
    var editingProductId = null;

    // Advanced Formula System Variables
    var formulaDependencies = {}; // Store dependencies between fields
    var customVariables = {}; // Store custom variables for each product
    // Formula cache removed - using CalculationBuilder instead

    // Fallback CalculationBuilder shim to keep calculations working even if the
    // external builder library isn't loaded via index.html. This supports common
    // operations and re-calculation wiring used by script2.js.
    (function(){
        if (window.calculationBuilder) return; // real builder already present

        function toNumber(v){
            const n = typeof v === 'number' ? v : parseFloat(v);
            return (isNaN(n) || !isFinite(n)) ? null : n;
        }

        function getParamValue(tableId, paramName, colIndex){
            try{
                // Query by table and column, then match param name in dataset to avoid selector escaping issues
                const all = document.querySelectorAll(`[data-table-id="${tableId}"][data-col-index="${colIndex}"]`);
                for (const el of all){
                    if ((el.dataset.paramName || '').trim() === String(paramName).trim()){
                        const n = toNumber(el.value);
                        if (n !== null) return n;
                    }
                }
            }catch(e){/* no-op */}
            return null;
        }

        function resolveInput(input, ctx){
            if (input == null) return null;
            if (typeof input === 'number') return input;
            if (typeof input === 'string'){
                // treat as parameter name
                return getParamValue(ctx.tableId, input, ctx.colIndex);
            }
            if (typeof input === 'object'){
                const t = (input.type || input.kind || '').toLowerCase();
                if (t === 'parameter' || t === 'param'){
                    const name = input.name || input.id || input.param;
                    return getParamValue(ctx.tableId, name, ctx.colIndex);
                }
                if (t === 'variable' || t === 'var'){
                    const name = input.name || input.id;
                    const vars = window.customVariablesMap || (typeof window.getCustomVariables === 'function' ? window.getCustomVariables() : {});
                    const v = vars ? vars[name] : undefined;
                    return toNumber(v);
                }
                if (t === 'constant' || Object.prototype.hasOwnProperty.call(input, 'value')){
                    return toNumber(input.value);
                }
            }
            return null;
        }

        function applyOperation(op, inputs, ctx){
            const vals = (inputs || []).map(x => resolveInput(x, ctx)).filter(v => v !== null);
            if (!vals.length) return null;
            switch((op || '').toLowerCase()){
                case 'sum':
                case 'add':
                    return vals.reduce((a,b)=>a+b,0);
                case 'avg':
                case 'average':
                    return vals.reduce((a,b)=>a+b,0) / vals.length;
                case 'multiply':
                case 'product':
                    return vals.reduce((a,b)=>a*b,1);
                case 'subtract':
                    return vals.length >= 2 ? (vals[0] - vals[1]) : null;
                case 'divide':
                    return (vals.length >= 2 && vals[1] !== 0) ? (vals[0] / vals[1]) : null;
                case 'percentage':
                    return (vals.length >= 2 && vals[1] !== 0) ? ((vals[0] / vals[1]) * 100) : null;
                case 'min':
                    return Math.min(...vals);
                case 'max':
                    return Math.max(...vals);
                default:
                    return null;
            }
        }

        window.calculationBuilder = {
            initializeBuilder(container, calculationData){
                // Minimal persistence: keep existing calculation JSON if present
                try{
                    if (!container) return;
                    const hidden = container.querySelector('.calculation-json');
                    if (hidden && calculationData){
                        hidden.value = encodeURIComponent(JSON.stringify(calculationData));
                    }
                    // Optionally, display a tiny badge to indicate fallback is active
                    if (!container.querySelector('.calc-builder')){
                        const badge = document.createElement('div');
                        badge.className = 'calc-builder text-xs text-gray-500';
                        badge.textContent = 'CalculationBuilder (fallback)';
                        container.appendChild(badge);
                    }
                }catch(e){/* no-op */}
            },
            setCustomVariables(vars){
                const map = {};
                if (Array.isArray(vars)){
                    vars.forEach(v => { if (v && v.name) map[v.name] = toNumber(v.value) ?? v.value; });
                }
                window.customVariablesMap = map;
            },
            refreshParameterOptions(){ /* no-op in fallback */ },
            executeCalculation(calculation, tableId, colIndex){
                try{
                    const ctx = { tableId, colIndex: parseInt(colIndex,10) };
                    let result = null;
                    if (calculation && Array.isArray(calculation.steps) && calculation.steps.length){
                        let current = null;
                        for (const step of calculation.steps){
                            current = applyOperation(step.operation || step.op, step.inputs || step.sources || [], ctx);
                        }
                        result = current;
                    } else if (calculation && (calculation.operation || calculation.op)){
                        result = applyOperation(calculation.operation || calculation.op, calculation.inputs || calculation.sources || [], ctx);
                    } else {
                        // Try simple shape: {op, a, b}
                        if (calculation && calculation.op && (calculation.a != null || calculation.b != null)){
                            result = applyOperation(calculation.op, [calculation.a, calculation.b], ctx);
                        }
                    }
                    if (result == null || isNaN(result)) return null;
                    const decimals = (typeof calculation?.decimals === 'number') ? calculation.decimals
                                    : (typeof calculation?.outputDecimals === 'number') ? calculation.outputDecimals
                                    : (typeof calculation?.round === 'number') ? calculation.round : null;
                    return (typeof decimals === 'number') ? Number(result.toFixed(decimals)) : result;
                }catch(e){ console.warn('Fallback executeCalculation error:', e); return null; }
            },
            recalculateDependents(tableId, paramName, colIndex){
                try{
                    const selector = `.gui-calculated[data-table-id="${tableId}"][data-col-index="${colIndex}"]`;
                    document.querySelectorAll(selector).forEach(input => {
                        const calcStr = input.dataset.calculation ? decodeURIComponent(input.dataset.calculation) : '';
                        if (!calcStr) return;
                        try{
                            const calc = JSON.parse(calcStr);
                            const v = window.calculationBuilder.executeCalculation(calc, tableId, parseInt(colIndex,10));
                            if (v == null) { input.value = ''; }
                            else if (typeof v === 'number' && isFinite(v)) { input.value = v.toFixed(2); }
                            else { input.value = v; }
                        }catch(e){ /* ignore */ }
                    });
                }catch(e){/* no-op */}
            },
            recalculateAll(){
                try{
                    document.querySelectorAll('.gui-calculated').forEach(input => {
                        const tableId = input.dataset.tableId;
                        const colIndex = parseInt(input.dataset.colIndex,10);
                        const calcStr = input.dataset.calculation ? decodeURIComponent(input.dataset.calculation) : '';
                        if (!calcStr) return;
                        try{
                            const calc = JSON.parse(calcStr);
                            const v = window.calculationBuilder.executeCalculation(calc, tableId, colIndex);
                            if (v == null) { input.value = ''; }
                            else if (typeof v === 'number' && isFinite(v)) { input.value = v.toFixed(2); }
                            else { input.value = v; }
                        }catch(e){ /* ignore */ }
                    });
                }catch(e){/* no-op */}
            }
        };

        // Provide a harmless stub so callers don't need to guard its existence
        if (!window.updateTemplateCalculatedFields){
            window.updateTemplateCalculatedFields = function(){};
        }
    })();


    // Define getCustomVariables function to return current custom variables
    window.getCustomVariables = function () {
        const variables = {};
        const modal = document.getElementById('product-modal');
        if (modal && modal.style.display === 'block') {
            // Get custom variables from modal when editing
            modal.querySelectorAll('.variable-row').forEach(row => {
                const nameInput = row.querySelector('.variable-name');
                const valueInput = row.querySelector('.variable-value');
                if (nameInput && valueInput) {
                    const name = nameInput.value.trim();
                    const value = parseFloat(valueInput.value);
                    if (name && !isNaN(value)) {
                        variables[name] = value;
                    }
                }
            });
        } else if (editingProductId && products[editingProductId]) {
            // Get custom variables from the currently selected product
            const product = products[editingProductId];
            if (product.customVariables) {
                product.customVariables.forEach(variable => {
                    if (variable.name) {
                        variables[variable.name] = parseFloat(variable.value) || 0;
                    }
                });
            }
        }
        // Also maintain a global map for quick access
        window.customVariablesMap = variables;
        return variables;
    };

    // Batch Number Generation Functions
    function createBatchNumber(productConfig, date = new Date()) {
        // Prefer explicit batchCode; fall back to product.code for legacy configs
        const baseCode = (productConfig.batchCode || productConfig.code || '').toString().toUpperCase();
        if (!baseCode) return '';

        const day = formatDay(date.getDate(), productConfig.dayFormat || 'DD');
        const month = formatMonth(date.getMonth() + 1, productConfig.monthFormat || 'letter');

        return baseCode + day + month;
    }

    function formatDay(day, format) {
        if (format === 'DD') {
            return day.toString().padStart(2, '0');
        }
        return day.toString();
    }

    function formatMonth(month, format) {
        if (format === 'letter') {
            // A=Jan, B=Feb, ..., L=Dec
            const letters = 'ABCDEFGHIJKL';
            return letters[month - 1] || 'A';
        } else if (format === 'roman') {
            // I=Jan, II=Feb, ..., XII=Dec
            const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
            return romans[month - 1] || 'I';
        }
        return month.toString();
    }

    function updateBatchPreview() {
        const code = document.getElementById('product-batch-code')?.value || '---';
        const dayFormat = document.getElementById('product-day-format')?.value || 'DD';
        const monthFormat = document.getElementById('product-month-format')?.value || 'letter';

        const today = new Date();
        const day = formatDay(today.getDate(), dayFormat);
        const month = formatMonth(today.getMonth() + 1, monthFormat);

        const previewCode = document.getElementById('preview-code');
        const previewDay = document.getElementById('preview-day');
        const previewMonth = document.getElementById('preview-month');

        if (previewCode) previewCode.textContent = code || '---';
        if (previewDay) previewDay.textContent = day || '--';
        if (previewMonth) previewMonth.textContent = month || '-';
    }

    // AQL sampling plan mapping and sample table meta
    const sampleTableMeta = {};
    // Acceptance/Rejection numbers by sample size category and AQL level
    // Format: "Ac/Re" meaning Accept up to Ac defectives, Reject at Re defectives
    const AQL_PLAN = {
        2: { "0.10%": "0/1", "0.15%": "0/1", "0.25%": "0/1", "0.40%": "0/1", "0.65%": "0/1", "1.0%": "0/1", "1.5%": "0/1", "2.5%": "0/1", "4.0%": "0/1", "6.5%": "0/1", "10.0%": "1/2" },
        3: { "0.10%": "0/1", "0.15%": "0/1", "0.25%": "0/1", "0.40%": "0/1", "0.65%": "0/1", "1.0%": "0/1", "1.5%": "0/1", "2.5%": "0/1", "4.0%": "0/1", "6.5%": "1/2", "10.0%": "1/2" },
        5: { "0.10%": "0/1", "0.15%": "0/1", "0.25%": "0/1", "0.40%": "0/1", "0.65%": "0/1", "1.0%": "0/1", "1.5%": "0/1", "2.5%": "1/2", "4.0%": "1/2", "6.5%": "1/2", "10.0%": "2/3" },
        8: { "0.10%": "0/1", "0.15%": "0/1", "0.25%": "0/1", "0.40%": "0/1", "0.65%": "0/1", "1.0%": "0/1", "1.5%": "0/1", "2.5%": "1/2", "4.0%": "1/2", "6.5%": "2/3", "10.0%": "3/4" },
        13: { "0.10%": "0/1", "0.15%": "0/1", "0.25%": "0/1", "0.40%": "0/1", "0.65%": "0/1", "1.0%": "0/1", "1.5%": "1/2", "2.5%": "1/2", "4.0%": "1/2", "6.5%": "2/3", "10.0%": "4/5" },
        20: { "0.10%": "0/1", "0.15%": "0/1", "0.25%": "0/1", "0.40%": "0/1", "0.65%": "0/1", "1.0%": "1/2", "1.5%": "1/2", "2.5%": "2/3", "4.0%": "2/3", "6.5%": "3/4", "10.0%": "5/6" },
        32: { "0.10%": "0/1", "0.15%": "0/1", "0.25%": "0/1", "0.40%": "0/1", "1.0%": "1/2", "1.5%": "1/2", "2.5%": "2/3", "4.0%": "3/4", "6.5%": "5/6", "10.0%": "7/8" },
        50: { "0.10%": "0/1", "0.15%": "0/1", "0.25%": "0/1", "1.0%": "1/2", "1.5%": "2/3", "2.5%": "3/4", "4.0%": "5/6", "6.5%": "7/8", "10.0%": "10/11" }
    };
    function nearestSampleSizeCategory(n) {
        const sizes = Object.keys(AQL_PLAN).map(s => parseInt(s, 10));
        return sizes.reduce((prev, curr) => Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev, sizes[0]);
    }
    function parseAcRe(str) {
        if (!str || typeof str !== 'string') return { ac: 0, re: 1 };
        const parts = str.split('/');
        return { ac: parseInt(parts[0], 10) || 0, re: parseInt(parts[1], 10) || 1 };
    }
    function computeTareLimits(stdWeight) {
        // New TD-based calculation per provided table
        const Qn = parseFloat(stdWeight) || 0;
        let TD = 0; // Tolerable Deficiency
        if (Qn <= 0) return { t1: 0, t2: 0, pack1: 0, pack2: 0 };
        if (Qn <= 50) {
            TD = 0.09 * Qn;
        } else if (Qn <= 100) {
            TD = 4.5;
        } else if (Qn <= 200) {
            TD = 0.045 * Qn;
        } else if (Qn <= 300) {
            TD = 9;
        } else if (Qn <= 500) {
            TD = 0.03 * Qn;
        } else if (Qn <= 1000) {
            TD = 15;
        } else if (Qn <= 10000) {
            TD = 0.015 * Qn;
        } else if (Qn <= 15000) {
            TD = 150;
        } else if (Qn <= 50000) {
            TD = 0.01 * Qn;
        } else {
            // For > 50,000 g, extend using 1% rule unless specified otherwise
            TD = 0.01 * Qn;
        }
        const t1 = Qn - TD;               // Tare 1 = Qn - TD
        const t2 = Qn - (2 * TD);         // Tare 2 = Qn - 2*TD
        const pack1 = t2;                 // Keep existing display fields
        const pack2 = Qn + (2 * TD);
        return { t1, t2, pack1, pack2 };
    }
    function getAcReFor(tableId, aqlLevel) {
        const meta = sampleTableMeta[tableId] || {};
        const sampleRows = meta.sampleRows || 20;
        const bucket = nearestSampleSizeCategory(sampleRows);
        const row = AQL_PLAN[bucket] || AQL_PLAN[20];
        const key = row[aqlLevel] ? aqlLevel : '1.0%';
        return parseAcRe(row[key]);
    }

    const productSelect = document.getElementById('product-name');
    const batchInput = document.getElementById('batch-number');
    const dateInput = document.getElementById('report-date');
    const shiftDurationSelect = document.getElementById('shift-duration');
    const shiftInput = document.getElementById('shift');
    // Pallet records are now handled dynamically
    const saveToReportsBtn = document.getElementById('save-to-reports');
    // const loadBtn = document.getElementById('load-data');
    const resetBtn = document.getElementById('reset-form');
    const exportPdfBtn = document.getElementById('export-pdf');
    const notification = document.getElementById('notification');
    const dynamicSectionsContainer = document.getElementById('dynamic-sections-container');

    // Product management elements
    const addProductBtn = document.getElementById('add-product-btn');
    const importProductsBtn = document.getElementById('import-products-btn');
    const exportProductsBtn = document.getElementById('export-products-btn');
    const productSearch = document.getElementById('product-search');
    const productsTableBody = document.getElementById('products-table-body');
    const productModal = document.getElementById('product-modal');
    const modalTitle = document.getElementById('modal-title');
    const productForm = document.getElementById('product-form');
    const productIdInput = document.getElementById('product-id');
    const productNameInput = document.getElementById('product-name-modal');
    const productStandardWeightInput = document.getElementById('product-standard-weight');
    const productShelfLifeInput = document.getElementById('product-shelf-life');
    const productCartonsPerPalletInput = document.getElementById('product-cartons-per-pallet');
    const productPacksPerBoxInput = document.getElementById('product-packs-per-box');
    const productBoxesPerCartonInput = document.getElementById('product-boxes-per-carton');
    const productEmptyBoxWeightInput = document.getElementById('product-empty-box-weight');
    const productEmptyCartonWeightInput = document.getElementById('product-empty-carton-weight');
    const productAqlLevelInput = document.getElementById('product-aql-level');
    const sectionsContainer = document.getElementById('sections-container');
    const addSectionBtn = document.getElementById('add-section-btn');
    const cancelProductBtn = document.getElementById('cancel-product-btn');
    const saveProductBtn = document.getElementById('save-product-btn');

    // Custom Variables Elements
    const variablesContainer = document.getElementById('variables-container');
    const addVariableBtn = document.getElementById('add-variable-btn');

    // Recipe containers
    const withCocoaRecipeContainer = document.getElementById('with-cocoa-recipe-container');
    const withoutCocoaRecipeContainer = document.getElementById('without-cocoa-recipe-container');
    const creamRecipeContainer = document.getElementById('cream-recipe-container');
    const addWithCocoaRecipeBtn = document.getElementById('add-with-cocoa-recipe-btn');
    const addWithoutCocoaRecipeBtn = document.getElementById('add-without-cocoa-recipe-btn');
    const addCreamRecipeBtn = document.getElementById('add-cream-recipe-btn');

    // Time headers will be generated dynamically based on shift
    let timeHeaders2hr = [];
    let timeHeaders1hr = [];

    // Initialize products from localStorage or use default with error handling
    let products;

    // Products will be loaded via API by product-api-integration.js
    // Keep localStorage as fallback only
    try {
        const savedProducts = localStorage.getItem('productConfigurations');
        products = savedProducts ? JSON.parse(savedProducts) : null;
    } catch (parseError) {
        logError('Loading saved products', parseError);
        showNotification('Failed to load saved products. Using default configuration.', 'warning', 5000);
        products = null;
    }
    products = products || {
        'plain-no-cocoa': {
            'id': 'plain-no-cocoa',
            'name': 'Plain Biscuits (No Cocoa)',
            'code': 'BBS',
            'ingredients_type': 'without-cocoa',
            'has_cream': false,
            'standardWeight': 185,
            'shelfLife': 6,
            'cartonsPerPallet': 120,
            'packsPerBox': 12,
            'boxesPerCarton': 6,
            'emptyBoxWeight': 25,
            'emptyCartonWeight': 50,
            'qualityCriteria': [
                {
                    'id': 'grade-a',
                    'title': 'GRADE A - STANDARD PRODUCT',
                    'icon': 'fas fa-check-circle',
                    'color': 'green',
                    'items': [
                        { 'label': 'Acceptance:', 'value': 'Not less than 95%' },
                        { 'label': 'Color:', 'value': 'Uniform, consistent with standard' },
                        { 'label': 'Formation:', 'value': 'Perfect shape, no deformities' },
                        { 'label': 'Sensory:', 'value': 'Excellent taste, texture, aroma' },
                        { 'label': 'Packaging:', 'value': 'Perfect seal, no defects' },
                        { 'label': 'Breakage:', 'value': 'Minimal to none' }
                    ]
                },
                {
                    'id': 'grade-b',
                    'title': 'GRADE B - MINOR DEFECTS',
                    'icon': 'fas fa-exclamation-triangle',
                    'color': 'yellow',
                    'items': [
                        { 'label': 'Acceptance:', 'value': 'Not more than 5%' },
                        { 'label': 'Color:', 'value': 'Slight variation from standard' },
                        { 'label': 'Formation:', 'value': 'Minor shape irregularities' },
                        { 'label': 'Sensory:', 'value': 'Acceptable with minor variations' },
                        { 'label': 'Packaging:', 'value': 'Minor cosmetic defects' },
                        { 'label': 'Breakage:', 'value': 'Minor cracks or chips' }
                    ]
                },
                {
                    'id': 'grade-c',
                    'title': 'GRADE C - MAJOR DEFECTS',
                    'icon': 'fas fa-times-circle',
                    'color': 'red',
                    'items': [
                        { 'label': 'Acceptance:', 'value': 'NOT ACCEPTED' },
                        { 'label': 'Color:', 'value': 'Significant discoloration' },
                        { 'label': 'Formation:', 'value': 'Severe deformation' },
                        { 'label': 'Sensory:', 'value': 'Unacceptable taste/texture' },
                        { 'label': 'Packaging:', 'value': 'Seal failure, contamination' },
                        { 'label': 'Breakage:', 'value': 'Significant damage' }
                    ]
                }
            ],
            'sections': {
                'section-1': {
                    'name': 'RAW MATERIAL PREPARATION & INITIAL VERIFICATION',
                    'icon': 'fas fa-seedling',
                    'tables': [
                        {
                            'id': 'verification-checks',
                            'name': 'Material Verification & Pre-Processing Checks',
                            'inspectionPeriod': 120, // 2 hours
                            'parameters': [
                                { name: 'Ingredients Conformity', limits: 'Conform to Recipe', type: 'check' },
                                { name: 'Scale Calibration', limits: 'Confirmed', type: 'check' },
                                { name: 'Flour Sieve Check', limits: '20 Mesh', type: 'check' },
                                { name: 'Sugar Magnet Confirmation', limits: 'Confirmed', type: 'check' },
                                { name: 'Mixing Steps Conformity', limits: 'As per SOP', type: 'check' },
                                { name: 'Dough Metal Detector (OPRP)', limits: 'Fe 1.5mm, NF 3.5mm, SS 4mm', type: 'oprp' }
                            ]
                        }
                    ]
                },
                'section-2': {
                    'name': 'BAKING PROCESS CONTROL & MONITORING',
                    'icon': 'fas fa-fire',
                    'tables': [
                        {
                            'id': 'baking-process',
                            'name': 'Baking Process Parameters',
                            'inspectionPeriod': 30, // 30 minutes
                            'parameters': [
                                { name: 'Oven Zone 1 Temp (°C)', limits: 'As per Recipe', type: 'text' },
                                { name: 'Oven Zone 2 Temp (°C)', limits: 'As per Recipe', type: 'text' },
                                { name: 'Oven Zone 3 Temp (°C)', limits: 'As per Recipe', type: 'text' },
                                { name: 'Baking Time (min)', limits: '3:00 - 7:30', type: 'text' },
                                { name: 'Mold Speed (RPM)', limits: '4.0 - 12.0', type: 'text' },
                                { name: 'Weight Before Baking (Avg 10 pcs)', limits: '30 - 40g', type: 'number', min: 30, max: 40 },
                                { name: 'Weight After Baking (Avg 10 pcs)', limits: '25 - 30g', type: 'number', min: 25, max: 30 },
                                { name: 'Dimensions (Avg 10 pcs) mm', limits: '42 - 45mm', type: 'text' },
                                { name: 'Thickness (Avg 10 pcs) mm', limits: '50 - 65mm', type: 'text' },
                                { name: 'Color', limits: 'A Grade', type: 'grade' },
                                { name: 'Formation', limits: 'A Grade', type: 'grade' },
                                { name: 'Sensory Test', limits: 'A Grade', type: 'grade' },
                                { name: 'Moisture Content %', limits: '0.5 - 3.5%', type: 'text' }
                            ]
                        }
                    ]
                },
                'section-3': {
                    'name': 'PACKS WEIGHTS MONITORING',
                    'icon': 'fas fa-weight',
                    'tables': [
                        {
                            'id': 'packs-weights',
                            'name': 'Packs Weights',
                            'inspectionPeriod': 60,
                            'isPacksWeightsTable': true,
                            'parameters': [
                                { name: 'Pack Gross Weight', limits: '176.68 - 193.32g', type: 'number', min: 176.68, max: 193.32 },
                                { name: 'Display Box Gross Weight', limits: '500 - 600g', type: 'number', min: 500, max: 600 },
                                { name: 'Carton Gross Weight', limits: '3.0 - 3.6 Kg', type: 'number', min: 3.0, max: 3.6 }
                            ]
                        }
                    ]
                },
                'section-4': {
                    'name': 'PACKAGING & FINAL QUALITY CONTROL',
                    'icon': 'fas fa-box',
                    'tables': [
                        {
                            'id': 'packaging',
                            'name': 'Packaging Quality Control',
                            'parameters': [
                                { name: 'Final Product Metal Detector (CCP)', limits: 'Fe 1.5mm, NF 3.5mm, SS 4mm', type: 'ccp' },
                                { name: 'Pack Gross Weight (Avg 10) g', limits: '176.68 - 193.32g', type: 'number', min: 176.68, max: 193.32 },
                                { name: 'Display Box Gross Weight (Avg 10) g', limits: '500 - 600g', type: 'number', min: 500, max: 600 },
                                { name: 'Number of Packs in Display Box', limits: '12 pcs', type: 'number' },
                                { name: 'Number of Display Boxes in Carton', limits: '6 pcs', type: 'number' },
                                { name: 'Carton Gross Weight (Avg 10) Kg', limits: '3.0 - 3.6 Kg', type: 'number', min: 3.0, max: 3.6 },
                                { name: 'Production Date/Time/Weight/Barcode (Pack)', limits: 'Confirmed', type: 'check' },
                                { name: 'Print Stability on Pack', limits: 'Confirmed', type: 'check' },
                                { name: 'Production Date (Display Box)', limits: 'Confirmed', type: 'check' },
                                { name: 'Production Date/Month Code (Carton)', limits: 'Confirmed', type: 'check' },
                                { name: 'Pack Packaging Evaluation', limits: 'A Grade', type: 'grade' },
                                { name: 'Display Box Packaging Evaluation', limits: 'A Grade', type: 'grade' },
                                { name: 'Carton Packaging Evaluation', limits: 'A Grade', type: 'grade' },
                                { name: 'Breakage', limits: 'A Grade', type: 'grade' }
                            ]
                        }
                    ]
                }
            },
            'recipe': [
                { name: 'Flour', weight: '150', shelfLife: 12, dateFormat: 'dd/mm/yyyy' },
                { name: 'Sugar', weight: '51', shelfLife: 24, dateFormat: 'dd/mm/yyyy' },
                { name: 'Vegetable Oil', weight: '36.800', shelfLife: 6, dateFormat: 'dd/mm/yyyy' },
                { name: 'Salt', weight: '0.800', shelfLife: 36, dateFormat: 'dd/mm/yyyy' },
                { name: 'Baking Powder', weight: '1.500', shelfLife: 18, dateFormat: 'dd/mm/yyyy' },
                { name: 'Lecithin', weight: '0.880', shelfLife: 12, dateFormat: 'dd/mm/yyyy' },
                { name: 'Glucose', weight: '7.400', shelfLife: 12, dateFormat: 'dd/mm/yyyy' },
                { name: 'Vanilla', weight: '2.940', shelfLife: 24, dateFormat: 'dd/mm/yyyy' },
                { name: 'Ammonium Bicarbonate', weight: '0.148', shelfLife: 24, dateFormat: 'dd/mm/yyyy' },
                { name: 'Rework Material', weight: '10', shelfLife: 1, dateFormat: 'dd/mm/yyyy' }
            ]
        }
    };

    const months = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

    // *** NEW: Global variable to hold the smart navigation map ***
    let navigationMap = [];

    // *** UPDATED V2: Builds a smart navigation map based on actual time values, handling asynchronous columns ***
    function buildNavigationMap() {
        navigationMap = [];
        const formTab = document.getElementById('form-tab');
        if (!formTab) return;

        const tables = Array.from(formTab.querySelectorAll('table.form-table'));
        if (tables.length === 0) return;

        // Step 1: Collect all unique time values from all table headers in their display order
        const uniqueTimes = [];
        const timeHeaderRows = formTab.querySelectorAll('thead tr[id^="time-headers-"]');
        timeHeaderRows.forEach(headerRow => {
            Array.from(headerRow.cells).forEach(cell => {
                const time = cell.textContent.trim();
                if (time && !uniqueTimes.includes(time)) {
                    uniqueTimes.push(time);
                }
            });
        });

        // Step 2: Iterate through each unique time, then through each table, to build the map column by column
        uniqueTimes.forEach(time => {
            tables.forEach(table => {
                const timeHeaderRow = table.querySelector('thead tr[id^="time-headers-"]');
                if (!timeHeaderRow) return;

                // Find which column index in this specific table corresponds to the current time
                const timeCells = Array.from(timeHeaderRow.cells);
                const timeColumnIndex = timeCells.findIndex(cell => cell.textContent.trim() === time);

                // If this table has this time column, add its inputs to the map
                if (timeColumnIndex !== -1) {
                    const dataRows = Array.from(table.querySelectorAll('tbody tr:not(.bg-blue-50):not(.bg-gray-50)'));

                    dataRows.forEach(row => {
                        // This logic correctly finds the Nth data cell that corresponds to the Nth time column
                        let currentDataCell = null;
                        let timeHeaderCounter = 0;
                        for (const cell of Array.from(row.cells)) {
                            const input = cell.querySelector('.input-field, .grade-select');
                            if (input && !cell.classList.contains('font-semibold')) {
                                if (timeHeaderCounter === timeColumnIndex) {
                                    currentDataCell = cell;
                                    break;
                                }
                                timeHeaderCounter++;
                            }
                        }

                        if (currentDataCell) {
                            const finalInput = currentDataCell.querySelector('.input-field:not([readonly]):not([disabled]), .grade-select:not([disabled])');
                            if (finalInput) {
                                navigationMap.push(finalInput);
                            }
                        }
                    });
                }
            });
        });

        console.log(`Smart navigation map built with ${navigationMap.length} elements.`);
    }


    function setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            const activeElement = document.activeElement;
            const isNavigable = activeElement && activeElement.matches('.input-field, .grade-select') && activeElement.closest('td');

            if (!isNavigable) return;

            // --- Smart Navigation (Enter/Tab) ---
            const currentIndex = navigationMap.indexOf(activeElement);
            if (currentIndex !== -1 && (e.key === 'Enter' || e.key === 'Tab')) {
                e.preventDefault();
                let nextIndex;

                if (e.key === 'Tab' && e.shiftKey) { // Backward
                    nextIndex = (currentIndex - 1 + navigationMap.length) % navigationMap.length;
                } else { // Forward
                    nextIndex = (currentIndex + 1) % navigationMap.length;
                }

                const nextElement = navigationMap[nextIndex];
                if (nextElement) {
                    nextElement.focus();
                    if (nextElement.select) nextElement.select();
                }
                return; // End execution here
            }

            // --- Local Grid Navigation (Arrow Keys) ---
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                const currentCell = activeElement.closest('td');
                const currentRow = currentCell.closest('tr');
                const cellIndex = Array.from(currentRow.cells).indexOf(currentCell);

                let targetCell = null;

                switch (e.key) {
                    case 'ArrowDown':
                        const nextRow = currentRow.nextElementSibling;
                        if (nextRow) targetCell = nextRow.cells[cellIndex];
                        break;
                    case 'ArrowUp':
                        const prevRow = currentRow.previousElementSibling;
                        if (prevRow) targetCell = prevRow.cells[cellIndex];
                        break;
                    case 'ArrowLeft':
                        targetCell = currentCell.previousElementSibling;
                        break;
                    case 'ArrowRight':
                        targetCell = currentCell.nextElementSibling;
                        break;
                }

                const targetInput = targetCell?.querySelector('.input-field:not([readonly]):not([disabled]), .grade-select:not([disabled])');
                if (targetInput) {
                    targetInput.focus();
                    if (targetInput.select) targetInput.select();
                }
            }
        });
    }
    // Initialize keyboard navigation
    setupKeyboardNavigation();
    // Function to switch between child tabs
    function switchChildTab(tabId) {
        const navContainer = document.querySelector('#product-modal .child-tabs-nav');
        if (!navContainer) return;

        // Deactivate all child tabs and panels
        navContainer.querySelectorAll('.child-tab-button').forEach(button => {
            button.classList.remove('active');
        });
        document.querySelectorAll('#product-modal .child-tab-panel').forEach(panel => {
            panel.style.display = 'none';
        });

        // Activate the selected tab and panel
        const selectedButton = navContainer.querySelector(`.child-tab-button[data-tab-id="${tabId}"]`);
        const selectedPanel = document.getElementById(tabId);

        if (selectedButton) {
            selectedButton.classList.add('active');
        }
        if (selectedPanel) {
            selectedPanel.style.display = 'block';
        }
    }

    // Renamed from addSection and moved to global scope
    // This function adds a new section as a child tab in the "Form Sections" tab.
    window.addFormSection = function (section = null) {
        const childTabsNav = document.querySelector('#product-modal .child-tabs-nav');
        const childTabsContent = document.querySelector('#product-modal .child-tabs-content');

        if (!childTabsNav || !childTabsContent) {
            console.error('Child tab containers not found!');
            return;
        }

        const sectionId = section ? section.id : `section-${Date.now()}`;
        const sectionName = section ? section.name : 'New Section';

        // 1. Create the Child Tab Button
        const tabButton = document.createElement('button');
        tabButton.type = 'button';
        tabButton.className = 'child-tab-button';
        tabButton.dataset.tabId = sectionId;
        tabButton.innerHTML = `
        <span class="child-tab-label">${sectionName}</span>
        <i class="fas fa-times remove-section-btn" title="Remove Section"></i>
    `;
        childTabsNav.appendChild(tabButton);

        // 2. Create the Child Tab Panel
        const tabPanel = document.createElement('div');
        tabPanel.id = sectionId;
        tabPanel.className = 'child-tab-panel';
        tabPanel.style.display = 'none'; // Hide by default

        tabPanel.innerHTML = `
        <div class="section-container p-4 border border-gray-200 rounded bg-white">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                    <label class="block font-semibold mb-1">Section ID:</label>
                    <input type="text" class="input-field section-id" value="${sectionId}" readonly>
                </div>
                <div>
                    <label class="block font-semibold mb-1">Section Name:</label>
                    <input type="text" class="input-field section-name" value="${sectionName}" placeholder="Section Name" required>
                </div>
                <div>
                    <label class="block font-semibold mb-1">Icon Class:</label>
                    <input type="text" class="input-field section-icon" value="${section ? section.icon : 'fas fa-cog'}" placeholder="fas fa-cog">
                </div>
            </div>
            <div class="mb-4">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="font-semibold text-gray-800">Tables</h4>
                    <button type="button" class="add-table-btn bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 text-sm">
                        <i class="fas fa-plus mr-1"></i>Add Table
                    </button>
                </div>
                <div class="tables-container space-y-4">
                    </div>
            </div>
        </div>
    `;
        childTabsContent.appendChild(tabPanel);

        // 3. Add Event Listeners
        tabButton.addEventListener('click', (e) => {
            if (!e.target.classList.contains('remove-section-btn')) {
                switchChildTab(sectionId);
            }
        });

        tabButton.querySelector('.remove-section-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to remove this section?')) {
                const isActive = tabButton.classList.contains('active');
                tabButton.remove();
                tabPanel.remove();
                if (isActive) {
                    const firstTab = childTabsNav.querySelector('.child-tab-button');
                    if (firstTab) {
                        switchChildTab(firstTab.dataset.tabId);
                    }
                }
            }
        });

        const sectionNameInput = tabPanel.querySelector('.section-name');
        sectionNameInput.addEventListener('input', () => {
            tabButton.querySelector('.child-tab-label').textContent = sectionNameInput.value || 'New Section';
        });

        tabPanel.querySelector('.add-table-btn').addEventListener('click', () => {
            addTable(tabPanel.querySelector('.tables-container'));
        });

        // 4. Handle Existing Tables
        if (section && section.tables) {
            const tablesContainer = tabPanel.querySelector('.tables-container');
            section.tables.forEach(table => {
                addTable(tablesContainer, table);
            });
        }

        // 5. Switch to the new tab
        switchChildTab(sectionId);
    }

    // Updated function to add a section as a child tab
    function addSection(section = null) {
        const childTabsNav = document.querySelector('#product-modal .child-tabs-nav');
        const childTabsContent = document.querySelector('#product-modal .child-tabs-content');

        if (!childTabsNav || !childTabsContent) {
            console.error('Child tab containers not found!');
            return;
        }

        const sectionId = section ? section.id : `section-${Date.now()}`;
        const sectionName = section ? section.name : 'New Section';

        // 1. Create the Child Tab Button
        const tabButton = document.createElement('button');
        tabButton.type = 'button';
        tabButton.className = 'child-tab-button';
        tabButton.dataset.tabId = sectionId;
        tabButton.innerHTML = `
        <span class="child-tab-label">${sectionName}</span>
        <i class="fas fa-times remove-section-btn" title="Remove Section"></i>
    `;
        childTabsNav.appendChild(tabButton);

        // 2. Create the Child Tab Panel
        const tabPanel = document.createElement('div');
        tabPanel.id = sectionId;
        tabPanel.className = 'child-tab-panel';
        tabPanel.style.display = 'none'; // Hide by default

        tabPanel.innerHTML = `
        <div class="section-container p-4 border border-gray-200 rounded">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                    <label class="block font-semibold mb-1">Section ID:</label>
                    <input type="text" class="input-field section-id" value="${sectionId}" readonly>
                </div>
                <div>
                    <label class="block font-semibold mb-1">Section Name:</label>
                    <input type="text" class="input-field section-name" value="${sectionName}" placeholder="Section Name" required>
                </div>
                <div>
                    <label class="block font-semibold mb-1">Icon Class:</label>
                    <input type="text" class="input-field section-icon" value="${section ? section.icon : 'fas fa-cog'}" placeholder="fas fa-cog">
                </div>
            </div>
            <div class="mb-4">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="font-semibold">Tables</h4>
                    <button type="button" class="add-table-btn bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 text-sm">
                        <i class="fas fa-plus mr-1"></i>Add Table
                    </button>
                </div>
                <div class="tables-container space-y-4">
                    </div>
            </div>
        </div>
    `;
        childTabsContent.appendChild(tabPanel);

        // 3. Add Event Listeners
        // Switch to this tab when clicked
        tabButton.addEventListener('click', (e) => {
            if (!e.target.classList.contains('remove-section-btn')) {
                switchChildTab(sectionId);
            }
        });

        // Remove tab and panel
        tabButton.querySelector('.remove-section-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to remove this section?')) {
                const isActive = tabButton.classList.contains('active');
                tabButton.remove();
                tabPanel.remove();
                // If the removed tab was active, switch to the first available tab
                if (isActive) {
                    const firstTab = childTabsNav.querySelector('.child-tab-button');
                    if (firstTab) {
                        switchChildTab(firstTab.dataset.tabId);
                    }
                }
            }
        });

        // Update tab label when section name changes
        const sectionNameInput = tabPanel.querySelector('.section-name');
        sectionNameInput.addEventListener('input', () => {
            tabButton.querySelector('.child-tab-label').textContent = sectionNameInput.value || 'New Section';
        });

        // Add table button
        tabPanel.querySelector('.add-table-btn').addEventListener('click', () => {
            addTable(tabPanel.querySelector('.tables-container'));
        });

        // 4. Handle Existing Tables
        if (section && section.tables) {
            const tablesContainer = tabPanel.querySelector('.tables-container');
            section.tables.forEach(table => {
                addTable(tablesContainer, table);
            });
        }

        // 5. Switch to the new tab
        switchChildTab(sectionId);
    }
    // Tab functionality
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');

            // Deactivate all tabs and contents
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            // Activate selected tab and content
            tab.classList.add('active');
            document.getElementById(tabId).classList.add('active');

            // Initialize tab-specific features
            if (tabId === 'alerts-tab') {
                initAlertsTab();
            }
        });
    });

    // Generate inspection times based on number of passes and period
    function generateInspectionTimes(numPasses, periodMinutes) {
        const shiftStartTime = document.getElementById('shift-start-time')?.value || '06:00';
        const [startHour, startMinute] = shiftStartTime.split(':').map(Number);
        const headers = [];

        for (let i = 0; i < numPasses; i++) {
            const totalMinutes = startMinute + (i * periodMinutes);
            const hours = startHour + Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            const timeStr = `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            headers.push(timeStr);
        }

        return headers;
    }

    // Enhanced function to generate time headers based on shift and inspection periods
    function generateTimeHeaders() {
        const shiftDurationSelect = document.getElementById('shift-duration');
        const shiftDuration = shiftDurationSelect ? parseInt(shiftDurationSelect.value) : 8;
        const startInspectionTimeInput = document.getElementById('start-inspection-time');
        const startTime = startInspectionTimeInput ? startInspectionTimeInput.value : '08:00';

        // Parse start time
        const [startHour, startMinute] = startTime.split(':').map(num => parseInt(num));

        // Clear existing headers
        timeHeaders2hr = [];
        timeHeaders1hr = [];

        // Generate inspection interval headers based on selected default period
        // For 8-hour shift with 1-hour inspection period = 8 columns
        const defaultInspectionPeriodSelect = document.getElementById('default-inspection-period');
        const inspectionPeriodMinutes = defaultInspectionPeriodSelect ?
            parseInt(defaultInspectionPeriodSelect.value) : 60; // Default to 1 hour
        const totalShiftMinutes = shiftDuration * 60;
        const numberOfColumns = Math.floor(totalShiftMinutes / inspectionPeriodMinutes);

        for (let i = 0; i < numberOfColumns; i++) {
            const totalMinutes = (startHour * 60 + startMinute + i * inspectionPeriodMinutes) % (24 * 60);
            const hour = Math.floor(totalMinutes / 60);
            const minute = totalMinutes % 60;
            timeHeaders1hr.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
        }

        // Generate 2-hour interval headers for compatibility with existing tables
        const intervals2hr = Math.floor(shiftDuration / 2);
        for (let i = 0; i < intervals2hr; i++) {
            const totalMinutes = (startHour * 60 + startMinute + i * 120) % (24 * 60);
            const hour = Math.floor(totalMinutes / 60);
            const minute = totalMinutes % 60;
            timeHeaders2hr.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
        }

        // Update headers in the form - skip if element doesn't exist
        if (document.getElementById('time-headers-1hr')) {
            renderTimeHeaders('time-headers-1hr', timeHeaders1hr);
        }

        // Update table headers
        const hourlyHeader = document.getElementById('hourly-measurements-header');
        if (hourlyHeader) {
            hourlyHeader.textContent = `Hourly Measurements - ${timeHeaders1hr.length} passes (${inspectionPeriodMinutes} min intervals)`;
        }

        // Update column calculation display
        const columnCountDisplay = document.getElementById('column-count-display');
        if (columnCountDisplay) {
            const periodHours = inspectionPeriodMinutes / 60;
            const periodText = periodHours >= 1 ? `${periodHours} hour${periodHours > 1 ? 's' : ''}` : `${inspectionPeriodMinutes} minutes`;
            columnCountDisplay.textContent = `${shiftDuration} hours ÷ ${periodText} = ${numberOfColumns} columns`;
        }

        // Re-render form sections if a product is selected
        if (productSelect.value) {
            const selectedProduct = products[productSelect.value];
            if (selectedProduct) {
                renderDynamicSections(selectedProduct);

                // Formula engine initialization removed - using CalculationBuilder instead
                // Hourly table is now handled dynamically
            }
        }
    }

    // Function to generate inspection times for a specific table based on its inspection period
    function generateTableInspectionTimes(inspectionPeriodMinutes, shiftDuration, startTime) {
        const times = [];
        const [startHour, startMinute] = startTime.split(':').map(num => parseInt(num));
        const totalShiftMinutes = shiftDuration * 60;
        const numberOfColumns = Math.floor(totalShiftMinutes / inspectionPeriodMinutes);

        // Generate times based on automatic calculation: shift_hours / inspection_period_hours = number_of_columns
        for (let i = 0; i < numberOfColumns; i++) {
            const totalMinutes = (startHour * 60 + startMinute + i * inspectionPeriodMinutes) % (24 * 60);
            const hour = Math.floor(totalMinutes / 60);
            const minute = totalMinutes % 60;
            times.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
        }

        return times;
    }

    // New function to calculate number of columns automatically
    function calculateInspectionColumns(inspectionPeriodMinutes, shiftDurationHours) {
        const shiftDurationMinutes = shiftDurationHours * 60;
        return Math.floor(shiftDurationMinutes / inspectionPeriodMinutes);
    }

    // Function to generate inspection times with automatic column calculation
    function generateInspectionTimesAuto(inspectionPeriodMinutes, shiftDurationHours, startTime) {
        const numberOfColumns = calculateInspectionColumns(inspectionPeriodMinutes, shiftDurationHours);
        return generateTableInspectionTimes(inspectionPeriodMinutes, shiftDurationHours, startTime);
    }

    // Auto-calculation engine
    function setupAutoCalculations(tbody) {
        // Find all auto-calculated fields
        const autoCalcFields = tbody.querySelectorAll('.auto-calculated');

        autoCalcFields.forEach(field => {
            const calculateFrom = field.dataset.calculateFrom;
            const formula = field.dataset.formula || 'sum';
            const colIndex = field.dataset.colIndex;

            // Setup listeners on source fields
            if (calculateFrom) {
                const sourceParams = calculateFrom.split(',');
                sourceParams.forEach(sourceParam => {
                    // Find source fields
                    const sourceFields = document.querySelectorAll(`[data-param-id*="${sourceParam}"][data-col-index="${colIndex}"]`);
                    sourceFields.forEach(sourceField => {
                        sourceField.addEventListener('input', () => {
                            calculateField(field, sourceParams, formula, colIndex);
                        });
                    });
                });
            }
        });

        // Setup listeners for all numeric inputs for AVG/STD calculations
        tbody.querySelectorAll('input[type="number"]').forEach(input => {
            input.addEventListener('input', () => {
                const colIndex = input.dataset.colIndex;
                if (colIndex !== undefined) {
                    calculateColumnStats(tbody, colIndex);
                }
            });
        });
    }

    // Calculate field value based on formula
    function calculateField(targetField, sourceParams, formula, colIndex) {
        try {
            const values = [];

            // Collect values from source fields
            sourceParams.forEach(sourceParam => {
                const sourceFields = document.querySelectorAll(`[data-param-id*="${sourceParam}"][data-col-index="${colIndex}"]`);
                sourceFields.forEach(field => {
                    const value = parseFloat(field.value);
                    if (!isNaN(value)) {
                        values.push(value);
                    }
                });
            });

            if (values.length === 0) {
                targetField.value = '';
                return;
            }

            let result = 0;

            switch (formula) {
                case 'sum':
                    result = values.reduce((a, b) => a + b, 0);
                    break;
                case 'avg':
                case 'average':
                    result = values.reduce((a, b) => a + b, 0) / values.length;
                    break;
                case 'multiply':
                    result = values.reduce((a, b) => a * b, 1);
                    break;
                case 'subtract':
                    result = values[0] - (values[1] || 0);
                    break;
                case 'divide':
                    result = values[1] !== 0 ? values[0] / values[1] : 0;
                    break;
                case 'percentage':
                    result = values[1] !== 0 ? (values[0] / values[1]) * 100 : 0;
                    break;
                case 'min':
                    result = Math.min(...values);
                    break;
                case 'max':
                    result = Math.max(...values);
                    break;
                default:
                    // Custom formula evaluation (careful with security)
                    if (formula.includes('x') && values.length > 0) {
                        // Simple formula like "x * 2" or "x + 10"
                        const x = values[0];
                        result = eval(formula.replace(/x/g, x));
                    }
            }

            targetField.value = result.toFixed(2);

            // Trigger validation
            validateInput(targetField);

            // Trigger change event for cascading calculations
            const event = new Event('input', { bubbles: true });
            targetField.dispatchEvent(event);

        } catch (error) {
            console.error('Calculation error:', error);
            targetField.value = 'ERROR';
        }
    }

    // Calculate column statistics (AVG, STD)
    function calculateColumnStats(tbody, colIndex) {
        const values = [];

        // Collect all numeric values from the column
        tbody.querySelectorAll(`input[type="number"][data-col-index="${colIndex}"]`).forEach(input => {
            if (!input.classList.contains('avg-field') &&
                !input.classList.contains('std-field') &&
                !input.classList.contains('tare1-field') &&
                !input.classList.contains('tare2-field')) {
                const value = parseFloat(input.value);
                if (!isNaN(value)) {
                    values.push(value);
                }
            }
        });

        if (values.length > 0) {
            // Calculate average
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const avgField = tbody.querySelector(`.avg-field[data-col="${colIndex}"]`);
            if (avgField) {
                avgField.value = avg.toFixed(2);
            }

            // Calculate standard deviation
            if (values.length > 1) {
                const variance = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / (values.length - 1);
                const std = Math.sqrt(variance);
                const stdField = tbody.querySelector(`.std-field[data-col="${colIndex}"]`);
                if (stdField) {
                    stdField.value = std.toFixed(2);
                }
            }

            // Calculate Tare statuses if applicable
            if (standardWeight > 0) {
                const tare1Field = tbody.querySelector(`.tare1-field[data-col="${colIndex}"]`);
                const tare2Field = tbody.querySelector(`.tare2-field[data-col="${colIndex}"]`);

                if (tare1Field && tare1 > 0) {
                    const tare1Status = avg >= tare1 ? 'PASS' : 'FAIL';
                    tare1Field.value = tare1Status;
                    tare1Field.style.backgroundColor = tare1Status === 'PASS' ? '#d1fae5' : '#fee2e2';
                }

                if (tare2Field && tare2 > 0) {
                    const tare2Status = avg >= tare2 ? 'PASS' : 'FAIL';
                    tare2Field.value = tare2Status;
                    tare2Field.style.backgroundColor = tare2Status === 'PASS' ? '#d1fae5' : '#fee2e2';
                }
            }
        }
    }

    // Validate input against min/max limits
    function validateInput(input) {
        try {
            const tag = (input.tagName || '').toLowerCase();
            const typeAttr = (input.getAttribute('type') || '').toLowerCase();

            // Always start by clearing previous state when value is empty
            if (!input.value || String(input.value).trim() === '') {
                input.classList.remove('in-range', 'out-of-range');
                return;
            }

            // Handle selects and pass/fail-like fields generically
            if (tag === 'select' || typeAttr === 'select-one') {
                const v = String(input.value).trim().toLowerCase();
                if (v === 'ok' || v === 'pass' || v === 'accepted' || v === 'yes') {
                    input.classList.add('in-range');
                    input.classList.remove('out-of-range');
                } else if (v === 'not ok' || v === 'fail' || v === 'rejected' || v === 'no') {
                    input.classList.add('out-of-range');
                    input.classList.remove('in-range');
                } else {
                    input.classList.remove('in-range', 'out-of-range');
                }
                return;
            }

            // Numeric validation against min/max if present
            const value = parseFloat(input.value);
            const min = parseFloat(input.dataset.min);
            const max = parseFloat(input.dataset.max);

            if (isNaN(value)) {
                input.classList.remove('in-range', 'out-of-range');
                return;
            }

            let setAny = false;
            if (!isNaN(min) && value < min) {
                input.classList.add('out-of-range');
                input.classList.remove('in-range');
                setAny = true;
            }
            if (!isNaN(max) && value > max) {
                input.classList.add('out-of-range');
                input.classList.remove('in-range');
                setAny = true;
            }
            if (!setAny && !isNaN(min) && !isNaN(max)) {
                input.classList.add('in-range');
                input.classList.remove('out-of-range');
            }
            if (!setAny && isNaN(min) && isNaN(max)) {
                // No bounds -> clear state
                input.classList.remove('in-range', 'out-of-range');
            }
        } catch (e) {
            console.warn('validateInput error:', e);
        }
    }

    // Enhanced notification system with different message types
    function showNotification(message, type = 'success', duration = 3000) {
        try {
            // Clear any existing notification timeout
            if (window.notificationTimeout) {
                clearTimeout(window.notificationTimeout);
            }

            // Validate inputs
            if (!message || typeof message !== 'string') {
                console.warn('Invalid notification message:', message);
                message = 'An unknown error occurred';
            }

            if (!['success', 'error', 'warning', 'info'].includes(type)) {
                console.warn('Invalid notification type:', type);
                type = 'info';
            }

            // Set notification content and style
            notification.className = 'notification show ' + type;

            // Add icon based on type
            const icon = document.createElement('i');
            icon.className = type === 'error' ? 'fas fa-exclamation-circle' :
                type === 'warning' ? 'fas fa-exclamation-triangle' :
                    type === 'info' ? 'fas fa-info-circle' :
                        'fas fa-check-circle';

            // Create close button
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '&times;';
            closeBtn.className = 'notification-close';
            closeBtn.style.cssText = 'float: right; background: none; border: none; color: inherit; font-size: 24px; margin-left: 15px; cursor: pointer; line-height: 1; padding: 0;';
            closeBtn.onclick = () => {
                notification.classList.remove('show');
                if (window.notificationTimeout) {
                    clearTimeout(window.notificationTimeout);
                }
            };
            closeBtn.setAttribute('aria-label', 'Close notification');

            notification.innerHTML = `<span>${icon.outerHTML} ${message}</span>`;
            notification.appendChild(closeBtn);

            // Auto-hide after duration (longer for errors)
            const autoDuration = type === 'error' ? Math.max(duration, 5000) : duration;
            window.notificationTimeout = setTimeout(() => {
                notification.classList.remove('show');
            }, autoDuration);

        } catch (notifError) {
            console.error('Error in notification system:', notifError);
            // Fallback to basic alert if notification system fails
            alert(`${type.toUpperCase()}: ${message}`);
        }
    }

    // Error logging function
    function logError(context, error) {
        console.error(`[${context}]:`, error);
        showNotification(`Error in ${context}: ${error.message || error}`, 'error', 5000);
    }

    // Validation helper functions
    function validateRequiredFields(fields) {
        const missing = [];
        fields.forEach(field => {
            const element = document.getElementById(field.id);
            if (!element || !element.value.trim()) {
                missing.push(field.label);
            }
        });
        return missing;
    }

    function validateNumericRange(value, min, max, fieldName) {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
            return `${fieldName} must be a valid number`;
        }
        if (min !== undefined && numValue < min) {
            return `${fieldName} must be at least ${min}`;
        }
        if (max !== undefined && numValue > max) {
            return `${fieldName} must not exceed ${max}`;
        }
        return null;
    }

    // Function to calculate standard weight and related tare values
    function calculateStandardWeight() {
        const standardWeightInput = document.getElementById('standard-weight');
        const weightValue = parseFloat(standardWeightInput.value);
        if (isNaN(weightValue) || weightValue <= 0) {
            showNotification('Please enter a valid standard weight.', 'error');
            clearFields();
            return;
        }
        // Store standard weight globally
        standardWeight = weightValue;
        const limits = computeTareLimits(standardWeight);
        // Update the tare input fields
        const t1El = document.getElementById('tare1');
        const t2El = document.getElementById('tare2');
        const p1El = document.getElementById('packs-weight-limit-1');
        const p2El = document.getElementById('packs-weight-limit-2');
        if (t1El) t1El.value = limits.t1.toFixed(2);
        if (t2El) t2El.value = limits.t2.toFixed(2);
        if (p1El) p1El.value = limits.pack1.toFixed(2);
        if (p2El) p2El.value = limits.pack2.toFixed(2);
        // Re-evaluate statuses for existing inputs
        checkRejectionCriteria();
        showNotification('Tare values calculated successfully!', 'success');
    }

    // Function to clear fields when there's an error
    function clearFields() {
        document.getElementById('tare1').value = '';
        document.getElementById('tare2').value = '';
        document.getElementById('packs-weight-limit-1').value = '';
        document.getElementById('packs-weight-limit-2').value = '';
    }

    // Function to check rejection criteria based on standard weight
    function checkRejectionCriteria() {
        // Recalculate Tare status for all sample tables and groups using new AQL logic
        const tables = Object.keys(sampleTableMeta);
        tables.forEach(tableId => {
            // Get unique group identifiers present for this table
            const inputs = document.querySelectorAll(`input[data-table="${tableId}"]`);
            const groups = new Set();
            inputs.forEach(inp => { if (inp.dataset.group) groups.add(inp.dataset.group); });
            groups.forEach(groupStr => {
                updateTareStatus(tableId, groupStr, 0);
            });
        });
    }

    // Function to populate standard weight fields after sections are rendered
    function populateStandardWeightFields(selectedProduct) {
        if (!selectedProduct || !selectedProduct.standardWeight) {
            return;
        }

        // Set standard weight globally
        standardWeight = selectedProduct.standardWeight;

        // Try to find standard weight fields in all possible locations
        const standardWeightFields = [
            document.getElementById('standard-weight'),
            document.querySelector('input[name="standard-weight"]'),
            ...document.querySelectorAll('input[id*="standard-weight"]'),
            ...document.querySelectorAll('input[placeholder*="standard"]'),
            ...document.querySelectorAll('input[placeholder*="Standard"]')
        ].filter(field => field !== null);

        // Populate all found standard weight fields
        standardWeightFields.forEach(field => {
            if (field) {
                field.value = selectedProduct.standardWeight;
                // Trigger change event to update any dependent calculations
                field.dispatchEvent(new Event('change', { bubbles: true }));
                field.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        // Also populate sample weight table fields if they exist
        const sampleWeightFields = document.querySelectorAll('input[id*="sample-weight"]');
        sampleWeightFields.forEach(field => {
            if (field && !field.value) {
                field.value = selectedProduct.standardWeight;
            }
        });

        // Calculate tare values automatically if standard weight is set
        setTimeout(() => {
            calculateStandardWeightForAllTables();
        }, 200);
    }

    // Function to calculate standard weight for all tables
    function calculateStandardWeightForAllTables() {
        if (standardWeight <= 0) {
            return;
        }
        const limits = computeTareLimits(standardWeight);
        tare1 = limits.t1;
        tare2 = limits.t2;
        // Update tare fields safely
        updateFieldSafely('tare1', limits.t1.toFixed(2));
        updateFieldSafely('tare2', limits.t2.toFixed(2));
        updateFieldSafely('packs-weight-limit-1', limits.pack1.toFixed(2));
        updateFieldSafely('packs-weight-limit-2', limits.pack2.toFixed(2));
        // Show success message
        showNotification(`Standard weight set to ${standardWeight}g and tare values calculated.`, 'success', 3000);
        // Re-evaluate statuses for existing inputs
        checkRejectionCriteria();
    }

    // Function to safely update field values
    function updateFieldSafely(fieldId, value) {
        const field = document.getElementById(fieldId);
        if (field) {
            field.value = value;
        }
    }

    // Function to safely clear fields
    function clearFieldsSafely() {
        const fieldsTooClear = ['tare1', 'tare2', 'packs-weight-limit-1', 'packs-weight-limit-2'];
        fieldsTooClear.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = '';
            }
        });
    }

    // Function to check Pack_Wight fields and update status fields
    function checkPackWeightFields() {
        // Iterate over the groups
        for (var group = 1; group <= timeHeaders1hr.length; group++) {
            // Ensure the group number is formatted as a two-digit string (e.g., 01, 02, ..., 12)
            var groupStr = (group < 10 ? '0' + group : group).toString();
            var isEmpty = true;

            // Check each Pack_Wight field in the group
            for (var i = 1; i <= 20; i++) {
                var indexStr = (i < 10 ? '0' + i : i).toString();
                var packWeightField = document.querySelector(`input[data-group="${groupStr}"][data-index="${indexStr}"]`);

                if (packWeightField && packWeightField.value !== '') {
                    isEmpty = false;
                    break;
                }
            }

            // If all Pack_Wight fields are empty, set the status fields to STOP and change background color to white
            if (isEmpty) {
                var avgStatusField = document.getElementById('AVG_Status_' + groupStr);
                var tare1StatusField = document.getElementById('Tare1_Status_' + groupStr);
                var tare2StatusField = document.getElementById('Tare2_Status_' + groupStr);

                if (avgStatusField) {
                    avgStatusField.value = 'STOP';
                    avgStatusField.className = 'input-field status-stop';
                }
                if (tare1StatusField) {
                    tare1StatusField.value = 'STOP';
                    tare1StatusField.className = 'input-field status-stop';
                }
                if (tare2StatusField) {
                    tare2StatusField.value = 'STOP';
                    tare2StatusField.className = 'input-field status-stop';
                }
            }
        }
    }

    // calculateStatistics function removed - now handled by dynamic table system

    function generateBatchNumber() {
        const selectedProduct = products[productSelect.value];
        const batchDisplay = document.getElementById('batch-number-display');

        if (selectedProduct) {
            // Auto-populate standard weight based on product (safely)
            const standardWeightField = document.getElementById('standard-weight');
            if (standardWeightField) {
                standardWeightField.value = selectedProduct.standardWeight;
                // Calculate tare values automatically
                calculateStandardWeight();
            }

            // Generate new batch number using the configured format
            const reportDate = document.getElementById('report-date');
            const date = reportDate && reportDate.value ? new Date(reportDate.value) : new Date();

            // Update controlled document header display
            updateDocumentHeaderDisplay(selectedProduct);

            if (createBatchNumber(selectedProduct, date)) {
                const batchNumber = createBatchNumber(selectedProduct, date);

                // Update the batch display
                if (batchDisplay) {
                    batchDisplay.textContent = batchNumber;
                }

                // Also update the old batch input if it exists for compatibility
                if (batchInput) {
                    batchInput.value = batchNumber;
                }
            } else {
                if (batchDisplay) {
                    batchDisplay.textContent = 'Not Configured';
                }
                if (batchInput) {
                    batchInput.value = '';
                }
            }
        } else {
            if (batchDisplay) batchDisplay.textContent = '-';
            if (batchInput) batchInput.value = '';
            const standardWeightField = document.getElementById('standard-weight');
            if (standardWeightField) standardWeightField.value = '';
            clearFieldsSafely();
        }
    }

    // Controlled Document Header: update top header/footer spans
    function updateDocumentHeaderDisplay(product) {
        try {
            const issueDateSpan = document.getElementById('doc-issue-date');
            const reviewDateSpan = document.getElementById('doc-review-date');
            const docCodeSpan = document.getElementById('doc-code');
            const issueNoSpan = document.getElementById('doc-issue-no');
            const reviewNoSpan = document.getElementById('doc-review-no');
            const footerCode = document.getElementById('doc-code-footer');
            const footerIssue = document.getElementById('doc-issue-no-footer');
            const footerReview = document.getElementById('doc-review-no-footer');

            const fmt = (d) => {
                if (!d) return '-';
                // Expecting YYYY-MM-DD or ISO
                const dt = new Date(d);
                if (isNaN(dt.getTime())) {
                    // try parse as yyyy-mm-dd string
                    const parts = String(d).split('-');
                    if (parts.length === 3) {
                        return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
                    }
                    return String(d);
                }
                return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
            };

            const code = product?.docCode || '-';
            const issueNo = product?.issueNo || '-';
            const reviewNo = product?.reviewNo || '-';
            const issueDate = fmt(product?.issueDate);
            const reviewDate = fmt(product?.reviewDate);

            if (issueDateSpan) issueDateSpan.textContent = issueDate;
            if (reviewDateSpan) reviewDateSpan.textContent = reviewDate;
            if (docCodeSpan) docCodeSpan.textContent = code;
            if (issueNoSpan) issueNoSpan.textContent = issueNo;
            if (reviewNoSpan) reviewNoSpan.textContent = reviewNo;

            if (footerCode) footerCode.textContent = code;
            if (footerIssue) footerIssue.textContent = issueNo;
            if (footerReview) footerReview.textContent = reviewNo;
        } catch (e) {
            console.warn('Failed to update document header display', e);
        }
    }

    function addRecipeTable(container, recipe = null) {
        const recipeId = recipe ? recipe.id : `recipe-${Date.now()}`;
        const recipeTableContainer = document.createElement('div');
        recipeTableContainer.className = 'border border-gray-300 p-3 mb-3 rounded recipe-table-config';
        recipeTableContainer.dataset.recipeId = recipeId;

        recipeTableContainer.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <div class="flex items-center flex-1">
                <i class="fas fa-grip-vertical drag-handle" title="Drag to reorder"></i>
                <input type="text" class="input-field recipe-name-input" value="${recipe ? recipe.name : ''}" placeholder="Recipe Name (e.g., Dough, Filling)" required>
            </div>
            <button type="button" class="remove-recipe-table-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"><i class="fas fa-trash"></i></button>
        </div>
        <div class="mb-3">
            <div class="flex justify-between items-center mb-2">
                <h6 class="font-semibold">Ingredients</h6>
                <button type="button" class="add-ingredient-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs"><i class="fas fa-plus mr-1"></i>Add Ingredient</button>
            </div>
            <div class="ingredients-container space-y-2">
                </div>
        </div>
    `;

        container.appendChild(recipeTableContainer);

        const ingredientsContainer = recipeTableContainer.querySelector('.ingredients-container');

        // Add event listeners
        const removeBtn = recipeTableContainer.querySelector('.remove-recipe-table-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                recipeTableContainer.remove();
            });
        }

        const addBtn = recipeTableContainer.querySelector('.add-ingredient-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                addIngredientRow(ingredientsContainer);
            });
        }

        // Add existing ingredients if editing
        if (recipe && recipe.ingredients) {
            recipe.ingredients.forEach(ingredient => {
                addIngredientRow(ingredientsContainer, ingredient);
            });
        } else {
            // Add a default ingredient row for new recipe tables
            addIngredientRow(ingredientsContainer);
        }
    }

    function addIngredientRow(container, ingredient = null) {
        const ingredientRow = document.createElement('div');
        ingredientRow.className = 'ingredient-row grid grid-cols-5 gap-2 items-center';

        ingredientRow.innerHTML = `
        <input type="text" class="input-field ingredient-name col-span-2" placeholder="Ingredient Name" value="${ingredient ? ingredient.name : ''}" required>
        <input type="text" class="input-field ingredient-weight" placeholder="Weight" value="${ingredient ? ingredient.weight : ''}" required>
        <input type="number" class="input-field ingredient-shelf-life" placeholder="Shelf Life (m)" value="${ingredient ? ingredient.shelfLife : ''}" required>
        <div class="flex items-center">
            <select class="input-field ingredient-date-format">
                <option value="dd/mm/yyyy" ${ingredient && ingredient.dateFormat === 'dd/mm/yyyy' ? 'selected' : ''}>dd/mm/yy</option>
                <option value="mm/yyyy" ${ingredient && ingredient.dateFormat === 'mm/yyyy' ? 'selected' : ''}>mm/yy</option>
            </select>
            <button type="button" class="remove-ingredient-btn bg-red-500 text-white px-2 py-1 rounded ml-2"><i class="fas fa-trash"></i></button>
        </div>
    `;

        container.appendChild(ingredientRow);

        // Add event listener to remove button
        const removeIngredientBtn = ingredientRow.querySelector('.remove-ingredient-btn');
        if (removeIngredientBtn) {
            removeIngredientBtn.addEventListener('click', () => {
                ingredientRow.remove();
            });
        }
    }
    // Render dynamic sections based on product configuration
    function renderDynamicSections(product) {
        try {
            if (!dynamicSectionsContainer) {
                console.error('Dynamic sections container not found');
                showNotification('Unable to render product sections. Page may not be fully loaded.', 'error', 5000);
                return;
            }

            dynamicSectionsContainer.innerHTML = '';

            if (!product || (!product.sections && !product.recipes)) {
                console.warn('No sections or recipes found in product configuration:', product);
                return;
            }

            // --- RENDER RECIPE TABLES FIRST ---
            if (product.recipes && Array.isArray(product.recipes) && product.recipes.length > 0) {
                const recipeSectionDiv = document.createElement('div');
                recipeSectionDiv.id = 'recipe-display-section';
                recipeSectionDiv.className = 'mb-4';

                // Use a grid container to place recipes side-by-side
                let recipeHTML = `
                <h2 class="section-header p-2 mb-2"><i class="fas fa-blender mr-2"></i>Recipes</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            `;

                product.recipes.forEach(recipe => {
                    // Each recipe is a grid item
                    recipeHTML += `
                    <div>
                        <h3 class="bg-yellow-100 p-2 font-semibold text-center"><i class="fas fa-book-open mr-1"></i>${recipe.name || 'Unnamed Recipe'}</h3>
                        <table class="form-table w-full" id="recipe-table-${recipe.id}">
                            <thead>
                                <tr>
                                    <th>N.</th>
                                    <th>Material</th>
                                    <th>Weight (kg)</th>
                                    <th>Batch Number</th>
                                    <th>Pro. Date</th>
                                    <th>Exp. Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(recipe.ingredients || []).map((item, index) => `
                                    <tr>
                                        <td>${index + 1}</td>
                                        <td>${item.name}</td>
                                        <td>${item.weight}</td>
                                        <td><input class="input-field" placeholder="Batch number"></td>
                                        <td>
                                            <input class="input-field recipe-pro-date date-display" 
                                                   type="${item.dateFormat === 'mm/yyyy' ? 'month' : 'date'}" 
                                                   data-format="${item.dateFormat || 'dd/mm/yyyy'}"
                                                   data-shelf-life="${item.shelfLife || 0}">
                                        </td>
                                        <td>
                                            <input class="input-field recipe-exp-date date-display" 
                                                   type="${item.dateFormat === 'mm/yyyy' ? 'month' : 'date'}" 
                                                   readonly>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
                });

                recipeHTML += `</div>`; // Close the grid container
                recipeSectionDiv.innerHTML = recipeHTML;
                dynamicSectionsContainer.appendChild(recipeSectionDiv);
            }


            // --- RENDER OTHER DYNAMIC SECTIONS ---
            if (product.sections) {
                Object.keys(product.sections).forEach(sectionKey => {
                    try {
                        const section = product.sections[sectionKey];
                        if (!section) {
                            console.warn(`Section ${sectionKey} not found in product configuration`);
                            return;
                        }

                        const sectionDiv = document.createElement('div');
                        sectionDiv.id = sectionKey;
                        sectionDiv.className = 'mb-4';

                        let sectionHTML = `
                <h2 class="section-header p-2 mb-2">
                    <i class="${section.icon || 'fas fa-cog'} mr-2"></i>${section.name}
                </h2>
            `;

                        if (section.tables) {
                            section.tables.forEach(table => {
                                const tableType = table.type || 'parameters';

                                if (tableType === 'parameters') {
                                    let additionalColumns = 0;
                                    let additionalHeadersHtml = '';

                                    if (table.hasAvg) {
                                        additionalColumns++;
                                        additionalHeadersHtml += '<th rowspan="2">AVG</th>';
                                    }
                                    if (table.hasStd) {
                                        additionalColumns++;
                                        additionalHeadersHtml += '<th rowspan="2">STD</th>';
                                    }
                                    if (table.hasTare1) {
                                        additionalColumns++;
                                        additionalHeadersHtml += '<th rowspan="2">Tare 1</th>';
                                    }
                                    if (table.hasTare2) {
                                        additionalColumns++;
                                        additionalHeadersHtml += '<th rowspan="2">Tare 2</th>';
                                    }

                                    sectionHTML += `
                            <div class="mb-4">
                                <div class="flex justify-between items-center bg-blue-100 p-2">
                                    <h3 class="font-semibold">
                                        <i class="fas fa-table mr-1"></i>${table.name}
                                    </h3>
                                    <div class="flex gap-2">
                                        <button type="button" class="export-csv-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-xs" data-table-id="${table.id}-params">
                                            <i class="fas fa-file-csv mr-1"></i>CSV
                                        </button>
                                        <button type="button" class="export-excel-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs" data-table-id="${table.id}-params">
                                            <i class="fas fa-file-excel mr-1"></i>Excel
                                        </button>
                                        <button type="button" class="main-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs" data-table-id="${table.id}-params">
                                            <i class="fas fa-stop-circle mr-1"></i>Stop
                                        </button>
                                    </div>
                                </div>
                                <div id="${table.id}-params-controls" class="table-controls-container"></div>
                                <table class="form-table w-full" id="${table.id}-params" data-table-id="${table.id}">
                                    <thead>
                                        <tr>
                                            <th rowspan="2">Parameter</th>
                                            <th rowspan="2">Standard Limits</th>
                                            <th colspan="8" id="${table.id}-header">Time Intervals - Auto Calculated</th>
                                            ${additionalHeadersHtml}
                                        </tr>
                                        <tr id="time-headers-${table.id}"></tr>
                                    </thead>
                                    <tbody id="${table.id}-table-body"></tbody>
                                </table>
                            </div>
                        `;
                                }
                            });
                        }

                        if (sectionKey.includes('packaging') || section.name.toLowerCase().includes('packaging')) {
                            sectionHTML += renderPackagingImages();
                        }

                        sectionDiv.innerHTML = sectionHTML;
                        dynamicSectionsContainer.appendChild(sectionDiv);

                        if (section.tables) {
                            section.tables.forEach(table => {
                                const tableType = table.type || 'parameters';

                                if (tableType === 'parameters') {
                                    const shiftDurationSelect = document.getElementById('shift-duration');
                                    const shiftDuration = parseInt(shiftDurationSelect.value) || 8;
                                    const startTime = document.getElementById('start-inspection-time') ? document.getElementById('start-inspection-time').value : '08:00';
                                    const inspectionPeriod = table.inspectionPeriod || 60;
                                    const tableTimeHeaders = generateTableInspectionTimes(inspectionPeriod, shiftDuration, startTime);

                                    const tableHeader = document.getElementById(`${table.id}-header`);
                                    if (tableHeader) {
                                        const periodHours = inspectionPeriod / 60;
                                        tableHeader.colSpan = tableTimeHeaders.length;
                                        tableHeader.innerHTML = `Time Intervals (Every ${periodHours >= 1 ? periodHours + ' Hours' : inspectionPeriod + ' Minutes'})`;
                                    }

                                    renderTimeHeaders(`time-headers-${table.id}`, tableTimeHeaders);
                                    renderFormSection(`${table.id}-table-body`, table.parameters, tableTimeHeaders, table);
                                    setupTableEnhancements(`${table.id}-params`);

                                } else if (tableType === 'sample') {
                                    try {
                                        const shiftDurationSelect = document.getElementById('shift-duration');
                                        const shiftDuration = parseInt(shiftDurationSelect.value) || 8;
                                        const startTime = document.getElementById('start-inspection-time') ? document.getElementById('start-inspection-time').value : '08:00';
                                        const inspectionPeriod = table.inspectionPeriod || 60;
                                        const tableTimeHeaders = generateTableInspectionTimes(inspectionPeriod, shiftDuration, startTime);

                                        if (tableTimeHeaders && tableTimeHeaders.length > 0) {
                                            renderSampleTable(table, tableTimeHeaders, sectionKey);
                                        } else {
                                            console.warn(`No time headers generated for sample table ${table.id}`);
                                        }
                                    } catch (error) {
                                        console.error(`Error rendering sample table ${table.id}:`, error);
                                        showNotification(`Error rendering sample table: ${table.name}`, 'error', 5000);
                                    }

                                } else if (tableType === 'custom') {
                                    try {
                                        renderCustomTable(table, sectionKey);
                                    } catch (error) {
                                        console.error(`Error rendering custom table ${table.id}:`, error);
                                        showNotification(`Error rendering custom table: ${table.name}`, 'error', 5000);
                                    }
                                }

                                // Render AI code table
                                if (tableType === 'ai') {
                                    try {
                                        renderAiTable(table, sectionKey);
                                    } catch (error) {
                                        console.error(`Error rendering AI table ${table.id}:`, error);
                                        showNotification(`Error rendering AI table: ${table.name}`, 'error', 5000);
                                    }
                                }

                                // New: render checklist type
                                if (tableType === 'checklist') {
                                    try {
                                        renderChecklistTable(table, sectionKey);
                                    } catch (error) {
                                        console.error(`Error rendering checklist table ${table.id}:`, error);
                                        showNotification(`Error rendering checklist table: ${table.name}`, 'error', 5000);
                                    }
                                }

                                // Additional new table types
                                if (tableType === 'defects') {
                                    try {
                                        renderDefectsLogTable(table, sectionKey);
                                    } catch (error) {
                                        console.error(`Error rendering defects log ${table.id}:`, error);
                                        showNotification(`Error rendering defects log: ${table.name}`, 'error', 5000);
                                    }
                                }
                                if (tableType === 'summary') {
                                    try {
                                        renderShiftSummaryTable(table, sectionKey);
                                    } catch (error) {
                                        console.error(`Error rendering summary ${table.id}:`, error);
                                        showNotification(`Error rendering summary: ${table.name}`, 'error', 5000);
                                    }
                                }
                                if (tableType === 'spc') {
                                    try {
                                        renderSPCTable(table, sectionKey);
                                    } catch (error) {
                                        console.error(`Error rendering SPC table ${table.id}:`, error);
                                        showNotification(`Error rendering SPC table: ${table.name}`, 'error', 5000);
                                    }
                                }
                                if (tableType === 'signoff') {
                                    try {
                                        renderSignoffTable(table, sectionKey);
                                    } catch (error) {
                                        console.error(`Error rendering sign-off table ${table.id}:`, error);
                                        showNotification(`Error rendering sign-off table: ${table.name}`, 'error', 5000);
                                    }
                                }
                            });
                        }
                    } catch (error) {
                        console.error(`Error rendering section ${sectionKey}:`, error);
                        showNotification(`Error rendering section: ${section?.name || sectionKey}`, 'error', 5000);
                    }
                });
            }
        } catch (error) {
            console.error('Error in renderDynamicSections:', error);
            showNotification('Failed to render product sections completely.', 'error', 5000);
        }
        buildNavigationMap();

    }

    // Render ingredients section
    function renderIngredientsSection(product) {
        let html = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">';

        if (product.ingredients_type === 'with-cocoa' || product.ingredients_type === 'both') {
            html += `
                <div id="ingredients-with-cocoa">
                    <h3 class="bg-amber-100 p-2 font-semibold text-center">
                        <i class="fas fa-cookie mr-1"></i>Biscuit Ingredients WITH Cocoa
                    </h3>
                    <table class="form-table w-full" id="ingredients-with-cocoa-table">
                        <thead>
                            <tr>
                                <th>N.</th>
                                <th>Material</th>
                                <th>Weight (kg)</th>
                                <th>Batch Number</th>
                                <th>Pro. Date</th>
                                <th>Exp. Date</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            `;
        }

        if (product.ingredients_type === 'without-cocoa' || product.ingredients_type === 'both') {
            html += `
                <div id="ingredients-without-cocoa">
                    <h3 class="bg-yellow-100 p-2 font-semibold text-center">
                        <i class="fas fa-cookie-bite mr-1"></i>Biscuit Ingredients WITHOUT Cocoa
                    </h3>
                    <table class="form-table w-full" id="ingredients-without-cocoa-table">
                        <thead>
                            <tr>
                                <th>N.</th>
                                <th>Material</th>
                                <th>Weight (kg)</th>
                                <th>Batch Number</th>
                                <th>Pro. Date</th>
                                <th>Exp. Date</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            `;
        }

        html += '</div>';

        if (product.has_cream && product.creamRecipe) {
            html += `
                <div id="cream-ingredients" class="mb-4">
                    <h3 class="bg-pink-100 p-2 font-semibold text-center">
                        <i class="fas fa-ice-cream mr-1"></i>Cream Filling Ingredients
                    </h3>
                    <table class="form-table w-full" id="cream-ingredients-table">
                        <thead>
                            <tr>
                                <th>N.</th>
                                <th>Material</th>
                                <th>Weight (kg)</th>
                                <th>Batch Number</th>
                                <th>Pro. Date</th>
                                <th>Exp. Date</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            `;
        }

        return html;
    }

    // Render packaging images section
    function renderPackagingImages() {
        return `
            <div id="packaging-image-upload" class="mt-4 border border-gray-300 p-3 bg-gray-50 packaging-images">
                <h3 class="font-bold text-gray-800 mb-2 text-lg"><i class="fas fa-camera mr-1"></i>Packaging Print Images</h3>
                <div class="flex space-x-4">
                    <div>
                        <label class="font-semibold text-sm">Box Print:</label>
                        <input type="file" id="box-print-upload" class="block w-full text-xs text-gray-500 no-print" accept="image/*" multiple>
                        <div id="box-print-preview" class="flex-container"></div>
                    </div>
                    <div>
                        <label class="font-semibold text-sm">Carton Print:</label>
                        <input type="file" id="carton-print-upload" class="block w-full text-xs text-gray-500 no-print" accept="image/*" multiple>
                        <div id="carton-print-preview" class="flex-container"></div>
                    </div>
                    <div>
                        <label class="font-semibold text-sm">Wrapping Machine:</label>
                        <input type="file" id="wrapping-machine-upload" class="block w-full text-xs text-gray-500 no-print" accept="image/*" multiple>
                        <div id="wrapping-machine-preview" class="flex-container"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderFormSection(sectionId, parameters, timeIntervals, table) {
        const tbody = document.getElementById(sectionId);
        if (!tbody) return;
        tbody.innerHTML = '';

        // Check if this is a special packs weights table
        const isPacksWeightsTable = table && table.isPacksWeightsTable;

        parameters.forEach((param, index) => {
            const row = document.createElement('tr');
            // Generate unique parameter ID
            const paramId = `${sectionId}_${param.name.replace(/[^a-zA-Z0-9]/g, '_')}_${index}`;
            row.setAttribute('data-param-id', paramId);

            let cells = `
                <td class="font-semibold"><span class="param-label">${param.name}</span></td>
                <td>${param.limits}</td>
            `;
            timeIntervals.forEach((time, i) => {
                let inputHtml = '';
                const inputId = `${paramId}_${i}`;

                // Handle dual input fields
                if (param.dualInput) {
                    inputHtml = `<div class="flex gap-1">
                        <input class="input-field dual-input-1" type="number" data-min="${param.min}" data-max="${param.max}" placeholder="Val 1" style="width: 45%;">
                        <input class="input-field dual-input-2" type="number" data-min="${param.min}" data-max="${param.max}" placeholder="Val 2" style="width: 45%;">
                    </div>`;
                } else if (param.type === 'check') {
                    inputHtml = `<div class="checkbox-group"><label><input type="radio" name="${param.name.replace(/[^a-zA-Z0-9]/g, '')}_${i}" value="OK"> OK</label><label><input type="radio" name="${param.name.replace(/[^a-zA-Z0-9]/g, '')}_${i}" value="NOT OK"> NOT OK</label></div>`;
                } else if (param.type === 'oprp' || param.type === 'ccp') {
                    inputHtml = `<div class="checkbox-group"><label><input type="radio" name="${param.name.replace(/[^a-zA-Z0-9]/g, '')}_${i}" value="OK"> OK</label><label><input type="radio" name="${param.name.replace(/[^a-zA-Z0-9]/g, '')}_${i}" value="REJECT"> REJECT</label></div>`;
                } else if (param.type === 'grade') {
                    inputHtml = `<select class="input-field grade-select" data-row="${index}" data-col="${i}" data-prev-value="A"><option value="A">A</option><option value="B">B</option><option value="C">C</option></select>`;
                } else if (param.type === 'temperature') {
                    const minText = param.min !== undefined ? param.min : '';
                    const maxText = param.max !== undefined ? param.max : '';
                    const placeholder = minText && maxText ? `${minText}-${maxText}°C` : '°C';
                    inputHtml = `<input class="input-field temp-input" type="number" step="0.1" data-min="${param.min || ''}" data-max="${param.max || ''}" placeholder="${placeholder}" title="Enter temperature in °C" data-param-id="${paramId}" data-col-index="${i}" data-table-id="${table.id}" data-param-name="${param.name}" data-time-column="${time}">`;
                } else if (param.type === 'percentage') {
                    inputHtml = `<input class="input-field percent-input" type="number" data-min="${param.min || 0}" data-max="${param.max || 100}" step="0.1" placeholder="%" data-param-id="${paramId}" data-col-index="${i}" data-table-id="${table.id}" data-param-name="${param.name}" data-time-column="${time}">`;
                } else if (param.type === 'datetime') {
                    inputHtml = `<input class="input-field" type="datetime-local">`;
                } else if (param.type === 'dropdown') {
                    inputHtml = `<select class="input-field">`;
                    if (param.options && Array.isArray(param.options) && param.options.length > 0) {
                        param.options.forEach(opt => {
                            if (opt && opt.trim()) {
                                inputHtml += `<option value="${opt.trim()}">${opt.trim()}</option>`;
                            }
                        });
                    } else {
                        // Default options if none are specified
                        inputHtml += `<option value="">-- Select Option --</option>`;
                        inputHtml += `<option value="OK">OK</option>`;
                        inputHtml += `<option value="NOT OK">NOT OK</option>`;
                    }
                    inputHtml += `</select>`;
                } else {
                    const stepVal = (param.type === 'number' && typeof param.decimals === 'number') ? (1 / Math.pow(10, param.decimals)) : 'any';
                    inputHtml = `<input class="input-field" id="${inputId}" type="${param.type === 'number' ? 'number' : 'text'}" step="${stepVal}"
                        data-min="${param.min !== undefined ? param.min : ''}" data-max="${param.max !== undefined ? param.max : ''}" 
                        data-param-id="${paramId}" data-col-index="${i}"
                        data-table-id="${table.id}" data-param-name="${param.name}" data-time-column="${time}">`;
                }

                // Add calculation attributes if parameter has calculation
                if (param.isCalculated && param.calcMode === 'builder' && param.calculation) {
                    inputHtml = inputHtml.replace('class="input-field"',
                        `class="input-field gui-calculated" data-calculation="${encodeURIComponent(JSON.stringify(param.calculation))}"
                         data-table-id="${table.id}" data-param-name="${param.name}" data-col-index="${i}" readonly`);
                    inputHtml = inputHtml.replace('type="number"', 'type="number" style="background-color: #e0f2fe;"');
                    inputHtml = inputHtml.replace('type="text"', 'type="text" style="background-color: #e0f2fe;"');
                } else if (param.isCalculated && param.calcMode === 'template' && param.templateId) {
                    const mappingStr = encodeURIComponent(JSON.stringify(param.templateMapping || {}));
                    inputHtml = inputHtml.replace('class="input-field"',
                        `class="input-field template-calculated" data-template-id="${param.templateId}" data-template-mapping="${mappingStr}" data-table-id="${table.id}" data-col-index="${i}" readonly`);
                    inputHtml = inputHtml.replace('type="number"', 'type="number" style="background-color: #e0f2fe;"');
                    inputHtml = inputHtml.replace('type="text"', 'type="text" style="background-color: #e0f2fe;"');
                } else if (param.isCalculated && param.advancedFormula) {
                    // Legacy formula support - will be deprecated
                    inputHtml = inputHtml.replace('class="input-field"',
                        `class="input-field formula-calculated" data-formula="${encodeURIComponent(param.advancedFormula)}" 
                         data-table-id="${table.id}" data-param-name="${param.name}" data-time-column="${time}" readonly`);
                    inputHtml = inputHtml.replace('type="number"', 'type="number" style="background-color: #e0f2fe;"');
                    inputHtml = inputHtml.replace('type="text"', 'type="text" style="background-color: #e0f2fe;"');
                } else if (param.calculateFrom) {
                    // Legacy calculation support
                    inputHtml = inputHtml.replace('class="input-field"', `class="input-field auto-calculated" data-calculate-from="${param.calculateFrom}" data-formula="${param.formula || 'sum'}"`);
                }

                cells += `<td>${inputHtml}</td>`;
            });

            // Add additional columns for AVG, STD, Tare1, Tare2
            if (table) {
                if (table.hasAvg) {
                    cells += `<td><input class="input-field avg-field-row" data-param-id="${paramId}" readonly placeholder="AVG"></td>`;
                }
                if (table.hasStd) {
                    cells += `<td><input class="input-field std-field-row" data-param-id="${paramId}" readonly placeholder="STD"></td>`;
                }
                if (table.hasTare1) {
                    cells += `<td><input class="input-field tare1-field" data-param-id="${paramId}" type="number" placeholder="Tare 1"></td>`;
                }
                if (table.hasTare2) {
                    cells += `<td><input class="input-field tare2-field" data-param-id="${paramId}" type="number" placeholder="Tare 2"></td>`;
                }
            }

            row.innerHTML = cells;
            if (param.type === 'oprp' || param.type === 'ccp') {
                row.classList.add('bg-red-50');
            }
            tbody.appendChild(row);
        });

        // Auto-calculate AVG and STD values for numerical parameters
        if (table && (table.hasAvg || table.hasStd)) {
            setTimeout(() => {
                parameters.forEach((param, paramIndex) => {
                    if (param.type === 'number' || param.type === 'temperature' || param.type === 'percentage') {
                        const paramId = `${sectionId}_${param.name.replace(/[^a-zA-Z0-9]/g, '_')}_${paramIndex}`;
                        updateAverageAndStdDev(paramId, timeIntervals.length, tbody);
                    }
                });
            }, 100);
        }

        // Add event listeners for grade selects to check consecutive B grades
        document.querySelectorAll('.grade-select').forEach(select => {
            select.addEventListener('change', checkConsecutiveGrades);
        });

        // Add event listeners for numerical inputs to update AVG and STD
        tbody.querySelectorAll('input[type="number"]:not(.avg-field-row):not(.std-field-row):not(.formula-calculated):not(.gui-calculated)').forEach(input => {
            input.addEventListener('input', () => {
                // Validate against current min/max (can be changed dynamically by Genius panel)
                try { validateInput(input); } catch (e) { }

                const paramId = input.dataset.paramId;
                if (paramId) {
                    updateAverageAndStdDev(paramId, timeIntervals.length, tbody);
                }

                // Legacy formula system removed - using CalculationBuilder instead

                // New: Trigger recalculation for dependent GUI-based calculations
                if (window.calculationBuilder) {
                    const tableId = input.dataset.tableId;
                    const paramName = input.dataset.paramName;
                    const colIndex = parseInt(input.dataset.colIndex);

                    window.calculationBuilder.recalculateDependents(tableId, paramName, colIndex);
                }
            });
        });

        // Initialize calculations for all calculated fields
        setTimeout(() => {
            console.log('Initializing GUI-based calculations...');

            // New GUI-based calculations
            const guiCalculatedInputs = tbody.querySelectorAll('.gui-calculated');
            console.log(`Found ${guiCalculatedInputs.length} GUI-calculated inputs in tbody`);

            guiCalculatedInputs.forEach((input, index) => {
                const calculationStr = decodeURIComponent(input.dataset.calculation || '');
                const tableId = input.dataset.tableId; // The table of the calculated field
                const timeColumn = parseInt(input.dataset.colIndex); // The column of the calculated field

                console.log(`Processing GUI calculation ${index + 1}:`, {
                    calculationStr: calculationStr.substring(0, 100) + '...',
                    tableId,
                    timeColumn
                });

                if (calculationStr && window.calculationBuilder) {
                    try {
                        const calculation = JSON.parse(calculationStr);
                        console.log('Parsed calculation:', calculation);
                        const value = window.calculationBuilder.executeCalculation(calculation, tableId, timeColumn);
                        if (value !== null && !isNaN(value)) {
                            input.value = typeof value === 'number' ? value.toFixed(2) : value;
                            console.log(`Set input value to: ${input.value}`);
                        } else {
                            console.log('Calculation returned null/NaN, clearing input');
                            input.value = '';
                        }
                    } catch (e) {
                        console.error('Error executing calculation:', e);
                        input.value = '';
                    }
                } else {
                    console.log('No calculation string or calculation builder not available');
                }
            });

            // Legacy formula system removed - using CalculationBuilder instead
        }, 500); // Delay to ensure all fields are loaded
    }

    // Function to update average and standard deviation for a parameter row
    function updateAverageAndStdDev(paramId, timeColumnsCount, tbody) {
        const values = [];

        // Collect all numerical values from the parameter row
        for (let i = 0; i < timeColumnsCount; i++) {
            const input = document.querySelector(`input[data-param-id="${paramId}"][data-col-index="${i}"]`);
            if (input && input.value && !isNaN(input.value)) {
                values.push(parseFloat(input.value));
            }
        }

        if (values.length > 0) {
            // Calculate average
            const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
            const avgField = document.querySelector(`.avg-field-row[data-param-id="${paramId}"]`);
            if (avgField) {
                avgField.value = avg.toFixed(2);
            }

            // Calculate standard deviation
            if (values.length > 1) {
                const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / (values.length - 1);
                const stdDev = Math.sqrt(variance);
                const stdField = document.querySelector(`.std-field-row[data-param-id="${paramId}"]`);
                if (stdField) {
                    stdField.value = stdDev.toFixed(2);
                }
            }
        }

        // STOP option has been removed from CCP and OPRP inputs

        // Initial check for consecutive grades
        checkConsecutiveGrades();

        // Setup auto-calculations - pass tbody correctly
        if (tbody) {
            setupAutoCalculations(tbody);
        }
    }

    // Handle STOP event and propagate to linked tables
    function handleStopEvent(tableId, colIndex) {
        // Find the current product configuration
        const selectedProduct = products[productSelect.value];
        if (!selectedProduct || !selectedProduct.sections) return;

        let currentTable = null;
        let linkedTables = [];

        // Find the current table and its linked tables
        Object.values(selectedProduct.sections).forEach(section => {
            if (section.tables) {
                section.tables.forEach(table => {
                    if (table.id === tableId) {
                        currentTable = table;
                        linkedTables = table.linkedTables || [];
                    }
                });
            }
        });

        if (!currentTable) return;

        // Stop all inputs in the current column for linked tables
        linkedTables.forEach(linkedTableId => {
            const linkedTableBody = document.getElementById(`${linkedTableId}-table-body`);
            if (linkedTableBody) {
                // Find all inputs in the same time column
                linkedTableBody.querySelectorAll(`tr`).forEach(row => {
                    const cell = row.cells[colIndex + 2]; // +2 because first two columns are parameter and limits
                    if (cell) {
                        // Use the new stopCellCompletely function
                        if (typeof stopCellCompletely === 'function') {
                            stopCellCompletely(cell);
                        } else {
                            // Fallback to old method
                            const input = cell.querySelector('input, select');
                            if (input) {
                                if (input.type === 'radio') {
                                    const stopRadio = cell.querySelector('input[value="STOP"]');
                                    if (stopRadio) stopRadio.checked = true;
                                } else {
                                    input.value = 'STOPPED';
                                    input.disabled = true;
                                    input.classList.add('bg-red-100');
                                }
                            }
                        }
                    }
                });
            }
        });
    }

    // Function to check for consecutive B grades and make them red (and color the table cells)
    function checkConsecutiveGrades() {
        // Clear any previous flags first
        document.querySelectorAll('.invalid-consecutive-b').forEach(el => el.classList.remove('invalid-consecutive-b'));
        document.querySelectorAll('.grade-select.status-rejected').forEach(el => el.classList.remove('status-rejected'));
        document.querySelectorAll('td.cell-rejected').forEach(td => td.classList.remove('cell-rejected'));
        // Clear inline paints
        document.querySelectorAll('.grade-select').forEach(sel => { sel.style.backgroundColor=''; sel.style.color=''; sel.style.fontWeight=''; });
        document.querySelectorAll('td').forEach(td => { if (td.dataset._painted==='1'){ td.style.backgroundColor=''; delete td.dataset._painted; }});

        // Helper to paint an element red
        const paintSelectRed = (el)=>{ if(!el) return; el.style.backgroundColor = '#fee2e2'; el.style.color = '#b91c1c'; el.style.fontWeight = '600'; };
        const paintCellRed = (td)=>{ if(!td) return; td.style.backgroundColor = '#fee2e2'; td.dataset._painted='1'; };

        // Iterate through all grade select elements
        document.querySelectorAll('.grade-select').forEach(select => {
            const row = parseInt(select.dataset.row);
            const col = parseInt(select.dataset.col);
            const td = select.closest('td');

            // Apply red color for Grade C
            if (select.value === 'C') {
                select.classList.add('status-rejected');
                paintSelectRed(select);
                if (td) { td.classList.add('cell-rejected'); paintCellRed(td); }
            }

            // Check for consecutive B grades (previous column in the same row)
            if (select.value === 'B') {
                const prevSelect = document.querySelector(`.grade-select[data-row="${row}"][data-col="${col - 1}"]`);
                if (prevSelect && prevSelect.value === 'B') {
                    // Mark both the current and previous selects and their cells
                    select.classList.add('invalid-consecutive-b');
                    prevSelect.classList.add('invalid-consecutive-b');
                    paintSelectRed(select);
                    paintSelectRed(prevSelect);
                    if (td) { td.classList.add('cell-rejected'); paintCellRed(td); }
                    const prevTd = prevSelect.closest('td');
                    if (prevTd) { prevTd.classList.add('cell-rejected'); paintCellRed(prevTd); }
                    showNotification('Consecutive B grades are not allowed!', 'error');
                }
            }
        });
    }

    // Robust event delegation for any dynamically added grade selects
    document.addEventListener('change', function(e){
        const t = e.target;
        if (t && t.classList && t.classList.contains('grade-select')) {
            try { checkConsecutiveGrades(); } catch (_) {}
        }
    });

    // Inject minimal CSS for classes used by grade validation (in case stylesheet not loaded)
    (function ensureGradeValidationStyles(){
        if (document.getElementById('grade-validation-style')) return;
        const st = document.createElement('style');
        st.id = 'grade-validation-style';
        st.textContent = `
        .grade-select.status-rejected, .grade-select.invalid-consecutive-b { background-color:#fee2e2 !important; border-color:#fecaca !important; color:#b91c1c !important; font-weight:600; }
        td.cell-rejected { background-color:#fee2e2 !important; }
        `;
        document.head.appendChild(st);
    })();

    // Initial check on load (in case some selects have preset values)
    setTimeout(() => { try { checkConsecutiveGrades(); } catch (_) {} }, 0);

    function renderTimeHeaders(headerId, timeIntervals) {
        const headerRow = document.getElementById(headerId);
        if (!headerRow || !timeIntervals || !Array.isArray(timeIntervals)) {
            console.warn(`Could not render time headers for ${headerId}:`, { headerRow, timeIntervals });
            return;
        }

        headerRow.innerHTML = '';
        timeIntervals.forEach(time => {
            const th = document.createElement('th');
            th.classList.add('time-header', 'text-xs');
            th.textContent = time;
            headerRow.appendChild(th);
        });
    }

    // New flexible table rendering functions

    // Render sample table for weight monitoring and statistical control
    function renderSampleTable(table, timeIntervals, containerId) {
        const tableHtml = `
            <div class="mb-4">
                <div class="flex justify-between items-center bg-blue-100 p-2">
                    <h3 class="font-semibold">
                        <i class="fas fa-weight mr-1"></i>${table.name}
                    </h3>
                    <div class="flex gap-2">
                        <button type="button" class="export-csv-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-xs" data-table-id="${table.id}">
                            <i class="fas fa-file-csv mr-1"></i>Export CSV
                        </button>
                        <button type="button" class="export-excel-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs" data-table-id="${table.id}">
                            <i class="fas fa-file-excel mr-1"></i>Export Excel
                        <button type="button" class="toggle-filter-btn bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 text-xs" data-table-id="${table.id}">
                            <i class="fas fa-filter mr-1"></i>Filter
                        </button>
                        <button type="button" class="main-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs" data-table-id="${table.id}">
                            <i class="fas fa-stop-circle mr-1"></i>Stop
                        </button>
                    </div>
                </div>
                <div id="${table.id}-controls" class="table-controls-container"></div>
                <table class="form-table w-full" id="${table.id}">
                    <thead>
                        <tr>
                            <th rowspan="2">${table.samplePrefix || 'Sample'} No.</th>
                            <th colspan="${timeIntervals.length}" id="${table.id}-header">Time Intervals - Auto Calculated</th>
                        </tr>
                        <tr id="time-headers-${table.id}"></tr>
                    </thead>
                    <tbody id="${table.id}-tbody">
                    </tbody>
                </table>
                ${table.hasRejectionCriteria ? renderRejectionCriteria(table.id) : ''}
            </div>
        `;

        const container = document.getElementById(containerId);
        if (container) {
            container.insertAdjacentHTML('beforeend', tableHtml);

            // Render time headers
            renderTimeHeadersForTable(table.id, timeIntervals);

            // Render sample rows
            renderSampleRows(table, timeIntervals);

            // Add event listeners for calculations
            addSampleTableEventListeners(table.id, timeIntervals.length);

            // Add table enhancement features
            setupTableEnhancements(table.id);
        }
    }

    // Render time headers for sample table
    function renderTimeHeadersForTable(tableId, timeIntervals) {
        const timeHeadersRow = document.getElementById(`time-headers-${tableId}`);
        if (!timeHeadersRow || !timeIntervals || !Array.isArray(timeIntervals)) {
            console.warn(`Could not render time headers for table ${tableId}:`, { timeHeadersRow, timeIntervals });
            return;
        }

        timeHeadersRow.innerHTML = timeIntervals.map(time => `<th class="time-header text-xs">${time}</th>`).join('');
    }

    // Render sample rows with statistical rows
    function renderSampleRows(table, timeIntervals) {
        const tbody = document.getElementById(`${table.id}-tbody`);
        if (!tbody) return;

        tbody.innerHTML = '';
        const sampleRows = table.sampleRows || 20;

        // Create sample input rows
        for (let i = 1; i <= sampleRows; i++) {
            const row = document.createElement('tr');
            let cells = `<td>${i}</td>`;
            timeIntervals.forEach((time, index) => {
                const groupStr = (index + 1).toString().padStart(2, '0');
                const indexStr = i.toString().padStart(2, '0');
                cells += `<td><input class="input-field sample-weight" data-table="${table.id}" data-group="${groupStr}" data-index="${indexStr}" type="number" step="0.01"></td>`;
            });
            row.innerHTML = cells;
            tbody.appendChild(row);
        }

        // Add statistical rows if enabled
        if (table.hasAvg) {
            const avgRow = document.createElement('tr');
            avgRow.classList.add('bg-blue-50', 'font-semibold');
            let avgCells = `<td>AVG.</td>`;
            timeIntervals.forEach((time, index) => {
                const groupStr = (index + 1).toString().padStart(2, '0');
                avgCells += `<td><input id="AVG_${table.id}_${groupStr}" class="input-field font-semibold" readonly></td>`;
            });
            avgRow.innerHTML = avgCells;
            tbody.appendChild(avgRow);
        }

        if (table.hasStd) {
            const stdRow = document.createElement('tr');
            stdRow.classList.add('bg-gray-50', 'font-semibold');
            let stdCells = `<td>STD.</td>`;
            timeIntervals.forEach((time, index) => {
                const groupStr = (index + 1).toString().padStart(2, '0');
                stdCells += `<td><input id="STD_${table.id}_${groupStr}" class="input-field font-semibold" readonly></td>`;
            });
            stdRow.innerHTML = stdCells;
            tbody.appendChild(stdRow);
        }

        if (table.hasTare1) {
            const tare1Row = document.createElement('tr');
            tare1Row.classList.add('bg-yellow-50', 'font-semibold');
            let tare1Cells = `<td>Tare1 Status</td>`;
            timeIntervals.forEach((time, index) => {
                const groupStr = (index + 1).toString().padStart(2, '0');
                tare1Cells += `<td><input id="Tare1_Status_${table.id}_${groupStr}" class="input-field font-semibold" readonly></td>`;
            });
            tare1Row.innerHTML = tare1Cells;
            tbody.appendChild(tare1Row);
        }

        if (table.hasTare2) {
            const tare2Row = document.createElement('tr');
            tare2Row.classList.add('bg-yellow-50', 'font-semibold');
            let tare2Cells = `<td>Tare2 Status</td>`;
            timeIntervals.forEach((time, index) => {
                const groupStr = (index + 1).toString().padStart(2, '0');
                tare2Cells += `<td><input id="Tare2_Status_${table.id}_${groupStr}" class="input-field font-semibold" readonly></td>`;
            });
            tare2Row.innerHTML = tare2Cells;
            tbody.appendChild(tare2Row);
        }


    }

    // Render rejection criteria section
    function renderRejectionCriteria(tableId) {
        return `
            <div class="mt-4 bg-red-50 border border-red-300 p-3 rejection-criteria">
                <div class="flex flex-wrap items-center justify-between gap-y-2 text-sm">
                    <h3 class="font-bold text-red-800 whitespace-nowrap">
                        <i class="fas fa-ban mr-1"></i>REJECTION CRITERIA & ACTION LIMITS
                    </h3>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">Standard Weight (g):</label>
                        <input id="standard-weight-${tableId}" class="border border-red-300 p-1 w-24 input-field" placeholder="Std. weight" readonly>
                    </div>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">Tare 1 (g):</label>
                        <input id="tare1-${tableId}" class="border border-red-300 p-1 w-24 input-field" readonly>
                    </div>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">Tare 2 (g):</label>
                        <input id="tare2-${tableId}" class="border border-red-300 p-1 w-24 input-field" readonly>
                    </div>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">Pack Limit 1 (g):</label>
                        <input id="packs-weight-limit-1-${tableId}" class="border border-red-300 p-1 w-24 input-field" readonly>
                    </div>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">Pack Limit 2 (g):</label>
                        <input id="packs-weight-limit-2-${tableId}" class="border border-red-300 p-1 w-24 input-field" readonly>
                    </div>
                </div>
                <div class="flex flex-wrap items-center justify-start gap-x-4 gap-y-2 text-sm mt-2 pt-2 border-t border-red-200">
                    <h4 class="font-bold text-red-800 whitespace-nowrap w-full">
                        <i class="fas fa-chart-bar mr-1"></i>AQL SAMPLING PARAMETERS
                    </h4>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">Sample Size:</label>
                        <input id="sample-size-${tableId}" class="border border-red-300 p-1 w-16 input-field text-center" readonly>
                    </div>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">AQL Level:</label>
                        <input id="aql-level-${tableId}" class="border border-red-300 p-1 w-16 input-field text-center" readonly>
                    </div>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">Ac (Accept ≤):</label>
                        <input id="ac-value-${tableId}" class="border border-red-300 p-1 w-12 input-field text-center" readonly>
                    </div>
                    <div class="flex items-center">
                        <label class="font-semibold text-red-700 mr-2 whitespace-nowrap">Re (Reject ≥):</label>
                        <input id="re-value-${tableId}" class="border border-red-300 p-1 w-12 input-field text-center" readonly>
                    </div>
                </div>
            </div>
        `;
    }

    // Add event listeners for sample table calculations
    function addSampleTableEventListeners(tableId, columnCount) {
        const table = document.getElementById(tableId);
        if (table) {
            // Initialize meta and rejection criteria display
            const selectedProduct = products[productSelect.value] || {};
            const aqlLevel = selectedProduct?.aqlLevel || '1.0%';
            const firstGroupInputs = table.querySelectorAll('tbody tr td input.sample-weight[data-group="01"]');
            sampleTableMeta[tableId] = { sampleRows: firstGroupInputs.length || 20, aqlLevel };
            // Populate criteria block with current T1/T2
            const std = parseFloat(selectedProduct.standardWeight) || 0;
            if (std) {
                const limits = computeTareLimits(std);
                const stdEl = document.getElementById(`standard-weight-${tableId}`);
                const t1El = document.getElementById(`tare1-${tableId}`);
                const t2El = document.getElementById(`tare2-${tableId}`);
                const p1El = document.getElementById(`packs-weight-limit-1-${tableId}`);
                const p2El = document.getElementById(`packs-weight-limit-2-${tableId}`);
                if (stdEl) stdEl.value = std.toFixed(2);
                if (t1El) t1El.value = limits.t1.toFixed(2);
                if (t2El) t2El.value = limits.t2.toFixed(2);
                if (p1El) p1El.value = limits.pack1.toFixed(2);
                if (p2El) p2El.value = limits.pack2.toFixed(2);
            }

            table.addEventListener('input', function (e) {
                if (e.target.classList.contains('sample-weight')) {
                    const groupStr = e.target.dataset.group;
                    const groupNumber = parseInt(groupStr, 10);
                    calculateSampleStatistics(tableId, groupNumber);
                }
            });
        }
    }

    // Calculate statistics for sample table
    function calculateSampleStatistics(tableId, groupNumber) {
        let total = 0;
        let count = 0;
        let sumOfSquares = 0;

        const groupStr = groupNumber.toString().padStart(2, '0');

        // Get all sample inputs for this group
        const sampleInputs = document.querySelectorAll(`input[data-table="${tableId}"][data-group="${groupStr}"]`);

        sampleInputs.forEach(input => {
            const value = parseFloat(input.value);
            if (!isNaN(value) && value !== 0) {
                total += value;
                sumOfSquares += value * value;
                count++;
            }
        });

        // Calculate average and standard deviation
        const avg = (count > 0) ? (total / count) : 0;
        const stdDev = (count > 0) ? Math.sqrt((sumOfSquares / count) - (avg * avg)) : 0;

        // Update AVG and STD fields
        const avgField = document.getElementById(`AVG_${tableId}_${groupStr}`);
        const stdField = document.getElementById(`STD_${tableId}_${groupStr}`);

        if (avgField) {
            avgField.value = avg.toFixed(2);

            // Check if AVG is less than standard weight and apply red color
            const product = products[productSelect.value] || {};
            const standardWeight = parseFloat(product.standardWeight) || 0;

            if (standardWeight > 0 && avg < standardWeight) {
                avgField.style.backgroundColor = '#fee2e2'; // Light red background
                avgField.style.color = '#dc2626'; // Red text
                avgField.style.fontWeight = 'bold';
            } else {
                avgField.style.backgroundColor = ''; // Reset to default
                avgField.style.color = ''; // Reset to default
                avgField.style.fontWeight = ''; // Reset to default
            }
        }
        if (stdField) stdField.value = stdDev.toFixed(2);

        // Update Tare status fields if they exist
        updateTareStatus(tableId, groupStr, avg);
    }

    // Update tare status based on AQL sampling plan and Tare limits per column
    function updateTareStatus(tableId, groupStr, avg) {
        const tare1Field = document.getElementById(`Tare1_Status_${tableId}_${groupStr}`);
        const tare2Field = document.getElementById(`Tare2_Status_${tableId}_${groupStr}`);

        // If this pattern exists, we're in a Sample Table (Weight Monitoring)
        if (tare1Field || tare2Field) {
            const product = products[productSelect.value] || {};
            const std = parseFloat(product.standardWeight) || 0;
            if (!std) return;
            const limits = computeTareLimits(std);
            // Populate existing REJECTION CRITERIA & ACTION LIMITS block for this table
            const stdEl = document.getElementById(`standard-weight-${tableId}`);
            const t1El = document.getElementById(`tare1-${tableId}`);
            const t2El = document.getElementById(`tare2-${tableId}`);
            const p1El = document.getElementById(`packs-weight-limit-1-${tableId}`);
            const p2El = document.getElementById(`packs-weight-limit-2-${tableId}`);
            if (stdEl) stdEl.value = std.toFixed(2);
            if (t1El) t1El.value = limits.t1.toFixed(2);
            if (t2El) t2El.value = limits.t2.toFixed(2);
            if (p1El) p1El.value = limits.pack1.toFixed(2);
            if (p2El) p2El.value = limits.pack2.toFixed(2);

            // Count defectives and criticals in this column based on T1/T2
            const inputs = document.querySelectorAll(`input[data-table="${tableId}"][data-group="${groupStr}"]`);
            let defects = 0; // T2 <= x < T1
            let criticals = 0; // x < T2
            inputs.forEach(inp => {
                const v = parseFloat(inp.value);
                if (!isNaN(v) && v !== 0) {
                    if (v < limits.t2) criticals++;
                    else if (v < limits.t1) defects++;
                }
            });

            // Tare2 rule: any unit below T2 rejects the lot immediately
            if (tare2Field) {
                const t2Accepted = criticals === 0;
                tare2Field.value = t2Accepted ? 'ACCEPTED' : 'REJECTED';
                tare2Field.className = t2Accepted ? 'input-field status-accepted' : 'input-field status-rejected';
            }

            // AQL-based decision for Tare1 (defectives between T1 and T2)
            if (tare1Field) {
                const aqlLevel = product.aqlLevel || '1.0%';
                const sampleCount = inputs.length || 20;
                const bucket = nearestSampleSizeCategory(sampleCount);
                const row = AQL_PLAN[bucket] || AQL_PLAN[20];
                const acReStr = row[aqlLevel] || row['1.0%'];
                const { ac, re } = parseAcRe(acReStr);

                // Rule: If Tare2 is rejected, Tare1 must also be rejected
                let status;
                if (criticals > 0) {
                    status = 'REJECTED'; // Tare2 rejected, so Tare1 must be rejected
                } else {
                    // AQL-based decision: Accept unless defectives >= Re
                    status = (defects >= re) ? 'REJECTED' : 'ACCEPTED';
                }

                tare1Field.value = status;
                tare1Field.className = status === 'ACCEPTED' ? 'input-field status-accepted' : 'input-field status-rejected';

                // Update Ac/Re display in rejection criteria block
                const acEl = document.getElementById(`ac-value-${tableId}`);
                const reEl = document.getElementById(`re-value-${tableId}`);
                const sampleSizeEl = document.getElementById(`sample-size-${tableId}`);
                const aqlLevelEl = document.getElementById(`aql-level-${tableId}`);

                if (acEl) acEl.value = ac;
                if (reEl) reEl.value = re;
                if (sampleSizeEl) sampleSizeEl.value = sampleCount;
                if (aqlLevelEl) aqlLevelEl.value = aqlLevel;
            }
            return;
        }

        // Fallback for non-sample tables (preserve previous behavior if used elsewhere)
        const tare1Limit = parseFloat(document.getElementById(`tare1-${tableId}`)?.value) || 0;
        const tare2Limit = parseFloat(document.getElementById(`tare2-${tableId}`)?.value) || 0;
        if (tare1Field && tare1Limit > 0) {
            tare1Field.value = avg < tare1Limit ? 'STOP' : 'OK';
            tare1Field.className = avg < tare1Limit ? 'input-field status-stop' : 'input-field status-ok';
        }
        if (tare2Field && tare2Limit > 0) {
            tare2Field.value = avg > tare2Limit ? 'STOP' : 'OK';
            tare2Field.className = avg > tare2Limit ? 'input-field status-stop' : 'input-field status-ok';
        }
    }
    function updateRowNumbers(tbody) {
        const rows = tbody.querySelectorAll('tr');
        rows.forEach((row, index) => {
            const firstCell = row.querySelector('td');
            if (firstCell) {
                firstCell.textContent = index + 1;
            }
        });
    }
    // Render custom table with flexible columns and rows
    function renderCustomTable(table, containerId) {
        const columns = table.customColumns || [];
        const initialRows = table.customRows || 1;

        const tableHtml = `
        <div class="mb-4">
            <div class="flex justify-between items-center bg-blue-100 p-2">
                <h3 class="font-semibold">
                    <i class="fas fa-table mr-1"></i>${table.name}
                </h3>
                <div class="flex gap-2">
                    <button type="button" class="export-csv-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-xs" data-table-id="${table.id}">
                        <i class="fas fa-file-csv mr-1"></i>Export CSV
                    </button>
                    <button type="button" class="export-excel-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs" data-table-id="${table.id}">
                        <i class="fas fa-file-excel mr-1"></i>Export Excel
                    </button>
                    <button type="button" class="toggle-filter-btn bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 text-xs" data-table-id="${table.id}">
                        <i class="fas fa-filter mr-1"></i>Filter
                    </button>
                    <button type="button" class="main-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs" data-table-id="${table.id}">
                        <i class="fas fa-stop-circle mr-1"></i>Stop
                    </button>
                </div>
            </div>
            <div id="${table.id}-controls" class="table-controls-container"></div>
            <table class="form-table w-full" id="${table.id}">
                <thead>
                    <tr>
                        <th>#</th>
                        ${columns.map(col => `<th>${col.name}</th>`).join('')}
                        ${table.allowAddRows !== false ? '<th>Actions</th>' : ''}
                    </tr>
                </thead>
                <tbody id="${table.id}-tbody">
                </tbody>
            </table>
            ${table.allowAddRows !== false ? `<button id="add-${table.id}-row" class="no-print mt-2 p-2 bg-blue-600 text-white rounded hover:bg-blue-700"><i class="fas fa-plus mr-1"></i>Add Row</button>` : ''}
        </div>
    `;

        const container = document.getElementById(containerId);
        if (container) {
            container.insertAdjacentHTML('beforeend', tableHtml);

            // Render initial rows
            renderCustomTableRows(table, initialRows);

            // Add event listener for add row button
            if (table.allowAddRows !== false) {
                const addRowBtn = document.getElementById(`add-${table.id}-row`);
                if (addRowBtn) {
                    addRowBtn.addEventListener('click', () => {
                        addCustomTableRow(table);
                    });
                }
            }

            // Add table enhancement features
            setupTableEnhancements(table.id);
        }
    }

    // Render rows for custom table
    function renderCustomTableRows(table, rowCount) {
        const tbody = document.getElementById(`${table.id}-tbody`);
        if (!tbody) return;

        for (let i = 0; i < rowCount; i++) {
            addCustomTableRow(table);
        }
    }

    // Add a single row to custom table
    function addCustomTableRow(table) {
        const tbody = document.getElementById(`${table.id}-tbody`);
        if (!tbody) return;

        const columns = table.customColumns || [];
        const rowIndex = tbody.children.length + 1;
        const row = document.createElement('tr');

        let cells = `<td>${rowIndex}</td>`;
        columns.forEach((column, colIndex) => {
            const fieldId = `${table.id}_row${rowIndex}_col${colIndex + 1}`;

            switch (column.type) {
                case 'number':
                    cells += `<td><input type="number" class="input-field" id="${fieldId}" step="0.01"></td>`;
                    break;
                case 'date':
                    cells += `<td><input type="date" class="input-field" id="${fieldId}"></td>`;
                    break;
                case 'datetime':
                    cells += `<td><input type="datetime-local" class="input-field" id="${fieldId}"></td>`;
                    break;
                case 'select':
                    const options = column.options || [];
                    const optionsHtml = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
                    cells += `<td><select class="input-field" id="${fieldId}"><option value="">Select...</option>${optionsHtml}</select></td>`;
                    break;
                case 'checkbox':
                    cells += `<td><input type="checkbox" class="input-field" id="${fieldId}"></td>`;
                    break;
                default: // text
                    cells += `<td><input type="text" class="input-field" id="${fieldId}"></td>`;
            }
        });

        // Add delete button if rows can be added/removed
        if (table.allowAddRows !== false) {
            cells += `<td><button type="button" class="remove-custom-row-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 text-xs"><i class="fas fa-trash"></i></button></td>`;
        }

        row.innerHTML = cells;
        tbody.appendChild(row);

        // Add event listener for remove button
        if (table.allowAddRows !== false) {
            const removeBtn = row.querySelector('.remove-custom-row-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                    const tbody = row.closest('tbody');
                    row.remove();
                    updateRowNumbers(tbody);
                });
            }
        }
    }

    // Render checklist table
    function renderChecklistTable(table, containerId) {
        const items = Array.isArray(table.items) ? table.items : [];
        const html = `
            <div class="mb-4">
                <div class="flex justify-between items-center bg-blue-100 p-2">
                    <h3 class="font-semibold"><i class="fas fa-list-check mr-1"></i>${table.name}</h3>
                </div>
                <table class="form-table w-full" id="${table.id}">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Required</th>
                            <th>Status</th>
                            <th>Comments</th>
                        </tr>
                    </thead>
                    <tbody id="${table.id}-tbody">
                        ${items.map((it, idx) => `
                            <tr>
                                <td class="text-left">${it.text || ''}</td>
                                <td>${it.required ? 'Yes' : 'No'}</td>
                                <td><label class="checkbox-group"><input type="radio" name="chk_${table.id}_${idx}" value="OK"> OK</label> <label class="checkbox-group"><input type="radio" name="chk_${table.id}_${idx}" value="NOT OK"> NOT OK</label></td>
                                <td><input type="text" class="input-field" placeholder="Notes"></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        const container = document.getElementById(containerId);
        if (container) container.insertAdjacentHTML('beforeend', html);
    }

    // Render AI table from definition (enhanced with per-column validation, borders toggle, side header, and optional inspection intervals)
    function renderAiTable(table, containerId) {
        const def = table.aiDefinition || {};
        const columns = Array.isArray(def.columns) ? def.columns : [];
        const headerRows = Array.isArray(def.headerRows) ? def.headerRows : null;
        const sections = Array.isArray(def.sections) ? def.sections : null;
        const rowsCount = !sections ? (parseInt(def.rows || 0, 10) || 0) : 0;

        // Table-level options
        const borders = table.borders ?? def.borders ?? true; // default show borders
        const headerPosition = table.headerPosition || def.headerPosition || 'top'; // 'top' | 'side'
        const inspectionPeriod = table.inspectionPeriod || def.inspectionPeriod || null;

        // Optional time headers (like other tables)
        const shiftDurationSelect = document.getElementById('shift-duration');
        const shiftDuration = parseInt(shiftDurationSelect?.value, 10) || 8;
        const startTime = document.getElementById('start-inspection-time')?.value || '08:00';
        const timeHeaders = inspectionPeriod ? generateTableInspectionTimes(inspectionPeriod, shiftDuration, startTime) : [];

        // If a column has timeSeries: true, repeat it for each time slot
        const seriesCols = columns.filter(c => c.timeSeries);
        const nonSeriesCols = columns.filter(c => !c.timeSeries);

        function buildTopHeaderHtml() {
            // If custom header provided, respect it
            if (headerRows && headerRows.length > 0) {
                return headerRows.map(r => `<tr>${r.map(c => `<th ${c.colspan ? `colspan=\"${c.colspan}\"` : ''} ${c.rowspan ? `rowspan=\"${c.rowspan}\"` : ''}>${c.label || ''}</th>`).join('')}</tr>`).join('');
            }
            // Side header prefers a single row; vertical visuals handled by CSS
            if (headerPosition === 'side') {
                return `<tr>${columns.map(c => `<th>${c.label || c.key || ''}</th>`).join('')}</tr>`;
            }
            // Top header with time-series grouping
            if (seriesCols.length > 0 && timeHeaders.length > 0) {
                const row1 = [
                    ...nonSeriesCols.map(c => `<th rowspan="2">${c.label || c.key || ''}</th>`),
                    ...seriesCols.map(sc => `<th colspan="${timeHeaders.length}">${sc.label || sc.key || ''}</th>`)
                ].join('');
                const row2 = seriesCols.map(() => timeHeaders.map(t => `<th>${t}</th>`).join('')).join('');
                return `<tr>${row1}</tr><tr>${row2}</tr>`;
            }
            // Simple single-row header
            return `<tr>${columns.map(c => `<th>${c.label || c.key || ''}</th>`).join('')}</tr>`;
        }

        const tableClasses = `form-table w-full${borders ? ' table-bordered' : ' no-borders'}${headerPosition === 'side' ? ' header-side' : ''}`;
        const headHtml = buildTopHeaderHtml();

        const html = `
        <div class="mb-4">
            <div class="flex justify-between items-center bg-blue-100 p-2">
                <h3 class="font-semibold"><i class="fas fa-table mr-1"></i>${table.name}</h3>
                <div class="flex gap-2">
                    <button type="button" class="export-csv-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-xs" data-table-id="${table.id}"><i class="fas fa-file-csv mr-1"></i>Export CSV</button>
                    <button type="button" class="export-excel-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs" data-table-id="${table.id}"><i class="fas fa-file-excel mr-1"></i>Export Excel</button>
                    <button type="button" class="toggle-filter-btn bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 text-xs" data-table-id="${table.id}"><i class="fas fa-filter mr-1"></i>Filter</button>
                    <button type="button" class="main-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs" data-table-id="${table.id}"><i class="fas fa-stop-circle mr-1"></i>Stop</button>
                </div>
            </div>
            <div id="${table.id}-controls" class="table-controls-container"></div>
            <table class="${tableClasses}" id="${table.id}">
                <thead>${headHtml}</thead>
                <tbody id="${table.id}-tbody"></tbody>
            </table>
        </div>
    `;

        const container = document.getElementById(containerId);
        if (!container) return;
        container.insertAdjacentHTML('beforeend', html);

        const tbody = document.getElementById(`${table.id}-tbody`);
        if (!tbody) return;

        function inputAttrs(c, rowIndex, tIndex) {
            const attrs = [];
            const defVal = (tIndex != null && c.defaultByTime && Array.isArray(c.defaultByTime)) ? (c.defaultByTime[tIndex] ?? c.default) : c.default;
            const colKey = (c.key || c.label || 'col').toString().toLowerCase().replace(/[^a-z0-9_]/g, '_');
            if (c.required) attrs.push('required', 'data-required="true"');
            if (c.placeholder) attrs.push(`placeholder="${c.placeholder}"`);
            if (typeof c.min !== 'undefined') attrs.push(`min="${c.min}"`, `data-min="${c.min}"`);
            if (typeof c.max !== 'undefined') attrs.push(`max="${c.max}"`, `data-max="${c.max}"`);
            if (typeof c.step !== 'undefined') attrs.push(`step="${c.step}"`);
            if (c.type === 'number' && typeof c.step === 'undefined' && typeof c.decimals === 'number') {
                const step = 1 / Math.pow(10, c.decimals);
                attrs.push(`step="${step}"`);
            }
            if (c.pattern) attrs.push(`pattern="${c.pattern}"`, `data-pattern="${c.pattern}"`);
            if (typeof defVal !== 'undefined') attrs.push(`value="${defVal}"`);
            if (tIndex != null) attrs.push(`data-time-index="${tIndex}"`);
            if (typeof rowIndex !== 'undefined') attrs.push(`data-row-index="${rowIndex}"`);
            attrs.push(`data-col-key="${colKey}"`);
            attrs.push(`data-table-id="${table.id}"`);
            attrs.push('data-ai-validate="true"');
            return attrs.join(' ');
        }

        function cellInputHtml(c, rowIndex, tIndex) {
            const colKeySafe = (c.key || c.label || 'col').toString().toLowerCase().replace(/[^a-z0-9_]/g, '_');
            const nameBase = `${table.id}__r${rowIndex}__${colKeySafe}`;
            const name = tIndex != null ? `${nameBase}__t${tIndex}` : nameBase;
            const attrs = inputAttrs(c, rowIndex, tIndex);

            // Helper to post-process for computed columns
            function finalize(inputHtml) {
                if (c.compute) {
                    const enc = encodeURIComponent(c.compute);
                    // Add computed meta, make readonly and styled
                    inputHtml = inputHtml.replace('class="input-field"', 'class="input-field computed-cell"')
                        .replace('<input ', `<input data-compute="${enc}" data-compute-decimals="${typeof c.decimals === 'number' ? c.decimals : ''}" readonly `)
                        .replace('<textarea ', '<textarea readonly ')
                        .replace('<select ', '<select disabled ');
                }
                return inputHtml;
            }

            switch (c.type) {
                case 'number':
                    return finalize(`<input name="${name}" type="number" class="input-field" ${attrs}>`);
                case 'date':
                    return finalize(`<input name="${name}" type="date" class="input-field" ${attrs}>`);
                case 'time':
                    return finalize(`<input name="${name}" type="time" class="input-field" ${attrs}>`);
                case 'datetime':
                    return finalize(`<input name="${name}" type="datetime-local" class="input-field" ${attrs}>`);
                case 'select': {
                    const opts = Array.isArray(c.options) ? c.options : [];
                    const defVal = (tIndex != null && c.defaultByTime && Array.isArray(c.defaultByTime)) ? (c.defaultByTime[tIndex] ?? c.default) : c.default;
                    const optsHtml = ['<option value="">Select...</option>', ...opts.map(o => `<option value="${o}" ${defVal == o ? 'selected' : ''}>${o}</option>`)].join('');
                    return finalize(`<select name="${name}" class="input-field" ${attrs}>${optsHtml}</select>`);
                }
                case 'checkbox':
                    return finalize(`<input name="${name}" type="checkbox" class="input-field" ${c.default ? 'checked' : ''} ${attrs}>`);
                case 'textarea':
                    return finalize(`<textarea name="${name}" class="input-field" ${attrs}></textarea>`);
                default:
                    return finalize(`<input name="${name}" type="text" class="input-field" ${attrs}>`);
            }
        }

        function appendDataRow(rowIndex) {
            const tr = document.createElement('tr');
            if (seriesCols.length > 0 && timeHeaders.length > 0) {
                tr.innerHTML = nonSeriesCols.map(c => `<td>${cellInputHtml(c, rowIndex, null)}</td>`).join('') +
                    seriesCols.map(sc => timeHeaders.map((_, tIdx) => `<td>${cellInputHtml(sc, rowIndex, tIdx)}</td>`).join('')).join('');
            } else {
                tr.innerHTML = columns.map(c => `<td>${cellInputHtml(c, rowIndex, null)}</td>`).join('');
            }
            tbody.appendChild(tr);
        }

        if (sections && sections.length > 0) {
            sections.forEach(sec => {
                const th = document.createElement('tr');
                const colSpan = (seriesCols.length > 0 && timeHeaders.length > 0)
                    ? (nonSeriesCols.length + seriesCols.length * timeHeaders.length)
                    : columns.length;
                th.innerHTML = `<th colspan="${colSpan}" class="text-left bg-gray-50">${sec.title || ''}</th>`;
                tbody.appendChild(th);
                const r = parseInt(sec.rows || 0, 10) || 0;
                for (let i = 0; i < r; i++) appendDataRow(i);
            });
        } else {
            for (let i = 0; i < rowsCount; i++) appendDataRow(i);
        }

        setupTableEnhancements(table.id);
        attachAiValidation(table.id);
        attachAiComputed(table.id, columns, timeHeaders);
    }

    function attachAiValidation(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        table.addEventListener('input', (e) => {
            const el = e.target;
            if (!(el && el.matches('[data-ai-validate], [data-min], [data-max], [data-pattern]'))) return;
            let ok = true;
            const valueStr = (el.type === 'checkbox') ? (el.checked ? '1' : '') : el.value;
            const num = parseFloat(valueStr);
            const hasNum = !isNaN(num);
            const min = parseFloat(el.getAttribute('data-min'));
            const max = parseFloat(el.getAttribute('data-max'));
            const pattern = el.getAttribute('data-pattern');
            if (!isNaN(min) && hasNum && num < min) ok = false;
            if (!isNaN(max) && hasNum && num > max) ok = false;
            if (pattern && valueStr) {
                try { if (!(new RegExp(pattern)).test(valueStr)) ok = false; } catch { }
            }
            if (el.required && (valueStr === '' || valueStr == null)) ok = false;
            el.classList.toggle('out-of-range', !ok);
            el.classList.toggle('in-range', ok);
            el.style.backgroundColor = ok ? '' : '#fee2e2';
        });
    }

    // New: AI computed columns and conditional formatting helpers
    function attachAiComputed(tableId, columns, timeHeaders) {
        const table = document.getElementById(tableId);
        if (!table) return;

        // Build quick lookup by key
        const keyOf = (c) => (c.key || c.label || 'col').toString().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const colsByKey = {};
        columns.forEach(c => { colsByKey[keyOf(c)] = { ...c, __key: keyOf(c) }; });

        function buildRowContext(rowIndex) {
            const ctx = {};
            Object.values(colsByKey).forEach(c => {
                if (c.timeSeries && Array.isArray(timeHeaders) && timeHeaders.length) {
                    const arr = [];
                    timeHeaders.forEach((_, tIdx) => {
                        const el = table.querySelector(`[data-row-index="${rowIndex}"][data-col-key="${c.__key}"][data-time-index="${tIdx}"]`);
                        const val = el ? (el.type === 'checkbox' ? (el.checked ? 1 : 0) : parseFloat(el.value)) : NaN;
                        arr.push(isNaN(val) ? null : val);
                    });
                    ctx[c.__key] = arr;
                } else {
                    const el = table.querySelector(`[data-row-index="${rowIndex}"][data-col-key="${c.__key}"]:not([data-time-index])`);
                    const val = el ? (el.type === 'checkbox' ? (el.checked ? 1 : 0) : parseFloat(el.value)) : NaN;
                    ctx[c.__key] = isNaN(val) ? null : val;
                }
            });
            return ctx;
        }

        function evaluate(expr, cols, t, value) {
            try {
                // Safe, limited evaluator: expose only whitelisted helpers
                const sum = (arr) => Array.isArray(arr) ? arr.filter(v => typeof v === 'number' && isFinite(v)).reduce((a, b) => a + b, 0) : 0;
                const avg = (arr) => {
                    if (!Array.isArray(arr)) return 0;
                    const nums = arr.filter(v => typeof v === 'number' && isFinite(v));
                    return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
                };
                const fn = new Function(
                    'cols', 't', 'value', 'Math', 'sum', 'avg', 'min', 'max',
                    `"use strict"; return (${expr});`
                );
                return fn(cols, t, value, Math, sum, avg, Math.min, Math.max);
            } catch (e) {
                console.warn('Compute eval error:', e);
                return null;
            }
        }

        function applyConditional(el, colCfg, value, cols, t) {
            // First, apply min/max validation styling (already handled in attachAiValidation on input),
            // then custom rules if provided on column
            if (colCfg && Array.isArray(colCfg.conditional)) {
                let matched = false;
                for (const rule of colCfg.conditional) {
                    if (!rule || !rule.when) continue;
                    let ok = false;
                    try { ok = !!evaluate(rule.when, cols, t, value); } catch { }
                    if (ok) {
                        matched = true;
                        if (rule.addClass) el.classList.add(rule.addClass);
                        if (rule.removeClass) el.classList.remove(rule.removeClass);
                        if (rule.style && typeof rule.style === 'object') {
                            Object.assign(el.style, rule.style);
                        }
                        // stop at first match unless rule.continue === true
                        if (!rule.continue) break;
                    }
                }
                if (!matched) {
                    // clear simple inline styles if set by rules
                    if (colCfg.resetStyleOnNoMatch) {
                        el.style.backgroundColor = '';
                        el.style.color = '';
                    }
                }
            }
        }

        function recomputeRow(rowIndex) {
            const cols = buildRowContext(rowIndex);
            // For each cell with data-compute in this row
            table.querySelectorAll(`[data-row-index="${rowIndex}"][data-compute]`).forEach(el => {
                const key = el.getAttribute('data-col-key');
                const colCfg = colsByKey[key];
                const expr = decodeURIComponent(el.getAttribute('data-compute'));
                const tAttr = el.getAttribute('data-time-index');
                const t = (tAttr != null) ? parseInt(tAttr, 10) : undefined;
                let val = evaluate(expr, cols, t, undefined);
                if (typeof val === 'number' && isFinite(val)) {
                    const dec = parseInt(el.getAttribute('data-compute-decimals'), 10);
                    el.value = isNaN(dec) ? val : Number(val.toFixed(dec));
                } else {
                    el.value = '';
                }
                // Built-in validation for computed cells (min/max/pattern/required)
                (function () {
                    let ok = true;
                    const valueStr = (el.type === 'checkbox') ? (el.checked ? '1' : '') : (el.value === null ? '' : String(el.value));
                    const num = parseFloat(valueStr);
                    const hasNum = !isNaN(num);
                    const min = parseFloat(el.getAttribute('data-min'));
                    const max = parseFloat(el.getAttribute('data-max'));
                    const pattern = el.getAttribute('data-pattern');
                    if (!isNaN(min) && hasNum && num < min) ok = false;
                    if (!isNaN(max) && hasNum && num > max) ok = false;
                    if (pattern && valueStr) {
                        try { if (!(new RegExp(pattern)).test(valueStr)) ok = false; } catch { }
                    }
                    if (el.required && (valueStr === '' || valueStr == null)) ok = false;
                    el.classList.toggle('out-of-range', !ok);
                    el.classList.toggle('in-range', ok);
                    if (!ok) el.style.backgroundColor = '#fee2e2'; else el.style.backgroundColor = '';
                })();
                // Apply conditional rules for computed result
                applyConditional(el, colCfg, parseFloat(el.value), cols, t);
            });
        }

        // Recompute all rows initially
        const maxRows = Array.from(table.querySelectorAll('[data-row-index]')).reduce((m, el) => Math.max(m, parseInt(el.getAttribute('data-row-index'), 10) || 0), -1) + 1;
        for (let r = 0; r < maxRows; r++) recomputeRow(r);

        // On input anywhere in the table, recompute that row
        table.addEventListener('input', (e) => {
            const el = e.target.closest('[data-row-index][data-col-key]');
            if (!el) return;
            const rowIndex = parseInt(el.getAttribute('data-row-index'), 10);
            recomputeRow(rowIndex);
            // Also apply conditional rules to the edited element
            const key = el.getAttribute('data-col-key');
            const colCfg = colsByKey[key];
            const cols = buildRowContext(rowIndex);
            const tAttr = el.getAttribute('data-time-index');
            const t = (tAttr != null) ? parseInt(tAttr, 10) : undefined;
            const value = el.type === 'checkbox' ? (el.checked ? 1 : 0) : parseFloat(el.value);
            applyConditional(el, colCfg, value, cols, t);
        });

        // Apply conditional styles initially as well
        table.querySelectorAll('[data-row-index][data-col-key]').forEach(el => {
            const rowIndex = parseInt(el.getAttribute('data-row-index'), 10);
            const key = el.getAttribute('data-col-key');
            const colCfg = colsByKey[key];
            const cols = buildRowContext(rowIndex);
            const tAttr = el.getAttribute('data-time-index');
            const t = (tAttr != null) ? parseInt(tAttr, 10) : undefined;
            const value = el.type === 'checkbox' ? (el.checked ? 1 : 0) : parseFloat(el.value);
            applyConditional(el, colCfg, value, cols, t);
        });
    }

    // New: Defects Log table renderer
    function renderDefectsLogTable(table, containerId) {
        const types = Array.isArray(table.defectTypes) && table.defectTypes.length
            ? table.defectTypes
            : ['Cracks', 'Burnt', 'Underweight', 'Overbake'];
        const includeSeverity = !!table.includeSeverity;
        const includeLocation = table.includeLocation !== false; // default true
        const tableId = table.id || `defects-${Date.now()}`;
        const cols = [
            { key: 'time', label: 'Time' },
            { key: 'type', label: 'Defect Type' },
            { key: 'qty', label: 'Qty' },
        ];
        if (includeSeverity) cols.push({ key: 'severity', label: 'Severity' });
        if (includeLocation) cols.push({ key: 'location', label: 'Location/Station' });
        cols.push({ key: 'notes', label: 'Notes' });

        const head = cols.map(c => `<th>${c.label}</th>`).join('');
        const html = `
            <div class="mb-4">
                <div class="flex justify-between items-center bg-blue-100 p-2">
                    <h3 class="font-semibold"><i class="fas fa-bug mr-1"></i>${table.name || 'Defects Log'}</h3>
                    <div class="flex gap-2">
                        <button type="button" class="export-csv-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-xs" data-table-id="${tableId}"><i class="fas fa-file-csv mr-1"></i>CSV</button>
                        <button type="button" class="export-excel-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs" data-table-id="${tableId}"><i class="fas fa-file-excel mr-1"></i>Excel</button>
                        <button type="button" class="toggle-filter-btn bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 text-xs" data-table-id="${tableId}"><i class="fas fa-filter mr-1"></i>Filter</button>
                        <button type="button" class="main-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs" data-table-id="${tableId}"><i class="fas fa-stop-circle mr-1"></i>Stop</button>
                        <button type="button" class="add-defect-row bg-indigo-600 text-white px-2 py-1 rounded text-xs" data-target="${tableId}-tbody"><i class="fas fa-plus mr-1"></i>Add Row</button>
                    </div>
                </div>
                <div id="${tableId}-controls" class="table-controls-container"></div>
                <table class="form-table w-full" id="${tableId}">
                    <thead><tr>${head}</tr></thead>
                    <tbody id="${tableId}-tbody"></tbody>
                </table>
            </div>`;
        const container = document.getElementById(containerId);
        if (!container) return;
        container.insertAdjacentHTML('beforeend', html);

        const tbody = document.getElementById(`${tableId}-tbody`);
        function addRow() {
            const cells = [];
            cells.push(`<td><input type="time" class="input-field"></td>`);
            // type select
            cells.push(`<td><select class="input-field">${types.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></td>`);
            cells.push(`<td><input type="number" min="0" step="1" class="input-field" value="0"></td>`);
            if (includeSeverity) cells.push(`<td><select class="input-field"><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option></select></td>`);
            if (includeLocation) cells.push(`<td><input type="text" class="input-field" placeholder="Line/Station"></td>`);
            cells.push(`<td><input type="text" class="input-field" placeholder="Notes"></td>`);
            const tr = document.createElement('tr');
            tr.innerHTML = cells.join('');
            tbody.appendChild(tr);
        }
        // Add 3 starter rows
        for (let i=0;i<3;i++) addRow();

        // Wire add button
        const addBtn = document.querySelector(`.add-defect-row[data-target="${tableId}-tbody"]`);
        addBtn && addBtn.addEventListener('click', addRow);

        setupTableEnhancements && setupTableEnhancements(tableId);
    }

    // New: Shift Summary renderer
    function renderShiftSummaryTable(table, containerId) {
        const tableId = table.id || `summary-${Date.now()}`;
        const includeRework = !!table.includeRework;
        const includeDowntime = !!table.includeDowntime;
        const html = `
            <div class="mb-4">
                <div class="flex justify-between items-center bg-blue-100 p-2">
                    <h3 class="font-semibold"><i class="fas fa-clipboard-list mr-1"></i>${table.name || 'Shift Summary'}</h3>
                    <div class="flex gap-2">
                        <button type="button" class="export-csv-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-xs" data-table-id="${tableId}"><i class="fas fa-file-csv mr-1"></i>CSV</button>
                        <button type="button" class="export-excel-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs" data-table-id="${tableId}"><i class="fas fa-file-excel mr-1"></i>Excel</button>
                        <button type="button" class="toggle-filter-btn bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 text-xs" data-table-id="${tableId}"><i class="fas fa-filter mr-1"></i>Filter</button>
                        <button type="button" class="main-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs" data-table-id="${tableId}"><i class="fas fa-stop-circle mr-1"></i>Stop</button>
                    </div>
                </div>
                <div id="${tableId}-controls" class="table-controls-container"></div>
                <table class="form-table w-full" id="${tableId}">
                    <thead>
                        <tr>
                            <th>Produced (kg)</th>
                            <th>Accepted (kg)</th>
                            <th>Rejected (kg)</th>
                            ${includeRework ? '<th>Rework (kg)</th>' : ''}
                            ${includeDowntime ? '<th>Downtime (min)</th>' : ''}
                            <th>Yield (%)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><input type="number" class="input-field" step="0.01" min="0" data-role="prod"></td>
                            <td><input type="number" class="input-field" step="0.01" min="0" data-role="acc"></td>
                            <td><input type="number" class="input-field" step="0.01" min="0" data-role="rej"></td>
                            ${includeRework ? '<td><input type="number" class="input-field" step="0.01" min="0" data-role="rew"></td>' : ''}
                            ${includeDowntime ? '<td><input type="number" class="input-field" step="1" min="0" data-role="down"></td>' : ''}
                            <td><input type="number" class="input-field" step="0.01" min="0" readonly data-role="yield"></td>
                        </tr>
                    </tbody>
                </table>
            </div>`;
        const container = document.getElementById(containerId);
        if (!container) return;
        container.insertAdjacentHTML('beforeend', html);

        const tableEl = document.getElementById(tableId);
        function recalc() {
            const prod = parseFloat(tableEl.querySelector('[data-role="prod"]').value) || 0;
            const acc = parseFloat(tableEl.querySelector('[data-role="acc"]').value) || 0;
            const y = prod > 0 ? (acc / prod) * 100 : 0;
            tableEl.querySelector('[data-role="yield"]').value = Number(y.toFixed(2));
        }
        tableEl.addEventListener('input', recalc);
        setupTableEnhancements && setupTableEnhancements(tableId);
    }

    // New: SPC (Run Chart) renderer using Chart.js
    function renderSPCTable(table, containerId) {
        const tableId = table.id || `spc-${Date.now()}`;
        const rows = parseInt(table.spcRows || 20, 10);
        const param = table.spcParam || 'Measured Value';
        const LCL = typeof table.spcLCL === 'number' ? table.spcLCL : undefined;
        const TARGET = typeof table.spcTarget === 'number' ? table.spcTarget : undefined;
        const UCL = typeof table.spcUCL === 'number' ? table.spcUCL : undefined;

        const html = `
            <div class="mb-4">
                <div class="flex justify-between items-center bg-blue-100 p-2">
                    <h3 class="font-semibold"><i class="fas fa-chart-line mr-1"></i>${table.name || 'SPC Run Chart'}</h3>
                    <div class="flex gap-2">
                        <button type="button" class="export-csv-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-xs" data-table-id="${tableId}"><i class="fas fa-file-csv mr-1"></i>CSV</button>
                        <button type="button" class="export-excel-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs" data-table-id="${tableId}"><i class="fas fa-file-excel mr-1"></i>Excel</button>
                        <button type="button" class="toggle-filter-btn bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 text-xs" data-table-id="${tableId}"><i class="fas fa-filter mr-1"></i>Filter</button>
                        <button type="button" class="main-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs" data-table-id="${tableId}"><i class="fas fa-stop-circle mr-1"></i>Stop</button>
                    </div>
                </div>
                <div id="${tableId}-controls" class="table-controls-container"></div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                        <table class="form-table w-full" id="${tableId}">
                            <thead>
                                <tr><th>#</th><th>${param}</th></tr>
                            </thead>
                            <tbody id="${tableId}-tbody"></tbody>
                        </table>
                    </div>
                    <div>
                        <canvas id="${tableId}-chart" style="height:260px;"></canvas>
                    </div>
                </div>
            </div>`;
        const container = document.getElementById(containerId);
        if (!container) return;
        container.insertAdjacentHTML('beforeend', html);

        const tbody = document.getElementById(`${tableId}-tbody`);
        for (let i = 1; i <= rows; i++) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${i}</td><td><input type="number" class="input-field" step="0.01" data-index="${i-1}"></td>`;
            tbody.appendChild(tr);
        }

        const ctx = document.getElementById(`${tableId}-chart`).getContext('2d');
        const data = Array(rows).fill(null);
        const labels = Array.from({length: rows}, (_,i)=> i+1);
        const ds = { label: param, data, borderColor: '#2563eb', fill: false, tension: 0.2, spanGaps: true };
        const annos = [];
        function constLine(value, label, color){
            return { type: 'line', yMin: value, yMax: value, borderColor: color, borderWidth: 1.5, label: { display: true, content: label, position: 'start', backgroundColor: 'rgba(0,0,0,0.6)' } };
        }
        const cfg = {
            type: 'line',
            data: { labels, datasets: [ds] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: { x: { title: { display: true, text: 'Sample' } }, y: { title: { display: true, text: param } } },
            }
        };
        const chart = new Chart(ctx, cfg);
        // Add reference lines by updating after init
        function updateRefLines(){
            // Simple approach: add additional datasets for lines
            chart.data.datasets = [ds];
            if (typeof LCL === 'number') chart.data.datasets.push({ label: 'LCL', data: Array(rows).fill(LCL), borderColor: '#ef4444', borderDash: [6,6], pointRadius: 0, fill:false });
            if (typeof TARGET === 'number') chart.data.datasets.push({ label: 'Target', data: Array(rows).fill(TARGET), borderColor: '#10b981', borderDash: [4,4], pointRadius: 0, fill:false });
            if (typeof UCL === 'number') chart.data.datasets.push({ label: 'UCL', data: Array(rows).fill(UCL), borderColor: '#ef4444', borderDash: [6,6], pointRadius: 0, fill:false });
            chart.update();
        }
        updateRefLines();

        // Wire inputs
        document.getElementById(tableId).addEventListener('input', (e)=>{
            const inp = e.target.closest('input[type="number"]');
            if (!inp) return;
            const idx = parseInt(inp.dataset.index, 10);
            const v = inp.value === '' ? null : parseFloat(inp.value);
            data[idx] = isFinite(v) ? v : null;
            chart.update();
        });

        setupTableEnhancements && setupTableEnhancements(tableId);
    }

    // New: Sign-off renderer
    function renderSignoffTable(table, containerId) {
        const roles = Array.isArray(table.roles) && table.roles.length ? table.roles : ['Quality Engineer', 'Production Supervisor', 'Quality Manager'];
        const includeDate = table.includeDate !== false; // default true
        const tableId = table.id || `signoff-${Date.now()}`;
        const head = `<tr><th>Role</th><th>Name</th>${includeDate ? '<th>Date</th>' : ''}<th>Signature</th><th>Status</th></tr>`;
        const rows = roles.map(r => `<tr>
            <td>${r}</td>
            <td><input type="text" class="input-field" placeholder="Full Name"></td>
            ${includeDate ? '<td><input type="date" class="input-field"></td>' : ''}
            <td><input type="text" class="input-field" placeholder="Sign/Initials"></td>
            <td><select class="input-field"><option value="Pending">Pending</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option></select></td>
        </tr>`).join('');
        const html = `
            <div class="mb-4">
                <div class="flex justify-between items-center bg-blue-100 p-2">
                    <h3 class="font-semibold"><i class="fas fa-signature mr-1"></i>${table.name || 'Sign-off'}</h3>
                    <div class="flex gap-2">
                        <button type="button" class="export-csv-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 text-xs" data-table-id="${tableId}"><i class="fas fa-file-csv mr-1"></i>CSV</button>
                        <button type="button" class="export-excel-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 text-xs" data-table-id="${tableId}"><i class="fas fa-file-excel mr-1"></i>Excel</button>
                        <button type="button" class="toggle-filter-btn bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 text-xs" data-table-id="${tableId}"><i class="fas fa-filter mr-1"></i>Filter</button>
                        <button type="button" class="main-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs" data-table-id="${tableId}"><i class="fas fa-stop-circle mr-1"></i>Stop</button>
                    </div>
                </div>
                <div id="${tableId}-controls" class="table-controls-container"></div>
                <table class="form-table w-full" id="${tableId}">
                    <thead>${head}</thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        const container = document.getElementById(containerId);
        if (container) container.insertAdjacentHTML('beforeend', html);
        setupTableEnhancements && setupTableEnhancements(tableId);
    }

    // ===== TABLE TEMPLATES =====
    const tableTemplates = {
        'quality-basic': {
            name: 'Basic Quality Control',
            type: 'parameters',
            parameters: [
                { name: 'Weight', limits: '±5g', type: 'number', min: 95, max: 105 },
                { name: 'Length', limits: '±2mm', type: 'number', min: 48, max: 52 },
                { name: 'Width', limits: '±2mm', type: 'number', min: 28, max: 32 },
                { name: 'Thickness', limits: '±1mm', type: 'number', min: 4, max: 6 },
                { name: 'Appearance', limits: 'Visual Check', type: 'dropdown', options: ['Good', 'Acceptable', 'Reject'] }
            ],
            hasAvg: true,
            hasStd: true,
            inspectionPeriod: 60
        },
        'quality-advanced': {
            name: 'Advanced Quality Control',
            type: 'parameters',
            parameters: [
                { name: 'Weight', limits: '±3g', type: 'number', min: 97, max: 103, dualInput: true },
                { name: 'Moisture', limits: '2-4%', type: 'number', min: 2, max: 4 },
                { name: 'Fat Content', limits: '15-20%', type: 'number', min: 15, max: 20 },
                { name: 'Sugar Content', limits: '25-30%', type: 'number', min: 25, max: 30 },
                { name: 'pH Level', limits: '6.5-7.5', type: 'number', min: 6.5, max: 7.5 },
                { name: 'Texture', limits: 'Crispy', type: 'dropdown', options: ['Crispy', 'Soft', 'Hard'] },
                { name: 'Color', limits: 'Golden Brown', type: 'dropdown', options: ['Light', 'Golden', 'Dark'] },
                { name: 'Taste', limits: 'Normal', type: 'dropdown', options: ['Excellent', 'Good', 'Acceptable', 'Poor'] }
            ],
            hasAvg: true,
            hasStd: true,
            hasTare1: true,
            hasTare2: true,
            inspectionPeriod: 30
        },
        'weight-monitoring': {
            name: 'Weight Monitoring',
            type: 'sample',
            sampleRows: 20,
            samplePrefix: 'Sample',
            hasAvg: true,
            hasStd: true,
            hasTare1: true,
            hasTare2: true,
            hasRejectionCriteria: true,
            inspectionPeriod: 60
        },
        'production-log': {
            name: 'Production Log',
            type: 'custom',
            customRows: 5,
            allowAddRows: true,
            customColumns: [
                { name: 'Time', type: 'datetime' },
                { name: 'Batch No', type: 'text' },
                { name: 'Quantity', type: 'number' },
                { name: 'Operator', type: 'text' },
                { name: 'Status', type: 'select', options: ['Running', 'Stopped', 'Maintenance'] },
                { name: 'Notes', type: 'text' }
            ]
        },
        'inspection-checklist': {
            name: 'Inspection Checklist',
            type: 'custom',
            customRows: 10,
            allowAddRows: false,
            customColumns: [
                { name: 'Item', type: 'text' },
                { name: 'Checked', type: 'checkbox' },
                { name: 'Result', type: 'select', options: ['Pass', 'Fail', 'N/A'] },
                { name: 'Comments', type: 'text' }
            ]
        }
    };

    // Show table template selection dialog
    function showTableTemplateDialog(tableContainer) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';

        let templateOptions = '';
        Object.keys(tableTemplates).forEach(key => {
            const template = tableTemplates[key];
            templateOptions += `
                <div class="template-option border rounded p-3 mb-2 cursor-pointer hover:bg-blue-50" data-template="${key}">
                    <h4 class="font-semibold">${template.name}</h4>
                    <p class="text-sm text-gray-600">Type: ${template.type}</p>
                    ${template.parameters ? `<p class="text-xs text-gray-500">${template.parameters.length} parameters</p>` : ''}
                    ${template.customColumns ? `<p class="text-xs text-gray-500">${template.customColumns.length} columns</p>` : ''}
                </div>
            `;
        });

        modal.innerHTML = `
            <div class="bg-white rounded-lg p-6 max-w-md w-full max-h-96 overflow-y-auto">
                <h3 class="text-lg font-bold mb-4">Select Table Template</h3>
                <div class="template-list">
                    ${templateOptions}
                </div>
                <div class="flex justify-end gap-2 mt-4">
                    <button type="button" class="cancel-btn bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        modal.querySelectorAll('.template-option').forEach(option => {
            option.addEventListener('click', function () {
                const templateKey = this.dataset.template;
                applyTableTemplate(tableContainer, tableTemplates[templateKey]);
                modal.remove();
                showNotification('Template applied successfully', 'success');
            });
        });

        modal.querySelector('.cancel-btn').addEventListener('click', () => {
            modal.remove();
        });

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // Apply table template to container
    function applyTableTemplate(tableContainer, template) {
        // Update table type
        const tableTypeSelect = tableContainer.querySelector('.table-type');
        if (tableTypeSelect) {
            tableTypeSelect.value = template.type;
            tableTypeSelect.dispatchEvent(new Event('change'));
        }

        // Update table name
        const tableNameInput = tableContainer.querySelector('.table-name');
        if (tableNameInput) {
            tableNameInput.value = template.name;
        }

        // Update inspection period
        if (template.inspectionPeriod) {
            const periodInput = tableContainer.querySelector('.table-inspection-period');
            if (periodInput) {
                periodInput.value = template.inspectionPeriod;
            }
        }

        // Apply type-specific configurations
        if (template.type === 'parameters') {
            // Clear existing parameters
            const parametersContainer = tableContainer.querySelector('.parameters-container');
            if (parametersContainer) {
                parametersContainer.innerHTML = '';

                // Add template parameters
                template.parameters.forEach(param => {
                    addParameter(parametersContainer, param);
                });
            }

            // Set checkboxes
            ['hasAvg', 'hasStd', 'hasTare1', 'hasTare2'].forEach(prop => {
                const checkbox = tableContainer.querySelector(`.table-${prop.toLowerCase().replace('has', 'has-')}`);
                if (checkbox) {
                    checkbox.checked = template[prop] || false;
                }
            });

        } else if (template.type === 'sample') {
            // Set sample-specific configurations
            const sampleRowsInput = tableContainer.querySelector('.sample-rows');
            if (sampleRowsInput && template.sampleRows) {
                sampleRowsInput.value = template.sampleRows;
            }

            const samplePrefixInput = tableContainer.querySelector('.sample-prefix');
            if (samplePrefixInput && template.samplePrefix) {
                samplePrefixInput.value = template.samplePrefix;
            }

            const rejectionCheckbox = tableContainer.querySelector('.table-has-rejection-criteria');
            if (rejectionCheckbox) {
                rejectionCheckbox.checked = template.hasRejectionCriteria || false;
            }

            // Set checkboxes
            ['hasAvg', 'hasStd', 'hasTare1', 'hasTare2'].forEach(prop => {
                const checkbox = tableContainer.querySelector(`.table-${prop.toLowerCase().replace('has', 'has-')}`);
                if (checkbox) {
                    checkbox.checked = template[prop] || false;
                }
            });

        } else if (template.type === 'custom') {
            // Set custom table configurations
            const customRowsInput = tableContainer.querySelector('.custom-rows');
            if (customRowsInput && template.customRows) {
                customRowsInput.value = template.customRows;
            }

            const allowAddRowsCheckbox = tableContainer.querySelector('.custom-allow-add-rows');
            if (allowAddRowsCheckbox) {
                allowAddRowsCheckbox.checked = template.allowAddRows !== false;
            }

            // Clear and add custom columns
            const customColumnsContainer = tableContainer.querySelector('.custom-columns-container');
            if (customColumnsContainer && template.customColumns) {
                customColumnsContainer.innerHTML = '';
                template.customColumns.forEach(column => {
                    addCustomColumn(customColumnsContainer, column);
                });
            }
        }
    }

    // ===== ENHANCED TABLE CUSTOMIZATION FEATURES =====

    // Export table to CSV
    function exportTableToCSV(tableElement, fileName = 'table_export.csv') {
        const rows = [];
        const headers = [];

        // Get headers
        tableElement.querySelectorAll('thead th').forEach(th => {
            headers.push(th.textContent.trim());
        });
        rows.push(headers);

        // Get data rows
        tableElement.querySelectorAll('tbody tr').forEach(tr => {
            const row = [];
            tr.querySelectorAll('td').forEach(td => {
                const input = td.querySelector('input, select, textarea');
                if (input) {
                    if (input.type === 'checkbox') {
                        row.push(input.checked ? 'Yes' : 'No');
                    } else {
                        row.push(input.value || '');
                    }
                } else {
                    row.push(td.textContent.trim());
                }
            });
            rows.push(row);
        });

        // Convert to CSV
        const csvContent = rows.map(row =>
            row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
    }

    // Export table to Excel format (simplified XLSX)
    function exportTableToExcel(tableElement, fileName = 'table_export') {
        // Create a copy of the table
        const tableClone = tableElement.cloneNode(true);

        // Replace inputs with their values
        tableClone.querySelectorAll('input, select, textarea').forEach(input => {
            const value = input.type === 'checkbox' ? (input.checked ? 'Yes' : 'No') : input.value;
            const textNode = document.createTextNode(value);
            input.parentNode.replaceChild(textNode, input);
        });

        // Create HTML with Excel-specific formatting
        const html = `
            <html xmlns:o="urn:schemas-microsoft-com:office:office" 
                  xmlns:x="urn:schemas-microsoft-com:office:excel" 
                  xmlns="http://www.w3.org/TR/REC-html40">
            <head>
                <meta charset="utf-8">
                <style>
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid black; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; font-weight: bold; }
                </style>
            </head>
            <body>
                ${tableClone.outerHTML}
            </body>
            </html>
        `;

        const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${fileName}.xls`;
        link.click();
    }

    // Add column visibility toggle
    function addColumnVisibilityControls(tableElement) {
        const container = document.createElement('div');
        container.className = 'column-visibility-controls mb-2 p-2 bg-gray-100 rounded';
        container.innerHTML = '<span class="font-semibold mr-2">Show/Hide Columns:</span>';

        const headers = tableElement.querySelectorAll('thead th');
        headers.forEach((th, index) => {
            if (index > 0) { // Skip first column (usually parameter/label)
                const label = document.createElement('label');
                label.className = 'inline-flex items-center mr-3';
                label.innerHTML = `
                    <input type="checkbox" class="column-toggle mr-1" data-column="${index}" checked>
                    <span class="text-sm">${th.textContent.trim()}</span>
                `;
                container.appendChild(label);
            }
        });

        // Add event listeners
        container.querySelectorAll('.column-toggle').forEach(checkbox => {
            checkbox.addEventListener('change', function () {
                const columnIndex = parseInt(this.dataset.column);
                const display = this.checked ? '' : 'none';

                // Toggle header
                const header = headers[columnIndex];
                if (header) header.style.display = display;

                // Toggle cells
                tableElement.querySelectorAll(`tbody tr`).forEach(row => {
                    const cell = row.cells[columnIndex];
                    if (cell) cell.style.display = display;
                });
            });
        });

        // Insert before table
        tableElement.parentNode.insertBefore(container, tableElement);
    }

    // Add table filtering capability
    function addTableFilter(tableElement, searchableColumns = []) {
        const filterContainer = document.createElement('div');
        filterContainer.className = 'table-filter-container mb-2 p-2 bg-blue-50 rounded';
        filterContainer.innerHTML = `
            <div class="flex gap-2 items-center">
                <i class="fas fa-search text-gray-600"></i>
                <input type="text" class="table-filter-input input-field flex-1" placeholder="Search table...">
                <button type="button" class="clear-filter-btn bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600 text-sm">Clear</button>
            </div>
        `;

        const filterInput = filterContainer.querySelector('.table-filter-input');
        const clearBtn = filterContainer.querySelector('.clear-filter-btn');

        filterInput.addEventListener('input', function () {
            const searchText = this.value.toLowerCase();

            tableElement.querySelectorAll('tbody tr').forEach(row => {
                // Always show statistics rows (AVG, STD, Tare rows)
                const firstCell = row.cells[0];
                const isStatsRow = firstCell && (
                    firstCell.textContent.includes('AVG') ||
                    firstCell.textContent.includes('STD') ||
                    firstCell.textContent.includes('Tare') ||
                    firstCell.classList.contains('avg-field') ||
                    firstCell.classList.contains('std-field') ||
                    firstCell.classList.contains('tare1-field') ||
                    firstCell.classList.contains('tare2-field')
                );

                if (isStatsRow) {
                    row.style.display = ''; // Always show statistics rows
                    return;
                }

                let shouldShow = false;

                if (searchableColumns.length > 0) {
                    // Search only specified columns
                    searchableColumns.forEach(colIndex => {
                        const cell = row.cells[colIndex];
                        if (cell) {
                            const cellText = (cell.textContent || cell.innerText || '').toLowerCase();
                            const input = cell.querySelector('input, select');
                            const inputValue = input ? input.value.toLowerCase() : '';

                            if (cellText.includes(searchText) || inputValue.includes(searchText)) {
                                shouldShow = true;
                            }
                        }
                    });
                } else {
                    // Search all columns
                    row.querySelectorAll('td').forEach(cell => {
                        const cellText = (cell.textContent || cell.innerText || '').toLowerCase();
                        const input = cell.querySelector('input, select');
                        const inputValue = input ? input.value.toLowerCase() : '';

                        if (cellText.includes(searchText) || inputValue.includes(searchText)) {
                            shouldShow = true;
                        }
                    });
                }

                row.style.display = shouldShow || searchText === '' ? '' : 'none';
            });
        });

        clearBtn.addEventListener('click', function () {
            filterInput.value = '';
            filterInput.dispatchEvent(new Event('input'));
        });

        // Insert before table
        tableElement.parentNode.insertBefore(filterContainer, tableElement);
    }

    /**
     * Updates the visual numbering in the first column of the sample table rows.
     * @param {HTMLTableRowElement[]} dataRows - An array of the <tr> elements to renumber.
     */
    function updateSampleRowNumbers(dataRows) {
        dataRows.forEach((row, index) => {
            const firstCell = row.cells[0];
            if (firstCell) {
                firstCell.textContent = index + 1;
            }
        });
    }
    // Add sorting capability to table
    function addTableSorting(tableElement) {
        // Find the row that contains the time headers (e.g., 08:00, 09:00)
        const timeHeaderRow = tableElement.querySelector('thead tr[id^="time-headers-"]');
        if (!timeHeaderRow) return; // Exit if no time headers found

        const timeHeaders = timeHeaderRow.querySelectorAll('th');

        timeHeaders.forEach((header, headerIndex) => {
            header.style.cursor = 'pointer';
            const headerText = header.textContent.trim();
            // Add a container for text and icon to prevent layout shifts
            header.innerHTML = `
            <div class="flex items-center justify-center relative w-full">
                <span>${headerText}</span>
                <i class="fas fa-sort text-gray-400 text-xs absolute right-0"></i>
            </div>
        `;

            header.dataset.sortOrder = 'none'; // none -> asc -> desc

            header.addEventListener('click', function () {
                const dataColumnIndex = headerIndex + 1;
                let currentOrder = header.dataset.sortOrder;

                // Cycle the sort order
                if (currentOrder === 'none') {
                    currentOrder = 'asc';
                } else if (currentOrder === 'asc') {
                    currentOrder = 'desc';
                } else {
                    currentOrder = 'none';
                }
                header.dataset.sortOrder = currentOrder;

                // Reset icons on all other headers
                timeHeaders.forEach(otherHeader => {
                    if (otherHeader !== header) {
                        otherHeader.dataset.sortOrder = 'none';
                        const otherIcon = otherHeader.querySelector('i');
                        if (otherIcon) {
                            otherIcon.className = 'fas fa-sort text-gray-400 text-xs absolute right-0';
                        }
                    }
                });

                // Update the icon for the clicked header
                const icon = header.querySelector('i');
                if (currentOrder === 'asc') {
                    icon.className = 'fas fa-sort-up text-blue-400 text-xs absolute right-0';
                } else if (currentOrder === 'desc') {
                    icon.className = 'fas fa-sort-down text-blue-400 text-xs absolute right-0';
                } else {
                    icon.className = 'fas fa-sort text-gray-400 text-xs absolute right-0';
                }

                const tbody = tableElement.querySelector('tbody');
                const allRows = Array.from(tbody.rows);

                // Separate data rows from the fixed summary rows
                const dataRows = allRows.filter(row => {
                    const firstCellText = row.cells[0]?.textContent.trim().toUpperCase();
                    return !(firstCellText === 'AVG.' || firstCellText === 'STD.' || firstCellText.includes('TARE'));
                });
                const summaryRows = allRows.filter(row => !dataRows.includes(row));

                // Sort only the data rows
                dataRows.sort((a, b) => {
                    if (currentOrder === 'none') {
                        return allRows.indexOf(a) - allRows.indexOf(b);
                    }

                    const aCell = a.cells[dataColumnIndex];
                    const bCell = b.cells[dataColumnIndex];
                    if (!aCell || !bCell) return 0;

                    const aInput = aCell.querySelector('input');
                    const bInput = bCell.querySelector('input');

                    const aValue = aInput ? aInput.value.trim() : aCell.textContent.trim();
                    const bValue = bInput ? bInput.value.trim() : bCell.textContent.trim();

                    if (aValue === '' && bValue !== '') return 1;
                    if (aValue !== '' && bValue === '') return -1;
                    if (aValue === '' && bValue === '') return 0;

                    const aNum = parseFloat(aValue);
                    const bNum = parseFloat(bValue);
                    const sortFactor = currentOrder === 'asc' ? 1 : -1;

                    if (!isNaN(aNum) && !isNaN(bNum)) {
                        return (aNum - bNum) * sortFactor;
                    }
                    return aValue.localeCompare(bValue) * sortFactor;
                });

                // *** THE NEW FIX: Re-number the rows AFTER sorting them ***
                updateSampleRowNumbers(dataRows);

                // Re-assemble the table body with the correct order
                dataRows.forEach(row => tbody.appendChild(row));
                summaryRows.forEach(row => tbody.appendChild(row));
            });
        });
    }

    // Setup table enhancement features (export, column visibility, filtering, sorting)
    function setupTableEnhancements(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;

        const controlsContainer = document.getElementById(`${tableId}-controls`);

        // Export CSV button
        const exportCsvBtn = document.querySelector(`.export-csv-btn[data-table-id="${tableId}"]`);
        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => {
                const fileName = `${tableId}_${new Date().toISOString().split('T')[0]}.csv`;
                exportTableToCSV(table, fileName);
                showNotification('Table exported to CSV successfully', 'success');
            });
        }

        // Export Excel button
        const exportExcelBtn = document.querySelector(`.export-excel-btn[data-table-id="${tableId}"]`);
        if (exportExcelBtn) {
            exportExcelBtn.addEventListener('click', () => {
                const fileName = `${tableId}_${new Date().toISOString().split('T')[0]}`;
                exportTableToExcel(table, fileName);
                showNotification('Table exported to Excel successfully', 'success');
            });
        }


        // Toggle filter button
        const toggleFilterBtn = document.querySelector(`.toggle-filter-btn[data-table-id="${tableId}"]`);
        if (toggleFilterBtn) {
            toggleFilterBtn.addEventListener('click', () => {
                const existingFilter = controlsContainer.querySelector('.table-filter-container');
                if (existingFilter) {
                    existingFilter.remove();
                    toggleFilterBtn.classList.remove('bg-purple-800');
                    toggleFilterBtn.classList.add('bg-purple-600');
                } else {
                    if (controlsContainer) {
                        const filterControl = createTableFilter(table);
                        controlsContainer.appendChild(filterControl);
                        toggleFilterBtn.classList.remove('bg-purple-600');
                        toggleFilterBtn.classList.add('bg-purple-800');
                    }
                }
            });
        }

        // Add sorting to table headers only for sample tables
        // Check if this is a sample table
        const isSampleTable = tableId.includes('sample') ||
            table.querySelector('.sample-weight') ||
            table.querySelector('th')?.textContent?.includes('Sample');

        if (isSampleTable) {
            addTableSorting(table);
        }
    }

    // Create table filter element
    function createTableFilter(tableElement) {
        const filterContainer = document.createElement('div');
        filterContainer.className = 'table-filter-container mb-2 p-2 bg-blue-50 rounded';
        filterContainer.innerHTML = `
            <div class="flex gap-2 items-center">
                <i class="fas fa-search text-gray-600"></i>
                <input type="text" class="table-filter-input input-field flex-1" placeholder="Search table...">
                <button type="button" class="clear-filter-btn bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600 text-sm">Clear</button>
            </div>
        `;

        const filterInput = filterContainer.querySelector('.table-filter-input');
        const clearBtn = filterContainer.querySelector('.clear-filter-btn');

        filterInput.addEventListener('input', function () {
            const searchText = this.value.toLowerCase();

            tableElement.querySelectorAll('tbody tr').forEach(row => {
                // Always show statistics rows (AVG, STD, Tare rows)
                const firstCell = row.cells[0];
                const isStatsRow = firstCell && (
                    firstCell.textContent.includes('AVG') ||
                    firstCell.textContent.includes('STD') ||
                    firstCell.textContent.includes('Tare') ||
                    firstCell.classList.contains('avg-field') ||
                    firstCell.classList.contains('std-field') ||
                    firstCell.classList.contains('tare1-field') ||
                    firstCell.classList.contains('tare2-field')
                );

                if (isStatsRow) {
                    row.style.display = ''; // Always show statistics rows
                    return;
                }

                let shouldShow = false;

                row.querySelectorAll('td').forEach(cell => {
                    const cellText = (cell.textContent || cell.innerText || '').toLowerCase();
                    const input = cell.querySelector('input, select');
                    const inputValue = input ? input.value.toLowerCase() : '';

                    if (cellText.includes(searchText) || inputValue.includes(searchText)) {
                        shouldShow = true;
                    }
                });

                row.style.display = shouldShow || searchText === '' ? '' : 'none';
            });
        });

        clearBtn.addEventListener('click', function () {
            filterInput.value = '';
            filterInput.dispatchEvent(new Event('input'));
        });

        return filterContainer;
    }

    // Enhanced function to render recipe with material-specific date formatting
    function renderRecipe(recipeType, tableId, recipe) {
        const table = document.getElementById(tableId);
        if (!table) return;
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';

        if (recipe && recipe.length > 0) {
            recipe.forEach((item, index) => {
                const row = document.createElement('tr');

                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>
                        <div>${item.name}</div>
                    </td>
                    <td>${item.weight ? item.weight : '<input class="input-field" placeholder="Enter weight">'}</td>
                    <td><input class="input-field" placeholder="Batch number"></td>
                    <td>
                        <input class="input-field recipe-pro-date date-display" 
                               type="${item.dateFormat === 'mm/yyyy' ? 'month' : 'date'}" 
                               data-format="${item.dateFormat || 'dd/mm/yyyy'}"
                               data-shelf-life="${item.shelfLife || 0}">
                    </td>
                    <td>
                        <input class="input-field recipe-exp-date date-display" 
                               type="${item.dateFormat === 'mm/yyyy' ? 'month' : 'date'}" 
                               readonly>
                    </td>
                `;
                tbody.appendChild(row);

                // Add event listeners for production date to calculate expiry date
                const proDateInput = row.querySelector('.recipe-pro-date');
                const expDateInput = row.querySelector('.recipe-exp-date');

                proDateInput.addEventListener('change', function () {
                    if (this.value) {
                        const proDate = new Date(this.value);
                        const shelfLife = parseInt(this.getAttribute('data-shelf-life')) || 0;

                        if (shelfLife > 0) {
                            const expDate = new Date(proDate);
                            expDate.setMonth(expDate.getMonth() + shelfLife);

                            // Format based on material's date format setting
                            const selectedFormat = this.getAttribute('data-format');
                            if (selectedFormat === 'mm/yyyy') {
                                // For mm/yyyy format, we only need month and year
                                const month = (expDate.getMonth() + 1).toString().padStart(2, '0');
                                const year = expDate.getFullYear();
                                expDateInput.value = `${year}-${month}`;
                            } else {
                                // For dd/mm/yyyy format, use full date
                                const day = expDate.getDate().toString().padStart(2, '0');
                                const month = (expDate.getMonth() + 1).toString().padStart(2, '0');
                                const year = expDate.getFullYear();
                                expDateInput.value = `${year}-${month}-${day}`;
                            }
                        }
                    }
                });
            });
        }
    }

    function handleFileSelect(event, previewId) {
        const preview = document.getElementById(previewId);
        if (!preview) return;
        preview.innerHTML = '';
        const files = event.target.files;
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = function (e) {
                const box = document.createElement('div');
                box.classList.add('image-box');
                const img = document.createElement('img');
                img.src = e.target.result;
                img.classList.add('image-thumbnail');
                box.appendChild(img);
                preview.appendChild(box);
            };
            reader.readAsDataURL(file);
        }
    }

    function initializeImageUploads() {
        const boxUpload = document.getElementById('box-print-upload');
        const cartonUpload = document.getElementById('carton-print-upload');
        const wrappingUpload = document.getElementById('wrapping-machine-upload');

        if (boxUpload) boxUpload.addEventListener('change', (e) => handleFileSelect(e, 'box-print-preview'));
        if (cartonUpload) cartonUpload.addEventListener('change', (e) => handleFileSelect(e, 'carton-print-preview'));
        if (wrappingUpload) wrappingUpload.addEventListener('change', (e) => handleFileSelect(e, 'wrapping-machine-preview'));
    }

    // Live validation of all inputs/selects based on dataset ranges and value semantics
    function validateInputs() {
        // Validate regular min/max inputs
        document.querySelectorAll('input[data-min][data-max]').forEach(input => {
            const value = parseFloat(input.value);
            const min = parseFloat(input.dataset.min);
            const max = parseFloat(input.dataset.max);
            if (!isNaN(value) && (value < min || value > max)) {
                input.classList.add('out-of-range');
                input.classList.remove('in-range');
                input.style.backgroundColor = '#fee2e2'; // Light red background
            } else if (!isNaN(value) && (value >= min && value <= max)) {
                input.classList.add('in-range');
                input.classList.remove('out-of-range');
                input.style.backgroundColor = ''; // Clear background
            } else {
                input.classList.remove('in-range', 'out-of-range');
                input.style.backgroundColor = '';
            }
        });

        // Validate temperature inputs (keep numeric value, validate range)
        document.querySelectorAll('.temp-input').forEach(input => {
            const value = parseFloat(input.value);
            const min = parseFloat(input.dataset.min);
            const max = parseFloat(input.dataset.max);

            if (!isNaN(value)) {
                // Validate range if min/max are defined
                if (!isNaN(min) && !isNaN(max)) {
                    if (value < min || value > max) {
                        input.classList.add('out-of-range');
                        input.style.backgroundColor = '#fee2e2';
                        input.title = `Temperature must be between ${min}°C and ${max}°C`;
                    } else {
                        input.classList.remove('out-of-range');
                        input.classList.add('in-range');
                        input.style.backgroundColor = '#dcfce7';
                        input.title = `Valid temperature (${min}°C - ${max}°C)`;
                    }
                } else {
                    input.classList.remove('out-of-range', 'in-range');
                    input.style.backgroundColor = '';
                    input.title = 'Temperature in °C';
                }
            } else if (input.value !== '') {
                // Invalid number format
                input.classList.add('out-of-range');
                input.style.backgroundColor = '#fee2e2';
                input.title = 'Please enter a valid temperature number';
            } else {
                input.classList.remove('in-range', 'out-of-range');
                input.style.backgroundColor = '';
                input.title = 'Enter temperature in °C';
            }
        });

        // Validate percentage inputs
        document.querySelectorAll('.percent-input').forEach(input => {
            const value = parseFloat(input.value);
            const min = parseFloat(input.dataset.min) || 0;
            const max = parseFloat(input.dataset.max) || 100;
            if (!isNaN(value)) {
                if (value < min || value > max) {
                    input.classList.add('out-of-range');
                    input.style.backgroundColor = '#fee2e2';
                } else {
                    input.classList.remove('out-of-range');
                    input.style.backgroundColor = '';
                }
            }
        });

        // Validate STD fields against min/max STD limits
        document.querySelectorAll('.std-field').forEach(stdField => {
            const colIndex = stdField.dataset.col;
            const tbody = stdField.closest('tbody');
            const table = tbody.closest('table');

            // Calculate STD for this column
            const values = [];
            tbody.querySelectorAll(`tr`).forEach(row => {
                const cell = row.cells[parseInt(colIndex) + 2];
                if (cell && !row.classList.contains('bg-blue-50') && !row.classList.contains('bg-gray-50')) {
                    const input = cell.querySelector('input[type="number"]');
                    if (input && input.value) {
                        values.push(parseFloat(input.value));
                    }
                }
            });

            if (values.length > 0) {
                const mean = values.reduce((a, b) => a + b) / values.length;
                const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
                const std = Math.sqrt(variance);

                stdField.value = std.toFixed(2);

                // Check against STD limits if they exist in the product configuration
                // This would need to be enhanced with actual parameter STD limits
                const minStd = 0; // Would come from parameter.minStd
                const maxStd = 5; // Would come from parameter.maxStd

                if (std < minStd || std > maxStd) {
                    stdField.classList.add('out-of-range');
                    stdField.style.backgroundColor = '#fee2e2';
                } else {
                    stdField.classList.remove('out-of-range');
                    stdField.style.backgroundColor = '';
                }
            }
        });
    }

    function handleStopEvent(event) {
        if (event.target.value === 'REJECT' && event.target.name.includes('ccp')) {
            const timeCell = event.target.closest('td');
            const timeIndex = Array.from(timeCell.parentNode.children).indexOf(timeCell) - 2;
            const tableBody = event.target.closest('tbody');
            Array.from(tableBody.children).forEach(row => {
                const cell = row.children[timeIndex + 2];
                if (cell) {
                    cell.innerHTML = '<span class="rotate-text text-red-500 font-bold">STOPPED</span>';
                }
            });
        }
    }

    function saveForm() {
        try {
            const formData = {};
            let elementCount = 0;

            document.querySelectorAll('input, select, textarea').forEach(input => {
                try {
                    if (input.type === 'radio') {
                        if (input.checked) {
                            formData[input.name] = input.value;
                            elementCount++;
                        }
                    } else if (input.type === 'file') {
                        // Skip file inputs for local storage
                    } else {
                        formData[input.id || input.name] = input.value;
                        elementCount++;
                    }
                } catch (elementError) {
                    console.warn('Error processing form element:', input, elementError);
                }
            });

            if (elementCount === 0) {
                showNotification('No form data found to save.', 'warning');
                return;
            }

            try {
                localStorage.setItem('biscuitReportForm', JSON.stringify(formData));
            } catch (storageError) {
                throw new Error(`Failed to save form data: ${storageError.message}. This might be due to storage quota limits.`);
            }

            showNotification(`Form data saved successfully! (${elementCount} fields)`, 'success');

        } catch (error) {
            logError('Form Save Operation', error);
            showNotification(`Failed to save form data: ${error.message}`, 'error', 6000);
        }
    }

    function loadForm() {
        try {
            const savedData = localStorage.getItem('biscuitReportForm');
            if (!savedData) {
                showNotification('No saved data found.', 'info');
                return;
            }

            let formData;
            try {
                formData = JSON.parse(savedData);
            } catch (parseError) {
                throw new Error(`Failed to parse saved form data: ${parseError.message}. The saved data may be corrupted.`);
            }

            let loadedCount = 0;
            let errorCount = 0;

            for (const key in formData) {
                try {
                    const input = document.getElementById(key);
                    if (input) {
                        if (input.type === 'radio') {
                            const radioInput = document.querySelector(`input[name="${key}"][value="${formData[key]}"]`);
                            if (radioInput) {
                                radioInput.checked = true;
                                loadedCount++;
                            }
                        } else {
                            input.value = formData[key];
                            loadedCount++;
                        }
                    } else {
                        const inputByName = document.querySelector(`[name="${key}"]`);
                        if (inputByName && inputByName.type === 'radio') {
                            const radioInput = document.querySelector(`input[name="${key}"][value="${formData[key]}"]`);
                            if (radioInput) {
                                radioInput.checked = true;
                                loadedCount++;
                            }
                        }
                    }
                } catch (fieldError) {
                    console.warn(`Error loading field ${key}:`, fieldError);
                    errorCount++;
                }
            }

            if (loadedCount === 0) {
                showNotification('No matching form fields found for saved data.', 'warning');
            } else {
                const message = errorCount > 0 ?
                    `Form data loaded: ${loadedCount} fields restored, ${errorCount} fields had errors.` :
                    `Form data loaded successfully! (${loadedCount} fields restored)`;
                showNotification(message, errorCount > 0 ? 'warning' : 'success');
            }

        } catch (error) {
            logError('Form Load Operation', error);
            showNotification(`Failed to load form data: ${error.message}`, 'error', 6000);
        }
    }

    function resetForm() {
        if (confirm('Are you sure you want to reset the form? All unsaved data will be lost.')) {
            location.reload(); // Simple page reload to reset everything
            showNotification('Form has been reset.', 'success');
        }
    }

    // وظيفة طباعة محسنة
    function printForm() {
        // إظهار جميع الأقسام قبل الطباعة
        const allSections = document.querySelectorAll('.tab-content, .section-container, #dynamic-sections-container, #sections-container');
        allSections.forEach(section => {
            if (section) {
                section.style.display = 'block';
                section.style.visibility = 'visible';
                section.style.opacity = '1';
            }
        });

        // تأكد من تطبيق كلاسات الطباعة
        document.body.classList.add('printing');

        setTimeout(() => {
            window.print();
            document.body.classList.remove('printing');
        }, 500);
    }

    async function exportToPDF() {
        showNotification('Preparing PDF export...', 'success');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
            if (window.__applyArabicFontToDoc) { await window.__applyArabicFontToDoc(doc); }

        // Add title
        doc.setFontSize(18);
        writeTextSmart(doc,'Biscuit Quality Control Form', 105, 15, { align: 'center' });

        // أولاً، تأكد من إظهار جميع الأقسام
        const allSections = document.querySelectorAll('.tab-content, .section-container, #dynamic-sections-container, #sections-container');
        allSections.forEach(section => {
            if (section) {
                section.style.display = 'block';
                section.style.visibility = 'visible';
                section.style.opacity = '1';
            }
        });

        // إخفاء العناصر غير المرغوب فيها مؤقتاً
        const elementsToHide = document.querySelectorAll('.no-print, button, .btn, .bg-blue-600, .bg-green-600, .tab-buttons, #tab-buttons');
        elementsToHide.forEach(el => el.style.display = 'none');

        // Add form content - استخدم الحاوية الكاملة
        html2canvas(document.querySelector('#print-area') || document.querySelector('.max-w-full'), {
            useCORS: true,
            allowTaint: false,
            scale: 2,
            logging: false,
            width: document.querySelector('#print-area')?.scrollWidth || document.querySelector('.max-w-full')?.scrollWidth,
            height: document.querySelector('#print-area')?.scrollHeight || document.querySelector('.max-w-full')?.scrollHeight
        }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const imgWidth = 210; // A4 width in mm
            const pageHeight = 295; // A4 height in mm
            const imgHeight = canvas.height * imgWidth / canvas.width;
            let heightLeft = imgHeight;
            let position = 25;

            doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                doc.addPage();
                doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            doc.save('biscuit-quality-control-form.pdf');
            showNotification('PDF exported successfully!', 'success');

            // استعادة العناصر المخفية
            elementsToHide.forEach(el => el.style.display = '');
        }).catch(error => {
            console.error('Error generating PDF:', error);
            showNotification('Error generating PDF. Please try again.', 'error');
            // استعادة العناصر المخفية في حالة الخطأ أيضاً
            elementsToHide.forEach(el => el.style.display = '');
        });
    }

    // Enhanced PDF export with professional header/footer and full section coverage
    async function exportToPDFPro() {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            if (window.__applyArabicFontToDoc) { await window.__applyArabicFontToDoc(doc); }
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margins = { top: 28, bottom: 14, left: 10, right: 10 };
            let cursorY = margins.top;
            let insertedCriteriaAfterRaw = false; // inject 3-column criteria after specific section
            let insertedPackagingImages = false; // place packaging images once

            // Meta
            const productSel = document.getElementById('product-name');
            const productName = productSel && productSel.selectedOptions && productSel.selectedOptions[0] ? (productSel.selectedOptions[0].text || '-') : '-';
            const productId = productSel?.value || '';
            const selectedProduct = productId ? (products[productId] || null) : null;
            const reportDate = document.getElementById('report-date')?.value || '-';
            const batchNumber = document.getElementById('batch-number')?.value || '-';
            const shift = document.getElementById('shift')?.value || '-';
            const shiftDuration = document.getElementById('shift-duration')?.value || '-';
            const startInspection = document.getElementById('start-inspection-time')?.value || '-';

            // Helper: header on every page
            function drawHeaderFooter(pageNumber, totalPages) {
                // Header background band
                doc.setFillColor(245, 247, 252);
                doc.rect(0, 0, pageWidth, 18, 'F');

                // Left: Logo placeholder
                doc.setDrawColor(200);
                doc.rect(margins.left, 4, 28, 10);
                doc.setFontSize(9); doc.setTextColor(120); writeTextSmart(doc,'LOGO', margins.left + 8, 10);

                // Center: Title and product
                doc.setTextColor(20);
                doc.setFont(undefined, 'bold');
                doc.setFontSize(12);
                writeTextSmart(doc,'QUALITY CONTROL FORM', pageWidth / 2, 8, { align: 'center' });
                doc.setFont(undefined, 'normal');
                doc.setFontSize(9);
                writeTextSmart(doc,String(productName || '-'), pageWidth / 2, 13, { align: 'center' });

                // Right: meta
                doc.setFontSize(8);
                doc.setTextColor(60);
                const rightX = pageWidth - margins.right - 48;
                writeTextSmart(doc,`Batch: ${batchNumber}`, rightX, 6);
                writeTextSmart(doc,`Date: ${reportDate}`, rightX, 10);
                writeTextSmart(doc,`Page ${pageNumber} of ${totalPages || '-'}`, rightX, 14);

                // Controlled doc line
                const code = selectedProduct?.docCode || '-';
                const issueNo = selectedProduct?.issueNo || '-';
                const reviewNo = selectedProduct?.reviewNo || '-';
                const fmtDate = (d) => {
                    if (!d) return '-';
                    const dt = new Date(d);
                    if (!isNaN(dt)) return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
                    const parts = String(d).split('-');
                    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(d);
                };
                const issueDate = fmtDate(selectedProduct?.issueDate);
                const reviewDate = fmtDate(selectedProduct?.reviewDate);
                doc.setDrawColor(220);
                doc.setTextColor(100);
                doc.setFontSize(8);
                writeTextSmart(doc,`Form: ${code}  |  Issue: ${issueNo} (${issueDate})  |  Review: ${reviewNo} (${reviewDate})`, margins.left, 20);

                // Footer
                doc.setDrawColor(230);
                doc.line(margins.left, pageHeight - margins.bottom - 6, pageWidth - margins.right, pageHeight - margins.bottom - 6);
                doc.setFontSize(7); doc.setTextColor(120);
                writeTextSmart(doc,'Advanced Quality Control Form - Biscuit Manufacturing', pageWidth / 2, pageHeight - margins.bottom - 2, { align: 'center' });
            }

            // Ensure header for first page
            drawHeaderFooter(1, 1);

            // Helper: page management for non-table content
            function ensureSpace(h) {
                if (cursorY + h > pageHeight - margins.bottom) {
                    const current = doc.internal.getCurrentPageInfo().pageNumber;
                    doc.addPage();
                    const total = doc.internal.getNumberOfPages();
                    drawHeaderFooter(current + 1, total);
                    cursorY = margins.top;
                }
            }

            function addSectionTitle(title) {
                if (!title) return;
                ensureSpace(8);
                doc.setFontSize(11);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(30);
                writeTextSmart(doc,title, margins.left, cursorY);
                doc.setFont(undefined, 'normal');
                cursorY += 6;
            }

            function addKeyValueTable(rows) {
                if (!rows || !rows.length) return;
                doc.autoTable({
                    startY: cursorY,
                    margin: { left: margins.left, right: margins.right, top: margins.top },
                    theme: 'grid',
                    head: [['Field', 'Value']],
                    body: rows,
                    styles: { fontSize: 8, cellPadding: 2, halign: 'left', valign: 'middle' },
                    headStyles: { fillColor: [229, 231, 235], textColor: [31, 41, 55], fontStyle: 'bold' },
                    columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 'auto' } },
                    didDrawPage: (data) => {
                        const total = doc.internal.getNumberOfPages();
                        drawHeaderFooter(data.pageNumber, total);
                    }
                });
                cursorY = (doc.lastAutoTable?.finalY || cursorY) + 6;
            }

            function drawTablesFromDOM(tables) {
                tables.forEach(tbl => {
                    // Skip tables with export buttons
                    const hasExportButtons = tbl.querySelector('.export-csv-btn, .export-excel-btn, .filter-btn, button[class*="export"], button[class*="filter"]');
                    if (hasExportButtons) return;

                    // Derive titles
                    const sectionTitle = tbl.closest('div[id^="section-"]')?.querySelector('h2.section-header')?.innerText?.trim() || '';
                    const wrapper = tbl.closest('.mb-4');
                    let tableTitle = '';
                    if (wrapper) {
                        const h3 = wrapper.querySelector('h3');
                        if (h3) {
                            tableTitle = h3.innerText.trim()
                                .replace(/Export CSV.*$/i, '')
                                .replace(/Export Excel.*$/i, '')
                                .replace(/Filter.*$/i, '')
                                .replace(/Stop.*$/i, '')
                                .trim();
                        }
                    }
                    const titleLine = [sectionTitle, tableTitle].filter(Boolean).join(' — ');
                    if (titleLine) addSectionTitle(titleLine);

                    // Clone and convert inputs to text
                    const clone = tbl.cloneNode(true);
                    clone.querySelectorAll('button, .export-csv-btn, .export-excel-btn, .filter-btn, .stop-btn').forEach(btn => btn.remove());
                    clone.querySelectorAll('td, th').forEach(cell => {
                        if (/Export CSV|Export Excel|Filter|Stop/i.test(cell.textContent)) cell.textContent = '';
                    });
                    clone.querySelectorAll('td').forEach(td => {
                        const inputs = td.querySelectorAll('input, select, textarea');
                        if (inputs.length) {
                            const vals = [];
                            inputs.forEach(el => {
                                if (el.tagName === 'SELECT') {
                                    const opt = el.selectedOptions && el.selectedOptions[0];
                                    if (opt) vals.push(opt.text.trim());
                                } else if (el.type === 'checkbox') {
                                    vals.push(el.checked ? '✓' : '✗');
                                } else if (el.type === 'radio') {
                                    if (el.checked) vals.push(el.value);
                                } else {
                                    const v = (el.value || '').toString().trim();
                                    if (v) vals.push(v);
                                }
                            });
                            td.textContent = vals.length ? vals.join(' / ') : '-';
                        }
                        if (td.textContent.trim() === '') td.textContent = '-';
                    });

                    // Render table
                    doc.autoTable({
                        html: clone,
                        startY: cursorY,
                        margin: { left: margins.left, right: margins.right, top: margins.top },
                        theme: 'grid',
                        styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle', lineColor: [200, 200, 200], lineWidth: 0.1 },
                        headStyles: { fillColor: [243, 244, 246], textColor: [31, 41, 55], fontStyle: 'bold' },
                        bodyStyles: { textColor: [31, 41, 55], halign: 'center' },
                        columnStyles: { 0: { halign: 'left' } },
                        didDrawPage: (data) => {
                            const total = doc.internal.getNumberOfPages();
                            drawHeaderFooter(data.pageNumber, total);
                        },
                        didParseCell: (data) => {
                            if (!data.cell || !data.cell.text) return;
                            const t = (data.cell.text[0] || '').toString().toUpperCase();
                            // Color statuses
                            if (/(ACCEPTED|PASS|OK)/.test(t)) {
                                data.cell.styles.textColor = [34, 197, 94];
                                data.cell.styles.fontStyle = 'bold';
                                data.cell.styles.fillColor = [230, 255, 240];
                            } else if (/(REJECTED|FAIL|NOT OK|STOP|STOPPED)/.test(t)) {
                                data.cell.styles.textColor = [239, 68, 68];
                                data.cell.styles.fontStyle = 'bold';
                                data.cell.styles.fillColor = [255, 235, 235];
                            } else if (/^A$/.test(t)) {
                                data.cell.styles.textColor = [21, 128, 61];
                            } else if (/^B$/.test(t)) {
                                data.cell.styles.textColor = [202, 138, 4];
                                data.cell.styles.fillColor = [255, 251, 235];
                            } else if (/^C$/.test(t)) {
                                data.cell.styles.textColor = [185, 28, 28];
                                data.cell.styles.fontStyle = 'bold';
                                data.cell.styles.fillColor = [254, 226, 226];
                            }
                        }
                    });

                    const prevY = (doc.lastAutoTable?.finalY || cursorY);
                    cursorY = prevY + 4;

                    // Render per-table notes directly under the table if present (DOM -> PDF)
                    try {
                        let notesBlock = tbl.nextElementSibling;
                        // Search forward a few siblings until next table
                        let hops = 0;
                        while (notesBlock && !(notesBlock.classList && notesBlock.classList.contains('table-notes-block')) && notesBlock.tagName !== 'TABLE' && hops < 6) {
                            notesBlock = notesBlock.nextElementSibling;
                            hops++;
                        }
                        if (notesBlock && notesBlock.classList && notesBlock.classList.contains('table-notes-block')) {
                            const ta = notesBlock.querySelector('textarea');
                            const noteText = (ta && typeof ta.value === 'string' ? ta.value : (notesBlock.textContent || '')).trim();
                            if (noteText) {
                                const availableWidth = pageWidth - margins.left - margins.right;
                                const lines = doc.splitTextToSize(noteText, availableWidth);
                                ensureSpace(lines.length * 4 + 6);
                                doc.setFontSize(9); doc.setFont(undefined, 'bold'); doc.setTextColor(30);
                                writeTextSmart(doc,'Notes', margins.left, cursorY);
                                cursorY += 5;
                                doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(60);
                                writeTextSmart(doc,lines, margins.left, cursorY);
                                cursorY += lines.length * 4 + 6;
                            }
                        }
                    } catch (e) { /* ignore notes render errors */ }

                    cursorY += 5;

                    // Inject 3-column criteria after the RAW MATERIAL PREPARATION & INITIAL VERIFICATION — Biscuit Ingredients WITH Cocoa section
                    if (!insertedCriteriaAfterRaw) {
                        const secU = (sectionTitle || '').toUpperCase();
                        const tblU = (tableTitle || '').toUpperCase();
                        const titleU = (titleLine || '').toUpperCase();
                        const secMatch = secU.includes('RAW MATERIAL PREPARATION') && secU.includes('INITIAL VERIFICATION');
                        const isIngredientsTable = tblU.includes('INGREDIENTS') || tblU.includes('BISCUIT INGREDIENTS') || titleU.includes('INGREDIENTS');
                        const isCreamTable = tblU.includes('CREAM') || titleU.includes('CREAM');
                        // Check if this is the last ingredients-related table
                        const isLastIngredientsTable = (
                            // If it's cream table, it's likely the last
                            isCreamTable ||
                            // If it's WITHOUT COCOA table and no cream recipe exists
                            (tblU.includes('WITHOUT COCOA') && selectedProduct && !selectedProduct.has_cream) ||
                            // If it's WITH COCOA table and product doesn't have without-cocoa or cream
                            (tblU.includes('WITH COCOA') && selectedProduct &&
                                selectedProduct.ingredients_type === 'with-cocoa' && !selectedProduct.has_cream)
                        );
                        if (secMatch && isIngredientsTable && isLastIngredientsTable) {
                            const ok = addThreeQualityCriteriaBlock();
                            insertedCriteriaAfterRaw = ok || insertedCriteriaAfterRaw;
                            if (!insertedPackagingImages) {
                                const hadImages = addPackagingImages();
                                insertedPackagingImages = hadImages || insertedPackagingImages;
                            }
                        }
                    }
                });
            }

            function addPackagingImages() {
                const containers = [
                    { id: 'box-print-preview', title: 'Box Print' },
                    { id: 'carton-print-preview', title: 'Carton Print' },
                    { id: 'wrapping-machine-preview', title: 'Wrapping Machine' }
                ];
                let any = false;
                containers.forEach(({ id, title }) => {
                    const wrap = document.getElementById(id);
                    if (!wrap) return;
                    const imgs = wrap.querySelectorAll('img');
                    if (!imgs.length) return;
                    any = true;
                    addSectionTitle(`Packaging Print Images — ${title}`);
                    const colW = (pageWidth - margins.left - margins.right - 6) / 2; // 2 columns grid
                    const rowH = colW * 0.6;
                    let x = margins.left, y = cursorY;
                    imgs.forEach((img, idx) => {
                        ensureSpace(rowH + 6);
                        try {
                            const src = img.src;
                            if (src && src.startsWith('data:')) {
                                doc.addImage(src, 'PNG', x, y, colW, rowH);
                            } else {
                                // draw placeholder if not data URL
                                doc.setDrawColor(180); doc.rect(x, y, colW, rowH);
                                doc.setFontSize(8); writeTextSmart(doc,'Image', x + 4, y + 6);
                            }
                        } catch (e) {
                            doc.setDrawColor(180); doc.rect(x, y, colW, rowH);
                            doc.setFontSize(8); writeTextSmart(doc,'Image error', x + 4, y + 6);
                        }
                        if (x + colW * 2 + 6 <= pageWidth - margins.right) {
                            x += colW + 6;
                        } else {
                            x = margins.left; y += rowH + 6; cursorY = y;
                        }
                    });
                    cursorY = y + rowH + 8;
                });
                return any;
            }

            function addQualityCriteriaFromProduct() {
                if (!selectedProduct || !Array.isArray(selectedProduct.qualityCriteria) || !selectedProduct.qualityCriteria.length) return false;
                addSectionTitle('QUALITY EVALUATION CRITERIA & STANDARDS');
                const colorMap = {
                    green: { fill: [220, 252, 231], text: [6, 95, 70] },
                    yellow: { fill: [254, 243, 199], text: [146, 64, 14] },
                    red: { fill: [254, 226, 226], text: [153, 27, 27] },
                    blue: { fill: [219, 234, 254], text: [30, 64, 175] }
                };
                const cardsPerRow = Math.min(selectedProduct.qualityCriteria.length, 2);
                const cardW = (pageWidth - margins.left - margins.right - (cardsPerRow - 1) * 6) / cardsPerRow;
                const cardHMin = 24;
                let x = margins.left, y = cursorY;
                selectedProduct.qualityCriteria.forEach((criteria, idx) => {
                    const style = colorMap[criteria.color] || colorMap.green;
                    const items = Array.isArray(criteria.items) ? criteria.items : [];
                    // Measure items height (approx)
                    const textLines = items.map(it => `${it.label || ''} ${it.value || ''}`);
                    const linesCount = textLines.length;
                    const estH = 8 + 5 + linesCount * 4 + 6; // padding + title + items + padding
                    const cardH = Math.max(cardHMin, estH);
                    ensureSpace(cardH + 6);
                    // Card background
                    doc.setFillColor(...style.fill);
                    doc.rect(x, y, cardW, cardH, 'F');
                    // Title
                    doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(...style.text);
                    writeTextSmart(doc,String(criteria.title || ''), x + 3, y + 6);
                    // Items
                    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(40);
                    let ly = y + 12;
                    items.forEach(it => {
                        const line = `${it.label ? it.label + ': ' : ''}${it.value || ''}`;
                        writeTextSmart(doc,line, x + 3, ly);
                        ly += 4;
                    });
                    // Next position
                    if ((idx + 1) % cardsPerRow === 0) {
                        x = margins.left; y += cardH + 6; cursorY = y;
                    } else {
                        x += cardW + 6;
                    }
                });
                cursorY = Math.max(cursorY, y + 28);
                return true;
            }

            function addSignatureRow(container, signature = null) {
                const sigRow = document.createElement('div');
                sigRow.className = 'signature-row flex items-center gap-2 mb-2 p-2 border border-gray-200 rounded';
                sigRow.innerHTML = `
            <input type="text" class="input-field signature-label flex-1" placeholder="Signature Label (e.g., Quality Engineer)" value="${signature ? (signature.label || '') : ''}">
            <button type="button" class="remove-signature-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"><i class="fas fa-trash"></i></button>
        `;
                container.appendChild(sigRow);

                sigRow.querySelector('.remove-signature-btn').addEventListener('click', () => {
                    sigRow.remove();
                });
            }


            function addThreeQualityCriteriaBlock() {
                if (!selectedProduct || !Array.isArray(selectedProduct.qualityCriteria) || !selectedProduct.qualityCriteria.length) return false;
                // Take first three criteria only
                const three = selectedProduct.qualityCriteria.slice(0, 3);
                if (!three.length) return false;
                addSectionTitle('QUALITY EVALUATION CRITERIA & STANDARDS');
                const colorMap = {
                    green: { fill: [220, 252, 231], text: [6, 95, 70] },
                    yellow: { fill: [254, 243, 199], text: [146, 64, 14] },
                    red: { fill: [254, 226, 226], text: [153, 27, 27] },
                    blue: { fill: [219, 234, 254], text: [30, 64, 175] }
                };
                const gap = 6;
                const colW = (pageWidth - margins.left - margins.right - gap * 2) / 3; // 3 columns
                // Estimate heights and get max height for the row
                const estHeights = three.map(c => {
                    const items = Array.isArray(c.items) ? c.items : [];
                    const linesCount = items.length;
                    const estH = 8 + 5 + linesCount * 4 + 6; // padding + title + items + padding
                    return Math.max(24, estH);
                });
                const cardH = Math.max(...estHeights);
                ensureSpace(cardH + 6);
                let x = margins.left;
                const y = cursorY;
                three.forEach((criteria, idx) => {
                    const style = colorMap[criteria.color] || colorMap.green;
                    // Card background
                    doc.setFillColor(...style.fill);
                    doc.rect(x, y, colW, cardH, 'F');
                    // Title
                    doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(...style.text);
                    writeTextSmart(doc,String(criteria.title || ''), x + 3, y + 6);
                    // Items
                    doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(40);
                    let ly = y + 12;
                    const items = Array.isArray(criteria.items) ? criteria.items : [];
                    items.forEach(it => {
                        const line = `${it.label ? it.label + ': ' : ''}${it.value || ''}`;
                        writeTextSmart(doc,line, x + 3, ly);
                        ly += 4;
                    });
                    x += colW + gap;
                });
                cursorY = y + cardH + 8;
                return true;
            }

            function addRejectionCriteriaBlocks() {
                // Convert visible rejection criteria blocks into key/value tables
                const blocks = document.querySelectorAll('.rejection-criteria');
                blocks.forEach((blk, i) => {
                    const tableId = blk.closest('div[id^="section-"]')?.querySelector('table.form-table')?.id || '';
                    const rows = [];
                    blk.querySelectorAll('label').forEach(label => {
                        const text = label.textContent.replace(/[:\s]+$/, '').trim();
                        const input = label.parentElement?.querySelector('input, select, textarea');
                        let val = '-';
                        if (input) {
                            if (input.tagName === 'SELECT') {
                                const opt = input.selectedOptions && input.selectedOptions[0];
                                val = opt ? opt.text.trim() : (input.value || '-');
                            } else {
                                val = input.value || '-';
                            }
                        }
                        if (text) rows.push([text, val]);
                    });
                    if (rows.length) {
                        addSectionTitle(`Rejection Criteria${tableId ? ' — ' + tableId : ''}`);
                        addKeyValueTable(rows);
                    }
                });
            }

            function addSignatureBlock() {
                // Dynamic signatures from product configuration
                function findSignatureFieldValue(kind, label) {
                    const key = (label || '').toLowerCase();
                    const roleKey = key.replace(/[^a-z0-9]+/g, '-');
                    const candidates = [];
                    const aliasMap = {
                        'quality engineer': 'qa',
                        'qa': 'qa',
                        'production engineer': 'prod',
                        'production supervisor': 'prod',
                        'quality manager': 'qm',
                    };
                    if (kind === 'name') {
                        candidates.push(`#${roleKey}-sig-name`, `#${roleKey}-name`, `[data-signature-role="${roleKey}"] .signature-name`);
                    } else {
                        candidates.push(`#${roleKey}-sig-date`, `#${roleKey}-date`, `[data-signature-role="${roleKey}"] .signature-date`);
                    }
                    const alias = aliasMap[key];
                    if (alias) {
                        if (kind === 'name') {
                            candidates.push(`#${alias}-sig-name`, `#${alias}-name`);
                        } else {
                            candidates.push(`#${alias}-sig-date`, `#${alias}-date`);
                        }
                    }
                    for (const sel of candidates) {
                        const el = document.querySelector(sel);
                        if (el) {
                            const val = 'value' in el ? el.value : el.textContent;
                            if (val && String(val).trim()) return String(val).trim();
                        }
                    }
                    return '';
                }

                let signatures = [];
                try {
                    if (typeof window.getProductSignatures === 'function') {
                        const productSel = document.getElementById('product-name');
                        const productId = productSel?.value || '';
                        signatures = window.getProductSignatures(productId) || window.getProductSignatures() || [];
                    } else if (window.SignatureManager && typeof window.SignatureManager.getSignaturesForProduct === 'function') {
                        const productSel = document.getElementById('product-name');
                        const productId = productSel?.value || '';
                        signatures = window.SignatureManager.getSignaturesForProduct(productId) || [];
                    }
                } catch (e) { console.warn('Signature config fetch failed:', e); }

                if (!Array.isArray(signatures) || signatures.length === 0) {
                    signatures = [
                        { label: 'Quality Engineer Signature', role: 'quality engineer', order: 1, visible: true, showName: true, showDate: true },
                        { label: 'Production Supervisor Signature', role: 'production supervisor', order: 2, visible: true, showName: true, showDate: true },
                        { label: 'Quality Manager Signature', role: 'quality manager', order: 3, visible: true, showName: true, showDate: true },
                    ];
                }

                const visible = signatures.filter(s => s && s.visible !== false).sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
                if (visible.length === 0) return;

                addSectionTitle('Signatures');
                const rows = visible.map(sig => {
                    const label = sig.label || sig.role || 'Signature';
                    const parts = [];
                    if (sig.showName !== false) parts.push('Name: ' + (findSignatureFieldValue('name', label) || ''));
                    if (sig.showDate !== false) parts.push('Date: ' + (findSignatureFieldValue('date', label) || ''));
                    return [label, parts.join('    ')];
                });
                addKeyValueTable(rows);
            }

            // Process content
            const formRoot = document.getElementById('form-tab') || document.body;

            // 1) Quality Criteria (structured)
            // addQualityCriteriaFromProduct(); // moved to appear after the RAW MATERIAL PREPARATION section as 3 columns

            // 2) All tables in order of appearance
            const tables = formRoot.querySelectorAll('table.form-table');
            drawTablesFromDOM(tables);

            // Fallback: if specific RAW section was not found, still place the 3-column criteria here
            if (!insertedCriteriaAfterRaw) {
                const ok = addThreeQualityCriteriaBlock();
                insertedCriteriaAfterRaw = ok || insertedCriteriaAfterRaw;
            }

            // 3) Rejection criteria key/value
            addRejectionCriteriaBlocks();

            // 4) Packaging images grid
            if (!insertedPackagingImages) { addPackagingImages(); }

            // 5) Product notes
            const notesWrap = document.getElementById('product-notes-display');
            const notesText = notesWrap ? (notesWrap.textContent || '').trim() : '';
            if (notesText) {
                addSectionTitle('PRODUCT NOTES');
                const lines = doc.splitTextToSize(notesText, pageWidth - margins.left - margins.right);
                ensureSpace(lines.length * 4 + 4);
                doc.setFontSize(9);
                writeTextSmart(doc,lines, margins.left, cursorY);
                cursorY += lines.length * 4 + 6;
            }

            // 6) Signatures
            //addSignatureBlock();

            // Finalize page numbers in headers
            const totalPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                drawHeaderFooter(i, totalPages);
            }

            // File name
            const safeProduct = (productName || 'report').replace(/[^a-z0-9\-]+/gi, '_');
            const fileName = `${safeProduct}_${batchNumber || 'batch'}_${reportDate || ''}.pdf`;
            doc.save(fileName);
            showNotification('PDF exported successfully!', 'success');
        } catch (e) {
            console.error('PDF export error:', e);
            showNotification('PDF export failed: ' + e.message, 'error');
        }
    }

    async function exportToPDFProfessional() {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            if (window.__applyArabicFontToDoc) { await window.__applyArabicFontToDoc(doc); }
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();

            // --- 1. إعدادات التصميم والألوان ---
            const FONT_NORMAL = (window.__ARABIC_FONT_NAME || 'Amiri');
            const FONT_BOLD = (window.__ARABIC_FONT_NAME || 'Amiri');
            const COLOR_PRIMARY = '#0B3A8A';
            const COLOR_SECONDARY = '#1E40AF';
            const COLOR_TEXT = '#374151';
            const COLOR_LIGHT_GRAY = '#F3F4F6';
            const MARGINS = { top: 32, bottom: 20, left: 12, right: 12 };
            let cursorY = MARGINS.top;

            // --- 2. جمع البيانات من النموذج ---
            const productSel = document.getElementById('product-name');
            const productName = productSel?.selectedOptions?.[0]?.text || '-';
            const productId = productSel?.value || '';
            const selectedProduct = productId ? (products[productId] || null) : null;
            const reportDate = document.getElementById('report-date')?.value || '-';
            const batchNumber = document.getElementById('batch-number-display')?.textContent || document.getElementById('batch-number')?.value || '-';
            const shift = document.getElementById('shift')?.value || '-';
            const shiftDuration = document.getElementById('shift-duration')?.value || '-';

            // --- 3. دالة لرسم رأس وتذييل الصفحة ---
            function drawHeaderFooter() {
                const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
                const totalPages = doc.internal.getNumberOfPages();
                doc.setFillColor(COLOR_PRIMARY);
                doc.rect(0, 0, pageWidth, 22, 'F');
                // Add company logo if available
                if (window.LogoManager && window.LogoManager.hasLogo()) {
                    const logoData = window.LogoManager.getLogo();
                    if (logoData.src) {
                        try {
                            // Add logo image with white background
                            doc.setFillColor('#FFFFFF');
                            doc.rect(MARGINS.left, 5, 30, 12, 'F');
                            doc.addImage(logoData.src, 'PNG', MARGINS.left + 2, 6, 26, 10, undefined, 'FAST');
                        } catch (e) {
                            // Fallback to text if image fails
                            doc.setFillColor('#FFFFFF');
                            doc.rect(MARGINS.left, 5, 30, 12, 'F');
                            doc.setFont(FONT_BOLD);
                            doc.setFontSize(12);
                            doc.setTextColor(COLOR_PRIMARY);
                            writeTextSmart(doc,'LOGO', MARGINS.left + 8, 13);
                        }
                    } else {
                        // No logo src, show text placeholder
                        doc.setFillColor('#FFFFFF');
                        doc.rect(MARGINS.left, 5, 30, 12, 'F');
                        doc.setFont(FONT_BOLD);
                        doc.setFontSize(12);
                        doc.setTextColor(COLOR_PRIMARY);
                        writeTextSmart(doc,'LOGO', MARGINS.left + 8, 13);
                    }
                } else {
                    // No logo manager, show text placeholder
                    doc.setFillColor('#FFFFFF');
                    doc.rect(MARGINS.left, 5, 30, 12, 'F');
                    doc.setFont(FONT_BOLD);
                    doc.setFontSize(12);
                    doc.setTextColor(COLOR_PRIMARY);
                    writeTextSmart(doc,'LOGO', MARGINS.left + 8, 13);
                }
                doc.setFont(FONT_BOLD);
                doc.setFontSize(14);
                doc.setTextColor('#FFFFFF');
                writeTextSmart(doc,'QUALITY CONTROL REPORT', pageWidth / 2, 11, { align: 'center' });
                doc.setFontSize(10);
                doc.setFont(FONT_NORMAL);
                writeTextSmart(doc,'Biscuit Manufacturing Department', pageWidth / 2, 17, { align: 'center' });
                doc.setDrawColor(COLOR_SECONDARY);
                doc.line(MARGINS.left, pageHeight - MARGINS.bottom + 5, pageWidth - MARGINS.right, pageHeight - MARGINS.bottom + 5);
                const code = selectedProduct?.docCode || '-';
                const issueNo = selectedProduct?.issueNo || '-';
                const reviewNo = selectedProduct?.reviewNo || '-';
                const fmtDate = (d) => {
                    if (!d) return '-';
                    try {
                        const dt = new Date(d);
                        const day = String(dt.getDate()).padStart(2, '0');
                        const month = String(dt.getMonth() + 1).padStart(2, '0');
                        const year = dt.getFullYear();
                        return `${day}/${month}/${year}`;
                    } catch (e) { return d; }
                };
                const issueDate = fmtDate(selectedProduct?.issueDate);
                const reviewDate = fmtDate(selectedProduct?.reviewDate);
                doc.setFontSize(8);
                doc.setTextColor(COLOR_TEXT);
                let footerText = `Form: ${code} | Issue No: ${issueNo} (${issueDate}) | Review No: ${reviewNo} (${reviewDate})`;
                writeTextSmart(doc,footerText, MARGINS.left, pageHeight - MARGINS.bottom + 10);
                const pageStr = `Page ${pageNumber} of ${totalPages}`;
                writeTextSmart(doc,pageStr, pageWidth - MARGINS.right, pageHeight - MARGINS.bottom + 10, { align: 'right' });
            }

            // --- 4. دوال مساعدة لرسم المحتوى ---
            function addSectionTitle(title) {
                if (cursorY + 12 > pageHeight - MARGINS.bottom) addPage();
                doc.setFont(FONT_BOLD);
                doc.setFontSize(12);
                doc.setTextColor(COLOR_PRIMARY);
                writeTextSmart(doc,title.toUpperCase(), MARGINS.left, cursorY);
                doc.setDrawColor(COLOR_SECONDARY);
                doc.line(MARGINS.left, cursorY + 2, pageWidth - MARGINS.right, cursorY + 2);
                cursorY += 8;
            }

            function addPage() {
                doc.addPage();
                cursorY = MARGINS.top;
            }

            // --- 5. بناء محتوى PDF ---
            drawHeaderFooter();

            addSectionTitle('Report Summary');
            doc.autoTable({
                startY: cursorY,
                margin: MARGINS,
                body: [
                    ['Product Name:', productName],
                    ['Batch Number:', batchNumber],
                    ['Production Date:', reportDate],
                    ['Shift:', `Shift ${shift} (${shiftDuration} hours)`],
                ],
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 2, textColor: COLOR_TEXT, lineColor: '#E5E7EB' },
                headStyles: { fillColor: COLOR_LIGHT_GRAY, textColor: COLOR_PRIMARY, fontStyle: 'bold' },
                columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
                didDrawPage: (data) => {
                    drawHeaderFooter();
                }
            });
            cursorY = doc.lastAutoTable.finalY + 10;

            if (selectedProduct && selectedProduct.qualityCriteria) {
                addSectionTitle('Quality Evaluation Criteria');
                const criteria = selectedProduct.qualityCriteria.slice(0, 3);
                const cardWidth = (pageWidth - MARGINS.left - MARGINS.right - (criteria.length - 1) * 5) / criteria.length;
                let cardX = MARGINS.left;
                const colorMap = {
                    green: { bg: '#EBFBF4', border: '#10B981', text: '#065F46' },
                    yellow: { bg: '#FFFBEB', border: '#F59E0B', text: '#92400E' },
                    red: { bg: '#FEF2F2', border: '#EF4444', text: '#991B1B' }
                };
                let maxHeight = 0;
                criteria.forEach(c => {
                    const titleLines = doc.splitTextToSize(c.title, cardWidth - 10);
                    const itemLines = c.items.map(item => doc.splitTextToSize(`${item.label} ${item.value}`, cardWidth - 10));
                    const height = titleLines.length * 5 + itemLines.flat().length * 4 + 15;
                    if (height > maxHeight) maxHeight = height;
                });
                if (cursorY + maxHeight > pageHeight - MARGINS.bottom) addPage();
                criteria.forEach(c => {
                    const colors = colorMap[c.color] || colorMap.green;
                    doc.setFillColor(colors.bg);
                    doc.setDrawColor(colors.border);
                    doc.rect(cardX, cursorY, cardWidth, maxHeight, 'FD');
                    doc.setFont(FONT_BOLD);
                    doc.setFontSize(10);
                    doc.setTextColor(colors.text);
                    writeTextSmart(doc,c.title, cardX + 5, cursorY + 8);
                    let itemY = cursorY + 16;
                    doc.setFont(FONT_NORMAL);
                    doc.setFontSize(8);
                    doc.setTextColor(COLOR_TEXT);
                    c.items.forEach(item => {
                        const lines = doc.splitTextToSize(`- ${item.label} ${item.value}`, cardWidth - 10);
                        writeTextSmart(doc,lines, cardX + 5, itemY);
                        itemY += lines.length * 4;
                    });
                    cardX += cardWidth + 5;
                });
                cursorY += maxHeight + 10;
            }

            const formRoot = document.getElementById('form-tab') || document.body;
            formRoot.querySelectorAll('.section-header').forEach(header => {
                const section = header.parentElement;

                if (header.innerText.trim().toUpperCase().includes('QUALITY EVALUATION CRITERIA')) {
                    return;
                }

                addSectionTitle(header.innerText.trim());

                section.querySelectorAll('table.form-table').forEach(table => {
                    const clone = table.cloneNode(true);
                    clone.querySelectorAll('button, .no-print').forEach(el => el.remove());

                    clone.querySelectorAll('td, th').forEach(cell => {
                        const isStopped = cell.querySelector('.stop-overlay');
                        if (isStopped) {
                            cell.textContent = 'STOPPED';
                        } else {
                            const input = cell.querySelector('input, select');
                            if (input) {
                                if (input.type === 'radio' || input.type === 'checkbox') {
                                    cell.textContent = input.checked ? '✓' : '';
                                } else if (input.tagName === 'SELECT') {
                                    cell.textContent = input.selectedOptions[0]?.text || '';
                                } else {
                                    cell.textContent = input.value;
                                }
                            }
                        }
                        if (cell.textContent.trim() === '') cell.textContent = '-';
                    });

                    // ================= START OF THE NEW FIX V2 =================
                    // More intelligent column width calculation
                    const head = clone.querySelector('thead');
                    const firstHeadRow = head ? head.rows[0] : null;
                    const numColumns = firstHeadRow ? firstHeadRow.cells.length : 0;

                    const columnStyles = {};
                    const isSampleTable = table.id.includes('sample') || table.querySelector('.sample-weight');

                    if (isSampleTable && numColumns > 1) {
                        // For Sample tables: tiny first column, rest are auto
                        columnStyles[0] = { cellWidth: 12 }; // Small width for sample number
                        for (let i = 1; i < numColumns; i++) {
                            columnStyles[i] = { cellWidth: 'auto' };
                        }
                    } else if (!isSampleTable && numColumns > 2) {
                        // For Parameter tables: proportional widths
                        // Use percentages to make it flexible
                        columnStyles[0] = { cellWidth: '35%', halign: 'left' }; // Parameter Name
                        columnStyles[1] = { cellWidth: '25%', halign: 'left' }; // Standard Limits
                        // The remaining 40% will be distributed among the other columns automatically
                    }
                    // For other tables (like custom tables), let the library decide automatically.
                    // ================= END OF THE NEW FIX V2 =================

                    doc.autoTable({
                        html: clone,
                        startY: cursorY,
                        margin: MARGINS,
                        theme: 'grid',
                        styles: { fontSize: 7, cellPadding: 1.5, textColor: COLOR_TEXT, lineColor: '#E5E7EB', overflow: 'linebreak' },
                        headStyles: {
                            fillColor: COLOR_SECONDARY,
                            textColor: '#FFFFFF',
                            fontStyle: 'bold',
                            halign: 'center',
                            lineWidth: 0.1,
                            lineColor: COLOR_PRIMARY
                        },
                        alternateRowStyles: { fillColor: '#F9FAFB' },
                        columnStyles: columnStyles, // Apply the dynamic styles
                        didParseCell: (data) => {
                            const cellText = (data.cell.text[0] || '').trim().toUpperCase();
                            const isStatRow = cellText === 'AVG.' || cellText === 'STD.' || cellText.includes('TARE');
                            if (isStatRow) {
                                data.cell.styles.fillColor = COLOR_LIGHT_GRAY;
                                data.cell.styles.fontStyle = 'bold';
                            }
                            if (cellText.includes('PASS') || cellText.includes('ACCEPTED') || cellText.includes('OK')) {
                                data.cell.styles.textColor = '#10B981';
                                data.cell.styles.fontStyle = 'bold';
                            } else if (cellText.includes('FAIL') || cellText.includes('REJECTED') || cellText.includes('STOP')) {
                                data.cell.styles.textColor = '#EF4444';
                                data.cell.styles.fontStyle = 'bold';
                            }
                        },
                        didDrawPage: (data) => {
                            drawHeaderFooter();
                        }
                    });
                    cursorY = doc.lastAutoTable.finalY + 4;

                    // Render per-table notes directly under the table if present (DOM -> PDF)
                    try {
                        let notesBlock = table.nextElementSibling;
                        // Search forward a few siblings until next table
                        let hops = 0;
                        while (notesBlock && !(notesBlock.classList && notesBlock.classList.contains('table-notes-block')) && notesBlock.tagName !== 'TABLE' && hops < 6) {
                            notesBlock = notesBlock.nextElementSibling;
                            hops++;
                        }
                        if (notesBlock && notesBlock.classList && notesBlock.classList.contains('table-notes-block')) {
                            const ta = notesBlock.querySelector('textarea');
                            const noteText = (ta && typeof ta.value === 'string' ? ta.value : (notesBlock.textContent || '')).trim();
                            if (noteText) {
                                const availableWidth = pageWidth - MARGINS.left - MARGINS.right;
                                const lines = doc.splitTextToSize(noteText, availableWidth);
                                const estH = lines.length * 4 + 6;
                                if (cursorY + estH > pageHeight - MARGINS.bottom) addPage();
                                doc.setFont(FONT_BOLD); doc.setFontSize(9); doc.setTextColor(COLOR_PRIMARY);
                                writeTextSmart(doc,'Notes', MARGINS.left, cursorY);
                                cursorY += 5;
                                doc.setFont(FONT_NORMAL); doc.setFontSize(8); doc.setTextColor(COLOR_TEXT);
                                writeTextSmart(doc,lines, MARGINS.left, cursorY);
                                cursorY += lines.length * 4 + 6;
                            }
                        }
                    } catch (e) { /* ignore notes render errors */ }

                    cursorY += 6;
                });
            });

            const imagesContainer = document.getElementById('packaging-image-upload');
            if (imagesContainer) {
                const images = imagesContainer.querySelectorAll('img');
                if (images.length > 0) {
                    addSectionTitle('Packaging Images');
                    if (cursorY + 40 > pageHeight - MARGINS.bottom) addPage();
                    let imgX = MARGINS.left;
                    images.forEach(img => {
                        try {
                            doc.addImage(img.src, 'PNG', imgX, cursorY, 30, 30);
                            imgX += 35;
                            if (imgX + 35 > pageWidth - MARGINS.right) {
                                imgX = MARGINS.left;
                                cursorY += 35;
                                if (cursorY + 40 > pageHeight - MARGINS.bottom) addPage();
                            }
                        } catch (e) { console.warn('Could not add image to PDF:', e); }
                    });
                    cursorY += 40;
                }
            }
            if (cursorY + 40 > pageHeight - MARGINS.bottom) addPage();
            addSectionTitle('Approvals');
            // Dynamic signatures from product configuration
            function ensureSpace(h) { if (cursorY + h > pageHeight - MARGINS.bottom) addPage(); }
            function findSignatureFieldValue(kind, label) {
                const key = (label || '').toLowerCase();
                const roleKey = key.replace(/[^a-z0-9]+/g, '-');
                const candidates = [];
                const aliasMap = {
                    'quality engineer': 'qa',
                    'qa': 'qa',
                    'production engineer': 'prod',
                    'production supervisor': 'prod',
                    'quality manager': 'qm',
                };
                if (kind === 'name') {
                    candidates.push(`#${roleKey}-sig-name`, `#${roleKey}-name`, `[data-signature-role="${roleKey}"] .signature-name`);
                } else {
                    candidates.push(`#${roleKey}-sig-date`, `#${roleKey}-date`, `[data-signature-role="${roleKey}"] .signature-date`);
                }
                const alias = aliasMap[key];
                if (alias) {
                    if (kind === 'name') {
                        candidates.push(`#${alias}-sig-name`, `#${alias}-name`);
                    } else {
                        candidates.push(`#${alias}-sig-date`, `#${alias}-date`);
                    }
                }
                for (const sel of candidates) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const val = 'value' in el ? el.value : el.textContent;
                        if (val && String(val).trim()) return String(val).trim();
                    }
                }
                return '';
            }
            (function renderDynamicSignatures(){
                let signatures = [];
                try {
                    if (typeof window.getProductSignatures === 'function') {
                        const productSel = document.getElementById('product-name');
                        const productId = productSel?.value || '';
                        signatures = window.getProductSignatures(productId) || window.getProductSignatures() || [];
                    } else if (window.SignatureManager && typeof window.SignatureManager.getSignaturesForProduct === 'function') {
                        const productSel = document.getElementById('product-name');
                        const productId = productSel?.value || '';
                        signatures = window.SignatureManager.getSignaturesForProduct(productId) || [];
                    }
                } catch(e) { console.warn('Signature config fetch failed:', e); }
                if (!Array.isArray(signatures) || signatures.length === 0) {
                    signatures = [
                        { label: 'Quality Engineer Signature', role: 'quality engineer', order: 1, visible: true, showName: true, showDate: true },
                        { label: 'Production Supervisor Signature', role: 'production supervisor', order: 2, visible: true, showName: true, showDate: true },
                        { label: 'Quality Manager Signature', role: 'quality manager', order: 3, visible: true, showName: true, showDate: true },
                    ];
                }
                const visible = signatures.filter(s => s && s.visible !== false).sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
                if (visible.length === 0) return;
                const maxCols = visible.length >= 3 ? 3 : 2;
                const gap = 8;
                const colWidth = (pageWidth - MARGINS.left - MARGINS.right - gap * (maxCols - 1)) / maxCols;
                let col = 0;
                let x = MARGINS.left;
                const boxH = 28;
                visible.forEach(sig => {
                    ensureSpace(boxH + 6);
                    const label = sig.label || sig.role || 'Signature';
                    doc.setFont(FONT_BOLD);
                    doc.setFontSize(9);
                    doc.setTextColor(COLOR_PRIMARY);
                    writeTextSmart(doc,label, x, cursorY + 5);
                    doc.setDrawColor(COLOR_TEXT);
                    const lineY = cursorY + 18;
                    doc.line(x, lineY, x + colWidth - 10, lineY);
                    doc.setFont(FONT_NORMAL);
                    doc.setFontSize(8);
                    doc.setTextColor(COLOR_TEXT);
                    const parts = [];
                    if (sig.showName !== false) parts.push('Name: ' + (findSignatureFieldValue('name', label) || ''));
                    if (sig.showDate !== false) parts.push('Date: ' + (findSignatureFieldValue('date', label) || ''));
                    const meta = parts.join('    ');
                    if (meta) writeTextSmart(doc,meta, x, lineY + 5);
                    col++;
                    if (col >= maxCols) {
                        col = 0;
                        x = MARGINS.left;
                        cursorY = lineY + 12;
                    } else {
                        x += colWidth + gap;
                    }
                });
                if (col !== 0) cursorY += boxH;
            })();

            // --- 6. الترقيم النهائي وتصدير الملف ---
            const totalPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                drawHeaderFooter();
            }

            const safeProductName = productName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            doc.save(`QC_Report_${safeProductName}_${batchNumber}.pdf`);
            showNotification('PDF exported successfully!', 'success');

        } catch (e) {
            console.error('Enhanced PDF export error:', e);
            showNotification('PDF export failed: ' + e.message, 'error');
        }
    }

    async function exportToPDFProfessional() {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            if (window.__applyArabicFontToDoc) { await window.__applyArabicFontToDoc(doc); }
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();

            // --- 1. إعدادات التصميم والألوان ---
            const FONT_NORMAL = (window.__ARABIC_FONT_NAME || 'Amiri');
            const FONT_BOLD = (window.__ARABIC_FONT_NAME || 'Amiri');
            const COLOR_PRIMARY = '#0B3A8A';
            const COLOR_SECONDARY = '#1E40AF';
            const COLOR_TEXT = '#374151';
            const COLOR_LIGHT_GRAY = '#F3F4F6';
            const MARGINS = { top: 32, bottom: 20, left: 12, right: 12 };
            let cursorY = MARGINS.top;

            // --- 2. جمع البيانات من النموذج ---
            const productSel = document.getElementById('product-name');
            const productName = productSel?.selectedOptions?.[0]?.text || '-';
            const productId = productSel?.value || '';
            const selectedProduct = productId ? (products[productId] || null) : null;
            const reportDate = document.getElementById('report-date')?.value || '-';
            const batchNumber = document.getElementById('batch-number-display')?.textContent || document.getElementById('batch-number')?.value || '-';
            const shift = document.getElementById('shift')?.value || '-';
            const shiftDuration = document.getElementById('shift-duration')?.value || '-';

            // --- 3. دالة لرسم رأس وتذييل الصفحة ---
            function drawHeaderFooter() {
                const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
                const totalPages = doc.internal.getNumberOfPages();
                doc.setFillColor(COLOR_PRIMARY);
                doc.rect(0, 0, pageWidth, 22, 'F');
                // Add company logo if available
                if (window.LogoManager && window.LogoManager.hasLogo()) {
                    const logoData = window.LogoManager.getLogo();
                    if (logoData.src) {
                        try {
                            // Add logo image with white background
                            doc.setFillColor('#FFFFFF');
                            doc.rect(MARGINS.left, 5, 30, 12, 'F');
                            doc.addImage(logoData.src, 'PNG', MARGINS.left + 2, 6, 26, 10, undefined, 'FAST');
                        } catch (e) {
                            // Fallback to text if image fails
                            doc.setFillColor('#FFFFFF');
                            doc.rect(MARGINS.left, 5, 30, 12, 'F');
                            doc.setFont(FONT_BOLD);
                            doc.setFontSize(12);
                            doc.setTextColor(COLOR_PRIMARY);
                            writeTextSmart(doc,'LOGO', MARGINS.left + 8, 13);
                        }
                    } else {
                        // No logo src, show text placeholder
                        doc.setFillColor('#FFFFFF');
                        doc.rect(MARGINS.left, 5, 30, 12, 'F');
                        doc.setFont(FONT_BOLD);
                        doc.setFontSize(12);
                        doc.setTextColor(COLOR_PRIMARY);
                        writeTextSmart(doc,'LOGO', MARGINS.left + 8, 13);
                    }
                } else {
                    // No logo manager, show text placeholder
                    doc.setFillColor('#FFFFFF');
                    doc.rect(MARGINS.left, 5, 30, 12, 'F');
                    doc.setFont(FONT_BOLD);
                    doc.setFontSize(12);
                    doc.setTextColor(COLOR_PRIMARY);
                    writeTextSmart(doc,'LOGO', MARGINS.left + 8, 13);
                }
                doc.setFont(FONT_BOLD);
                doc.setFontSize(14);
                doc.setTextColor('#FFFFFF');
                writeTextSmart(doc,'QUALITY CONTROL REPORT', pageWidth / 2, 11, { align: 'center' });
                doc.setFontSize(10);
                doc.setFont(FONT_NORMAL);
                writeTextSmart(doc,'Biscuit Manufacturing Department', pageWidth / 2, 17, { align: 'center' });
                doc.setDrawColor(COLOR_SECONDARY);
                doc.line(MARGINS.left, pageHeight - MARGINS.bottom + 5, pageWidth - MARGINS.right, pageHeight - MARGINS.bottom + 5);
                const code = selectedProduct?.docCode || '-';
                const issueNo = selectedProduct?.issueNo || '-';
                const reviewNo = selectedProduct?.reviewNo || '-';
                const fmtDate = (d) => {
                    if (!d) return '-';
                    try {
                        const dt = new Date(d);
                        const day = String(dt.getDate()).padStart(2, '0');
                        const month = String(dt.getMonth() + 1).padStart(2, '0');
                        const year = dt.getFullYear();
                        return `${day}/${month}/${year}`;
                    } catch (e) { return d; }
                };
                const issueDate = fmtDate(selectedProduct?.issueDate);
                const reviewDate = fmtDate(selectedProduct?.reviewDate);
                doc.setFontSize(8);
                doc.setTextColor(COLOR_TEXT);
                let footerText = `Form: ${code} | Issue No: ${issueNo} (${issueDate}) | Review No: ${reviewNo} (${reviewDate})`;
                writeTextSmart(doc,footerText, MARGINS.left, pageHeight - MARGINS.bottom + 10);
                const pageStr = `Page ${pageNumber} of ${totalPages}`;
                writeTextSmart(doc,pageStr, pageWidth - MARGINS.right, pageHeight - MARGINS.bottom + 10, { align: 'right' });
            }

            // --- 4. دوال مساعدة لرسم المحتوى ---
            function addSectionTitle(title) {
                if (cursorY + 12 > pageHeight - MARGINS.bottom) addPage();
                doc.setFont(FONT_BOLD);
                doc.setFontSize(12);
                doc.setTextColor(COLOR_PRIMARY);
                writeTextSmart(doc,title.toUpperCase(), MARGINS.left, cursorY);
                doc.setDrawColor(COLOR_SECONDARY);
                doc.line(MARGINS.left, cursorY + 2, pageWidth - MARGINS.right, cursorY + 2);
                cursorY += 8;
            }

            function addPage() {
                doc.addPage();
                cursorY = MARGINS.top;
            }

            // --- 5. بناء محتوى PDF ---
            drawHeaderFooter();

            addSectionTitle('Report Summary');
            doc.autoTable({
                startY: cursorY,
                margin: MARGINS,
                body: [
                    ['Product Name:', productName],
                    ['Batch Number:', batchNumber],
                    ['Production Date:', reportDate],
                    ['Shift:', `Shift ${shift} (${shiftDuration} hours)`],
                ],
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 2, textColor: COLOR_TEXT, lineColor: '#E5E7EB' },
                headStyles: { fillColor: COLOR_LIGHT_GRAY, textColor: COLOR_PRIMARY, fontStyle: 'bold' },
                columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
                didDrawPage: (data) => {
                    drawHeaderFooter();
                }
            });
            cursorY = doc.lastAutoTable.finalY + 10;

            if (selectedProduct && selectedProduct.qualityCriteria) {
                // ... (Quality criteria code remains the same)
            }

            const formRoot = document.getElementById('form-tab') || document.body;
            formRoot.querySelectorAll('.section-header').forEach(header => {
                const section = header.parentElement;

                if (header.innerText.trim().toUpperCase().includes('QUALITY EVALUATION CRITERIA')) {
                    return;
                }

                addSectionTitle(header.innerText.trim());

                section.querySelectorAll('table.form-table').forEach(table => {
                    const head = [];
                    const body = [];

                    const thead = table.querySelector('thead');
                    if (thead) {
                        Array.from(thead.rows).forEach(row => {
                            const headerRow = [];
                            Array.from(row.cells).forEach(cell => {
                                headerRow.push({
                                    content: cell.textContent.trim(),
                                    colSpan: cell.colSpan || 1,
                                    rowSpan: cell.rowSpan || 1,
                                });
                            });
                            head.push(headerRow);
                        });
                    }

                    const tbody = table.querySelector('tbody');
                    if (tbody) {
                        Array.from(tbody.rows).forEach(row => {
                            const bodyRow = [];
                            Array.from(row.cells).forEach(cell => {
                                let cellContent = '-';
                                const isStopped = cell.querySelector('.stop-overlay');
                                if (isStopped) {
                                    cellContent = 'STOPPED';
                                } else {
                                    const input = cell.querySelector('input, select');
                                    if (input) {
                                        if (input.type === 'radio' || input.type === 'checkbox') {
                                            cellContent = input.checked ? '✓' : '';
                                        } else if (input.tagName === 'SELECT') {
                                            cellContent = input.selectedOptions[0]?.text || '';
                                        } else {
                                            cellContent = input.value;
                                        }
                                    } else {
                                        cellContent = cell.textContent.trim();
                                    }
                                }
                                bodyRow.push(cellContent || '-');
                            });
                            body.push(bodyRow);
                        });
                    }

                    const isSampleTable = table.id.includes('sample') || table.querySelector('.sample-weight');
                    const columnStyles = {};
                    const numColumns = head.length > 0 ? head[0].length : 0;

                    if (isSampleTable && numColumns > 1) {
                        columnStyles[0] = { cellWidth: 12 };
                    } else if (!isSampleTable && numColumns > 2) {
                        columnStyles[0] = { cellWidth: '35%', halign: 'left' };
                        columnStyles[1] = { cellWidth: '25%', halign: 'left' };
                    }

                    doc.autoTable({
                        head: head,
                        body: body,
                        startY: cursorY,
                        margin: MARGINS,
                        theme: 'grid',
                        styles: { fontSize: 7, cellPadding: 1.5, textColor: COLOR_TEXT, lineColor: '#E5E7EB', overflow: 'linebreak' },
                        headStyles: {
                            fillColor: COLOR_SECONDARY,
                            textColor: '#FFFFFF',
                            fontStyle: 'bold',
                            halign: 'center',
                            valign: 'middle',
                            lineWidth: 0.1, // <-- السطر المضاف
                            lineColor: COLOR_PRIMARY // <-- السطر المضاف
                        },
                        alternateRowStyles: { fillColor: '#F9FAFB' },
                        columnStyles: columnStyles,
                        didParseCell: (data) => {
                            const cellText = (data.cell.raw || '').toString().trim().toUpperCase();
                            const isStatRow = cellText === 'AVG.' || cellText === 'STD.' || cellText.includes('TARE');
                            if (isStatRow) {
                                data.cell.styles.fillColor = COLOR_LIGHT_GRAY;
                                data.cell.styles.fontStyle = 'bold';
                            }
                            if (cellText.includes('PASS') || cellText.includes('ACCEPTED') || cellText.includes('OK')) {
                                data.cell.styles.textColor = '#10B981';
                                data.cell.styles.fontStyle = 'bold';
                            } else if (cellText.includes('FAIL') || cellText.includes('REJECTED') || cellText.includes('STOPPED')) {
                                data.cell.styles.textColor = '#EF4444';
                                data.cell.styles.fontStyle = 'bold';
                            }
                        },
                        didDrawPage: (data) => {
                            drawHeaderFooter();
                        }
                    });

                    cursorY = doc.lastAutoTable.finalY + 4;

                    // Render per-table notes directly under the table if present (DOM -> PDF)
                    try {
                        let notesBlock = table.nextElementSibling;
                        // Search forward a few siblings until next table
                        let hops = 0;
                        while (notesBlock && !(notesBlock.classList && notesBlock.classList.contains('table-notes-block')) && notesBlock.tagName !== 'TABLE' && hops < 6) {
                            notesBlock = notesBlock.nextElementSibling;
                            hops++;
                        }
                        if (notesBlock && notesBlock.classList && notesBlock.classList.contains('table-notes-block')) {
                            const ta = notesBlock.querySelector('textarea');
                            const noteText = (ta && typeof ta.value === 'string' ? ta.value : (notesBlock.textContent || '')).trim();
                            if (noteText) {
                                const availableWidth = pageWidth - MARGINS.left - MARGINS.right;
                                const lines = doc.splitTextToSize(noteText, availableWidth);
                                const estH = lines.length * 4 + 6;
                                if (cursorY + estH > pageHeight - MARGINS.bottom) addPage();
                                doc.setFont(FONT_BOLD); doc.setFontSize(9); doc.setTextColor(COLOR_PRIMARY);
                                writeTextSmart(doc,'Notes', MARGINS.left, cursorY);
                                cursorY += 5;
                                doc.setFont(FONT_NORMAL); doc.setFontSize(8); doc.setTextColor(COLOR_TEXT);
                                writeTextSmart(doc,lines, MARGINS.left, cursorY);
                                cursorY += lines.length * 4 + 6;
                            }
                        }
                    } catch (e) { /* ignore notes render errors */ }

                    cursorY += 6;
                });
            });

            // Dynamic Approvals/Signatures section inserted here
            (function renderApprovalsSection(){
                function addSectionTitleLocal(title) {
                    if (cursorY + 12 > pageHeight - MARGINS.bottom) addPage();
                    doc.setFont(FONT_BOLD);
                    doc.setFontSize(12);
                    doc.setTextColor(COLOR_PRIMARY);
                    writeTextSmart(doc,title.toUpperCase(), MARGINS.left, cursorY);
                    doc.setDrawColor(COLOR_SECONDARY);
                    doc.line(MARGINS.left, cursorY + 2, pageWidth - MARGINS.right, cursorY + 2);
                    cursorY += 8;
                }
                function ensureSpace(h) { if (cursorY + h > pageHeight - MARGINS.bottom) addPage(); }
                function findSignatureFieldValue(kind, label) {
                    const key = (label || '').toLowerCase();
                    const roleKey = key.replace(/[^a-z0-9]+/g, '-');
                    const candidates = [];
                    const aliasMap = {
                        'quality engineer': 'qa',
                        'qa': 'qa',
                        'production engineer': 'prod',
                        'production supervisor': 'prod',
                        'quality manager': 'qm',
                    };
                    if (kind === 'name') {
                        candidates.push(`#${roleKey}-sig-name`, `#${roleKey}-name`, `[data-signature-role="${roleKey}"] .signature-name`);
                    } else {
                        candidates.push(`#${roleKey}-sig-date`, `#${roleKey}-date`, `[data-signature-role="${roleKey}"] .signature-date`);
                    }
                    const alias = aliasMap[key];
                    if (alias) {
                        if (kind === 'name') {
                            candidates.push(`#${alias}-sig-name`, `#${alias}-name`);
                        } else {
                            candidates.push(`#${alias}-sig-date`, `#${alias}-date`);
                        }
                    }
                    for (const sel of candidates) {
                        const el = document.querySelector(sel);
                        if (el) {
                            const val = 'value' in el ? el.value : el.textContent;
                            if (val && String(val).trim()) return String(val).trim();
                        }
                    }
                    return '';
                }
                try {
                    let signatures = [];
                    const productSel = document.getElementById('product-name');
                    const productId = productSel?.value || '';
                    if (typeof window.getProductSignatures === 'function') {
                        signatures = window.getProductSignatures(productId) || window.getProductSignatures() || [];
                    } else if (window.SignatureManager && typeof window.SignatureManager.getSignaturesForProduct === 'function') {
                        signatures = window.SignatureManager.getSignaturesForProduct(productId) || [];
                    }
                    if (!Array.isArray(signatures) || signatures.length === 0) {
                        signatures = [
                            { label: 'Quality Engineer Signature', role: 'quality engineer', order: 1, visible: true, showName: true, showDate: true },
                            { label: 'Production Supervisor Signature', role: 'production supervisor', order: 2, visible: true, showName: true, showDate: true },
                            { label: 'Quality Manager Signature', role: 'quality manager', order: 3, visible: true, showName: true, showDate: true },
                        ];
                    }
                    const visible = signatures.filter(s => s && s.visible !== false).sort((a,b) => (a.order ?? 0) - (b.order ?? 0));
                    if (visible.length === 0) return;
                    addSectionTitleLocal('Approvals');
                    const maxCols = visible.length >= 3 ? 3 : 2;
                    const gap = 8;
                    const colWidth = (pageWidth - MARGINS.left - MARGINS.right - gap * (maxCols - 1)) / maxCols;
                    let col = 0;
                    let x = MARGINS.left;
                    const boxH = 28;
                    visible.forEach(sig => {
                        ensureSpace(boxH + 6);
                        const label = sig.label || sig.role || 'Signature';
                        doc.setFont(FONT_BOLD);
                        doc.setFontSize(9);
                        doc.setTextColor(COLOR_PRIMARY);
                        writeTextSmart(doc,label, x, cursorY + 5);
                        doc.setDrawColor(COLOR_TEXT);
                        const lineY = cursorY + 18;
                        doc.line(x, lineY, x + colWidth - 10, lineY);
                        doc.setFont(FONT_NORMAL);
                        doc.setFontSize(8);
                        doc.setTextColor(COLOR_TEXT);
                        const parts = [];
                        if (sig.showName !== false) parts.push('Name: ' + (findSignatureFieldValue('name', label) || ''));
                        if (sig.showDate !== false) parts.push('Date: ' + (findSignatureFieldValue('date', label) || ''));
                        const meta = parts.join('    ');
                        if (meta) writeTextSmart(doc,meta, x, lineY + 5);
                        col++;
                        if (col >= maxCols) {
                            col = 0;
                            x = MARGINS.left;
                            cursorY = lineY + 12;
                        } else {
                            x += colWidth + gap;
                        }
                    });
                    if (col !== 0) cursorY += boxH;
                } catch (e) {
                    console.warn('Failed to render dynamic signatures:', e);
                }
            })();

            const totalPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                drawHeaderFooter();
            }

            const safeProductName = productName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            doc.save(`QC_Report_${safeProductName}_${batchNumber}.pdf`);
            showNotification('PDF exported successfully!', 'success');

        } catch (e) {
            console.error('Enhanced PDF export error:', e);
            showNotification('PDF export failed: ' + e.message, 'error');
        }
    }
    // New PDF export: text-based tables using jsPDF-AutoTable
    async function exportToPDFTextTables() {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            if (window.__applyArabicFontToDoc) { await window.__applyArabicFontToDoc(doc); }
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 10;
            let cursorY = 14;
            let isFirstPage = true;
            let currentPageNum = 1;

            // Gather header information
            const productName = document.getElementById('product-name')?.selectedOptions?.[0]?.text || '-';
            const reportDate = document.getElementById('report-date')?.value || '-';
            const batchNumber = document.getElementById('batch-number')?.value || '-';
            const shift = document.getElementById('shift')?.value || '-';
            const shiftDuration = document.getElementById('shift-duration')?.value || '-';
            const startInspection = document.getElementById('start-inspection-time')?.value || '-';

            // Also reflect current header meta in DOM before export
            const selProdIdForHeader = document.getElementById('product-name')?.value;
            updateDocumentHeaderDisplay(selProdIdForHeader ? products[selProdIdForHeader] : null);

            // Function to add main header (only on first page)
            const addMainHeader = () => {
                if (!isFirstPage) return 14; // Return starting Y position for non-first pages

                doc.setFontSize(16);
                doc.setFont(undefined, 'bold');
                writeTextSmart(doc,'QUALITY CONTROL FORM', pageWidth / 2, cursorY, { align: 'center' });
                cursorY += 8;

                doc.setFontSize(14);
                doc.setFont(undefined, 'normal');
                writeTextSmart(doc,'Biscuit Manufacturing', pageWidth / 2, cursorY, { align: 'center' });
                cursorY += 8;

                doc.setFontSize(10);
                writeTextSmart(doc,`Product: ${productName}`, margin, cursorY);
                writeTextSmart(doc,`Date: ${reportDate}`, pageWidth - margin - 40, cursorY);
                cursorY += 5;

                writeTextSmart(doc,`Batch: ${batchNumber}`, margin, cursorY);
                writeTextSmart(doc,`Shift: ${shift}`, pageWidth - margin - 40, cursorY);
                cursorY += 5;

                writeTextSmart(doc,`Duration: ${shiftDuration}h`, margin, cursorY);
                writeTextSmart(doc,`Start: ${startInspection}`, pageWidth - margin - 40, cursorY);
                cursorY += 6;

                // Controlled Document Header
                const selectedProdId = document.getElementById('product-name')?.value;
                const selectedProduct = selectedProdId ? products[selectedProdId] : null;
                const fmt = (d) => {
                    if (!d) return '-';
                    const dt = new Date(d);
                    if (isNaN(dt.getTime())) {
                        const parts = String(d).split('-');
                        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
                        return String(d);
                    }
                    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
                };

                const code = selectedProduct?.docCode || '-';
                const issueNo = selectedProduct?.issueNo || '-';
                const reviewNo = selectedProduct?.reviewNo || '-';
                const issueDate = fmt(selectedProduct?.issueDate);
                const reviewDate = fmt(selectedProduct?.reviewDate);

                doc.setFontSize(9);
                doc.setDrawColor(200, 200, 200);
                doc.line(margin, cursorY, pageWidth - margin, cursorY);
                cursorY += 4;
                writeTextSmart(doc,`Form No: ${code}  |  Issue: ${issueNo} (${issueDate})  |  Review: ${reviewNo} (${reviewDate})`, margin, cursorY);
                cursorY += 2;
                doc.line(margin, cursorY, pageWidth - margin, cursorY);
                cursorY += 8;

                return cursorY;
            };

            // Add main header for first page
            cursorY = addMainHeader();

            const formScope = document.getElementById('form-tab') || document.body;
            const tables = formScope.querySelectorAll('table.form-table');

            // Process each table
            tables.forEach((tbl, idx) => {
                // Skip tables that contain export buttons or are control tables
                const hasExportButtons = tbl.querySelector('.export-csv-btn, .export-excel-btn, .filter-btn, button[class*="export"], button[class*="filter"]');
                if (hasExportButtons) {
                    console.log('Skipping table with export buttons');
                    return;
                }

                // Determine section and table titles
                let sectionTitle = tbl.closest('div[id^="section-"]')?.querySelector('h2.section-header')?.innerText?.trim() || '';
                let tableTitle = '';
                const wrapper = tbl.closest('.mb-4');
                if (wrapper) {
                    const h3 = wrapper.querySelector('h3');
                    if (h3) {
                        // Clean the title text by removing any button text
                        tableTitle = h3.innerText.trim()
                            .replace(/Export CSV.*$/i, '')
                            .replace(/Export Excel.*$/i, '')
                            .replace(/Filter.*$/i, '')
                            .replace(/Stop.*$/i, '')
                            .trim();
                    }
                }

                const titleLine = [sectionTitle, tableTitle].filter(Boolean).join(' — ');

                // Check if we need a new page
                if (cursorY > pageHeight - 40) {
                    doc.addPage();
                    isFirstPage = false;
                    currentPageNum++;
                    cursorY = 14; // Reset Y position for new page
                }

                if (titleLine) {
                    doc.setFontSize(11);
                    doc.setTextColor(40);
                    doc.setFont(undefined, 'bold');
                    writeTextSmart(doc,titleLine, margin, cursorY);
                    doc.setFont(undefined, 'normal');
                    cursorY += 5;
                }

                // Clone table and clean it for PDF export
                const clone = tbl.cloneNode(true);

                // Remove any button elements and their containers
                clone.querySelectorAll('button, .export-csv-btn, .export-excel-btn, .filter-btn, .stop-btn').forEach(btn => {
                    btn.remove();
                });

                // Remove any cells that only contained buttons
                clone.querySelectorAll('td, th').forEach(cell => {
                    if (cell.textContent.includes('Export CSV') ||
                        cell.textContent.includes('Export Excel') ||
                        cell.textContent.includes('Filter') ||
                        cell.textContent.includes('Stop')) {
                        cell.textContent = '';
                    }
                });

                // Process inputs and format cell content
                clone.querySelectorAll('td').forEach(td => {
                    const inputs = td.querySelectorAll('input, select, textarea');
                    if (inputs.length > 0) {
                        const vals = [];
                        inputs.forEach(el => {
                            if (el.tagName === 'SELECT') {
                                const opt = el.selectedOptions && el.selectedOptions[0];
                                if (opt) vals.push(opt.text.trim());
                            } else if (el.type === 'checkbox') {
                                vals.push(el.checked ? '✓' : '✗');
                            } else if (el.type === 'radio') {
                                if (el.checked) vals.push(el.value);
                            } else {
                                const value = el.value?.trim();
                                if (value !== undefined && value !== '') {
                                    vals.push(value);
                                }
                            }
                        });
                        // Set the text content with proper formatting
                        td.textContent = vals.length > 0 ? vals.join(' / ') : '-';
                    }
                    // Ensure empty cells show a dash
                    if (td.textContent.trim() === '') {
                        td.textContent = '-';
                    }
                });

                // Configure autoTable with better alignment handling
                doc.autoTable({
                    html: clone,
                    startY: cursorY,
                    margin: { left: margin, right: margin },
                    theme: 'grid',
                    styles: {
                        fontSize: 8,
                        cellPadding: 2,
                        halign: 'center',
                        valign: 'middle',
                        lineColor: [200, 200, 200],
                        lineWidth: 0.1
                    },
                    headStyles: {
                        fillColor: [243, 244, 246],
                        textColor: [31, 41, 55],
                        fontStyle: 'bold',
                        halign: 'center'
                    },
                    bodyStyles: {
                        textColor: [31, 41, 55],
                        halign: 'center'
                    },
                    columnStyles: {
                        // Ensure consistent column alignment
                        0: { halign: 'left' }, // First column often contains labels
                    },
                    didDrawPage: function (data) {
                        // Check if a new page was created by autoTable
                        if (data.pageNumber > currentPageNum) {
                            isFirstPage = false;
                            currentPageNum = data.pageNumber;
                        }
                    },
                    willDrawCell: function (data) {
                        // Ensure proper alignment for specific content
                        if (data.cell.text && data.cell.text.length > 0) {
                            const text = data.cell.text[0];
                            // For ACCEPTED/REJECTED status, ensure center alignment
                            if (text === 'ACCEPTED' || text === 'REJECTED') {
                                data.cell.styles.halign = 'center';
                                data.cell.styles.fontStyle = 'bold';
                                if (text === 'ACCEPTED') {
                                    data.cell.styles.textColor = [34, 197, 94]; // Green
                                } else if (text === 'REJECTED') {
                                    data.cell.styles.textColor = [239, 68, 68]; // Red
                                }
                            }
                        }
                    }
                });

                cursorY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 8 : cursorY + 10;
            });

            // Add page footers with correct numbering
            const totalPages = doc.internal.getNumberOfPages();
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);

            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);

                // Add page number
                const footerText = `Page ${i} of ${totalPages}`;
                writeTextSmart(doc,footerText, pageWidth / 2, pageHeight - 8, { align: 'center' });

                // Add generation timestamp
                const timestamp = new Date().toLocaleString();
                doc.setFontSize(7);
                writeTextSmart(doc,`Generated: ${timestamp}`, margin, pageHeight - 8);
            }

            // Save the PDF
            doc.save('biscuit-quality-control-report.pdf');
            showNotification('PDF exported successfully!', 'success');

        } catch (e) {
            console.error('PDF export error:', e);
            showNotification('PDF export failed: ' + e.message, 'error');
        }
    }



    // Renders the simplified alerts UI based on the selected product
    function renderSimplifiedAlerts(product) {
        const container = document.getElementById('simplified-alerts-container');
        const alertsSection = document.getElementById('alerts-section');
        if (!container) return;
        container.innerHTML = '';

        const criticalParams = [];
        if (product && product.sections) {
            Object.values(product.sections).forEach(section => {
                section.tables?.forEach(table => {
                    table.parameters?.forEach(param => {
                        if (param.type === 'ccp' || param.type === 'oprp') {
                            criticalParams.push({
                                name: param.name,
                                id: `${table.id}-${param.name.replace(/\s/g, '-')}`,
                                tableName: table.name
                            });
                        }
                    });
                });
            });
        }

        if (criticalParams.length === 0) {
            // Hide alerts section if no critical parameters
            if (alertsSection) alertsSection.style.display = 'none';
            container.innerHTML = '<div class="p-4 text-center text-gray-500">لا توجد نقاط فحص حرجة (CCP/OPRP) معرفة لهذا المنتج.</div>';
            return;
        }

        // Show alerts section if there are critical parameters
        if (alertsSection) alertsSection.style.display = 'block';

        const alertStates = loadAlertStates();

        criticalParams.forEach(param => {
            const isEnabled = alertStates[param.id] || false;
            const item = document.createElement('div');
            item.className = 'alert-toggle-item flex justify-between items-center p-3 border-b';
            item.innerHTML = `
                <div>
                    <span class="font-semibold text-gray-800">${param.name}</span>
                    <span class="text-xs text-gray-500 ml-2">(${param.tableName})</span>
                </div>
                <label class="switch">
                    <input type="checkbox" class="alert-toggle" data-alert-id="${param.id}" ${isEnabled ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            `;
            container.appendChild(item);
        });

        // Add event listeners to the new toggles
        container.querySelectorAll('.alert-toggle').forEach(toggle => {
            toggle.addEventListener('change', handleAlertToggleChange);
        });
    }

    // Handles the change event for an alert toggle
    function handleAlertToggleChange(event) {
        const alertId = event.target.dataset.alertId;
        const isEnabled = event.target.checked;

        const alertStates = loadAlertStates();
        alertStates[alertId] = isEnabled;
        saveAlertStates(alertStates);

        showNotification(`تنبيه "${alertId.split('-').slice(1).join(' ')}" تم ${isEnabled ? 'تفعيله' : 'تعطيله'}.`, 'info');

        // Restart the checker to apply changes immediately
        startAlertChecker();
    }

    // Loads the saved states of alerts from localStorage


    // Saves the current states of alerts to localStorage
    function saveAlertStates(states) {
        try {
            localStorage.setItem('simplifiedAlertStates', JSON.stringify(states));
        } catch (e) {
            console.error('Failed to save alert states:', e);
        }
    }

    // Starts the interval to check for due alerts
    function startAlertChecker() {
        // Clear any existing interval
        if (alertCheckerInterval) {
            clearInterval(alertCheckerInterval);
        }

        // Reset the fired alerts cache for the new day
        const today = new Date().toLocaleDateString();
        if (localStorage.getItem('alertFiredDate') !== today) {
            firedAlerts.clear();
            localStorage.setItem('alertFiredDate', today);
        }

        // Start a new interval that runs every 30 seconds
        alertCheckerInterval = setInterval(checkDueAlerts, 30000);
        console.log('Alert checker started.');
    }

    // Checks if any enabled alerts are due
    function checkDueAlerts() {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const alertStates = loadAlertStates();
        const enabledAlertIds = Object.keys(alertStates).filter(id => alertStates[id]);

        if (enabledAlertIds.length === 0) {
            // No need to run if no alerts are enabled
            return;
        }

        // Get all unique inspection times from the form's headers
        const inspectionTimes = new Set();
        document.querySelectorAll('tr[id^="time-headers-"]').forEach(headerRow => {
            headerRow.querySelectorAll('th').forEach(th => {
                inspectionTimes.add(th.textContent.trim());
            });
        });

        // Check if the current time matches any inspection time
        if (inspectionTimes.has(currentTime)) {
            const alertFriendlyName = enabledAlertIds[0].split('-').slice(1).join(' ');

            // Check if we've already fired for this time slot
            const fireKey = `${currentTime}`;
            if (!firedAlerts.has(fireKey)) {
                showNotification(`تنبيه فحص! 🚨 الوقت الآن ${currentTime}، الرجاء إجراء الفحوصات المجدولة.`, 'warning', 10000);
                firedAlerts.set(fireKey, true); // Mark as fired for this time slot
            }
        }
    }


    // Alerts (CCP/OPRP) Tab Functions using RESTful Table API
    async function loadAlerts() {
        try {
            const res = await fetch(`tables/inspection_alerts?limit=1000`);
            const json = await res.json();
            const rows = json.data || [];
            const tbody = document.getElementById('alerts-table-body');
            if (!tbody) return;
            tbody.innerHTML = '';
            rows.forEach(r => {
                const tr = document.createElement('tr');
                const productName = products[r.product_id]?.name || r.product_id || '-';
                const nextDue = r.next_due_at ? new Date(r.next_due_at).toLocaleString() : '-';
                tr.innerHTML = `
                    <td>${productName}</td>
                    <td>${r.title || '-'}</td>
                    <td>${r.type || '-'}</td>
                    <td>${r.frequency_minutes || '-'}</td>
                    <td>${r.start_time || '-'}</td>
                    <td>${nextDue}</td>
                    <td>${r.active ? 'Yes' : 'No'}</td>
                    <td>
                        <button class="action-btn delete-btn" data-action="delete" data-id="${r.id}"><i class="fas fa-trash"></i></button>
                        <button class="action-btn ${r.active ? 'edit-btn' : 'add-btn'}" data-action="toggle" data-id="${r.id}" data-active="${r.active ? 'true' : 'false'}">${r.active ? 'Deactivate' : 'Activate'}</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error('Failed to load alerts', e);
        }
    }

    function computeNextDueAt(startTime, freqMinutes) {
        try {
            const [h, m] = (startTime || '08:00').split(':').map(n => parseInt(n));
            const now = new Date();
            const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 8, m || 0, 0, 0);
            const next = new Date(base.getTime());
            while (next < now) {
                next.setMinutes(next.getMinutes() + (parseInt(freqMinutes) || 60));
            }
            return next.getTime();
        } catch { return null; }
    }

    async function addAlertFromForm() {
        const productId = document.getElementById('alerts-product')?.value || '';
        const title = document.getElementById('alert-title')?.value?.trim() || '';
        const type = document.getElementById('alert-type')?.value || 'CCP';
        const frequency = parseInt(document.getElementById('alert-frequency')?.value || '60');
        const startTime = document.getElementById('alert-start-time')?.value || '08:00';
        const active = (document.getElementById('alert-active')?.value || 'true') === 'true';
        const sectionId = document.getElementById('alert-section-id')?.value?.trim() || '';
        const tableId = document.getElementById('alert-table-id')?.value?.trim() || '';
        const parameterName = document.getElementById('alert-parameter-name')?.value?.trim() || '';

        if (!productId || !title) {
            showNotification('Please select a product and enter a title', 'warning');
            return;
        }
        const nextDue = computeNextDueAt(startTime, frequency);
        try {
            const res = await fetch(`tables/inspection_alerts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_id: productId,
                    title,
                    type,
                    frequency_minutes: frequency,
                    start_time: startTime,
                    next_due_at: nextDue,
                    active,
                    section_id: sectionId || null,
                    table_id: tableId || null,
                    parameter_name: parameterName || null
                })
            });
            if (!res.ok) throw new Error('Failed to create alert');
            showNotification('Alert added', 'success');
            await loadAlerts();
        } catch (e) {
            showNotification('Failed to add alert: ' + e.message, 'error');
        }
    }



    async function toggleAlertActive(id, activeNow) {
        try {
            const res = await fetch(`tables/inspection_alerts/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: !activeNow })
            });
            if (!res.ok) throw new Error('Toggle failed');
            showNotification(`Alert ${activeNow ? 'deactivated' : 'activated'}`, 'success');
            await loadAlerts();
        } catch (e) {
            showNotification('Failed to toggle alert: ' + e.message, 'error');
        }
    }





    // Populate product dropdown
    function populateProductDropdown(preserveSelection = false) {
        // Store current selection if preserving
        const currentSelection = preserveSelection ? productSelect.value : null;

        productSelect.innerHTML = '<option value="">Select a Product</option>';
        Object.keys(products).forEach(key => {
            const product = products[key];
            const option = document.createElement('option');
            option.value = key;
            option.textContent = product.name;
            productSelect.appendChild(option);
        });

        // Restore selection if it was preserved and still exists
        if (preserveSelection && currentSelection && products[currentSelection]) {
            productSelect.value = currentSelection;
        }
    }

    // Render products table
    function renderProductsTable() {
        productsTableBody.innerHTML = '';
        Object.keys(products).forEach(key => {
            const product = products[key];
            const row = document.createElement('tr');

            const sectionCount = product.sections ? Object.keys(product.sections).length : 0;

            row.innerHTML = `
            <td>${product.id}</td>
            <td>${product.name}</td>
            <td>${product.standardWeight}</td>
            <td>${product.shelfLife}</td>
            <td>${product.cartonsPerPallet}</td>
            <td>${sectionCount}</td>
            <td><code class="bg-gray-100 px-2 py-1 rounded text-sm">${product.batchCode || 'Not Set'}</code></td>
            <td>
                <button class="action-btn edit-btn" data-id="${key}"><i class="fas fa-edit"></i></button>
                <button class="action-btn delete-btn" data-id="${key}"><i class="fas fa-trash"></i></button>
            </td>
        `;
            productsTableBody.appendChild(row);
        });

        // Add event listeners to edit and delete buttons
        document.querySelectorAll('#products-table-body .edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const productId = e.currentTarget.getAttribute('data-id');
                editProduct(productId);
            });
        });

        document.querySelectorAll('#products-table-body .delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const productId = e.currentTarget.getAttribute('data-id');
                deleteProduct(productId);
            });
        });
    }

    // Add section to product modal
    function addSection(section = null) {
        const sectionContainer = document.createElement('div');
        sectionContainer.className = 'section-container';

        const sectionId = section ? section.id : `section-${Date.now()}`;

        sectionContainer.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <div class="flex items-center">
                    <i class="fas fa-grip-vertical drag-handle" title="Drag to reorder"></i>
                    <div class="section-title">Section Configuration</div>
                </div>
                <button type="button" class="remove-section-btn"><i class="fas fa-trash"></i></button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                    <label class="block font-semibold mb-1">Section ID:</label>
                    <input type="text" class="input-field section-id" value="${sectionId}" readonly>
                </div>
                <div>
                    <label class="block font-semibold mb-1">Section Name:</label>
                    <input type="text" class="input-field section-name" value="${section ? section.name : ''}" placeholder="Section Name" required>
                </div>
                <div>
                    <label class="block font-semibold mb-1">Icon Class:</label>
                    <input type="text" class="input-field section-icon" value="${section ? section.icon : 'fas fa-cog'}" placeholder="fas fa-cog">
                </div>
            </div>
            <div class="mb-4">
                <div class="flex justify-between items-center mb-2">
                    <h4>Tables</h4>
                    <button type="button" class="add-table-btn bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"><i class="fas fa-plus mr-1"></i>Add Table</button>
                </div>
                <div class="tables-container">
                    <!-- Tables will be added here -->
                </div>
            </div>
        `;

        sectionsContainer.appendChild(sectionContainer);

        // Add event listeners
        sectionContainer.querySelector('.remove-section-btn').addEventListener('click', () => {
            sectionContainer.remove();
        });

        sectionContainer.querySelector('.add-table-btn').addEventListener('click', () => {
            addTable(sectionContainer.querySelector('.tables-container'));
        });

        // Add existing tables if editing
        if (section && section.tables) {
            const tablesContainer = sectionContainer.querySelector('.tables-container');
            section.tables.forEach(table => {
                addTable(tablesContainer, table);
            });
        } else {
            // Add default table
            addTable(sectionContainer.querySelector('.tables-container'));
        }
    }

    // Enhanced add table function with support for different table types
    // في ملف script.js
    // في ملف script.js
    function addTable(tablesContainer, table = null) {
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-config-container border border-gray-300 p-4 mb-4 rounded-lg bg-white shadow-sm';
        const tableId = table ? table.id : `table-${Date.now()}`;
        const tableType = table ? table.type || 'parameters' : 'parameters';
        tableContainer.setAttribute('data-table-id', tableId);

        tableContainer.innerHTML = `
        <div class="flex justify-between items-center mb-3 pb-2 border-b">
            <div class="flex items-center gap-3">
                <i class="fas fa-grip-vertical drag-handle text-gray-500 cursor-grab" title="Drag to reorder"></i>
                <h5 class="font-semibold text-lg text-gray-700">Table Configuration</h5>
            </div>
            <button type="button" class="remove-table-btn bg-red-500 text-white px-3 py-1 rounded-md hover:bg-red-600 transition-colors"><i class="fas fa-trash"></i></button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
                <label class="block font-semibold mb-1 text-sm">Table ID:</label>
                <input type="text" class="input-field table-id bg-gray-100" value="${tableId}" readonly>
            </div>
            <div>
                <label class="block font-semibold mb-1 text-sm">Table Name:</label>
                <input type="text" class="input-field table-name" value="${table ? table.name : ''}" placeholder="e.g., Baking Process" required>
            </div>
            <div>
                <label class="block font-semibold mb-1 text-sm">Table Type:</label>
                <select class="input-field table-type">
                    <option value="parameters" ${tableType === 'parameters' ? 'selected' : ''}>Parameters Table</option>
                    <option value="sample" ${tableType === 'sample' ? 'selected' : ''}>Sample (Weight)</option>
                    <option value="custom" ${tableType === 'custom' ? 'selected' : ''}>Custom Table</option>
                    <option value="checklist" ${tableType === 'checklist' ? 'selected' : ''}>Checklist</option>
                    <option value="ai" ${tableType === 'ai' ? 'selected' : ''}>AI Code Table</option>
                    <option value="defects" ${tableType === 'defects' ? 'selected' : ''}>Defects Log</option>
                    <option value="summary" ${tableType === 'summary' ? 'selected' : ''}>Shift Summary</option>
                    <option value="spc" ${tableType === 'spc' ? 'selected' : ''}>SPC (Run Chart)</option>
                    <option value="signoff" ${tableType === 'signoff' ? 'selected' : ''}>Sign-off</option>
                </select>
            </div>
        </div>

        <div class="parameters-config-options" style="display: none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">Parameters Table Options</h6>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-gray-50 rounded">
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-avg" ${table && table.hasAvg ? 'checked' : ''}> Enable AVG Column</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-std" ${table && table.hasStd ? 'checked' : ''}> Enable STD Column</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-tare1" ${table && table.hasTare1 ? 'checked' : ''}> Enable Tare 1 Column</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-tare2" ${table && table.hasTare2 ? 'checked' : ''}> Enable Tare 2 Column</label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <div>
                    <label class="block font-semibold mb-1 text-sm">Inspection Period (minutes)</label>
                    <input type="number" min="1" step="1" class="input-field table-inspection-period" value="${table && table.inspectionPeriod ? table.inspectionPeriod : 60}">
                </div>
            </div>
            <div class="mt-4"><div class="flex justify-between items-center mb-2"><h6 class="font-semibold">Parameters</h6><button type="button" class="add-parameter-btn bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 text-sm"><i class="fas fa-plus mr-1"></i>Add Parameter</button></div><div class="parameters-container space-y-3"></div></div>
        </div>

        <div class="sample-config-options" style="display: none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">Sample Table Options</h6>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                <div>
                    <label class="block font-semibold mb-1 text-sm">Sample Rows</label>
                    <input type="number" min="1" step="1" class="input-field sample-rows" value="${table && table.sampleRows ? table.sampleRows : 20}">
                </div>
                <div>
                    <label class="block font-semibold mb-1 text-sm">Sample Prefix</label>
                    <input type="text" class="input-field sample-prefix" value="${table && table.samplePrefix ? table.samplePrefix : 'Sample'}" placeholder="Sample">
                </div>
                <div>
                    <label class="block font-semibold mb-1 text-sm">Inspection Period (minutes)</label>
                    <input type="number" min="1" step="1" class="input-field table-inspection-period" value="${table && table.inspectionPeriod ? table.inspectionPeriod : 60}">
                </div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-gray-50 rounded mt-3">
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-avg" ${table && table.hasAvg ? 'checked' : ''}> Enable AVG Row</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-std" ${table && table.hasStd ? 'checked' : ''}> Enable STD Row</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-tare1" ${table && table.hasTare1 ? 'checked' : ''}> Enable Tare 1 Row</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-tare2" ${table && table.hasTare2 ? 'checked' : ''}> Enable Tare 2 Row</label>
            </div>
            <div class="mt-3">
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="table-has-rejection-criteria" ${table && table.hasRejectionCriteria ? 'checked' : ''}> Include Rejection Section</label>
            </div>
        </div>
         <div class="custom-config-options" style="display: none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">Custom Table Options</h6>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                    <label class="block font-semibold mb-1 text-sm">Initial Rows</label>
                    <input type="number" min="0" step="1" class="input-field custom-rows" value="${table && table.customRows !== undefined ? table.customRows : 1}">
                </div>
                <div class="md:col-span-2 flex items-end">
                    <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="custom-allow-add-rows" ${table && table.allowAddRows === false ? '' : 'checked'}> Allow adding/removing rows</label>
                </div>
            </div>
            <div class="mt-3">
                <div class="flex justify-between items-center mb-2">
                    <h6 class="font-semibold">Columns</h6>
                    <button type="button" class="add-custom-column-btn bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 text-sm"><i class="fas fa-plus mr-1"></i>Add Column</button>
                </div>
                <div class="custom-columns-container"></div>
            </div>
        </div>
        <div class="checklist-config-options" style="display: none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">Checklist Options</h6>
            <div class="mt-2">
                <div class="flex justify-between items-center mb-2">
                    <h6 class="font-semibold">Items</h6>
                    <button type="button" class="add-checklist-item-btn bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 text-sm"><i class="fas fa-plus mr-1"></i>Add Item</button>
                </div>
                <div class="checklist-items-container"></div>
            </div>
        </div>
        <div class="ai-config-options" style="display: none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">AI Code Table</h6>
            <div class="p-3 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-900 mb-3">
                1) Click "Copy Standard AI Prompt" and paste it into any AI. 2) Describe the table you need. 3) Copy the returned JSON code and paste it below. 4) Click Parse & Preview, edit details if needed, then Save Product.
            </div>
            <div class="flex flex-wrap gap-2 mb-2">
                <button type="button" class="ai-copy-prompt-btn bg-gray-200 text-gray-700 px-3 py-1 rounded hover:bg-gray-300 text-xs"><i class="fas fa-copy mr-1"></i>Copy Standard AI Prompt</button>
                <button type="button" class="ai-parse-btn bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 text-xs"><i class="fas fa-code mr-1"></i>Parse & Preview</button>
            </div>
            <textarea class="ai-code-input w-full border p-2 rounded h-40 text-xs" placeholder="Paste AI JSON here..."></textarea>
            <textarea class="ai-definition-json hidden"></textarea>
            <div class="ai-editor mt-3"></div>
            <div class="ai-preview mt-3 p-2 bg-white border rounded"></div>
        </div>
        
        <div class="defects-config-options" style="display: none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">Defects Log Options</h6>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                    <label class="block font-semibold mb-1 text-sm">Defect Types (comma separated)</label>
                    <input type="text" class="input-field defect-types" placeholder="Cracks, Burnt, Underweight, Overbake">
                </div>
                <div class="flex items-end">
                    <label class="inline-flex items-center gap-2 text-sm"><input type="checkbox" class="defects-include-severity"> Include Severity</label>
                </div>
                <div class="flex items-end">
                    <label class="inline-flex items-center gap-2 text-sm"><input type="checkbox" class="defects-include-location" checked> Include Location/Station</label>
                </div>
            </div>
        </div>

        <div class="summary-config-options" style="display:none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">Shift Summary Options</h6>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-gray-50 rounded">
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="summary-include-rework" checked> Include Rework</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="summary-include-downtime" checked> Include Downtime (min)</label>
            </div>
        </div>

        <div class="spc-config-options" style="display:none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">SPC (Run Chart) Options</h6>
            <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div>
                    <label class="block font-semibold mb-1 text-sm">Parameter Name</label>
                    <input type="text" class="input-field spc-param" placeholder="e.g., Pack Weight (g)">
                </div>
                <div>
                    <label class="block font-semibold mb-1 text-sm">Rows</label>
                    <input type="number" min="1" step="1" class="input-field spc-rows" value="20">
                </div>
                <div>
                    <label class="block font-semibold mb-1 text-sm">LCL</label>
                    <input type="number" step="0.01" class="input-field spc-lcl" placeholder="Lower Control Limit">
                </div>
                <div>
                    <label class="block font-semibold mb-1 text-sm">Target</label>
                    <input type="number" step="0.01" class="input-field spc-target" placeholder="Target">
                </div>
                <div>
                    <label class="block font-semibold mb-1 text-sm">UCL</label>
                    <input type="number" step="0.01" class="input-field spc-ucl" placeholder="Upper Control Limit">
                </div>
            </div>
        </div>

        <div class="signoff-config-options" style="display:none;">
            <h6 class="font-semibold text-gray-600 mb-2 border-t pt-3">Sign-off Options</h6>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="md:col-span-2">
                    <label class="block font-semibold mb-1 text-sm">Roles (comma separated)</label>
                    <input type="text" class="input-field signoff-roles" placeholder="Quality Engineer, Production Supervisor, Quality Manager">
                </div>
                <div class="flex items-end">
                    <label class="inline-flex items-center gap-2 text-sm"><input type="checkbox" class="signoff-include-date" checked> Include Date</label>
                </div>
            </div>
        </div>
    `;
        tablesContainer.appendChild(tableContainer);

        const typeSelect = tableContainer.querySelector('.table-type');
        const paramsConfig = tableContainer.querySelector('.parameters-config-options');
        const sampleConfig = tableContainer.querySelector('.sample-config-options');
        const customConfig = tableContainer.querySelector('.custom-config-options');
        const checklistConfig = tableContainer.querySelector('.checklist-config-options');
        const aiConfig = tableContainer.querySelector('.ai-config-options');
        const defectsConfig = tableContainer.querySelector('.defects-config-options');
        const summaryConfig = tableContainer.querySelector('.summary-config-options');
        const spcConfig = tableContainer.querySelector('.spc-config-options');
        const signoffConfig = tableContainer.querySelector('.signoff-config-options');

        function toggleConfigVisibility() {
            const selectedType = typeSelect.value;
            paramsConfig.style.display = selectedType === 'parameters' ? 'block' : 'none';
            sampleConfig.style.display = selectedType === 'sample' ? 'block' : 'none';
            customConfig.style.display = selectedType === 'custom' ? 'block' : 'none';
            checklistConfig.style.display = selectedType === 'checklist' ? 'block' : 'none';
            if (aiConfig) aiConfig.style.display = selectedType === 'ai' ? 'block' : 'none';
            defectsConfig.style.display = selectedType === 'defects' ? 'block' : 'none';
            summaryConfig.style.display = selectedType === 'summary' ? 'block' : 'none';
            spcConfig.style.display = selectedType === 'spc' ? 'block' : 'none';
            signoffConfig.style.display = selectedType === 'signoff' ? 'block' : 'none';
        }

        typeSelect.addEventListener('change', toggleConfigVisibility);
        tableContainer.querySelector('.remove-table-btn').addEventListener('click', () => tableContainer.remove());

        // AI config logic
        if (aiConfig) {
            const copyBtn = aiConfig.querySelector('.ai-copy-prompt-btn');
            const parseBtn = aiConfig.querySelector('.ai-parse-btn');
            const codeInput = aiConfig.querySelector('.ai-code-input');
            const defHolder = aiConfig.querySelector('.ai-definition-json');
            const editor = aiConfig.querySelector('.ai-editor');
            const preview = aiConfig.querySelector('.ai-preview');

            const aiStandardPrompt = `You are a table-config generator. Output ONLY one valid JSON object. No markdown, no code fences, no comments, no extra text. If you cannot produce valid JSON, output nothing.

Return a JSON object with these properties (omit any you don't need):\n\n{
  "name": "Human friendly table title",
  "type": "ai",
  "headerPosition": "top",
  "inspectionPeriod": 60,
  "borders": true,
  "headerRows": [
    [ { "label": "Header 1", "colspan": 2 }, { "label": "Header 2", "rowspan": 2 } ],
    [ { "label": "Sub A" }, { "label": "Sub B" } ]
  ],
  "sections": [ { "title": "Section A", "rows": 2 }, { "title": "Section B", "rows": 3 } ],
  "rows": 5,
  "columns": [
    {
      "key": "parameter",
      "label": "Parameter",
      "type": "text",
      "required": true,
      "placeholder": "e.g. Temp",
      "pattern": "^.{0,120}$"
    },
    {
      "key": "temp_c",
      "label": "Oven Temp (°C)",
      "type": "number",
      "min": 160, "max": 220, "step": 1, "decimals": 0,
      "timeSeries": true,
      "defaultByTime": [180,180,185,190]
    },
    {
      "key": "status",
      "label": "Status",
      "type": "select",
      "options": ["OK","NOT OK"],
      "default": "OK"
    },
    {
      "key": "oos",
      "label": "Out of Spec",
      "type": "checkbox",
      "compute": "cols.temp_c < 160 || cols.temp_c > 220",
      "conditional": [
        { "when": "value==true", "addClass": "cf-danger" }
      ]
    }
  ]
}\n\nRules:\n- Output must be pure JSON (no markdown or explanations).\n- Column types allowed: text, textarea, number, date, time, datetime, select, checkbox.\n- For select, include an \"options\" array.\n- Per-column validation: use min, max, step, decimals, pattern, required, placeholder.\n- Computed columns: add a string property \"compute\" containing an expression evaluated per row.\n  Available variables/functions in expressions:\n  - cols.<key> or cols[\"<key>\"] access other column values in the same row\n  - t is the zero-based time index when the column has timeSeries=true\n  - helpers: sum(list), avg(list), min(a,b,...), max(a,b,...)\n- Conditional formatting: add a \"conditional\" array of rules like\n  { \"when\": \"expression using value and cols\", \"addClass\": \"cf-danger|cf-warning|cf-ok\", \"style\": {\"backgroundColor\":\"#fff\"} }\n  where value is the current cell value and cols provides same-row values.\n- Time series: set timeSeries=true to repeat that column for each inspection slot derived from inspectionPeriod.\n- Sorting: column header click sorting is automatic; no schema flag needed.\n- Summary footer: numeric columns show Sum and Avg in the footer automatically; "decimals" controls rounding.\n- headerRows is optional. If omitted, one header row is created from columns.\n- Use rows for default blank rows when no sections; otherwise define sections with {title, rows}.\n- Ensure header colspans/rowspans match the number of leaf columns.\n- Keep keys lowercase with underscores (e.g., \"oven_temp\").`;

            function copyPrompt() {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(aiStandardPrompt).then(() => {
                        showNotification('AI prompt copied to clipboard', 'success');
                    }).catch(() => {
                        try {
                            const ta = document.createElement('textarea');
                            ta.value = aiStandardPrompt;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            ta.remove();
                            showNotification('AI prompt copied to clipboard', 'success');
                        } catch (e) {
                            showNotification('Unable to copy prompt', 'error');
                        }
                    });
                }
            }

            function buildEditor(def) {
                editor.innerHTML = '';
                const wrap = document.createElement('div');
                wrap.innerHTML = `
                    <div class="p-2 bg-gray-50 border rounded">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label class="block font-semibold text-sm mb-1">Table Name</label>
                                <input type="text" class="input-field ai-name" value="${def.name || ''}">
                            </div>
                            <div>
                                <label class="block font-semibold text-sm mb-1">Default Rows</label>
                                <input type="number" min="0" class="input-field ai-rows" value="${def.rows || 0}">
                            </div>
                        </div>
                        <div class="mt-3">
                            <div class="flex justify-between items-center mb-2">
                                <h6 class="font-semibold">Columns</h6>
                                <button type="button" class="ai-add-col bg-blue-600 text-white px-2 py-1 rounded text-xs"><i class="fas fa-plus mr-1"></i>Add Column</button>
                            </div>
                            <div class="ai-columns space-y-2"></div>
                        </div>
                        <details class="mt-3">
                            <summary class="cursor-pointer font-semibold">Advanced: headerRows (JSON)</summary>
                            <textarea class="ai-headers-json w-full border p-2 rounded h-24 text-xs">${def.headerRows ? JSON.stringify(def.headerRows, null, 2) : ''}</textarea>
                        </details>
                        <details class="mt-3">
                            <summary class="cursor-pointer font-semibold">Advanced: sections (JSON)</summary>
                            <textarea class="ai-sections-json w-full border p-2 rounded h-24 text-xs">${def.sections ? JSON.stringify(def.sections, null, 2) : ''}</textarea>
                        </details>
                        <div class="mt-3">
                            <label class="inline-flex items-center gap-2 text-sm"><input type="checkbox" class="ai-borders" ${def.borders ? 'checked' : ''}> Show borders</label>
                        </div>
                    </div>
                `;
                editor.appendChild(wrap);

                // Advanced table options (integrated)
                try {
                    const advanced = document.createElement('div');
                    advanced.innerHTML = `
                        <div class="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label class="block font-semibold text-sm mb-1">Header position</label>
                                <select class="input-field ai-header-position">
                                    <option value="top" ${(def.headerPosition || 'top') === 'top' ? 'selected' : ''}>Top</option>
                                    <option value="side" ${def.headerPosition === 'side' ? 'selected' : ''}>Side</option>
                                </select>
                            </div>
                            <div>
                                <label class="block font-semibold text-sm mb-1">Inspection period (minutes)</label>
                                <input type="number" min="0" step="1" class="input-field ai-inspection-period" value="${def.inspectionPeriod || ''}" placeholder="e.g. 60 (optional)">
                            </div>
                        </div>`;
                    wrap.appendChild(advanced.firstElementChild || advanced);
                } catch (e) { /* no-op */ }

                const colsRoot = wrap.querySelector('.ai-columns');
                function renderCols() {
                    colsRoot.innerHTML = '';
                    (def.columns || []).forEach((c, idx) => {
                        const row = document.createElement('div');
                        row.className = 'ai-col-row grid grid-cols-1 md:grid-cols-5 gap-2 items-center bg-white border p-2 rounded';
                        row.innerHTML = `
                            <input type="text" class="input-field col-label" placeholder="Label" value="${c.label || ''}">
                            <input type="text" class="input-field col-key" placeholder="Key" value="${c.key || ''}">
                            <select class="input-field col-type">
                                <option value="text" ${c.type === 'text' ? 'selected' : ''}>Text</option>
                                <option value="textarea" ${c.type === 'textarea' ? 'selected' : ''}>Textarea</option>
                                <option value="number" ${c.type === 'number' ? 'selected' : ''}>Number</option>
                                <option value="date" ${c.type === 'date' ? 'selected' : ''}>Date</option>
                                <option value="time" ${c.type === 'time' ? 'selected' : ''}>Time</option>
                                <option value="datetime" ${c.type === 'datetime' ? 'selected' : ''}>Date/Time</option>
                                <option value="select" ${c.type === 'select' ? 'selected' : ''}>Select</option>
                                <option value="checkbox" ${c.type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
                            </select>
                            <input type="text" class="input-field col-options" placeholder="Options (comma)" value="${Array.isArray(c.options) ? c.options.join(',') : ''}" ${c.type === 'select' ? '' : 'style="display:none;"'}>
                            <button type="button" class="rm-col bg-red-500 text-white px-2 py-1 rounded text-xs"><i class="fas fa-trash"></i></button>
                        `;
                        colsRoot.appendChild(row);

                        const typeSel = row.querySelector('.col-type');
                        const optInput = row.querySelector('.col-options');
                        typeSel.addEventListener('change', () => {
                            if (typeSel.value === 'select') optInput.style.display = 'block'; else optInput.style.display = 'none';
                            persist();
                        });
                        ['input', 'change'].forEach(evt => {
                            row.querySelector('.col-label').addEventListener(evt, persist);
                            row.querySelector('.col-key').addEventListener(evt, persist);
                            optInput.addEventListener(evt, persist);
                        });
                        row.querySelector('.rm-col').addEventListener('click', () => {
                            def.columns.splice(idx, 1);
                            renderCols();
                            persist();
                        });

                        // Advanced per-column attributes controls
                        const advDetails = document.createElement('details');
                        advDetails.className = 'col-advanced-details col-span-full mt-2'; // يمتد على عرض الصف بالكامل
                        advDetails.innerHTML = `
    <summary class="text-xs font-medium text-gray-600 cursor-pointer hover:text-blue-600 p-1 rounded hover:bg-gray-100">
        Advanced Options
    </summary>
    <div class="col-advanced-content mt-2 p-3 bg-gray-50 border rounded-md">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
            
            <div class="form-group">
                <label class="text-xs font-medium text-gray-500">Min Value</label>
                <input type="number" class="input-field col-min" placeholder="e.g., 0" value="${typeof c.min !== 'undefined' ? c.min : ''}">
            </div>
            <div class="form-group">
                <label class="text-xs font-medium text-gray-500">Max Value</label>
                <input type="number" class="input-field col-max" placeholder="e.g., 100" value="${typeof c.max !== 'undefined' ? c.max : ''}">
            </div>
            <div class="form-group">
                <label class="text-xs font-medium text-gray-500">Step</label>
                <input type="number" class="input-field col-step" placeholder="e.g., 0.1" value="${typeof c.step !== 'undefined' ? c.step : ''}">
            </div>
            <div class="form-group">
                <label class="text-xs font-medium text-gray-500">Decimals</label>
                <input type="number" class="input-field col-decimals" placeholder="e.g., 2" value="${typeof c.decimals !== 'undefined' ? c.decimals : ''}">
            </div>

            <div class="form-group">
                <label class="text-xs font-medium text-gray-500">Default Value</label>
                <input type="text" class="input-field col-default" placeholder="Initial value" value="${typeof c.default !== 'undefined' ? c.default : ''}">
            </div>
            <div class="form-group">
                <label class="text-xs font-medium text-gray-500">Placeholder</label>
                <input type="text" class="input-field col-placeholder" placeholder="Hint text" value="${c.placeholder || ''}">
            </div>
            <div class="form-group md:col-span-2">
                <label class="text-xs font-medium text-gray-500">Validation Pattern (Regex)</label>
                <input type="text" class="input-field col-pattern" placeholder="e.g., ^[A-Z]{3}$" value="${c.pattern || ''}">
            </div>

            <div class="form-group md:col-span-2">
                <label class="text-xs font-medium text-gray-500">Default by Time (comma-separated)</label>
                <input type="text" class="input-field col-default-by-time" placeholder="e.g., 10,12,15" value="${Array.isArray(c.defaultByTime) ? c.defaultByTime.join(',') : ''}">
            </div>

            <div class="form-group md:col-span-2">
                <label class="text-xs font-medium text-gray-500">Compute (JS expression)</label>
                <input type="text" class="input-field col-compute" placeholder="e.g., cols.value_a + cols.value_b" value="${c.compute ? String(c.compute).replace(/\"/g, '&quot;') : ''}">
                <p class="text-[10px] text-gray-500 mt-1">Use cols.<key>, t (time index for timeSeries), and helpers at runtime.</p>
            </div>
            <div class="form-group md:col-span-2">
                <label class="text-xs font-medium text-gray-500">Conditional (JSON array)</label>
                <textarea class="input-field col-conditional" placeholder='e.g., [{"when":"value>100","addClass":"cf-warning","style":{"backgroundColor":"#fff3cd"}}]' rows="3">${Array.isArray(c.conditional) && c.conditional.length ? JSON.stringify(c.conditional) : ''}</textarea>
            </div>

            <div class="form-group flex items-end pb-1">
                <label class="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" class="col-required" ${c.required ? 'checked' : ''}> Required
                </label>
            </div>
            <div class="form-group flex items-end pb-1">
                <label class="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" class="col-timeseries" ${c.timeSeries ? 'checked' : ''}> Time Series
                </label>
            </div>
        </div>
    </div>
`;
                        row.appendChild(advDetails); // إضافة القسم القابل للطي إلى صف الإعدادات

                        // إعادة ربط الأحداث مع الحقول الجديدة
                        ['input', 'change'].forEach(evt => advDetails.querySelectorAll('input').forEach(inp => inp.addEventListener(evt, persist)));
                    });
                }

                function persist() {
                    def.name = wrap.querySelector('.ai-name').value.trim();
                    def.rows = parseInt(wrap.querySelector('.ai-rows').value || '0', 10) || 0;
                    def.borders = !!wrap.querySelector('.ai-borders').checked;
                    const headerTxt = wrap.querySelector('.ai-headers-json').value.trim();
                    def.headerRows = headerTxt ? safeJson(headerTxt) : undefined;
                    const secTxt = wrap.querySelector('.ai-sections-json').value.trim();
                    def.sections = secTxt ? safeJson(secTxt) : undefined;

                    // table-level extras
                    const hpSel = wrap.querySelector('.ai-header-position');
                    def.headerPosition = hpSel ? hpSel.value : (def.headerPosition || 'top');
                    const ipVal = wrap.querySelector('.ai-inspection-period')?.value;
                    const ip = parseInt(ipVal || '0', 10);
                    def.inspectionPeriod = ip > 0 ? ip : undefined;

                    // columns
                    const rows = colsRoot.querySelectorAll('.ai-col-row');
                    def.columns = Array.from(rows).map(r => {
                        const typeEl = r.querySelector('.col-type');
                        if (!typeEl) {
                            console.warn('AI column row missing .col-type element:', r);
                            return null;
                        }
                        const obj = {
                            label: r.querySelector('.col-label')?.value?.trim() || '',
                            key: r.querySelector('.col-key')?.value?.trim() || '',
                            type: typeEl.value
                        };
                        if (obj.type === 'select') {
                            const raw = r.querySelector('.col-options')?.value || '';
                            const opts = raw.split(',').map(s => s.trim()).filter(Boolean);
                            if (opts.length) obj.options = opts;
                        }
                        // advanced per-column
                        const reqEl = r.querySelector('.col-required');
                        if (reqEl && reqEl.checked) obj.required = true;
                        const minV = parseFloat(r.querySelector('.col-min')?.value);
                        const maxV = parseFloat(r.querySelector('.col-max')?.value);
                        const stepV = parseFloat(r.querySelector('.col-step')?.value);
                        const defV = r.querySelector('.col-default')?.value;
                        const patV = r.querySelector('.col-pattern')?.value;
                        const decV = parseInt(r.querySelector('.col-decimals')?.value);
                        const phV = r.querySelector('.col-placeholder')?.value;
                        const ts = r.querySelector('.col-timeseries')?.checked;
                        const dbt = r.querySelector('.col-default-by-time')?.value;
                        const compV = r.querySelector('.col-compute')?.value?.trim();
                        const condV = r.querySelector('.col-conditional')?.value?.trim();
                        if (!isNaN(minV)) obj.min = minV;
                        if (!isNaN(maxV)) obj.max = maxV;
                        if (!isNaN(stepV)) obj.step = stepV;
                        if (defV !== undefined && defV !== '') obj.default = defV;
                        if (patV) obj.pattern = patV;
                        if (!isNaN(decV)) obj.decimals = decV;
                        if (phV) obj.placeholder = phV;
                        if (ts) obj.timeSeries = true;
                        if (dbt) obj.defaultByTime = dbt.split(',').map(s => s.trim());
                        if (compV) obj.compute = compV;
                        if (condV) { try { obj.conditional = JSON.parse(condV); } catch(e) { /* ignore invalid JSON */ } }
                        return obj;
                    }).filter(Boolean);
                    defHolder.value = JSON.stringify(def);
                    renderPreview(def);
                }

                wrap.querySelector('.ai-add-col').addEventListener('click', () => {
                    if (!Array.isArray(def.columns)) def.columns = [];
                    def.columns.push({ key: `col_${def.columns.length + 1}`, label: `Column ${def.columns.length + 1}`, type: 'text' });
                    renderCols();
                    persist();
                });

                ['input', 'change'].forEach(evt => {
                    wrap.querySelector('.ai-name').addEventListener(evt, persist);
                    wrap.querySelector('.ai-rows').addEventListener(evt, persist);
                    wrap.querySelector('.ai-borders').addEventListener(evt, persist);
                    wrap.querySelector('.ai-headers-json').addEventListener(evt, persist);
                    wrap.querySelector('.ai-sections-json').addEventListener(evt, persist);
                });

                if (!Array.isArray(def.columns)) def.columns = [];
                renderCols();
                persist();
            }

            function safeJson(txt) {
                try { return JSON.parse(txt); } catch (e) { return undefined; }
            }

            function renderPreview(def) {
                if (!def || !Array.isArray(def.columns) || def.columns.length === 0) {
                    preview.innerHTML = '<div class="text-sm text-gray-600">No columns defined yet.</div>';
                    return;
                }
                const colCount = def.columns.length;
                let html = '<div class="bg-blue-100 p-2 flex justify-between items-center"><div class="font-semibold">' + (def.name || 'AI Table') + '</div></div>'; html += '<div class="text-xs text-gray-600">Header: ' + (def.headerPosition || 'top') + ', Borders: ' + (def.borders ? 'on' : 'off') + (def.inspectionPeriod ? (', Inspect every ' + def.inspectionPeriod + ' min') : '') + '</div>';
                html += '<table class="form-table w-full mt-2' + (def.borders ? ' table-bordered' : ' no-borders') + (def.headerPosition === 'side' ? ' header-side' : '') + '">';
                html += '<thead>';
                if (Array.isArray(def.headerRows) && def.headerRows.length > 0) {
                    def.headerRows.forEach(row => {
                        html += '<tr>' + row.map(c => `<th ${c.colspan ? `colspan=\"${c.colspan}\"` : ''} ${c.rowspan ? `rowspan=\"${c.rowspan}\"` : ''}>${c.label || ''}</th>`).join('') + '</tr>';
                    });
                } else {
                    html += '<tr>' + def.columns.map(c => `<th>${c.label || c.key || ''}</th>`).join('') + '</tr>';
                }
                html += '</thead>';
                html += '<tbody>';
                function rowCells() {
                    return def.columns.map(c => {
                        const isComp = !!c.compute;
                        switch (c.type) {
                            case 'number': { const step = (typeof c.decimals === 'number') ? (1 / Math.pow(10, c.decimals)) : 'any'; return `<td><input type="number" class="input-field${isComp ? ' computed-cell' : ''}" step="${step}" ${isComp ? 'readonly style="background:#e0f2fe;"' : ''}></td>`; }
                            case 'date': return `<td><input type="date" class="input-field${isComp ? ' computed-cell' : ''}" ${isComp ? 'readonly style="background:#e0f2fe;"' : ''}></td>`;
                            case 'datetime': return `<td><input type="datetime-local" class="input-field${isComp ? ' computed-cell' : ''}" ${isComp ? 'readonly style="background:#e0f2fe;"' : ''}></td>`;
                            case 'select': return '<td><select class="input-field'+(isComp ? ' computed-cell' : '')+'" '+(isComp ? 'disabled style="background:#e0f2fe;"' : '')+'>' + (Array.isArray(c.options) ? ['<option value="">Select...</option>', ...c.options.map(o => `<option value="${o}">${o}</option>`)].join('') : '') + '</select></td>';
                            case 'time': return `<td><input type="time" class="input-field${isComp ? ' computed-cell' : ''}" ${isComp ? 'readonly style="background:#e0f2fe;"' : ''}></td>`;
                            case 'textarea': return `<td><textarea class="input-field${isComp ? ' computed-cell' : ''}" ${isComp ? 'readonly style="background:#e0f2fe;"' : ''}></textarea></td>`;
                            case 'checkbox': return '<td><input type="checkbox" class="input-field"></td>';
                            default: return `<td><input type="text" class="input-field${isComp ? ' computed-cell' : ''}" ${isComp ? 'readonly style="background:#e0f2fe;"' : ''}></td>`;
                        }
                    }).join('');
                }
                if (Array.isArray(def.sections) && def.sections.length > 0) {
                    def.sections.forEach(sec => {
                        html += `<tr><th colspan="${colCount}" class="text-left bg-gray-50">${sec.title || ''}</th></tr>`;
                        const r = parseInt(sec.rows || 0, 10) || 0;
                        for (let i = 0; i < r; i++) html += `<tr>${rowCells()}</tr>`;
                    });
                } else {
                    const r = parseInt(def.rows || 0, 10) || 0;
                    for (let i = 0; i < r; i++) html += `<tr>${rowCells()}</tr>`;
                }
                html += '</tbody></table>';
                preview.innerHTML = html;
            }

            function parseCode() {
                try {
                    const obj = JSON.parse(codeInput.value);
                    obj.type = 'ai';
                    defHolder.value = JSON.stringify(obj);
                    buildEditor(obj);
                    showNotification('AI code parsed successfully', 'success');
                } catch (e) {
                    showNotification('Invalid JSON code', 'error');
                }
            }

            if (copyBtn) copyBtn.addEventListener('click', copyPrompt);
            if (parseBtn) parseBtn.addEventListener('click', parseCode);
        }

        // Parameters: add parameter button
        paramsConfig.querySelector('.add-parameter-btn').addEventListener('click', () => {
            addParameter(paramsConfig.querySelector('.parameters-container'));
        });

        // Custom: add column button
        if (customConfig) {
            const colBtn = customConfig.querySelector('.add-custom-column-btn');
            if (colBtn) {
                colBtn.addEventListener('click', () => {
                    const colsContainer = customConfig.querySelector('.custom-columns-container');
                    addCustomColumn(colsContainer);
                });
            }

            // *** THIS IS THE NEW FIX ***
            // Add one listener to the parent container for all delete buttons
            const colsContainer = customConfig.querySelector('.custom-columns-container');
            colsContainer.addEventListener('click', function (event) {
                // Check if a remove button was clicked
                const removeButton = event.target.closest('.remove-custom-column-btn');
                if (removeButton) {
                    // Find the column container and remove it
                    removeButton.closest('.custom-column-row').remove();
                }
            });
        }

        // Checklist: add item button
        if (checklistConfig) {
            const addItemBtn = checklistConfig.querySelector('.add-checklist-item-btn');
            if (addItemBtn) {
                addItemBtn.addEventListener('click', () => {
                    const itemsContainer = checklistConfig.querySelector('.checklist-items-container');
                    addChecklistItem(itemsContainer);
                });
            }
        }

        // Prefill when editing
        if (table) {
            if (tableType === 'parameters' && table.parameters) {
                const container = paramsConfig.querySelector('.parameters-container');
                table.parameters.forEach(p => addParameter(container, p));
            } else if (tableType === 'custom') {
                const colsContainer = customConfig.querySelector('.custom-columns-container');
                if (colsContainer && Array.isArray(table.customColumns)) {
                    colsContainer.innerHTML = '';
                    table.customColumns.forEach(col => addCustomColumn(colsContainer, col));
                }
            } else if (tableType === 'checklist') {
                const itemsContainer = checklistConfig.querySelector('.checklist-items-container');
                if (itemsContainer) {
                    itemsContainer.innerHTML = '';
                    if (Array.isArray(table.items) && table.items.length > 0) {
                        table.items.forEach(it => addChecklistItem(itemsContainer, it));
                    } else {
                        addChecklistItem(itemsContainer);
                    }
                }
            } else if (tableType === 'ai') {
                // Preload AI definition into editor/preview
                const aiDef = table.aiDefinition || {};
                const defHolder = tableContainer.querySelector('.ai-definition-json');
                const codeInput = tableContainer.querySelector('.ai-code-input');
                const parseBtn = tableContainer.querySelector('.ai-parse-btn');
                if (defHolder) defHolder.value = JSON.stringify(aiDef);
                if (codeInput) codeInput.value = JSON.stringify(aiDef, null, 2);
                if (parseBtn) parseBtn.click();
            } else if (tableType === 'defects') {
                const cfg = tableContainer.querySelector('.defects-config-options');
                if (cfg) {
                    const typesEl = cfg.querySelector('.defect-types');
                    if (typesEl) typesEl.value = (Array.isArray(table.defectTypes) ? table.defectTypes.join(', ') : (table.defectTypes || ''));
                    const sevEl = cfg.querySelector('.defects-include-severity');
                    const locEl = cfg.querySelector('.defects-include-location');
                    if (sevEl) sevEl.checked = !!table.includeSeverity;
                    if (locEl) locEl.checked = table.includeLocation !== false;
                }
            } else if (tableType === 'summary') {
                const cfg = tableContainer.querySelector('.summary-config-options');
                if (cfg) {
                    const r = cfg.querySelector('.summary-include-rework');
                    const d = cfg.querySelector('.summary-include-downtime');
                    if (r) r.checked = !!table.includeRework;
                    if (d) d.checked = !!table.includeDowntime;
                }
            } else if (tableType === 'spc') {
                const cfg = tableContainer.querySelector('.spc-config-options');
                if (cfg) {
                    const p = cfg.querySelector('.spc-param'); if (p) p.value = table.spcParam || '';
                    const n = cfg.querySelector('.spc-rows'); if (n) n.value = parseInt(table.spcRows || 20, 10);
                    const l = cfg.querySelector('.spc-lcl'); if (l) l.value = (typeof table.spcLCL === 'number' ? table.spcLCL : '');
                    const t = cfg.querySelector('.spc-target'); if (t) t.value = (typeof table.spcTarget === 'number' ? table.spcTarget : '');
                    const u = cfg.querySelector('.spc-ucl'); if (u) u.value = (typeof table.spcUCL === 'number' ? table.spcUCL : '');
                }
            } else if (tableType === 'signoff') {
                const cfg = tableContainer.querySelector('.signoff-config-options');
                if (cfg) {
                    const roles = cfg.querySelector('.signoff-roles');
                    if (roles) roles.value = Array.isArray(table.roles) ? table.roles.join(', ') : (table.roles || '');
                    const inc = cfg.querySelector('.signoff-include-date'); if (inc) inc.checked = table.includeDate !== false;
                }
            }
        } else {
            // When creating new checklist, add one default item row
            if (typeSelect.value === 'checklist') {
                const itemsContainer = checklistConfig.querySelector('.checklist-items-container');
                if (itemsContainer) addChecklistItem(itemsContainer);
            }
        }

        toggleConfigVisibility();
    }

    // Add custom column to custom table
    function addCustomColumn(customColumnsContainer, column = null) {
        const columnContainer = document.createElement('div');
        columnContainer.className = 'custom-column-row border border-gray-200 p-2 mb-2 rounded';

        columnContainer.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
                <input type="text" class="input-field custom-column-name" placeholder="Column Name" value="${column ? column.name : ''}" required>
            </div>
            <div>
                <select class="input-field custom-column-type">
                    <option value="text" ${column && column.type === 'text' ? 'selected' : ''}>Text</option>
                    <option value="number" ${column && column.type === 'number' ? 'selected' : ''}>Number</option>
                    <option value="date" ${column && column.type === 'date' ? 'selected' : ''}>Date</option>
                    <option value="datetime" ${column && column.type === 'datetime' ? 'selected' : ''}>Date/Time</option>
                    <option value="select" ${column && column.type === 'select' ? 'selected' : ''}>Select/Dropdown</option>
                    <option value="checkbox" ${column && column.type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
                </select>
            </div>
            <div class="flex items-center gap-2">
                <input type="text" class="input-field custom-column-options" placeholder="Options (comma-separated)" value="${column && column.options ? column.options.join(',') : ''}" style="display: ${column && column.type === 'select' ? 'block' : 'none'};">
                <button type="button" class="remove-custom-column-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `;

        customColumnsContainer.appendChild(columnContainer);

        // Add event listener for the type dropdown to show/hide the options input
        const typeSelect = columnContainer.querySelector('.custom-column-type');
        const optionsInput = columnContainer.querySelector('.custom-column-options');

        typeSelect.addEventListener('change', () => {
            optionsInput.style.display = typeSelect.value === 'select' ? 'block' : 'none';
        });
    }

    // Add checklist item row
    function addChecklistItem(itemsContainer, item = null) {
        const itemRow = document.createElement('div');
        itemRow.className = 'checklist-item-row flex items-center gap-2 mb-2 p-2 border border-gray-200 rounded';
        itemRow.innerHTML = `
            <input type=\"text\" class=\"input-field checklist-item-text flex-1\" placeholder=\"Checklist item\" value=\"${item ? (item.text || '') : ''}\">\n            <label class=\"flex items-center gap-2 text-sm\"><input type=\"checkbox\" class=\"checklist-item-required\" ${item && item.required ? 'checked' : ''}> Required</label>\n            <button type=\"button\" class=\"remove-checklist-item-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600\"><i class=\"fas fa-trash\"></i></button>
        `;
        itemsContainer.appendChild(itemRow);
        itemRow.querySelector('.remove-checklist-item-btn').addEventListener('click', () => itemRow.remove());
    }

    // Add parameter to table
    // Function to add custom variable row
    function addCustomVariable(variable = null) {
        const variableRow = document.createElement('div');
        variableRow.className = 'variable-row flex gap-2 items-center p-2 bg-white rounded border border-purple-200';

        variableRow.innerHTML = `
            <i class="fas fa-grip-vertical drag-handle text-gray-400" title="Drag to reorder"></i>
            <input type="text" class="input-field variable-name flex-1" 
                placeholder="اسم المتغير (مثال: PACK_WEIGHT_CORRECTION)" 
                value="${variable ? variable.name : ''}" 
                pattern="[A-Z_][A-Z0-9_]*"
                title="استخدم أحرف كبيرة وأرقام و _ فقط، ابدأ بحرف أو _">
            <input type="number" class="input-field variable-value flex-1" 
                placeholder="القيمة (مثال: 0.98)" 
                value="${variable ? variable.value : ''}"
                step="0.001">
            <button type="button" class="remove-variable-btn bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600">
                <i class="fas fa-trash"></i>
            </button>
        `;

        variablesContainer.appendChild(variableRow);

        // Add event listeners
        variableRow.querySelector('.remove-variable-btn').addEventListener('click', () => {
            variableRow.remove();
        });

        // Validate variable name format
        const nameInput = variableRow.querySelector('.variable-name');
        const valueInput = variableRow.querySelector('.variable-value');

        // Update template calculations when value changes
        valueInput.addEventListener('input', () => {
            // Update custom variables map
            if (window.getCustomVariables) {
                window.getCustomVariables();
            }
            // Trigger update of template-calculated fields
            if (window.updateTemplateCalculatedFields) {
                window.updateTemplateCalculatedFields();
            }
        });

        nameInput.addEventListener('input', (e) => {
            const value = e.target.value;
            // Convert to uppercase and replace invalid characters
            e.target.value = value.toUpperCase().replace(/[^A-Z0-9_]/g, '');

            // Update calculation builders with new variables
            if (window.calculationBuilder) {
                window.calculationBuilder.refreshParameterOptions();
            }

            // Trigger update of template-calculated fields
            if (window.updateTemplateCalculatedFields) {
                window.updateTemplateCalculatedFields();
            }
        });

        valueInput.addEventListener('input', (e) => {
            // Update calculation builders when value changes
            if (window.calculationBuilder) {
                window.calculationBuilder.refreshParameterOptions();
            }
        });
    }

    // Formula Engine removed - using CalculationBuilder instead
    // The old FormulaEngine class has been replaced with the GUI-based CalculationBuilder
    // which provides a more user-friendly interface for creating calculations


    // Validate formula syntax
    // DEPRECATED: Legacy formula validation - will be removed
    // function validateFormula(formula) {
    //     if (!formula) return true;
    //     
    //     try {
    //         // Check for balanced brackets
    //         let bracketCount = 0;
    //         for (let char of formula) {
    //             if (char === '[') bracketCount++;
    //             if (char === ']') bracketCount--;
    //             if (bracketCount < 0) return false;
    //         }
    //         if (bracketCount !== 0) return false;
    //         
    //         // Check for balanced parentheses
    //         let parenCount = 0;
    //         for (let char of formula) {
    //             if (char === '(') parenCount++;
    //             if (char === ')') parenCount--;
    //             if (parenCount < 0) return false;
    //         }
    //         if (parenCount !== 0) return false;
    //         
    //         return true;
    //     } catch (error) {
    //         return false;
    //     }
    // }

    // Helper function to convert old formula format to new calculation format
    function convertOldFormulaToCalculation(formula) {
        // Basic conversion - this is a simple fallback
        // In production, you might want to parse the formula more thoroughly
        if (!formula) return null;

        // Try to detect simple operations
        if (formula.includes('/')) {
            return {
                operation: 'divide',
                inputs: [],
                constant: null
            };
        } else if (formula.includes('*')) {
            return {
                operation: 'multiply',
                inputs: [],
                constant: null
            };
        } else if (formula.includes('+')) {
            return {
                operation: 'sum',
                inputs: [],
                constant: null
            };
        } else if (formula.includes('-')) {
            return {
                operation: 'subtract',
                inputs: [],
                constant: null
            };
        }

        return null;
    }


    function addParameter(parametersContainer, parameter = null) {
        const paramContainer = document.createElement('div');
        paramContainer.className = 'parameter-config-item border border-gray-200 p-3 rounded-md bg-gray-50';
        const uniqueName = `calc-mode-${Date.now()}-${Math.random()}`;

        // **DEBUG**: Log the parameter object being added, especially its calculation data.
        console.log('[ADD PARAM] Creating parameter row for:', parameter?.name, 'with calculation:', parameter?.calculation);

        paramContainer.innerHTML = `
        <div class="flex items-start gap-2">
            <i class="fas fa-grip-vertical drag-handle mt-2 text-gray-400 cursor-grab" title="Drag to reorder"></i>
            <div class="flex-1">
                <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input type="text" class="input-field param-name" placeholder="Parameter Name" value="${parameter ? parameter.name : ''}" required>
                    <input type="text" class="input-field param-limits" placeholder="Standard Limits" value="${parameter ? parameter.limits : ''}" required>
                    <select class="input-field param-type">
                        <option value="text" ${parameter && parameter.type === 'text' ? 'selected' : ''}>Text</option>
                        <option value="number" ${!parameter || parameter.type === 'number' ? 'selected' : ''}>Number</option>
                        <option value="temperature" ${parameter && parameter.type === 'temperature' ? 'selected' : ''}>Temperature (°C)</option>
                        <option value="percentage" ${parameter && parameter.type === 'percentage' ? 'selected' : ''}>Percentage (%)</option>
                        <option value="datetime" ${parameter && parameter.type === 'datetime' ? 'selected' : ''}>Date/Time</option>
                        <option value="dropdown" ${parameter && parameter.type === 'dropdown' ? 'selected' : ''}>Dropdown</option>
                        <option value="check" ${parameter && parameter.type === 'check' ? 'selected' : ''}>Check (OK/NOT OK)</option>
                        <option value="grade" ${parameter && parameter.type === 'grade' ? 'selected' : ''}>Grade (A/B/C)</option>
                        <option value="oprp" ${parameter && parameter.type === 'oprp' ? 'selected' : ''}>OPRP</option>
                        <option value="ccp" ${parameter && parameter.type === 'ccp' ? 'selected' : ''}>CCP</option>
                    </select>
                    <button type="button" class="remove-param-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 transition-colors"><i class="fas fa-trash"></i></button>
                </div>
                <div class="numeric-settings-row grid grid-cols-1 md:grid-cols-5 gap-2 mt-2" style="display: none;">
                    <input type="text" class="input-field param-units" placeholder="Units (e.g., g, mm)" value="${parameter && parameter.units ? parameter.units : ''}">
                    <input type="number" class="input-field param-min" placeholder="Min" value="${parameter && parameter.min !== undefined ? parameter.min : ''}">
                    <input type="number" class="input-field param-max" placeholder="Max" value="${parameter && parameter.max !== undefined ? parameter.max : ''}">
                    <input type="number" class="input-field param-decimals" placeholder="Decimals" min="0" step="1" value="${parameter && parameter.decimals !== undefined ? parameter.decimals : 2}">
                    <label class="flex items-center gap-2 text-sm justify-center"><input type="checkbox" class="param-dual-input" ${parameter && parameter.dualInput ? 'checked' : ''}> Dual Input</label>
                </div>
                <div class="dropdown-options-row mt-2" style="display: none;">
                    <label class="block font-semibold mb-1 text-sm">Dropdown Options (comma-separated)</label>
                    <input type="text" class="input-field param-options" placeholder="e.g., Good, Acceptable, Reject" value="${parameter && parameter.options ? parameter.options.join(',') : ''}">
                </div>
                <div class="calculation-wrapper mt-3">
                    <label class="flex items-center gap-2">
                        <input type="checkbox" class="param-is-calculated" ${parameter && parameter.isCalculated ? 'checked' : ''}>
                        <span class="text-sm font-semibold text-gray-700 cursor-pointer"><i class="fas fa-calculator mr-1 text-blue-500"></i>Auto-calculate this parameter</span>
                    </label>
                    <div class="calculation-fields mt-2 p-3 bg-blue-50 border border-blue-200 rounded" style="display: none;">
                        <div class="calc-mode-switch mt-2 text-xs">
                            <label class="mr-3"><input type="radio" name="${uniqueName}" class="calc-mode" value="builder" ${!parameter || !parameter.calcMode || parameter.calcMode === 'builder' ? 'checked' : ''}> Build multi-step formulas</label>
                            <label><input type="radio" name="${uniqueName}" class="calc-mode" value="template" ${parameter && parameter.calcMode === 'template' ? 'checked' : ''}> Formula templates</label>
                        </div>
                        <div class="calc-builder-box mt-2" style="display: none;">
                            <input type="hidden" class="calculation-json" value="${parameter && parameter.calculation ? encodeURIComponent(JSON.stringify(parameter.calculation)) : ''}">
                        </div>
                        <div class="calc-template-box mt-2 p-2 bg-white border rounded" style="display: none;">
                            <div class="mb-2">
                                <label class="block font-semibold mb-1">Select Template</label>
                                <select class="template-select input-field text-xs"></select>
                            </div>
                            <div class="template-latex text-sm mb-2"></div>
                            <div class="template-mapping text-xs"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

        parametersContainer.appendChild(paramContainer);

        const isCalculatedCheckbox = paramContainer.querySelector('.param-is-calculated');
        const calculationFields = paramContainer.querySelector('.calculation-fields');

        // **FIX**: This function now correctly receives the calculation data and passes it on.
        function mountBuilderIfNeeded(calculationData) {
            const builderBox = calculationFields.querySelector('.calc-builder-box');
            if (builderBox && window.calculationBuilder && !builderBox.querySelector('.calc-builder')) {
                // **DEBUG**: Log the calculation data just before mounting the builder.
                console.log('[ADD PARAM] Mounting calculation builder with data:', calculationData);
                window.calculationBuilder.initializeBuilder(builderBox, calculationData);
            }
        }

        isCalculatedCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            calculationFields.style.display = isChecked ? 'block' : 'none';
            if (isChecked) {
                const mode = paramContainer.querySelector('.calc-mode:checked')?.value || 'builder';
                if (mode === 'builder') {
                    // **FIX**: Pass the parameter's calculation data when the checkbox is clicked.
                    mountBuilderIfNeeded(parameter?.calculation);
                } else {
                    refreshTemplateUI();
                }
            }
        });

        paramContainer.querySelector('.remove-param-btn').addEventListener('click', () => {
            paramContainer.remove();
            if (window.calculationBuilder) {
                window.calculationBuilder.refreshParameterOptions();
            }
        });

        const paramNameInput = paramContainer.querySelector('.param-name');
        paramNameInput.addEventListener('input', () => {
            if (window.calculationBuilder) {
                window.calculationBuilder.refreshParameterOptions();
            }
        });

        // This part remains unchanged
        function populateTemplates(selectEl, selectedId) {
            const list = (window.getFormulaTemplates && window.getFormulaTemplates()) || {};
            selectEl.innerHTML = '<option value="">-- Select Template --</option>' + Object.keys(list).map(id => `<option value="${id}" ${selectedId === id ? 'selected' : ''}>${list[id].name || id}</option>`).join('');
        }

        function getActiveProductModalParameters() {
            const modal = document.getElementById('product-modal');
            if (!modal) return { params: [], vars: [] };

            const params = [];
            const seenParams = new Set();
            modal.querySelectorAll('.param-name').forEach(input => {
                const name = input.value.trim();
                if (name && !seenParams.has(name)) {
                    seenParams.add(name);
                    params.push({ id: name, name: name, label: name });
                }
            });

            const vars = [];
            const seenVars = new Set();
            modal.querySelectorAll('.variable-name').forEach(input => {
                const name = input.value.trim();
                if (name && !seenVars.has(name)) {
                    seenVars.add(name);
                    vars.push({ id: name, name: name, label: name });
                }
            });

            return { params, vars };
        }

        function renderMapping(container, tpl, mapping) {
            if (!tpl) { container.innerHTML = ''; return; }

            const currentParamName = paramContainer.querySelector('.param-name').value.trim();
            const { params: availableParams, vars: availableVars } = getActiveProductModalParameters();

            container.innerHTML = '<div class="mb-2 font-semibold">Variables Mapping</div>';

            (tpl.variables || []).forEach(variable => {
                const m = mapping[variable.name] || { type: 'parameter', ref: '' };

                const row = document.createElement('div');
                row.className = 'grid grid-cols-3 gap-2 mb-1 items-center';

                const nameCol = document.createElement('div');
                nameCol.innerHTML = `<code>${variable.name}</code><div class="text-xs text-gray-500">${variable.label || ''}</div>`;
                row.appendChild(nameCol);

                const typeCol = document.createElement('div');
                const typeSelect = document.createElement('select');
                typeSelect.className = 'map-type input-field text-xs';
                typeSelect.dataset.var = variable.name;
                typeSelect.innerHTML = `
                <option value="parameter">Parameter</option>
                <option value="variable">Variable</option>
                <option value="constant">Constant</option>
            `;
                typeSelect.value = m.type;
                typeCol.appendChild(typeSelect);
                row.appendChild(typeCol);

                const refCol = document.createElement('div');
                refCol.className = 'ref-container';
                row.appendChild(refCol);

                container.appendChild(row);

                const updateRefInput = (selectedType) => {
                    refCol.innerHTML = '';
                    let refElement;

                    if (selectedType === 'parameter') {
                        refElement = document.createElement('select');
                        refElement.className = 'map-ref input-field text-xs w-full';
                        availableParams
                            .filter(p => p.name !== currentParamName)
                            .forEach(p => {
                                const option = document.createElement('option');
                                option.value = p.id;
                                option.textContent = p.label;
                                refElement.appendChild(option);
                            });
                    } else if (selectedType === 'variable') {
                        refElement = document.createElement('select');
                        refElement.className = 'map-ref input-field text-xs w-full';
                        availableVars.forEach(v => {
                            const option = document.createElement('option');
                            option.value = v.name;
                            option.textContent = v.label;
                            refElement.appendChild(option);
                        });
                    } else {
                        refElement = document.createElement('input');
                        refElement.type = 'number';
                        refElement.step = 'any';
                        refElement.className = 'map-ref input-field text-xs w-full';
                        refElement.placeholder = 'Enter constant value';
                    }

                    refElement.dataset.var = variable.name;
                    refCol.appendChild(refElement);

                    if (selectedType === m.type) {
                        refElement.value = m.ref || '';
                    }
                };

                typeSelect.addEventListener('change', (e) => {
                    updateRefInput(e.target.value);
                });

                updateRefInput(m.type);
            });
        }

        function refreshTemplateUI() {
            const box = paramContainer.querySelector('.calc-template-box');
            if (!box) return;
            const select = box.querySelector('.template-select');
            const latexBox = box.querySelector('.template-latex');
            const mapBox = box.querySelector('.template-mapping');
            const current = parameter || {};

            populateTemplates(select, current.templateId);

            const tpl = current.templateId ? (window.getFormulaTemplateById && window.getFormulaTemplateById(current.templateId)) : null;
            latexBox.innerHTML = tpl ? `$$${tpl.latex || ''}$$` : '';
            if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([latexBox]);

            let mapping = current.templateMapping || {};
            renderMapping(mapBox, tpl, mapping);

            select.onchange = () => {
                const id = select.value;
                const t = id ? (window.getFormulaTemplateById && window.getFormulaTemplateById(id)) : null;
                latexBox.innerHTML = t ? `$$${t.latex || ''}$$` : '';
                if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([latexBox]);
                renderMapping(mapBox, t, {});
            };
        }
        document.addEventListener('formulaTemplatesUpdated', refreshTemplateUI);

        paramContainer.querySelectorAll('.calc-mode').forEach(r => {
            r.addEventListener('change', (e) => {
                const mode = e.target.value;
                const builderBox = paramContainer.querySelector('.calc-builder-box');
                const templateBox = paramContainer.querySelector('.calc-template-box');
                builderBox.style.display = mode === 'builder' ? 'block' : 'none';
                templateBox.style.display = mode === 'template' ? 'block' : 'none';
                if (mode === 'builder') {
                    // **FIX**: Pass data when switching modes
                    mountBuilderIfNeeded(parameter?.calculation);
                } else {
                    refreshTemplateUI();
                }
            });
        });

        const typeSelectEl = paramContainer.querySelector('.param-type');
        const numericRowEl = paramContainer.querySelector('.numeric-settings-row');
        const dropdownRowEl = paramContainer.querySelector('.dropdown-options-row');
        function updateParamRows() {
            const t = typeSelectEl.value;
            const numericTypes = ['number', 'temperature', 'percentage'];
            numericRowEl.style.display = numericTypes.includes(t) ? 'grid' : 'none';
            dropdownRowEl.style.display = t === 'dropdown' ? 'block' : 'none';
        }
        typeSelectEl.addEventListener('change', updateParamRows);
        updateParamRows();

        // **FIX**: This is the main logic fix. It ensures that when the parameter row
        // is first created, if the "isCalculated" checkbox is already checked,
        // the builder is immediately and correctly initialized with the saved data.
        if (isCalculatedCheckbox.checked) {
            calculationFields.style.display = 'block';
            const initialMode = parameter?.calcMode || 'builder';
            const builderBox = paramContainer.querySelector('.calc-builder-box');
            const templateBox = paramContainer.querySelector('.calc-template-box');

            // Set initial visibility and radio button state
            builderBox.style.display = initialMode === 'builder' ? 'block' : 'none';
            templateBox.style.display = initialMode === 'template' ? 'block' : 'none';
            // Ensure the correct radio button is checked based on saved data
            const radioToCheck = paramContainer.querySelector(`.calc-mode[value="${initialMode}"]`);
            if (radioToCheck) radioToCheck.checked = true;

            if (initialMode === 'builder') {
                // **FIX**: Pass the parameter's calculation data on initial load.
                mountBuilderIfNeeded(parameter?.calculation);
            } else {
                refreshTemplateUI();
            }
        }
    }

    function addCustomColumn(customColumnsContainer, column = null) {
        const columnContainer = document.createElement('div');
        columnContainer.className = 'custom-column-row border border-gray-200 p-2 mb-2 rounded';
        columnContainer.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div><input type="text" class="input-field custom-column-name" placeholder="Column Name" value="${column ? column.name : ''}" required></div>
        <div>
            <select class="input-field custom-column-type">
                <option value="text" ${column && column.type === 'text' ? 'selected' : ''}>Text</option>
                <option value="number" ${column && column.type === 'number' ? 'selected' : ''}>Number</option>
                <option value="date" ${column && column.type === 'date' ? 'selected' : ''}>Date</option>
                <option value="datetime" ${column && column.type === 'datetime' ? 'selected' : ''}>Date/Time</option>
                <option value="select" ${column && column.type === 'select' ? 'selected' : ''}>Select/Dropdown</option>
                <option value="checkbox" ${column && column.type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
            </select>
        </div>
        <div class="flex items-center gap-2">
            <input type="text" class="input-field custom-column-options" placeholder="Options (comma-separated)" value="${column && column.options ? column.options.join(',') : ''}" style="display: ${column && column.type === 'select' ? 'block' : 'none'};">
            <button type="button" class="remove-custom-column-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"><i class="fas fa-trash"></i></button>
        </div>
    </div>
`;
        customColumnsContainer.appendChild(columnContainer);
    }


    function addRecipeRow(ingredient = null, recipeType = 'with-cocoa') {
        const recipeContainer = document.getElementById(`${recipeType}-recipe-container`);
        if (!recipeContainer) return;

        const recipeRow = document.createElement('div');
        recipeRow.className = 'recipe-row';

        // Initialize ingredient with default date format if not present
        if (ingredient && !ingredient.dateFormat) {
            ingredient.dateFormat = 'dd/mm/yyyy'; // Default format
        }

        recipeRow.innerHTML = `
            <input type="text" class="input-field recipe-name" placeholder="Ingredient Name" value="${ingredient ? ingredient.name : ''}" required>
            <input type="text" class="input-field recipe-weight" placeholder="Weight" value="${ingredient ? ingredient.weight : ''}" required>
            <input type="number" class="input-field recipe-shelf-life" placeholder="Shelf Life (months)" value="${ingredient ? ingredient.shelfLife : ''}" required>
            <select class="input-field material-date-format">
                <option value="dd/mm/yyyy" ${ingredient && ingredient.dateFormat === 'dd/mm/yyyy' ? 'selected' : ''}>Day/Month/Year</option>
                <option value="mm/yyyy" ${ingredient && ingredient.dateFormat === 'mm/yyyy' ? 'selected' : ''}>Month/Year</option>
            </select>
            <input type="hidden" class="recipe-type" value="${recipeType}">
            <button type="button" class="remove-recipe-btn bg-red-500 text-white px-2 py-1 rounded"><i class="fas fa-trash"></i></button>
        `;

        recipeContainer.appendChild(recipeRow);

        // Add event listener to remove button
        recipeRow.querySelector('.remove-recipe-btn').addEventListener('click', () => {
            recipeRow.remove();
        });

        // Add event listener to date format selector
        const formatSelect = recipeRow.querySelector('.material-date-format');
        formatSelect.addEventListener('change', function () {
            if (ingredient) {
                ingredient.dateFormat = this.value;
            }
        });
    }

    // Quality Criteria Management Functions
    function addQualityCriteria(criteria = null) {
        const qualityCriteriaContainer = document.getElementById('quality-criteria-config-container');
        const criteriaId = criteria ? criteria.id : `criteria-${Date.now()}`;

        const criteriaDiv = document.createElement('div');
        criteriaDiv.className = 'border border-gray-300 p-3 mb-3 rounded';
        criteriaDiv.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <div class="flex items-center">
                    <i class="fas fa-grip-vertical drag-handle" title="Drag to reorder"></i>
                    <h5 class="font-semibold">Quality Criteria Configuration</h5>
                </div>
                <button type="button" class="remove-criteria-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"><i class="fas fa-trash"></i></button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                <div>
                    <label class="block font-semibold mb-1">Criteria ID:</label>
                    <input type="text" class="input-field criteria-id" value="${criteriaId}" readonly>
                </div>
                <div>
                    <label class="block font-semibold mb-1">Title:</label>
                    <input type="text" class="input-field criteria-title" value="${criteria ? criteria.title : ''}" placeholder="e.g., GRADE A - STANDARD PRODUCT" required>
                </div>
                <div>
                    <label class="block font-semibold mb-1">Icon:</label>
                    <input type="text" class="input-field criteria-icon" value="${criteria ? criteria.icon : 'fas fa-check-circle'}" placeholder="fas fa-check-circle">
                </div>
                <div>
                    <label class="block font-semibold mb-1">Color Theme:</label>
                    <select class="input-field criteria-color">
                        <option value="green" ${criteria && criteria.color === 'green' ? 'selected' : ''}>Green (Success)</option>
                        <option value="yellow" ${criteria && criteria.color === 'yellow' ? 'selected' : ''}>Yellow (Warning)</option>
                        <option value="red" ${criteria && criteria.color === 'red' ? 'selected' : ''}>Red (Error)</option>
                        <option value="blue" ${criteria && criteria.color === 'blue' ? 'selected' : ''}>Blue (Info)</option>
                    </select>
                </div>
            </div>
            <div class="mb-3">
                <div class="flex justify-between items-center mb-2">
                    <h6 class="font-semibold">Criteria Items</h6>
                    <button type="button" class="add-criteria-item-btn bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"><i class="fas fa-plus mr-1"></i>Add Item</button>
                </div>
                <div class="criteria-items-container">
                    <!-- Criteria items will be added here -->
                </div>
            </div>
        `;

        qualityCriteriaContainer.appendChild(criteriaDiv);

        // Add event listeners
        criteriaDiv.querySelector('.remove-criteria-btn').addEventListener('click', () => {
            criteriaDiv.remove();
        });

        criteriaDiv.querySelector('.add-criteria-item-btn').addEventListener('click', () => {
            addCriteriaItem(criteriaDiv.querySelector('.criteria-items-container'));
        });

        // Add existing criteria items if editing
        if (criteria && criteria.items) {
            const itemsContainer = criteriaDiv.querySelector('.criteria-items-container');
            criteria.items.forEach(item => {
                addCriteriaItem(itemsContainer, item);
            });
        } else {
            // Add default criteria item
            addCriteriaItem(criteriaDiv.querySelector('.criteria-items-container'));
        }
    }
    // Signature Management Functions
    function addCriteriaItem(itemsContainer, item = null) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'flex items-center gap-2 mb-2 p-2 border border-gray-200 rounded';

        itemDiv.innerHTML = `
            <div class="flex-1">
                <input type="text" class="input-field criteria-item-label" value="${item ? item.label : ''}" placeholder="Label (e.g., Acceptance:)" required>
            </div>
            <div class="flex-1">
                <input type="text" class="input-field criteria-item-value" value="${item ? item.value : ''}" placeholder="Value (e.g., Not less than 95%)" required>
            </div>
            <button type="button" class="remove-criteria-item-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"><i class="fas fa-trash"></i></button>
        `;

        itemsContainer.appendChild(itemDiv);

        // Add event listener to remove button
        itemDiv.querySelector('.remove-criteria-item-btn').addEventListener('click', () => {
            itemDiv.remove();
        });
    }

    // Generate dynamic quality criteria section based on product configuration
    function generateQualityCriteriaSection(product) {
        const qualityCriteriaContainer = document.getElementById('quality-criteria-container');
        qualityCriteriaContainer.innerHTML = '';

        if (!product || !product.qualityCriteria || product.qualityCriteria.length === 0) {
            return; // No criteria defined for this product
        }

        const sectionDiv = document.createElement('div');
        sectionDiv.innerHTML = `
            <h2 class="section-header p-2 mb-2">
                <i class="fas fa-star mr-2"></i>QUALITY EVALUATION CRITERIA & STANDARDS
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-${Math.min(product.qualityCriteria.length, 3)} gap-4">
                ${product.qualityCriteria.map(criteria => {
            const colorClasses = {
                green: 'border-green-500 bg-green-50 text-green-800',
                yellow: 'border-yellow-500 bg-yellow-50 text-yellow-800',
                red: 'border-red-500 bg-red-50 text-red-800',
                blue: 'border-blue-500 bg-blue-50 text-blue-800'
            };
            const colorClass = colorClasses[criteria.color] || colorClasses.green;

            return `
                        <div class="border p-3 ${colorClass}">
                            <h3 class="font-bold text-center mb-2">
                                <i class="${criteria.icon || 'fas fa-check-circle'} mr-1"></i>${criteria.title}
                            </h3>
                            <ul class="text-xs space-y-1">
                                ${criteria.items.map(item => `<li><strong>${item.label}</strong> ${item.value}</li>`).join('')}
                            </ul>
                        </div>
                    `;
        }).join('')}
            </div>
        `;

        qualityCriteriaContainer.appendChild(sectionDiv);
    }

    // Open product modal for adding new product

    function openProductModal(product = null) {
        editingProductId = product ? product.id : null;
        productForm.reset();

        // تنظيف الحاويات الديناميكية قبل ملء البيانات
        const childTabsNav = document.querySelector('#product-modal .child-tabs-nav');
        const childTabsContent = document.querySelector('#product-modal .child-tabs-content');
        if (childTabsNav) childTabsNav.innerHTML = '';
        if (childTabsContent) childTabsContent.innerHTML = '';

        const recipeConfigContainer = document.getElementById('recipe-config-container');
        if (recipeConfigContainer) recipeConfigContainer.innerHTML = '';
        const variablesContainer = document.getElementById('variables-container');
        if (variablesContainer) variablesContainer.innerHTML = '';
        const qualityCriteriaContainer = document.getElementById('quality-criteria-config-container');
        if (qualityCriteriaContainer) qualityCriteriaContainer.innerHTML = '';


        if (product) {
            // --- تعديل منتج حالي ---
            modalTitle.textContent = 'Edit Product';
            document.getElementById('product-id').value = product.id;
            document.getElementById('product-id').disabled = true;
            document.getElementById('product-name-modal').value = product.name;
            document.getElementById('product-standard-weight').value = product.standardWeight;
            document.getElementById('product-shelf-life').value = product.shelfLife;
            document.getElementById('product-cartons-per-pallet').value = product.cartonsPerPallet;

            if (document.getElementById('product-packs-per-box')) document.getElementById('product-packs-per-box').value = product.packsPerBox || '';
            if (document.getElementById('product-boxes-per-carton')) document.getElementById('product-boxes-per-carton').value = product.boxesPerCarton || '';
            if (document.getElementById('product-empty-box-weight')) document.getElementById('product-empty-box-weight').value = product.emptyBoxWeight || '';
            if (document.getElementById('product-empty-carton-weight')) document.getElementById('product-empty-carton-weight').value = product.emptyCartonWeight || '';
            if (document.getElementById('product-aql-level')) document.getElementById('product-aql-level').value = product.aqlLevel || '1.0%';
            if (document.getElementById('product-batch-code')) document.getElementById('product-batch-code').value = product.batchCode || '';
            updateBatchPreview();

            if (product.sections && Object.keys(product.sections).length > 0) {
                Object.keys(product.sections).forEach(sectionKey => {
                    const sectionData = { id: sectionKey, ...product.sections[sectionKey] };
                    if (typeof window.addFormSection === 'function') {
                        window.addFormSection(sectionData);
                    }
                });
                const firstSectionId = Object.keys(product.sections)[0];
                if (firstSectionId) {
                    setTimeout(() => switchChildTab(firstSectionId), 50);
                }
            } else {
                if (typeof window.addFormSection === 'function') {
                    window.addFormSection();
                }
            }

            // **NEW: Load Custom Variables**
            if (product.customVariables) {
                product.customVariables.forEach(variable => addCustomVariable(variable));
            }

            if (product.recipes && Array.isArray(product.recipes)) {
                product.recipes.forEach(recipe => addRecipeTable(recipeConfigContainer, recipe));
            }
            if (product.qualityCriteria) {
                product.qualityCriteria.forEach(criteria => addQualityCriteria(criteria));
            }

        } else {
            // --- إضافة منتج جديد ---
            modalTitle.textContent = 'Add Product';
            document.getElementById('product-id').disabled = false;

            if (typeof window.addFormSection === 'function') {
                window.addFormSection();
            }
            addRecipeTable(recipeConfigContainer);
        }

        productModal.style.display = 'flex';
    }


    // Edit product
    async function editProduct(productId) {
        // First try local cache
        let product = products[productId];
        
        // If not in cache and API is available, try to fetch from API
        if (!product && typeof window.apiClient !== 'undefined') {
            try {
                const productsResponse = await window.apiClient.getProducts();
                const apiProduct = productsResponse.data?.find(p => p.product_id === productId);
                
                if (apiProduct && apiProduct.id) {
                    const configResponse = await window.apiClient.getProduct(apiProduct.id);
                    product = window.ProductAPIMapper.toUIFormat(configResponse);
                    
                    // Update cache
                    if (product) {
                        products[productId] = product;
                    }
                }
            } catch (error) {
                console.error('Failed to fetch product from API:', error);
            }
        }
        
        if (product) {
            openProductModal(product);
        } else {
            console.error(`Product ${productId} not found`);
            if (typeof showNotification === 'function') {
                showNotification('Product not found', 'error');
            }
        }
    }

    // Delete product
    async function deleteProduct(productId) {
        // Use API if available, otherwise fall back to localStorage
        if (typeof window.deleteProductWithAPI === 'function') {
            try {
                await window.deleteProductWithAPI(productId);
            } catch (error) {
                console.error('API delete failed, falling back to localStorage:', error);
                // Fallback to localStorage
                if (confirm('Are you sure you want to delete this product?')) {
                    delete products[productId];
                    localStorage.setItem('productConfigurations', JSON.stringify(products));
                    renderProductsTable();
                    populateProductDropdown(true);
                    showNotification('Product deleted successfully!');
                }
            }
        } else {
            // Fallback to localStorage if API not available
            if (confirm('Are you sure you want to delete this product?')) {
                delete products[productId];
                localStorage.setItem('productConfigurations', JSON.stringify(products));
                renderProductsTable();
                populateProductDropdown(true);
                showNotification('Product deleted successfully!');
            }
        }
    }

    // Enhanced save product function with date format handling

    async function saveProduct(e) {
        e.preventDefault();

        // -- Manual field validation --
        const requiredFields = [
            { id: 'product-id', name: 'Product ID' },
            { id: 'product-name-modal', name: 'Product Name' },
            { id: 'product-standard-weight', name: 'Standard Weight' },
            { id: 'product-shelf-life', name: 'Shelf Life' },
            { id: 'product-cartons-per-pallet', name: 'Cartons per Pallet' },
        ];

        for (const field of requiredFields) {
            const input = document.getElementById(field.id);
            if (!input || !input.value.trim()) {
                const panel = input.closest('.tab-panel');
                if (panel) {
                    const tabId = panel.id.replace('panel-', '');
                    if (window.productTabsManager) {
                        window.productTabsManager.switchToTab(tabId);
                    }
                }
                showNotification(`Error: '${field.name}' is a required field.`, 'error', 4000);
                setTimeout(() => {
                    input.focus();
                    input.style.borderColor = 'red';
                }, 100);
                return;
            } else {
                input.style.borderColor = '';
            }
        }

        try {
            const productId = document.getElementById('product-id').value;
            const productName = document.getElementById('product-name-modal').value;
            const productStandardWeight = parseFloat(document.getElementById('product-standard-weight').value);
            const productShelfLife = parseInt(document.getElementById('product-shelf-life').value);
            const productCartonsPerPallet = parseInt(document.getElementById('product-cartons-per-pallet').value);
            const productPacksPerBox = parseInt(document.getElementById('product-packs-per-box')?.value || 12);
            const productBoxesPerCarton = parseInt(document.getElementById('product-boxes-per-carton')?.value || 6);
            const productEmptyBoxWeight = parseFloat(document.getElementById('product-empty-box-weight')?.value || 25);
            const productEmptyCartonWeight = parseFloat(document.getElementById('product-empty-carton-weight')?.value || 50);
            const productAqlLevel = document.getElementById('product-aql-level')?.value || '1.0%';
            const productBatchCode = document.getElementById('product-batch-code')?.value?.trim().toUpperCase() || '';
            const productDayFormat = document.getElementById('product-day-format')?.value || 'DD';
            const productMonthFormat = document.getElementById('product-month-format')?.value || 'letter';
            const productDocCode = document.getElementById('product-doc-code')?.value?.trim() || '';
            const productIssueNo = document.getElementById('product-issue-no')?.value?.trim() || '';
            const productReviewNo = document.getElementById('product-review-no')?.value?.trim() || '';
            const productIssueDate = document.getElementById('product-issue-date')?.value || '';
            const productReviewDate = document.getElementById('product-review-date')?.value || '';

            const customVariables = [];
            document.querySelectorAll('#variables-container .variable-row').forEach(row => {
                const name = row.querySelector('.variable-name')?.value?.trim();
                const value = row.querySelector('.variable-value')?.value;
                if (name) {
                    customVariables.push({ name, value });
                }
            });

            const sections = {};
            document.querySelectorAll('#product-modal .child-tabs-content .child-tab-panel').forEach(panel => {
                const sectionId = panel.id;
                const sectionNameInput = panel.querySelector('.section-name');
                const sectionIconInput = panel.querySelector('.section-icon');

                if (sectionNameInput && sectionNameInput.value) {
                    sections[sectionId] = {
                        name: sectionNameInput.value,
                        icon: sectionIconInput ? sectionIconInput.value : 'fas fa-cog',
                        tables: []
                    };

                    panel.querySelectorAll('.table-config-container').forEach(tableContainer => {
                        const tableId = tableContainer.querySelector('.table-id').value;
                        const tableName = tableContainer.querySelector('.table-name').value;
                        const tableType = tableContainer.querySelector('.table-type').value;

                        if (tableName) {
                            const tableData = { id: tableId, name: tableName, type: tableType };
                            if (tableType === 'parameters') {
                                const configContainer = tableContainer.querySelector('.parameters-config-options');
                                if (configContainer) {
                                    tableData.hasAvg = configContainer.querySelector('.table-has-avg')?.checked || false;
                                    tableData.hasStd = configContainer.querySelector('.table-has-std')?.checked || false;
                                    tableData.hasTare1 = configContainer.querySelector('.table-has-tare1')?.checked || false;
                                    tableData.hasTare2 = configContainer.querySelector('.table-has-tare2')?.checked || false;
                                    tableData.inspectionPeriod = parseInt(configContainer.querySelector('.table-inspection-period')?.value || '60', 10);
                                }

                                tableData.parameters = [];
                                let minMaxError = null;
                                configContainer.querySelectorAll('.parameter-config-item').forEach(paramRow => {
                                    const paramName = paramRow.querySelector('.param-name').value;
                                    if (paramName) {
                                        const type = paramRow.querySelector('.param-type')?.value || 'text';
                                        const units = paramRow.querySelector('.param-units')?.value?.trim() || '';
                                        const decimals = parseInt(paramRow.querySelector('.param-decimals')?.value || '0', 10);
                                        const minRaw = paramRow.querySelector('.param-min')?.value;
                                        const maxRaw = paramRow.querySelector('.param-max')?.value;
                                        const minVal = minRaw !== '' ? parseFloat(minRaw) : undefined;
                                        const maxVal = maxRaw !== '' ? parseFloat(maxRaw) : undefined;
                                        if (minVal !== undefined && maxVal !== undefined && minVal > maxVal) {
                                            minMaxError = `Parameter '${paramName}': min (${minVal}) must be <= max (${maxVal})`;
                                        }
                                        const dualInput = !!paramRow.querySelector('.param-dual-input')?.checked;
                                        const optionsStr = paramRow.querySelector('.param-options')?.value || '';
                                        const options = type === 'dropdown' ? optionsStr.split(',').map(s => s.trim()).filter(Boolean) : undefined;

                                        const isCalculated = !!paramRow.querySelector('.param-is-calculated')?.checked;
                                        const modeEl = paramRow.querySelector('.calc-mode:checked');
                                        const calcMode = modeEl ? modeEl.value : 'builder';

                                        // -- START: FIX for Saving Calculation --
                                        let calculation = null;
                                        let templateId = null;
                                        let templateMapping = null;

                                        if (isCalculated) {
                                            if (calcMode === 'builder') {
                                                calculation = window.calculationBuilder.extractCalculation(paramRow);
                                                // If extraction returns null (e.g., UI error), save an empty calculation
                                                // to avoid losing the "isCalculated" state.
                                                if (!calculation) {
                                                    calculation = { steps: [] };
                                                }
                                            } else { // 'template' mode
                                                const tBox = paramRow.querySelector('.calc-template-box');
                                                const sel = tBox?.querySelector('.template-select');
                                                templateId = sel?.value || null;
                                                const tpl = templateId && window.getFormulaTemplateById ? window.getFormulaTemplateById(templateId) : null;
                                                const mapping = {};
                                                if (tpl) {
                                                    (tpl.variables || []).forEach(v => {
                                                        const typeEl = tBox.querySelector(`.map-type[data-var="${v.name}"]`);
                                                        const refEl = tBox.querySelector(`.map-ref[data-var="${v.name}"]`);
                                                        mapping[v.name] = { type: typeEl ? typeEl.value : 'parameter', ref: refEl ? refEl.value : '' };
                                                    });
                                                }
                                                templateMapping = mapping;
                                            }
                                        }
                                        // -- END: FIX for Saving Calculation --

                                        const paramObj = {
                                            name: paramName,
                                            limits: paramRow.querySelector('.param-limits').value,
                                            type, units, decimals, dualInput, isCalculated, calcMode, calculation, templateId, templateMapping
                                        };
                                        if (minVal !== undefined) paramObj.min = minVal;
                                        if (maxVal !== undefined) paramObj.max = maxVal;
                                        if (options) paramObj.options = options;
                                        tableData.parameters.push(paramObj);
                                    }
                                });
                                if (minMaxError) {
                                    showNotification(minMaxError, 'error', 5000);
                                    throw new Error(minMaxError);
                                }
                            } else if (tableType === 'sample') {
                                const configContainer = tableContainer.querySelector('.sample-config-options');
                                if (configContainer) {
                                    tableData.sampleRows = parseInt(configContainer.querySelector('.sample-rows')?.value || '20', 10);
                                    tableData.samplePrefix = configContainer.querySelector('.sample-prefix')?.value || 'Sample';
                                    tableData.inspectionPeriod = parseInt(configContainer.querySelector('.table-inspection-period')?.value || '60', 10);
                                    tableData.hasAvg = configContainer.querySelector('.table-has-avg')?.checked || false;
                                    tableData.hasStd = configContainer.querySelector('.table-has-std')?.checked || false;
                                    tableData.hasTare1 = configContainer.querySelector('.table-has-tare1')?.checked || false;
                                    tableData.hasTare2 = configContainer.querySelector('.table-has-tare2')?.checked || false;
                                    tableData.hasRejectionCriteria = configContainer.querySelector('.table-has-rejection-criteria')?.checked || false;
                                }
                            } else if (tableType === 'custom') {
                                const configContainer = tableContainer.querySelector('.custom-config-options');
                                if (configContainer) {
                                    tableData.customRows = parseInt(configContainer.querySelector('.custom-rows')?.value || '1', 10);
                                    tableData.allowAddRows = !!configContainer.querySelector('.custom-allow-add-rows')?.checked;
                                    tableData.customColumns = [];
                                    configContainer.querySelectorAll('.custom-column-row').forEach(row => {
                                        const name = row.querySelector('.custom-column-name')?.value?.trim() || '';
                                        const type = row.querySelector('.custom-column-type')?.value || 'text';
                                        const optionsStr = row.querySelector('.custom-column-options')?.value || '';
                                        const options = type === 'select' ? optionsStr.split(',').map(s => s.trim()).filter(Boolean) : undefined;
                                        if (name) {
                                            const col = { name, type };
                                            if (options) col.options = options;
                                            tableData.customColumns.push(col);
                                        }
                                    });
                                }
                            } else if (tableType === 'checklist') {
                                const configContainer = tableContainer.querySelector('.checklist-config-options');
                                if (configContainer) {
                                    tableData.items = [];
                                    configContainer.querySelectorAll('.checklist-item-row').forEach(row => {
                                        const text = row.querySelector('.checklist-item-text')?.value || '';
                                        const required = !!row.querySelector('.checklist-item-required')?.checked;
                                        if (text) tableData.items.push({ text, required });
                                    });
                                }
                            } else if (tableType === 'ai') {
                                const defHolder = tableContainer.querySelector('.ai-definition-json');
                                if (defHolder && defHolder.value) {
                                    try { tableData.aiDefinition = JSON.parse(defHolder.value); } catch (e) { tableData.aiDefinition = {}; }
                                }
                            } else if (tableType === 'defects') {
                                const configContainer = tableContainer.querySelector('.defects-config-options');
                                if (configContainer) {
                                    const typesStr = configContainer.querySelector('.defect-types')?.value || '';
                                    tableData.defectTypes = typesStr.split(',').map(s=>s.trim()).filter(Boolean);
                                    tableData.includeSeverity = !!configContainer.querySelector('.defects-include-severity')?.checked;
                                    tableData.includeLocation = !!configContainer.querySelector('.defects-include-location')?.checked;
                                }
                            } else if (tableType === 'summary') {
                                const configContainer = tableContainer.querySelector('.summary-config-options');
                                if (configContainer) {
                                    tableData.includeRework = !!configContainer.querySelector('.summary-include-rework')?.checked;
                                    tableData.includeDowntime = !!configContainer.querySelector('.summary-include-downtime')?.checked;
                                }
                            } else if (tableType === 'spc') {
                                const configContainer = tableContainer.querySelector('.spc-config-options');
                                if (configContainer) {
                                    tableData.spcParam = configContainer.querySelector('.spc-param')?.value || '';
                                    tableData.spcRows = parseInt(configContainer.querySelector('.spc-rows')?.value || '20', 10);
                                    const lcl = configContainer.querySelector('.spc-lcl')?.value;
                                    const t = configContainer.querySelector('.spc-target')?.value;
                                    const ucl = configContainer.querySelector('.spc-ucl')?.value;
                                    if (lcl !== '') tableData.spcLCL = parseFloat(lcl);
                                    if (t !== '') tableData.spcTarget = parseFloat(t);
                                    if (ucl !== '') tableData.spcUCL = parseFloat(ucl);
                                }
                            } else if (tableType === 'signoff') {
                                const configContainer = tableContainer.querySelector('.signoff-config-options');
                                if (configContainer) {
                                    const rolesStr = configContainer.querySelector('.signoff-roles')?.value || 'Quality Engineer, Production Supervisor, Quality Manager';
                                    tableData.roles = rolesStr.split(',').map(s=>s.trim()).filter(Boolean);
                                    tableData.includeDate = !!configContainer.querySelector('.signoff-include-date')?.checked;
                                }
                            }
                            sections[sectionId].tables.push(tableData);
                        }
                    });
                }
            });


            const productData = {
                id: productId,
                name: productName,
                code: productId, // Use productId as code if not explicitly set
                standardWeight: productStandardWeight,
                shelfLife: productShelfLife,
                cartonsPerPallet: productCartonsPerPallet,
                packsPerBox: productPacksPerBox,
                boxesPerCarton: productBoxesPerCarton,
                emptyBoxWeight: productEmptyBoxWeight,
                emptyCartonWeight: productEmptyCartonWeight,
                aqlLevel: productAqlLevel,
                batchCode: productBatchCode,
                dayFormat: productDayFormat,
                monthFormat: productMonthFormat,
                docCode: productDocCode,
                issueNo: productIssueNo,
                reviewNo: productReviewNo,
                issueDate: productIssueDate,
                reviewDate: productReviewDate,
                customVariables,
                sections: sections
            };

            // Try to save via API first, fallback to localStorage
            if (typeof window.saveProductWithAPI === 'function') {
                try {
                    await window.saveProductWithAPI(productData);
                    return; // Exit if API save successful
                } catch (apiError) {
                    console.error('API save failed, falling back to localStorage:', apiError);
                    // Continue to localStorage fallback below
                }
            }

            // Fallback to localStorage
            products[productId] = productData;
            localStorage.setItem('productConfigurations', JSON.stringify(products));
            renderProductsTable();
            populateProductDropdown(true);
            productModal.style.display = 'none';
            showNotification('Product saved successfully!', 'success');

            // If the saved/updated product is currently selected, refresh batch and header
            try {
                if (productSelect && productSelect.value === productId) {
                    updateDocumentHeaderDisplay(products[productId]);
                    generateBatchNumber();
                }
            } catch(_){}


        } catch (error) {
            logError('Product Save Operation', error);
            showNotification(`Failed to save product: ${error.message}`, 'error', 7000);
        }
    }


    // In the addEventListeners function, find the old recipe button listeners and replace them with this:
    try {
        const addRecipeBtn = document.getElementById('add-recipe-btn');
        if (addRecipeBtn) {
            addRecipeBtn.addEventListener('click', () => {
                const cont = document.getElementById('recipe-config-container');
                if (cont) addRecipeTable(cont);
            });
        }
    } catch (e) {
        console.warn('add-recipe-btn binding skipped:', e);
    }
    // Import products
    function importProducts() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = e => {
            const file = e.target.files[0];
            const reader = new FileReader();

            reader.onload = event => {
                try {
                    const importedProducts = JSON.parse(event.target.result);

                    // Validate imported products
                    let isValid = true;
                    Object.keys(importedProducts).forEach(key => {
                        const product = importedProducts[key];
                        if (!product.id || !product.name || !product.standardWeight) {
                            isValid = false;
                        }
                    });

                    if (!isValid) {
                        showNotification('Invalid file format.', 'error');
                        return;
                    }

                    // Merge with existing products
                    products = { ...products, ...importedProducts };

                    // Save to localStorage
                    localStorage.setItem('productConfigurations', JSON.stringify(products));

                    // Update UI
                    renderProductsTable();
                    populateProductDropdown();

                    showNotification('Products imported successfully!');
                } catch (error) {
                    showNotification('Error importing products.', 'error');
                }
            };

            reader.readAsText(file);
        };

        input.click();
    }

    // Export products
    function exportProducts() {
        const dataStr = JSON.stringify(products, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

        const exportFileDefaultName = 'product-configurations.json';

        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();

        showNotification('Products exported successfully!');
    }

    // Search products
    function searchProducts() {
        const searchTerm = productSearch.value.toLowerCase();

        document.querySelectorAll('#products-table-body tr').forEach(row => {
            const productId = row.cells[0].textContent.toLowerCase();
            const productName = row.cells[1].textContent.toLowerCase();

            if (productId.includes(searchTerm) || productName.includes(searchTerm)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }


    // Initialize analytics charts
    // Analytics function removed
    function removedAnalytics() {
        // Get saved form data or generate sample data
        const savedData = localStorage.getItem('biscuitReportForm');
        let formData = {};

        if (savedData) {
            formData = JSON.parse(savedData);
        } else {
            // Generate sample data
            for (let i = 1; i <= 12; i++) {
                const group = i < 10 ? '0' + i : i.toString();
                formData[`AVG_${group}`] = (180 + Math.random() * 20).toFixed(2);
                formData[`STD_${group}`] = (Math.random() * 5).toFixed(2);
            }
        }

        // Prepare data for weight chart
        const weightLabels = [];
        const weightData = [];

        for (let i = 1; i <= 12; i++) {
            const group = i < 10 ? '0' + i : i.toString();
            weightLabels.push(`Hour ${i}`);
            weightData.push(parseFloat(formData[`AVG_${group}`]) || 0);
        }

        // Prepare data for grade chart
        const gradeLabels = ['Grade A', 'Grade B', 'Grade C'];
        const gradeData = [75, 20, 5]; // Sample data

        // Destroy existing charts if they exist
        if (weightChart) weightChart.destroy();
        if (gradeChart) gradeChart.destroy();

        // Create weight chart
        const weightCtx = document.getElementById('weight-chart');
        if (weightCtx) {
            weightChart = new Chart(weightCtx.getContext('2d'), {
                type: 'line',
                data: {
                    labels: weightLabels,
                    datasets: [{
                        label: 'Average Weight (g)',
                        data: weightData,
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: false
                        }
                    }
                }
            });
        }

        // Create grade chart
        const gradeCtx = document.getElementById('grade-chart');
        if (gradeCtx) {
            gradeChart = new Chart(gradeCtx.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: gradeLabels,
                    datasets: [{
                        data: gradeData,
                        backgroundColor: [
                            'rgba(75, 192, 192, 0.7)',
                            'rgba(255, 206, 86, 0.7)',
                            'rgba(255, 99, 132, 0.7)'
                        ],
                        borderColor: [
                            'rgba(75, 192, 192, 1)',
                            'rgba(255, 206, 86, 1)',
                            'rgba(255, 99, 132, 1)'
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }

        // Update statistics
        const totalBatches = document.getElementById('total-batches');
        const passRate = document.getElementById('pass-rate');
        const failRate = document.getElementById('fail-rate');

        if (totalBatches) totalBatches.textContent = '24';
        if (passRate) passRate.textContent = '92%';
        if (failRate) failRate.textContent = '8%';

        // Update batch history table
        const batchHistoryTable = document.getElementById('batch-history-table');
        if (batchHistoryTable) {
            batchHistoryTable.innerHTML = `
                <tr>
                    <td>BBS01A</td>
                    <td>Plain Biscuits (No Cocoa)</td>
                    <td>2023-06-15</td>
                    <td><span class="shift-indicator shift-a">A</span></td>
                    <td><span class="text-green-600">PASS</span></td>
                    <td>
                        <button class="text-blue-600 hover:text-blue-800"><i class="fas fa-eye"></i></button>
                        <button class="text-green-600 hover:text-green-800 ml-2"><i class="fas fa-check"></i></button>
                    </td>
                </tr>
                <tr>
                    <td>BBC02B</td>
                    <td>Plain Biscuits (With Cocoa)</td>
                    <td>2023-06-15</td>
                    <td><span class="shift-indicator shift-b">B</span></td>
                    <td><span class="text-green-600">PASS</span></td>
                    <td>
                        <button class="text-blue-600 hover:text-blue-800"><i class="fas fa-eye"></i></button>
                        <button class="text-green-600 hover:text-green-800 ml-2"><i class="fas fa-check"></i></button>
                    </td>
                </tr>
                <tr>
                    <td>SBBS03C</td>
                    <td>Sandwich (No Cocoa)</td>
                    <td>2023-06-14</td>
                    <td><span class="shift-indicator shift-c">C</span></td>
                    <td><span class="text-red-600">FAIL</span></td>
                    <td>
                        <button class="text-blue-600 hover:text-blue-800"><i class="fas fa-eye"></i></button>
                        <button class="text-red-600 hover:text-red-800 ml-2"><i class="fas fa-times"></i></button>
                    </td>
                </tr>
            `;
        }
    }
    // ========================================================
    // START: نظام التنبيهات المبسط والديناميكي (نسخة نهائية مع زر تفعيل الصوت)
    // ========================================================

    let alertCheckerInterval = null;
    const firedAlerts = new Map();

    // -- إعداد التنبيه الصوتي --
    const notificationSound = new Audio("data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjQ1LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABMYXZjAAAAAAAAAAAAAAAAAAAAAABULW5DAAAAAAAAAAAAAAAAAAAAAENvbnRlbnQtdHlwZQAAAAAAAAAAAAAAAFQAAAAJAAADUgAAA1IAAAUrgAAA1QodAAAAAAAASW5mbwAAAA8AAAAEAAAAQAAgICAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw... (rest of base64 string)");
    let isAudioEnabled = false;

    /**
     * يقوم بتشغيل صوت التنبيه إذا كان مفعّلاً.
     */
    function playNotificationSound() {
        if (isAudioEnabled) {
            notificationSound.currentTime = 0;
            notificationSound.volume = 0.7; // Set reasonable volume
            notificationSound.play().catch(error => {
                console.error("خطأ في تشغيل الصوت:", error);
                // Try using the enhanced sound system as fallback
                if (window.AlertSoundSystem && window.AlertSoundSystem.playSound) {
                    window.AlertSoundSystem.playSound('notification');
                }
            });
        }
    }

    /**
     * يقوم بإعداد زر تفعيل الصوت.
     */
    function setupAudioEnabler() {
        const enableAudioBtn = document.getElementById('enable-audio-btn');
        if (enableAudioBtn && !enableAudioBtn.hasAttribute('data-initialized')) {
            enableAudioBtn.setAttribute('data-initialized', 'true');
            enableAudioBtn.addEventListener('click', () => {
                isAudioEnabled = true;
                // Enable both systems
                if (window.AlertSoundSystem) {
                    window.AlertSoundSystem.enableSound(true);
                }
                playNotificationSound(); // تشغيل صوت اختباري
                showNotification('تم تفعيل التنبيهات الصوتية!', 'success');
                enableAudioBtn.textContent = 'الصوت مفعّل ✓';
                enableAudioBtn.disabled = true;
                enableAudioBtn.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                enableAudioBtn.classList.add('bg-green-600', 'cursor-not-allowed', 'opacity-75');
            }, { once: true }); // يتم تشغيل هذا الحدث مرة واحدة فقط
        }
    }


    /**
     * يعرض واجهة التنبيهات المبسطة بناءً على المنتج المحدد.
     * @param {object} product - كائن المنتج المحدد.
     */
    function renderSimplifiedAlerts(product) {
        const container = document.getElementById('simplified-alerts-container');
        const alertsSection = document.getElementById('alerts-section');
        if (!container) return;
        container.innerHTML = '';

        const criticalParams = [];
        if (product && product.sections) {
            Object.values(product.sections).forEach(section => {
                section.tables?.forEach(table => {
                    table.parameters?.forEach(param => {
                        if (param.type === 'ccp' || param.type === 'oprp') {
                            criticalParams.push({
                                name: param.name,
                                id: `${table.id}-${param.name.replace(/\s/g, '-')}`,
                                tableName: table.name
                            });
                        }
                    });
                });
            });
        }

        if (criticalParams.length === 0) {
            // Hide alerts section if no critical parameters
            if (alertsSection) alertsSection.style.display = 'none';
            container.innerHTML = '<div class="p-4 text-center text-gray-500">لا توجد نقاط فحص حرجة (CCP/OPRP) معرفة لهذا المنتج.</div>';
            return;
        }

        // Show alerts section if there are critical parameters
        if (alertsSection) alertsSection.style.display = 'block';

        const alertStates = loadAlertStates();
        criticalParams.forEach(param => {
            // Alerts are now enabled by default
            const isEnabled = alertStates[param.id] !== false;
            const item = document.createElement('div');
            item.className = 'alert-toggle-item flex justify-between items-center p-3 border-b hover:bg-gray-50';
            item.innerHTML = `
            <div>
                <span class="font-semibold text-gray-800">${param.name}</span>
                <span class="text-xs text-gray-500 ml-2">(${param.tableName})</span>
            </div>
            <label class="switch">
                <input type="checkbox" class="alert-toggle" data-alert-id="${param.id}" ${isEnabled ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
        `;
            container.appendChild(item);
        });

        container.querySelectorAll('.alert-toggle').forEach(toggle => {
            toggle.addEventListener('change', handleAlertToggleChange);
        });
    }

    /**
     * يتعامل مع تغيير حالة تفعيل/تعطيل التنبيه.
     */
    function handleAlertToggleChange(event) {
        const alertId = event.target.dataset.alertId;
        const isEnabled = event.target.checked;

        const alertStates = loadAlertStates();
        alertStates[alertId] = isEnabled;
        saveAlertStates(alertStates);

        const friendlyName = alertId.split('-').slice(1).join(' ');
        showNotification(`تنبيه "${friendlyName}" تم ${isEnabled ? 'تفعيله' : 'تعطيله'}.`, 'info');

        startAlertChecker();
    }

    /**
     * يحمل حالة التنبيهات من الذاكرة المحلية.
     */
    function loadAlertStates() {
        try {
            const states = localStorage.getItem('simplifiedAlertStates');
            return states ? JSON.parse(states) : {};
        } catch (e) {
            console.error('Failed to load alert states:', e);
            return {};
        }
    }

    /**
     * يحفظ حالة التنبيهات في الذاكرة المحلية.
     */
    function saveAlertStates(states) {
        try {
            localStorage.setItem('simplifiedAlertStates', JSON.stringify(states));
        } catch (e) {
            console.error('Failed to save alert states:', e);
        }
    }

    /**
     * يبدأ المدقق الزمني للبحث عن التنبيهات المستحقة.
     */
    function startAlertChecker() {
        if (alertCheckerInterval) clearInterval(alertCheckerInterval);

        const today = new Date().toLocaleDateString();
        if (localStorage.getItem('alertFiredDate') !== today) {
            firedAlerts.clear();
            localStorage.setItem('alertFiredDate', today);
        }

        alertCheckerInterval = setInterval(checkDueAlerts, 15000);
        console.log('Alert checker started (15s interval).');
    }

    /**
     * يتحقق من وجود تنبيهات مستحقة بناءً على الوقت الحالي (بنافذة زمنية دقيقة واحدة).
     */
    function checkDueAlerts() {
        const now = new Date();

        const alertStates = loadAlertStates();
        const enabledAlertIds = Object.keys(alertStates).filter(id => alertStates[id]);

        if (enabledAlertIds.length === 0) return;

        const inspectionTimes = new Set();
        document.querySelectorAll('tr[id^="time-headers-"] th').forEach(th => {
            inspectionTimes.add(th.textContent.trim());
        });

        inspectionTimes.forEach(inspectionTime => {
            const [hour, minute] = inspectionTime.split(':').map(Number);
            const inspectionDateTime = new Date();
            inspectionDateTime.setHours(hour, minute, 0, 0);

            const timeDiff = now - inspectionDateTime;
            if (timeDiff >= 0 && timeDiff < 60000) {
                const fireKey = inspectionTime;
                if (!firedAlerts.has(fireKey)) {
                    showNotification(`تنبيه فحص! 🚨 الوقت الآن ${inspectionTime}، الرجاء إجراء الفحوصات المجدولة.`, 'warning', 10000);
                    playNotificationSound();
                    firedAlerts.set(fireKey, true);
                }
            }
        });
    }
    function applyStatusStylesToSelect(selectElement) {
        if (!selectElement || selectElement.tagName !== 'SELECT') return;

        const value = selectElement.value.toUpperCase();

        // إزالة الأنماط القديمة أولاً
        selectElement.classList.remove('status-accepted', 'status-rejected', 'status-warning');

        // تطبيق النمط الجديد
        if (value === 'OK' || value === 'PASS' || value === 'ACCEPTED') {
            selectElement.classList.add('status-accepted');
        } else if (value === 'NOT OK' || value === 'FAIL' || value === 'REJECTED') {
            selectElement.classList.add('status-rejected');
        } else if (value === 'REVIEW' || value === 'HOLD') {
            selectElement.classList.add('status-warning');
        }
    }
    // END: نظام التنبيهات المبسط والديناميكي (نسخة نهائية مع زر تفعيل الصوت)
    // ========================================================
    function addEventListeners() {
        if (productSelect) {
            productSelect.addEventListener('change', (e) => {
                const productType = e.target.value;
                const selectedProduct = products[productType];

                // Update editing product ID for custom variables access
                editingProductId = productType || null;
                renderSimplifiedAlerts(selectedProduct);

                // Provide custom variables to Calculation Builder and refresh inputs
                if (window.calculationBuilder) {
                    window.calculationBuilder.setCustomVariables(selectedProduct?.customVariables || []);
                    // Refresh all input options after product change
                    setTimeout(() => {
                        window.calculationBuilder.refreshParameterOptions();
                        window.calculationBuilder.recalculateAll();
                    }, 500);
                }

                // Update custom variables globally and refresh template calculations
                if (window.getCustomVariables) {
                    window.getCustomVariables();
                }
                if (window.updateTemplateCalculatedFields) {
                    setTimeout(() => {
                        window.updateTemplateCalculatedFields();
                    }, 100);
                }

                generateBatchNumber();

                if (selectedProduct) {
                    renderDynamicSections(selectedProduct);

                    // Formula engine initialization removed - using CalculationBuilder instead
                    // Hourly table is now handled dynamically

                    // Render recipe tables after sections are created
                    setTimeout(() => {
                        if (selectedProduct.ingredients_type === 'with-cocoa' || selectedProduct.ingredients_type === 'both') {
                            renderRecipe('with-cocoa', 'ingredients-with-cocoa-table', selectedProduct.recipe);
                        }
                        if (selectedProduct.ingredients_type === 'without-cocoa' || selectedProduct.ingredients_type === 'both') {
                            renderRecipe('without-cocoa', 'ingredients-without-cocoa-table', selectedProduct.recipe);
                        }
                        if (selectedProduct.has_cream && selectedProduct.creamRecipe) {
                            renderRecipe('cream', 'cream-ingredients-table', selectedProduct.creamRecipe);
                        }

                        // Initialize image uploads after sections are rendered
                        initializeImageUploads();

                        // Generate quality criteria section
                        generateQualityCriteriaSection(selectedProduct);

                        // Populate standard weight fields AFTER all sections are rendered
                        populateStandardWeightFields(selectedProduct);

                        // Add event listeners for inputs
                        document.querySelectorAll('input, select').forEach(input => {
                            if (input.type === 'number' || input.dataset.min) {
                                input.addEventListener('input', validateInputs);
                            }
                            if (input.type === 'radio') {
                                input.addEventListener('change', handleStopEvent);
                            }
                        });

                        // Update calculation options and recalculate after everything is set up
                        if (window.calculationBuilder) {
                            setTimeout(() => {
                                window.calculationBuilder.refreshParameterOptions();
                                window.calculationBuilder.recalculateAll();
                            }, 200);
                        }

                        // Update header/footer meta for selected product
                        updateDocumentHeaderDisplay(selectedProduct);
                        document.querySelectorAll('.form-table select').forEach(applyStatusStylesToSelect);
                    }, 100);
                } else {
                    // Clear sections and quality criteria if no product is selected
                    dynamicSectionsContainer.innerHTML = '';
                    const qualityCriteriaContainer = document.getElementById('quality-criteria-container');
                    qualityCriteriaContainer.innerHTML = '';
                    // Hourly table is now handled dynamically
                }
            });
        }

        if (dateInput) dateInput.addEventListener('change', generateBatchNumber);

        // Add event listener for shift duration change
        if (shiftDurationSelect) {
            shiftDurationSelect.addEventListener('change', function () {
                // Store current product selection
                const currentProductValue = productSelect.value;

                updateShiftOptions();
                generateTimeHeaders();

                // Restore product selection if it was cleared
                if (currentProductValue && !productSelect.value) {
                    productSelect.value = currentProductValue;
                }

                // Ensure dynamic sections are re-rendered if product is selected
                if (productSelect.value && products && products[productSelect.value]) {
                    const selectedProduct = products[productSelect.value];
                    renderDynamicSections(selectedProduct);

                    // Formula engine initialization removed - using CalculationBuilder instead
                }
            });

            // Add event listener for start inspection time change
            const startInspectionTimeInput = document.getElementById('start-inspection-time');
            if (startInspectionTimeInput) {
                startInspectionTimeInput.addEventListener('change', function () {
                    generateTimeHeaders();
                    showNotification('Inspection times updated based on new start time', 'info');
                });
            }

            // Add event listener for default inspection period change
            const defaultInspectionPeriodSelect = document.getElementById('default-inspection-period');
            if (defaultInspectionPeriodSelect) {
                defaultInspectionPeriodSelect.addEventListener('change', function () {
                    generateTimeHeaders();
                    showNotification(`Default inspection period changed to ${this.options[this.selectedIndex].text}`, 'info');
                });
            }
        }

        // Add event listener for shift letter change
        if (shiftInput) shiftInput.addEventListener('change', generateBatchNumber);

        // Pallet row management is now handled dynamically

        document.querySelectorAll('.border-b.border-gray-400.w-full.ml-2.input-field').forEach(el => {
            el.addEventListener('focus', () => {
                if (el.id === 'qa-sig-date' || el.id === 'prod-sig-date') {
                    el.textContent = new Date().toLocaleString();
                }
            });
        });

        // Legacy save removed from UI. Use reports workflow instead.
// if (saveBtn) saveBtn.addEventListener('click', saveForm);
if (saveToReportsBtn) saveToReportsBtn.addEventListener('click', ()=>{ try{ window.dispatchEvent(new CustomEvent('requestSaveToReports')); }catch(_){}});
        // if (loadBtn) loadBtn.addEventListener('click', loadForm);
        if (resetBtn) resetBtn.addEventListener('click', resetForm);
        if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportToPDFProfessional);
        // ربط زر الطباعة المحسن
        // Print button removed from UI; printing handled by inline script in index.html
// (no-op)

        // Product management event listeners
        if (addProductBtn) addProductBtn.addEventListener('click', () => openProductModal());
        if (importProductsBtn) importProductsBtn.addEventListener('click', importProducts);
        if (exportProductsBtn) exportProductsBtn.addEventListener('click', exportProducts);
        if (productSearch) productSearch.addEventListener('input', searchProducts);

        // Modal event listeners
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (productModal) productModal.style.display = 'none';
            });
        }

        if (cancelProductBtn) {
            cancelProductBtn.addEventListener('click', () => {
                if (productModal) productModal.style.display = 'none';
            });
        }

        if (productForm) {
            productForm.addEventListener('submit', saveProduct);
        }

        if (addSectionBtn) {
            addSectionBtn.addEventListener('click', () => addSection());
        }

        // Add variable button event listener
        if (addVariableBtn) {
            addVariableBtn.addEventListener('click', () => addCustomVariable());
        }

        // Keep Calculation Builder in sync with variable edits
        if (variablesContainer) {
            variablesContainer.addEventListener('input', () => {
                const vars = [];
                document.querySelectorAll('#variables-container .variable-row').forEach(row => {
                    const name = row.querySelector('.variable-name')?.value?.trim();
                    const valStr = row.querySelector('.variable-value')?.value;
                    const value = parseFloat(valStr);
                    if (name && !isNaN(value)) vars.push({ name: name.toUpperCase(), value });
                });
                if (window.calculationBuilder) {
                    window.calculationBuilder.setCustomVariables(vars);
                    window.calculationBuilder.refreshParameterOptions();
                }
            });
        }

        if (addWithCocoaRecipeBtn) {
            addWithCocoaRecipeBtn.addEventListener('click', () => addRecipeRow(null, 'with-cocoa'));
        }
        if (addWithoutCocoaRecipeBtn) {
            addWithoutCocoaRecipeBtn.addEventListener('click', () => addRecipeRow(null, 'without-cocoa'));
        }
        if (addCreamRecipeBtn) {
            addCreamRecipeBtn.addEventListener('click', () => addRecipeRow(null, 'cream'));
        }

        // Quality criteria management
        const addQualityCriteriaBtn = document.getElementById('add-quality-criteria-btn');
        if (addQualityCriteriaBtn) {
            addQualityCriteriaBtn.addEventListener('click', () => addQualityCriteria());
        }

        // Batch preview event listeners
        const batchCodeInput = document.getElementById('product-batch-code');
        const batchDayFormatInput = document.getElementById('product-day-format');
        const batchMonthFormatInput = document.getElementById('product-month-format');

        if (batchCodeInput) {
            batchCodeInput.addEventListener('input', updateBatchPreview);
        }
        if (batchDayFormatInput) {
            batchDayFormatInput.addEventListener('change', updateBatchPreview);
        }
        if (batchMonthFormatInput) {
            batchMonthFormatInput.addEventListener('change', updateBatchPreview);
        }

        // Main form batch number event listeners
        const reportDateInput = document.getElementById('report-date');
        const regenerateBatchBtn = document.getElementById('regenerate-batch-btn');

        if (reportDateInput) {
            const updateBatch = () => { try { generateBatchNumber(); } catch(_){} };
            reportDateInput.addEventListener('change', updateBatch);
            reportDateInput.addEventListener('input', updateBatch);
        }

        if (regenerateBatchBtn) {
            regenerateBatchBtn.addEventListener('click', generateBatchNumber);
        }

        // Close modal when clicking outside
        window.addEventListener('click', (event) => {
            if (event.target === productModal) {
                productModal.style.display = 'none';
            }
        });
        document.addEventListener('change', function (e) {
            if (e.target && e.target.tagName === 'SELECT' && e.target.closest('.form-table')) {
                applyStatusStylesToSelect(e.target);
            }
        });
        // Initialize drag and drop functionality
        initializeDragAndDrop();
    }

    // Update shift options based on duration
    function updateShiftOptions() {
        const shiftDuration = shiftDurationSelect.value;
        const currentOption = shiftInput.options[shiftInput.selectedIndex].value;

        // Clear existing options
        shiftInput.innerHTML = '';

        if (shiftDuration === '12') {
            // 12 hours - Shifts A and B (24/12 = 2 shifts)
            const optionA = document.createElement('option');
            optionA.value = 'A';
            optionA.textContent = 'A';
            shiftInput.appendChild(optionA);

            const optionB = document.createElement('option');
            optionB.value = 'B';
            optionB.textContent = 'B';
            shiftInput.appendChild(optionB);
        } else {
            // 8 hours - Shifts A, B, and C (24/8 = 3 shifts)
            const optionA = document.createElement('option');
            optionA.value = 'A';
            optionA.textContent = 'A';
            shiftInput.appendChild(optionA);

            const optionB = document.createElement('option');
            optionB.value = 'B';
            optionB.textContent = 'B';
            shiftInput.appendChild(optionB);

            const optionC = document.createElement('option');
            optionC.value = 'C';
            optionC.textContent = 'C';
            shiftInput.appendChild(optionC);
        }

        // Restore previous selection if it still exists
        if (currentOption === 'A' || currentOption === 'B' || currentOption === 'C') {
            shiftInput.value = currentOption;
        }
    }

    function initialRender() {
        // Generate initial time headers based on default shift (12 hours)
        generateTimeHeaders();

        // Update shift options
        updateShiftOptions();

        populateProductDropdown();
        renderProductsTable();
        addEventListeners();

        // Set initial pallet ID
        const palletIdInput = document.querySelector('.pallet-id');
        if (palletIdInput) {
            palletIdInput.value = currentPalletId;
            currentPalletId++;
        }

        // Set default shift in pallet records
        const palletShiftInput = document.querySelector('.pallet-shift');
        if (palletShiftInput && shiftInput) {
            palletShiftInput.value = shiftInput.value;
        }
        startAlertChecker();
        setupAudioEnabler();
        buildNavigationMap();

    }

    // Initialize drag and drop functionality
    function initializeDragAndDrop() {
        // Make sections sortable
        const sectionsContainer = document.getElementById('sections-container');
        if (sectionsContainer) {
            new Sortable(sectionsContainer, {
                animation: 150,
                handle: '.drag-handle',
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag'
            });
        }

        // Make quality criteria sortable
        const qualityCriteriaContainer = document.getElementById('quality-criteria-config-container');
        if (qualityCriteriaContainer) {
            new Sortable(qualityCriteriaContainer, {
                animation: 150,
                handle: '.drag-handle',
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag'
            });
        }

        // Function to initialize table sortables (called when tables are added)
        window.initializeTableSortables = function () {
            // Make tables within each section sortable
            document.querySelectorAll('.tables-container').forEach(container => {
                if (!container.sortableInstance) {
                    container.sortableInstance = new Sortable(container, {
                        animation: 150,
                        handle: '.drag-handle',
                        ghostClass: 'sortable-ghost',
                        chosenClass: 'sortable-chosen',
                        dragClass: 'sortable-drag'
                    });
                }
            });

            // Make parameters within each table sortable
            document.querySelectorAll('.parameters-container').forEach(container => {
                if (!container.sortableInstance) {
                    container.sortableInstance = new Sortable(container, {
                        animation: 150,
                        handle: '.drag-handle',
                        ghostClass: 'sortable-ghost',
                        chosenClass: 'sortable-chosen',
                        dragClass: 'sortable-drag'
                    });
                }
            });
        };

        // Initialize existing table sortables
        setTimeout(initializeTableSortables, 100);
    }

    // Table Linking functionality
    function updateLinkedTablesDropdown(containerId) {
        // Get all table configurations from all sections
        const allTables = [];
        document.querySelectorAll('.section-container').forEach(sectionContainer => {
            const sectionName = sectionContainer.querySelector('.section-name')?.value || 'Unnamed Section';
            sectionContainer.querySelectorAll('.tables-container > div').forEach(tableContainer => {
                const tableId = tableContainer.querySelector('.table-id')?.value;
                const tableName = tableContainer.querySelector('.table-name')?.value;
                if (tableId && tableName) {
                    allTables.push({
                        id: tableId,
                        name: `${sectionName} - ${tableName}`,
                        element: tableContainer
                    });
                }
            });
        });

        // Update all linked table dropdowns
        document.querySelectorAll('.table-linked-select').forEach(select => {
            const container = select.closest('.linked-tables-container');
            const currentTableId = container?.dataset.tableId;

            // Always check hidden input for current saved linked tables
            const hiddenInput = container?.querySelector('.table-linked');
            let selectedTables = [];

            // Priority: hidden input value (most current) > data attribute (initial)
            if (hiddenInput && hiddenInput.value.trim()) {
                selectedTables = hiddenInput.value.split(',').filter(id => id.trim());
            } else if (container?.dataset.linkedTables) {
                selectedTables = container.dataset.linkedTables.split(',').filter(id => id.trim());
                // Update hidden input with data attribute value
                if (hiddenInput) {
                    hiddenInput.value = selectedTables.join(',');
                }
            }

            // Clear and rebuild options
            select.innerHTML = '';

            allTables.forEach(table => {
                if (table.id !== currentTableId) { // Don't allow linking to self
                    const option = document.createElement('option');
                    option.value = table.id;
                    option.textContent = table.name;
                    option.selected = selectedTables.includes(table.id);
                    select.appendChild(option);
                }
            });
        });
    }

    // Update linked tables when selection changes
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('table-linked-select')) {
            const selectElement = e.target;
            const selectedOptions = Array.from(selectElement.selectedOptions).map(opt => opt.value);

            // Correctly finds the parent container and then the sibling hidden input
            const parentContainer = selectElement.closest('.linked-tables-container').parentElement;
            const hiddenInput = parentContainer.querySelector('.table-linked');

            if (hiddenInput) {
                hiddenInput.value = selectedOptions.join(',');
            }
        }
    });

    // Update dropdowns when modal opens
    const originalOpenProductModal = openProductModal;
    openProductModal = function (product = null) {
        originalOpenProductModal(product);
        // Give more time for DOM to be ready and use multiple attempts
        setTimeout(() => updateLinkedTablesDropdown(), 100);
        setTimeout(() => updateLinkedTablesDropdown(), 300);
        setTimeout(() => updateLinkedTablesDropdown(), 500);
    };

    // Update dropdowns when tables are added/removed
    document.addEventListener('click', (e) => {
        if (e.target.closest('.add-table-btn') || e.target.closest('.remove-table-btn')) {
            setTimeout(() => updateLinkedTablesDropdown(), 100);
        }
    });

    // Stop Column functionality
    let stopColumnStates = {}; // Track which tables have stop buttons visible

    function toggleStopButtons(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;

        const isVisible = stopColumnStates[tableId] || false;
        const newState = !isVisible;
        stopColumnStates[tableId] = newState;

        if (newState) {
            // Show stop buttons for each column
            addColumnStopButtons(tableId);
        } else {
            // Hide stop buttons
            removeColumnStopButtons(tableId);
        }
    }

    function addColumnStopButtons(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;

        // Find time header row
        const timeHeaderRow = table.querySelector('tr[id^="time-headers-"]');
        if (!timeHeaderRow) return;

        // Create stop buttons row
        const stopButtonsRow = document.createElement('tr');
        stopButtonsRow.className = 'stop-buttons-row';
        stopButtonsRow.dataset.tableId = tableId;

        // Add empty cells for non-time columns
        const firstRow = table.querySelector('thead tr');
        const firstCells = firstRow.querySelectorAll('th');
        let skipCells = 0;

        // Count how many cells to skip (Parameter, Standard Limits, etc.)
        for (let cell of firstCells) {
            if (cell.textContent.includes('Time Intervals')) break;
            skipCells += (cell.colSpan || 1);
        }

        // Add empty cells for skipped columns
        for (let i = 0; i < skipCells; i++) {
            stopButtonsRow.appendChild(document.createElement('td'));
        }

        // Add stop button for each time column
        const timeCells = timeHeaderRow.querySelectorAll('th');
        timeCells.forEach((cell, index) => {
            const td = document.createElement('td');
            td.className = 'text-center';
            td.innerHTML = `
                <button type="button" 
                        class="column-stop-btn bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 text-xs no-print"
                        data-table-id="${tableId}"
                        data-column-index="${index}"
                        data-column-time="${cell.textContent.trim()}"
                        title="Toggle Stop/Run for this column">
                    <i class="fas fa-stop-circle"></i> Stop
                </button>
            `;
            stopButtonsRow.appendChild(td);
        });

        // Insert after time headers row
        timeHeaderRow.parentNode.insertBefore(stopButtonsRow, timeHeaderRow.nextSibling);
    }

    function removeColumnStopButtons(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;

        const stopButtonsRow = table.querySelector('.stop-buttons-row');
        if (stopButtonsRow) {
            stopButtonsRow.remove();
        }
    }

    // Toggle column between stopped and running states
    function toggleColumnStopRun(tableId, columnIndex, columnTime) {
        const table = document.getElementById(tableId);
        if (!table) return;

        const tbody = table.querySelector('tbody');
        if (!tbody || !tbody.rows[0]) return;

        // Determine the actual index of the data cell in a row
        const firstDataRowCells = tbody.rows[0].cells;
        let dataColumnIndex = -1;
        let timeColumnCount = 0;

        for (let i = 0; i < firstDataRowCells.length; i++) {
            const cell = firstDataRowCells[i];
            const input = cell.querySelector('input, select, textarea');
            if (input && !cell.classList.contains('font-semibold')) {
                if (timeColumnCount === columnIndex) {
                    dataColumnIndex = i;
                    break;
                }
                timeColumnCount++;
            }
        }

        if (dataColumnIndex === -1) return;

        const firstCellInColumn = tbody.rows[0].cells[dataColumnIndex];
        const isCurrentlyStopped = firstCellInColumn && firstCellInColumn.querySelector('.stop-overlay');

        if (isCurrentlyStopped) {
            // --- ACTION: RUN THE COLUMN ---
            table.querySelectorAll('tbody tr').forEach(row => {
                if (row.cells[dataColumnIndex]) runCellCompletely(row.cells[dataColumnIndex]);
            });
            const btn = document.querySelector(`.column-stop-btn[data-table-id="${tableId}"][data-column-index="${columnIndex}"]`);
            if (btn) {
                btn.innerHTML = '<i class="fas fa-stop-circle"></i> Stop';
                btn.classList.replace('bg-green-600', 'bg-red-600');
            }
            runLinkedTables(tableId, columnTime, new Set([tableId]));
            showNotification(`Column ${columnTime} is now RUNNING.`, 'success');
        } else {
            // --- ACTION: STOP THE COLUMN ---
            table.querySelectorAll('tbody tr').forEach(row => {
                if (row.cells[dataColumnIndex]) stopCellCompletely(row.cells[dataColumnIndex]);
            });
            const btn = document.querySelector(`.column-stop-btn[data-table-id="${tableId}"][data-column-index="${columnIndex}"]`);
            if (btn) {
                btn.innerHTML = '<i class="fas fa-play-circle"></i> Run';
                btn.classList.replace('bg-red-600', 'bg-green-600');
            }
            stopLinkedTables(tableId, columnTime, new Set([tableId]));
            showNotification(`Column ${columnTime} has been STOPPED.`, 'warning');
        }
    }

    // New function to run a cell (remove stop overlay)
    // *** NEW: Updated function to clear cell contents upon running ***
    function runCellCompletely(cell) {
        if (!cell) return;

        // Remove stop overlay if exists
        const overlay = cell.querySelector('.stop-overlay');
        if (overlay) {
            overlay.remove();
        }

        // Re-enable inputs and CLEAR their values
        const inputs = cell.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.disabled = false;
            input.style.opacity = '1';

            // *** START OF THE NEW LOGIC ***
            // Clear the value of the input field
            if (input.type === 'checkbox' || input.type === 'radio') {
                input.checked = false; // Uncheck boxes and radios
            } else {
                input.value = ''; // Clear text, number, select, etc.
            }
            // *** END OF THE NEW LOGIC ***

            // Remove stored original value if it exists
            if (input.dataset.originalValue !== undefined) {
                delete input.dataset.originalValue;
            }
        });

        // Re-enable labels
        const labels = cell.querySelectorAll('label');
        labels.forEach(label => {
            label.style.opacity = '1';
            label.style.pointerEvents = 'auto';
            label.style.cursor = 'pointer';
        });

        // Reset cell styling
        cell.style.position = '';
    }

    // Function to run linked tables
    function runLinkedTables(sourceTableId, columnTime, processed = new Set()) {
        const productSelect = document.getElementById('product-name');
        const currentProduct = products[productSelect.value];
        if (!currentProduct || !currentProduct.sections) return;

        let linkedTableIds = [];
        Object.values(currentProduct.sections).forEach(section => {
            section.tables?.forEach(table => {
                if (table.id === sourceTableId.replace('-params', '')) {
                    linkedTableIds = table.linkedTables || [];
                }
            });
        });

        linkedTableIds.forEach(linkedId => {
            if (processed.has(linkedId)) return;
            processed.add(linkedId);

            const linkedTable = document.getElementById(linkedId) || document.getElementById(`${linkedId}-params`);
            if (!linkedTable) return;

            const timeHeaderRow = linkedTable.querySelector('tr[id^="time-headers-"]');
            if (!timeHeaderRow) return;

            timeHeaderRow.querySelectorAll('th').forEach((cell, index) => {
                if (cell.textContent.trim() === columnTime) {
                    const tbody = linkedTable.querySelector('tbody');
                    if (!tbody || !tbody.rows[0]) return;
                    let dataColumnIndex = -1;
                    let timeColumnCount = 0;
                    for (let i = 0; i < tbody.rows[0].cells.length; i++) {
                        const cell = tbody.rows[0].cells[i];
                        const input = cell.querySelector('input, select, textarea');
                        if (input && !cell.classList.contains('font-semibold')) {
                            if (timeColumnCount === index) { dataColumnIndex = i; break; }
                            timeColumnCount++;
                        }
                    }
                    if (dataColumnIndex === -1) return;

                    linkedTable.querySelectorAll('tbody tr').forEach(row => {
                        if (row.cells[dataColumnIndex]) runCellCompletely(row.cells[dataColumnIndex]);
                    });

                    const btn = document.querySelector(`.column-stop-btn[data-table-id="${linkedTable.id}"][data-column-index="${index}"]`);
                    if (btn) {
                        btn.innerHTML = '<i class="fas fa-stop-circle"></i> Stop';
                        btn.classList.replace('bg-green-600', 'bg-red-600');
                    }
                    runLinkedTables(linkedTable.id, columnTime, processed);
                }
            });
        });
    }

    // Run column by time
    function runColumnByTime(tableId, columnTime) {
        const table = document.getElementById(tableId);
        if (!table) return;

        const timeHeaderRow = table.querySelector('tr[id^="time-headers-"]');
        if (!timeHeaderRow) return;

        const timeHeaders = timeHeaderRow.querySelectorAll('th');
        let targetColumnIndex = -1;

        timeHeaders.forEach((th, index) => {
            const timeInput = th.querySelector('input[type="time"]');
            if (timeInput && timeInput.value === columnTime) {
                targetColumnIndex = index;
            }
        });

        if (targetColumnIndex !== -1) {
            const tbody = table.querySelector('tbody');
            if (!tbody) return;
            const rows = tbody.querySelectorAll('tr');

            const firstDataRow = rows[0];
            if (!firstDataRow) return;

            const allCells = firstDataRow.querySelectorAll('td');
            let dataColumnIndex = -1;
            let timeColumnCount = 0;

            for (let i = 0; i < allCells.length; i++) {
                const cell = allCells[i];
                const hasTimeInput = cell.querySelector('input:not([type="hidden"]), select, textarea');
                const isParameterCell = cell.classList.contains('font-semibold') ||
                    cell.querySelector('.font-semibold') ||
                    !hasTimeInput;

                if (!isParameterCell && hasTimeInput) {
                    if (timeColumnCount === targetColumnIndex) {
                        dataColumnIndex = i;
                        break;
                    }
                    timeColumnCount++;
                }
            }

            if (dataColumnIndex !== -1) {
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells[dataColumnIndex]) {
                        runCellCompletely(cells[dataColumnIndex]);
                    }
                });
            }
        }
    }

    function stopColumn(tableId, columnIndex, columnTime) {
        const table = document.getElementById(tableId);
        if (!table) return;

        // Get all data rows
        const tbody = table.querySelector('tbody');
        if (!tbody) return;
        const rows = tbody.querySelectorAll('tr');

        // Find time header row to determine correct column
        const timeHeaderRow = table.querySelector('tr[id^="time-headers-"]');
        if (!timeHeaderRow) return;

        // Get all time header cells
        const timeHeaders = timeHeaderRow.querySelectorAll('th');

        // The columnIndex is already the index within time columns
        // We need to find the corresponding data cell index
        // First, count how many columns come before the time columns
        const firstDataRow = rows[0];
        if (!firstDataRow) return;

        const allCells = firstDataRow.querySelectorAll('td');
        let dataColumnIndex = -1;
        let timeColumnCount = 0;

        // Find the data column that corresponds to this time column
        for (let i = 0; i < allCells.length; i++) {
            const cell = allCells[i];
            // Check if this cell contains time-related inputs
            const hasTimeInput = cell.querySelector('input:not([type="hidden"]), select, textarea');
            const isParameterCell = cell.classList.contains('font-semibold') ||
                cell.querySelector('.font-semibold') ||
                !hasTimeInput;

            if (!isParameterCell && hasTimeInput) {
                if (timeColumnCount === columnIndex) {
                    dataColumnIndex = i;
                    break;
                }
                timeColumnCount++;
            }
        }

        if (dataColumnIndex === -1) return;

        // Apply stop to all cells in this column
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells[dataColumnIndex]) {
                stopCellCompletely(cells[dataColumnIndex]);
            }
        });

        // Find and stop linked tables
        stopLinkedTables(tableId, columnTime);

        // Show notification
        showNotification(`Column ${columnTime} has been stopped in table ${tableId}`, 'warning');
    }

    // New function to completely stop a cell with any type of input
    function stopCellCompletely(cell) {
        if (!cell) return;

        // Check if already stopped
        if (cell.querySelector('.stop-overlay')) return;

        // Create a stop overlay
        const overlay = document.createElement('div');
        overlay.className = 'stop-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(239, 68, 68, 0.95);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 12px;
            pointer-events: all;
            z-index: 10;
            border-radius: 4px;
        `;
        overlay.innerHTML = 'STOPPED';

        // Make the cell relative positioned to contain the overlay
        cell.style.position = 'relative';

        // Handle different input types
        const inputs = cell.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.disabled = true;
            input.style.opacity = '0.2';

            // Store original value for potential restoration
            input.dataset.stoppedValue = input.value || '';

            if (input.type === 'radio' || input.type === 'checkbox') {
                // Store which was checked
                input.dataset.wasChecked = input.checked ? 'true' : 'false';
            }
        });

        // Disable labels and make them semi-transparent
        const labels = cell.querySelectorAll('label');
        labels.forEach(label => {
            label.style.opacity = '0.2';
            label.style.pointerEvents = 'none';
        });

        // Add the overlay to the cell
        cell.appendChild(overlay);
        cell.classList.add('stopped-cell');
    }

    function stopLinkedTables(sourceTableId, columnTime, processed = new Set()) {
        const productSelect = document.getElementById('product-name');
        const currentProduct = products[productSelect.value];
        if (!currentProduct || !currentProduct.sections) return;

        let linkedTableIds = [];
        Object.values(currentProduct.sections).forEach(section => {
            section.tables?.forEach(table => {
                if (table.id === sourceTableId.replace('-params', '')) {
                    linkedTableIds = table.linkedTables || [];
                }
            });
        });

        linkedTableIds.forEach(linkedId => {
            if (processed.has(linkedId)) return;
            processed.add(linkedId);

            const linkedTable = document.getElementById(linkedId) || document.getElementById(`${linkedId}-params`);
            if (!linkedTable) return;

            const timeHeaderRow = linkedTable.querySelector('tr[id^="time-headers-"]');
            if (!timeHeaderRow) return;

            timeHeaderRow.querySelectorAll('th').forEach((cell, index) => {
                if (cell.textContent.trim() === columnTime) {
                    const tbody = linkedTable.querySelector('tbody');
                    if (!tbody || !tbody.rows[0]) return;
                    let dataColumnIndex = -1;
                    let timeColumnCount = 0;
                    for (let i = 0; i < tbody.rows[0].cells.length; i++) {
                        const cell = tbody.rows[0].cells[i];
                        const input = cell.querySelector('input, select, textarea');
                        if (input && !cell.classList.contains('font-semibold')) {
                            if (timeColumnCount === index) { dataColumnIndex = i; break; }
                            timeColumnCount++;
                        }
                    }
                    if (dataColumnIndex === -1) return;

                    linkedTable.querySelectorAll('tbody tr').forEach(row => {
                        if (row.cells[dataColumnIndex]) stopCellCompletely(row.cells[dataColumnIndex]);
                    });

                    const btn = document.querySelector(`.column-stop-btn[data-table-id="${linkedTable.id}"][data-column-index="${index}"]`);
                    if (btn) {
                        btn.innerHTML = '<i class="fas fa-play-circle"></i> Run';
                        btn.classList.replace('bg-red-600', 'bg-green-600');
                    }
                    stopLinkedTables(linkedTable.id, columnTime, processed);
                }
            });
        });
    }

    // Event listeners for Stop buttons
    document.addEventListener('click', (e) => {
        // Main stop button
        if (e.target.closest('.main-stop-btn')) {
            const btn = e.target.closest('.main-stop-btn');
            const tableId = btn.dataset.tableId;
            toggleStopButtons(tableId);

            // Update button appearance
            if (stopColumnStates[tableId]) {
                btn.classList.remove('bg-red-600', 'hover:bg-red-700');
                btn.classList.add('bg-gray-600', 'hover:bg-gray-700');
                btn.innerHTML = '<i class="fas fa-times-circle mr-1"></i>Hide Stop';
            } else {
                btn.classList.remove('bg-gray-600', 'hover:bg-gray-700');
                btn.classList.add('bg-red-600', 'hover:bg-red-700');
                btn.innerHTML = '<i class="fas fa-stop-circle mr-1"></i>Stop';
            }
        }

        // Column stop button
        if (e.target.closest('.column-stop-btn')) {
            const btn = e.target.closest('.column-stop-btn');
            const tableId = btn.dataset.tableId;
            const columnIndex = parseInt(btn.dataset.columnIndex);
            const columnTime = btn.dataset.columnTime;

            // Toggle stop/run without confirmation
            toggleColumnStopRun(tableId, columnIndex, columnTime);
        }
    });

    initialRender();
});


