// Bill Manager Application

// Modern Professional PDF Design Constants
const PDF_COLORS = {
    PRIMARY: [30, 58, 138],           // Professional navy blue
    PRIMARY_LIGHT: [59, 130, 246],    // Lighter blue for accents
    TEXT_DARK: [17, 24, 39],          // Rich black
    TEXT_GRAY: [107, 114, 128],       // Medium gray
    TEXT_LIGHT: [156, 163, 175],      // Light gray
    BORDER: [229, 231, 235],          // Subtle border
    BG_GRAY: [249, 250, 251],         // Very light background
    SUCCESS: [16, 185, 129],          // Green for paid
    WARNING: [245, 158, 11],          // Orange for pending
    DANGER: [239, 68, 68],            // Red for unpaid
    WHITE: [255, 255, 255]
};

// Company Information for PDF
const COMPANY_INFO = {
    NAME: 'BALAJI SAI AUTO MOBILES',
    ADDRESS: 'Auto Nagar, Eluru Road, JANGAREDDYGUDEM',
    GSTIN: '37BGLPV7608B1Z3',
    PHONE: '9490350878'
};

// Data Storage
let bills = [];
let inventory = [];
let stockHistory = [];
let currentBillItems = [];
let currentBill = null;
// Export initialization flag
let exportInitialized = false;
// Bills UI state
let billsSearch = '';
let billsPage = 1;
let billsPerPage = 10;
let billsSortKey = null;
let billsSortDir = 'asc';

// ---- GST helpers ----
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const escHtml = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtRate = r => (Number(r) || 0) + '%';

// Group items by GST rate; tax is computed once per rate group on that group's taxable total.
function computeBillTotals(items) {
    const groups = {};
    let subtotal = 0;
    (items || []).forEach(it => {
        const rate = parseFloat(it.gstRate) || 0;
        const amt = Number(it.amount) || 0;
        groups[rate] = (groups[rate] || 0) + amt;
        subtotal += amt;
    });
    const gstBreakup = Object.keys(groups).map(Number).sort((a, b) => a - b).map(rate => {
        const taxable = round2(groups[rate]);
        // GST is split equally: CGST = SGST = half the rate
        const cgst = round2(taxable * (rate / 2) / 100);
        const sgst = cgst;
        return { rate, taxable, cgst, sgst, gst: round2(cgst + sgst) };
    });
    const totalCgst = round2(gstBreakup.reduce((s, g) => s + g.cgst, 0));
    const totalSgst = round2(gstBreakup.reduce((s, g) => s + g.sgst, 0));
    const totalGst = round2(totalCgst + totalSgst);
    subtotal = round2(subtotal);
    return { subtotal, gstBreakup, totalCgst, totalSgst, totalGst, total: round2(subtotal + totalGst) };
}

// Works for new bills (stored breakup) and legacy bills (no GST info)
function getBillTotals(bill) {
    if (bill.gstBreakup && bill.totalCgst != null) return { subtotal: bill.subtotal, gstBreakup: bill.gstBreakup, totalCgst: bill.totalCgst, totalSgst: bill.totalSgst, totalGst: bill.totalGst, total: bill.total };
    return computeBillTotals(bill.items);
}

// Initialize App
document.addEventListener('DOMContentLoaded', function () {
    // Wait for Supabase auth to initialize in `supabase-config.js` which will call `loadAllData()` when signed in.
});

// Load all data from serverless KV state
async function loadAllData() {
    try {
        setDefaultDate();

        // LOCAL DEMO MODE: state lives in localStorage
        let state = {};
        try { state = JSON.parse(localStorage.getItem('bm_demo_state')) || {}; } catch (e) { state = {}; }

        bills = state.bills || [];
        inventory = state.inventory || [];
        stockHistory = state.stockHistory || [];

        // Normalize existing inventory codes to short sequential format if needed
        try {
            let changed = false;
            // helper to test short code
            // allow 3 or 4 digit ITM codes (supports up to 9999 items)
            const isShort = (c) => /^ITM\d{3,4}$/i.test(String(c || ''));
            inventory.forEach(item => {
                if (!item.code || !isShort(item.code)) {
                    item.code = generateNextItemCode();
                    changed = true;
                }
            });
            if (changed) {
                // persist normalization back to state
                await saveState();
            }
        } catch (e) {
            console.warn('Inventory code normalization failed:', e);
        }

        loadInventory();
        updateStockItemSelect();
        loadBills();
        loadStockHistory();
        generateNextInvoiceNumber();
        // Initialize export UI when data is loaded
        if (window.initExportSection) window.initExportSection();
        if (window.initBillsControls) window.initBillsControls();
    } catch (err) {
        console.error('Error loading state:', err);
    }
}

// Persist full state to serverless KV
async function saveState() {
    try {
        const payload = { bills, inventory, stockHistory };
        localStorage.setItem('bm_demo_state', JSON.stringify(payload));
    } catch (err) {
        console.error('Error saving state:', err);
        alert('Unable to save data to browser storage (storage may be full).');
    }
}

function uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Navigation
function showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    // Remove active class from all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected section
    document.getElementById(sectionName + '-section').classList.add('active');

    // Ensure export UI is rendered when user opens the Export section
    if (sectionName === 'export') {
        if (window.initExportSection) window.initExportSection();
    }
    // Add active class to clicked button
    event.target.classList.add('active');
}

// Bills Section
function showNewBillForm() {
    document.getElementById('new-bill-form').style.display = 'block';
    currentBillItems = [];
    addBillItem(); // Add first item row
    generateNextInvoiceNumber();
    setDefaultDate();
}

function hideNewBillForm() {
    document.getElementById('new-bill-form').style.display = 'none';
    document.getElementById('billForm').reset();
    currentBillItems = [];
    document.getElementById('billItemsList').innerHTML = '';
    calculateBillTotal();
}

function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('invoiceDate').value = today;
}

function nextInvoiceNumber() {
    // Highest numeric invoice number across all bills + 1 (unique primary key)
    let max = 0;
    bills.forEach(b => {
        const n = parseInt(String(b.invoiceNo || '').replace(/\D/g, ''), 10);
        if (!isNaN(n) && n > max) max = n;
    });
    return (max + 1).toString().padStart(3, '0');
}

function generateNextInvoiceNumber() {
    const nextNumber = nextInvoiceNumber();
    document.getElementById('invoiceNo').value = nextNumber;
}

function addBillItem() {
    const itemRow = document.createElement('div');
    itemRow.className = 'item-row';
    itemRow.innerHTML = `
        <div class="item-field">
            <label>Item</label>
            <select class="item-select" onchange="fillItemDetails(this)">
                <option value="">-- Select or Type --</option>
                ${inventory.map(item => `<option value="${escHtml(item.id)}">${escHtml(item.name)}</option>`).join('')}
                <option value="custom">Custom Item</option>
            </select>
            <input type="text" class="item-name" placeholder="Item name" style="margin-top: 5px;">
        </div>
        <div class="item-field">
            <label>HSN Code</label>
            <input type="text" class="item-hsn" placeholder="HSN">
        </div>
        <div class="item-field">
            <label>Quantity</label>
            <input type="number" class="item-qty" min="1" value="1" oninput="calculateItemTotal(this)">
        </div>
        <div class="item-field">
            <label>Rate w/o GST (₹)</label>
            <input type="number" class="item-rate" step="0.01" min="0" oninput="calculateItemTotal(this)">
        </div>
        <div class="item-field">
            <label>GST %</label>
            <input type="number" class="item-gst" step="0.01" min="0" value="0" oninput="calculateItemTotal(this)">
        </div>
        <div class="item-field">
            <label>Total w/o GST (₹)</label>
            <input type="number" class="item-amount" step="0.01" readonly>
        </div>
        <button type="button" class="remove-item-btn" onclick="removeBillItem(this)">×</button>
    `;
    document.getElementById('billItemsList').appendChild(itemRow);
}

function fillItemDetails(select) {
    const row = select.closest('.item-row');
    const nameInput = row.querySelector('.item-name');
    const rateInput = row.querySelector('.item-rate');
    const hsnInput = row.querySelector('.item-hsn');
    const gstInput = row.querySelector('.item-gst');

    if (select.value === 'custom') {
        nameInput.value = '';
        rateInput.value = '';
        hsnInput.value = '';
        gstInput.value = 0;
        nameInput.focus();
    } else if (select.value) {
        const item = inventory.find(i => i.id === select.value);
        if (item) {
            nameInput.value = item.name;
            rateInput.value = item.priceExGst != null ? item.priceExGst : item.rate;
            hsnInput.value = item.hsn || '';
            gstInput.value = item.gstRate || 0;
            calculateItemTotal(row.querySelector('.item-qty'));
        }
    }
}

function calculateItemTotal(input) {
    const row = input.closest('.item-row');
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
    row.querySelector('.item-amount').value = round2(qty * rate).toFixed(2);
    calculateBillTotal();
}

function currentFormItems() {
    const items = [];
    document.querySelectorAll('#billItemsList .item-row').forEach(row => {
        const itemSelect = row.querySelector('.item-select');
        items.push({
            itemId: itemSelect.value && itemSelect.value !== 'custom' ? itemSelect.value : null,
            name: row.querySelector('.item-name').value.trim(),
            hsn: row.querySelector('.item-hsn').value.trim(),
            qty: parseFloat(row.querySelector('.item-qty').value),
            rate: parseFloat(row.querySelector('.item-rate').value),
            gstRate: parseFloat(row.querySelector('.item-gst').value) || 0,
            amount: parseFloat(row.querySelector('.item-amount').value) || 0
        });
    });
    return items;
}

function calculateBillTotal() {
    const t = computeBillTotals(currentFormItems());
    document.getElementById('billSubtotal').textContent = t.subtotal.toFixed(2);
    document.getElementById('billGstBreakup').innerHTML = t.gstBreakup.map(g =>
        `<div class="gst-line"><span>CGST @ ${fmtRate(g.rate / 2)} on ₹${g.taxable.toFixed(2)}</span><span>₹${g.cgst.toFixed(2)}</span></div>` +
        `<div class="gst-line"><span>SGST @ ${fmtRate(g.rate / 2)} on ₹${g.taxable.toFixed(2)}</span><span>₹${g.sgst.toFixed(2)}</span></div>`
    ).join('');
    document.getElementById('billTotalCgst').textContent = t.totalCgst.toFixed(2);
    document.getElementById('billTotalSgst').textContent = t.totalSgst.toFixed(2);
    document.getElementById('billTotalGst').textContent = t.totalGst.toFixed(2);
    document.getElementById('billTotal').textContent = t.total.toFixed(2);
}

function removeBillItem(button) {
    button.closest('.item-row').remove();
    calculateBillTotal();
}

// Submit Bill Form
document.getElementById('billForm').addEventListener('submit', function (e) {
    e.preventDefault();

    const items = currentFormItems().filter(it => it.name && it.qty && it.rate >= 0 && !isNaN(it.rate));

    if (items.length === 0) {
        alert('Please add at least one item');
        return;
    }

    const totals = computeBillTotals(items);

    const bill = {
        id: uid('bill'),
        invoiceNo: (v => (!v || bills.some(b => b.invoiceNo === v)) ? nextInvoiceNumber() : v)(document.getElementById('invoiceNo').value),
        date: document.getElementById('invoiceDate').value,
        customer: {
            name: document.getElementById('customerName').value.trim(),
            phone: document.getElementById('customerPhone').value.trim(),
            address: document.getElementById('customerAddress').value.trim()
        },
        paymentMode: document.getElementById('paymentMode') ? document.getElementById('paymentMode').value : 'Cash',
        status: document.getElementById('paymentStatus') ? document.getElementById('paymentStatus').value : 'Unpaid',
        items: items,
        subtotal: totals.subtotal,
        gstBreakup: totals.gstBreakup,
        totalCgst: totals.totalCgst,
        totalSgst: totals.totalSgst,
        totalGst: totals.totalGst,
        total: totals.total,
        timestamp: new Date().toISOString()
    };

    // Add to local state
    bills.unshift(bill);

    // Update inventory stock and stock history
    items.forEach(item => {
        if (item.itemId) {
            const invItem = inventory.find(i => i.id === item.itemId);
            if (invItem) {
                const newStock = Math.max(0, (invItem.stock || 0) - item.qty);
                invItem.stock = newStock;
                stockHistory.unshift({
                    id: uid('history'),
                    timestamp: new Date().toISOString(),
                    itemId: item.itemId,
                    itemName: invItem.name,
                    action: 'remove',
                    quantity: item.qty,
                    stockAfter: newStock,
                    reason: `Bill: ${bill.invoiceNo}`
                });
            }
        }
    });

    saveState();
    hideNewBillForm();
    loadInventory();
    updateStockItemSelect();
    loadBills();
    loadStockHistory();
    alert('Bill saved successfully!');
});

function loadBills() {
    const tbody = document.getElementById('billsTableBody');

    // Apply search filter
    let items = bills.slice();
    if (billsSearch) {
        const q = billsSearch.toLowerCase();
        items = items.filter(b => (b.invoiceNo && b.invoiceNo.toLowerCase().includes(q)) || (b.customer && b.customer.name && b.customer.name.toLowerCase().includes(q)) || (b.items && b.items.some(it => it.name && it.name.toLowerCase().includes(q))));
    }

    // Sorting
    if (billsSortKey) {
        items.sort((a, b) => {
            const va = getValueByPath(a, billsSortKey);
            const vb = getValueByPath(b, billsSortKey);
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return billsSortDir === 'asc' ? va - vb : vb - va;
            return billsSortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
    }

    const total = items.length;
    const per = parseInt(billsPerPage) || 10;
    const pages = Math.max(1, Math.ceil(total / per));
    if (billsPage > pages) billsPage = pages;
    const start = (billsPage - 1) * per;
    const pageItems = items.slice(start, start + per);

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No bills found. Create your first bill!</p></td></tr>';
    } else {
        tbody.innerHTML = pageItems.map(bill => `
        <tr>
            <td><strong>${bill.invoiceNo}</strong></td>
            <td>${formatDate(bill.date)}</td>
            <td>${escHtml((bill.customer && bill.customer.name) || '-')}</td>
            <td>${bill.items.length} item(s)</td>
            <td>${bill.paymentMode || 'N/A'}</td>
            <td>${bill.status || 'N/A'}</td>
            <td><strong>₹${bill.total.toFixed(2)}</strong></td>
            <td class="table-actions">
                <button class="btn-view" onclick="viewBill('${bill.id}')">View</button>
                <button class="btn-delete" onclick="deleteBill('${bill.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
    }

    // Update pagination info
    const info = document.getElementById('billsPaginationInfo');
    if (info) info.textContent = `Showing ${Math.min(total, start + 1)}-${Math.min(total, start + per)} of ${total}`;
    const prev = document.getElementById('billsPrev');
    const next = document.getElementById('billsNext');
    if (prev) prev.disabled = billsPage <= 1;
    if (next) next.disabled = billsPage >= pages;
}

function viewBill(billId) {
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;

    currentBill = bill;
    const t = getBillTotals(bill);

    const content = `
        <div class="bill-header">
            <h2>BALAJI SAI AUTO MOBILES</h2>
            <p>Auto Nagar, Eluru Road, JANGAREDDYGUDEM</p>
        </div>
        
        <div class="bill-info">
            <div class="info-group">
                <h4>Invoice No.</h4>
                <p>${bill.invoiceNo}</p>
            </div>
            <div class="info-group">
                <h4>Date</h4>
                <p>${formatDate(bill.date)}</p>
            </div>
            <div class="info-group">
                <h4>Customer Name</h4>
                <p>${escHtml(bill.customer.name || 'N/A')}</p>
            </div>
            <div class="info-group">
                <h4>Phone</h4>
                <p>${bill.customer.phone || 'N/A'}</p>
            </div>
            <div class="info-group">
                <h4>Address</h4>
                <p>${bill.customer.address || 'N/A'}</p>
            </div>
            <div class="info-group">
                <h4>Payment Mode</h4>
                <p>${bill.paymentMode || 'N/A'}</p>
            </div>
            <div class="info-group">
                <h4>Status</h4>
                <p>${bill.status || 'N/A'}</p>
            </div>
        </div>
        
        <div class="bill-items">
            <table>
                <thead>
                    <tr>
                        <th>S.No</th>
                        <th>Product Name</th>
                        <th>HSN Code</th>
                        <th>GST %</th>
                        <th>Qty</th>
                        <th>Unit Rate (w/o GST)</th>
                        <th>Total (w/o GST)</th>
                    </tr>
                </thead>
                <tbody>
                    ${bill.items.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${escHtml(item.name)}</td>
                            <td>${escHtml(item.hsn || '-')}</td>
                            <td>${fmtRate(item.gstRate)}</td>
                            <td>${item.qty}</td>
                            <td>₹${item.rate.toFixed(2)}</td>
                            <td>₹${item.amount.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="bill-summary">
            <div class="gst-line"><span>Total without GST</span><span>₹${t.subtotal.toFixed(2)}</span></div>
            ${t.gstBreakup.map(g => `
                <div class="gst-line"><span>CGST @ ${fmtRate(g.rate / 2)} on ₹${g.taxable.toFixed(2)}</span><span>₹${g.cgst.toFixed(2)}</span></div>
                <div class="gst-line"><span>SGST @ ${fmtRate(g.rate / 2)} on ₹${g.taxable.toFixed(2)}</span><span>₹${g.sgst.toFixed(2)}</span></div>
            `).join('')}
            <div class="gst-line"><span>Total CGST</span><span>₹${t.totalCgst.toFixed(2)}</span></div>
            <div class="gst-line"><span>Total SGST</span><span>₹${t.totalSgst.toFixed(2)}</span></div>
            <div class="gst-line"><span>Total GST</span><span>₹${t.totalGst.toFixed(2)}</span></div>
        </div>

        <div class="bill-total">
            Total after GST: ₹${t.total.toFixed(2)}
        </div>
    `;

    document.getElementById('billViewContent').innerHTML = content;
    document.getElementById('billViewModal').classList.add('active');
}

// Helper function to render a single bill in PDF
function renderBillToPDF(doc, bill, pageWidth, pageHeight) {
    const margin = 40;
    
    // Modern header with company info
    doc.setFillColor(...PDF_COLORS.PRIMARY);
    doc.rect(0, 0, pageWidth, 100, 'F');
    
    // Company name in header
    doc.setFontSize(24);
    doc.setTextColor(...PDF_COLORS.WHITE);
    doc.setFont(undefined, 'bold');
    doc.text(COMPANY_INFO.NAME, margin, 45);
    
    // Company contact info in header
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(COMPANY_INFO.ADDRESS, margin, 65);
    doc.text(`GSTIN: ${COMPANY_INFO.GSTIN}`, margin, 80);
    doc.text(`Phone: ${COMPANY_INFO.PHONE}`, margin, 92);

    // INVOICE label - top right
    doc.setFontSize(32);
    doc.setFont(undefined, 'bold');
    doc.text('INVOICE', pageWidth - margin, 55, { align: 'right' });

    // Invoice details section - top right under INVOICE
    let yPos = 120;
    doc.setFontSize(10);
    doc.setTextColor(...PDF_COLORS.TEXT_GRAY);
    doc.setFont(undefined, 'normal');
    doc.text('Invoice Number:', pageWidth - 200, yPos);
    doc.text('Date:', pageWidth - 200, yPos + 18);
    
    doc.setTextColor(...PDF_COLORS.TEXT_DARK);
    doc.setFont(undefined, 'bold');
    doc.text(bill.invoiceNo, pageWidth - margin, yPos, { align: 'right' });
    doc.text(formatDate(bill.date), pageWidth - margin, yPos + 18, { align: 'right' });

    // Bill To section - modern box
    yPos = 120;
    doc.setFillColor(...PDF_COLORS.BG_GRAY);
    doc.rect(margin, yPos, 280, 100, 'F');
    
    doc.setFontSize(10);
    doc.setTextColor(...PDF_COLORS.TEXT_GRAY);
    doc.setFont(undefined, 'bold');
    doc.text('BILL TO', margin + 15, yPos + 20);
    
    doc.setFontSize(12);
    doc.setTextColor(...PDF_COLORS.TEXT_DARK);
    doc.text(bill.customer.name || 'N/A', margin + 15, yPos + 40);
    
    doc.setFontSize(9);
    doc.setTextColor(...PDF_COLORS.TEXT_GRAY);
    doc.setFont(undefined, 'normal');
    const addressLines = doc.splitTextToSize(bill.customer.address || 'N/A', 250);
    doc.text(addressLines, margin + 15, yPos + 55);
    
    const phoneY = yPos + 55 + (addressLines.length * 11);
    doc.text(`Phone: ${bill.customer.phone || 'N/A'}`, margin + 15, phoneY);

    // Payment & Shipping details - modern grid
    yPos = 240;
    doc.setDrawColor(...PDF_COLORS.BORDER);
    doc.setLineWidth(1);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    
    yPos += 20;
    doc.setFontSize(9);
    doc.setTextColor(...PDF_COLORS.TEXT_GRAY);
    doc.setFont(undefined, 'bold');
    
    const col2 = margin;
    const col3 = margin + 180;
    
    doc.text('PAYMENT METHOD', col2, yPos);
    doc.text('STATUS', col3, yPos);
    
    yPos += 15;
    doc.setFontSize(10);
    doc.setTextColor(...PDF_COLORS.TEXT_DARK);
    doc.setFont(undefined, 'normal');
    doc.text(bill.paymentMode || 'N/A', col2, yPos);
    
    // Status with color badge
    const status = bill.status || 'N/A';
    const statusLower = status.toLowerCase();
    let statusColor = PDF_COLORS.TEXT_GRAY;
    if (statusLower === 'paid') statusColor = PDF_COLORS.SUCCESS;
    else if (statusLower === 'pending') statusColor = PDF_COLORS.WARNING;
    else if (statusLower.includes('unpaid')) statusColor = PDF_COLORS.DANGER;
    
    doc.setTextColor(...statusColor);
    doc.setFont(undefined, 'bold');
    doc.text(status.toUpperCase(), col3, yPos);
    
    yPos += 20;
    doc.setDrawColor(...PDF_COLORS.BORDER);
    doc.line(margin, yPos, pageWidth - margin, yPos);

    // Items table - modern design
    yPos += 20;
    const t = getBillTotals(bill);
    const cols = ['S.No', 'Product Name', 'HSN Code', 'GST %', 'Qty', 'Unit Rate (w/o GST)', 'Total (w/o GST)'];
    const rows = bill.items.map((it, idx) => [
        idx + 1,
        it.name,
        it.hsn || '-',
        fmtRate(it.gstRate),
        String(it.qty),
        `Rs. ${it.rate.toFixed(2)}`,
        `Rs. ${it.amount.toFixed(2)}`
    ]);

    doc.autoTable({
        startY: yPos,
        head: [cols],
        body: rows,
        theme: 'plain',
        headStyles: {
            fillColor: PDF_COLORS.BG_GRAY,
            textColor: PDF_COLORS.TEXT_DARK,
            fontSize: 10,
            fontStyle: 'bold',
            halign: 'left',
            cellPadding: 10
        },
        bodyStyles: {
            fontSize: 10,
            textColor: PDF_COLORS.TEXT_DARK,
            cellPadding: 10
        },
        columnStyles: {
            0: { halign: 'center', cellWidth: 40 },
            1: { cellWidth: 'auto' },
            2: { halign: 'center', cellWidth: 55 },
            3: { halign: 'center', cellWidth: 45 },
            4: { halign: 'center', cellWidth: 35 },
            5: { halign: 'right', cellWidth: 85 },
            6: { halign: 'right', cellWidth: 85 }
        },
        margin: { left: margin, right: margin },
        didDrawPage: function(data) {
            // Add borders to table
            doc.setDrawColor(...PDF_COLORS.BORDER);
            doc.setLineWidth(0.5);
        }
    });

    // GST summary
    let sy = doc.lastAutoTable.finalY + 25;
    const rx = pageWidth - margin;
    const lx = pageWidth - margin - 260;
    const pageBottom = pageHeight - 70;
    const needed = (t.gstBreakup.length * 2 + 4) * 16 + 70;
    if (sy + needed > pageBottom) { doc.addPage(); sy = margin + 10; }
    doc.setFontSize(10);
    doc.setTextColor(...PDF_COLORS.TEXT_DARK);
    const line = (label, val, bold) => {
        doc.setFont(undefined, bold ? 'bold' : 'normal');
        doc.text(label, lx, sy);
        doc.text(val, rx, sy, { align: 'right' });
        sy += 16;
    };
    line('Total without GST', `Rs. ${t.subtotal.toFixed(2)}`, true);
    t.gstBreakup.forEach(g => {
        line(`CGST @ ${fmtRate(g.rate / 2)} on Rs. ${g.taxable.toFixed(2)}`, `Rs. ${g.cgst.toFixed(2)}`);
        line(`SGST @ ${fmtRate(g.rate / 2)} on Rs. ${g.taxable.toFixed(2)}`, `Rs. ${g.sgst.toFixed(2)}`);
    });
    line('Total CGST', `Rs. ${t.totalCgst.toFixed(2)}`, true);
    line('Total SGST', `Rs. ${t.totalSgst.toFixed(2)}`, true);
    line('Total GST', `Rs. ${t.totalGst.toFixed(2)}`, true);

    // Total box with background
    const finalY = sy + 6;
    const totalBoxHeight = 60;
    const totalBoxWidth = 260;
    doc.setFillColor(...PDF_COLORS.PRIMARY);
    doc.roundedRect(pageWidth - margin - totalBoxWidth, finalY, totalBoxWidth, totalBoxHeight, 3, 3, 'F');

    doc.setFontSize(11);
    doc.setTextColor(...PDF_COLORS.WHITE);
    doc.setFont(undefined, 'bold');
    doc.text('TOTAL AFTER GST', pageWidth - margin - totalBoxWidth + 20, finalY + 25);

    doc.setFontSize(20);
    doc.text(`Rs. ${t.total.toFixed(2)}`, pageWidth - margin - totalBoxWidth + 20, finalY + 48);

    // Footer - professional
    const footerY = pageHeight - 60;
    doc.setDrawColor(...PDF_COLORS.BORDER);
    doc.setLineWidth(0.5);
    doc.line(margin, footerY, pageWidth - margin, footerY);
    
    doc.setFontSize(9);
    doc.setTextColor(...PDF_COLORS.TEXT_LIGHT);
    doc.setFont(undefined, 'normal');
    doc.text('Thank you for your business', pageWidth / 2, footerY + 20, { align: 'center' });
    doc.text('For any queries or concerns, please contact us at the address mentioned above', pageWidth / 2, footerY + 35, { align: 'center' });
}

// Download PDF of current bill using jsPDF
function downloadBillPDF() {
    if (!currentBill) { alert('No bill selected'); return; }
    if (!window.jspdf) {
        alert('jsPDF library not loaded. Please refresh the page and try again.');
        return;
    }
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        renderBillToPDF(doc, currentBill, pageWidth, pageHeight);
        doc.save(`Invoice_${currentBill.invoiceNo}.pdf`);
    } catch (err) {
        console.error('PDF export error', err);
        alert('Unable to generate PDF. Check console for details.');
    }
}

// Download multiple bills as PDF (one bill per page)
function downloadBillsPDF(billsToExport, filename) {
    if (!billsToExport || billsToExport.length === 0) {
        alert('No bills to export');
        return;
    }
    if (!window.jspdf) {
        alert('jsPDF library not loaded. Please refresh the page and try again.');
        return;
    }
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        billsToExport.forEach((bill, billIndex) => {
            if (billIndex > 0) {
                doc.addPage();
            }
            renderBillToPDF(doc, bill, pageWidth, pageHeight);
        });

        doc.save(filename + '.pdf');
    } catch (err) {
        console.error('PDF export error', err);
        alert('Unable to generate PDF. Check console for details.');
    }
}

function closeBillModal() {
    document.getElementById('billViewModal').classList.remove('active');
    currentBill = null;
}

function printBill() {
    if (!currentBill) {
        alert('No bill selected to print');
        return;
    }

    const content = document.getElementById('billViewContent').innerHTML;
    const stylesHref = 'styles.css';

    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (!printWindow) {
        alert('Unable to open print window. Please allow popups.');
        return;
    }

    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print Bill - ${currentBill.invoiceNo}</title><link rel="stylesheet" href="${stylesHref}"></head><body>${content}</body></html>`);
    printWindow.document.close();

    // Give the new window a moment to load resources, then print and close it
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        // Optionally close after printing; keep small delay for print dialog
        setTimeout(() => printWindow.close(), 500);
    }, 300);
}

function deleteBill(billId) {
    if (!confirm('Are you sure you want to delete this bill?')) return;
    const idx = bills.findIndex(b => b.id === billId);
    if (idx !== -1) bills.splice(idx, 1);
    saveState();
    loadBills();
    alert('Bill deleted successfully');
}

// Inventory Section
function showNewInventoryForm() {
    const codeEl = document.getElementById('itemCode');
    // Item code is the auto-generated primary key; keep the existing one when editing
    if (!codeEl.value) codeEl.value = generateNextItemCode();
    document.getElementById('new-inventory-form').style.display = 'block';
}

function hideNewInventoryForm() {
    document.getElementById('new-inventory-form').style.display = 'none';
    document.getElementById('inventoryForm').reset();
}

// Generate a short sequential item code (ITM001, ITM002...).
// Scans existing `inventory` for numeric ITM codes and returns next available.
function generateNextItemCode() {
    try {
        let max = 0;
        inventory.forEach(i => {
            const m = String(i.code || '').match(/^ITM(\d+)$/i);
            if (m && m[1]) {
                const n = parseInt(m[1], 10);
                if (!isNaN(n) && n > max) max = n;
            }
        });
        const next = max + 1;
        // pad to 4 digits to safely support up to 1000+ items: ITM0001 ... ITM1000
        return 'ITM' + String(next).padStart(4, '0');
    } catch (e) {
        // fallback to short random code
        return 'ITM' + Math.random().toString(36).substr(2, 4).toUpperCase();
    }
}

// Inventory price <-> GST price auto-calculation. The field the user typed in is the source of truth.
let lastPriceEdited = 'ex';
function syncInventoryPrices(source) {
    if (source) lastPriceEdited = source;
    const gst = parseFloat(document.getElementById('itemGst').value) || 0;
    const exEl = document.getElementById('itemRate');
    const inclEl = document.getElementById('itemPriceInclGst');
    if (lastPriceEdited === 'ex') {
        const ex = parseFloat(exEl.value);
        inclEl.value = isNaN(ex) ? '' : round2(ex * (1 + gst / 100)).toFixed(2);
    } else {
        const incl = parseFloat(inclEl.value);
        exEl.value = isNaN(incl) ? '' : round2(incl / (1 + gst / 100)).toFixed(2);
    }
}

document.getElementById('inventoryForm').addEventListener('submit', function (e) {
    e.preventDefault();
    syncInventoryPrices();
    const gstRate = parseFloat(document.getElementById('itemGst').value);
    const priceExGst = parseFloat(document.getElementById('itemRate').value);
    const priceInclGst = parseFloat(document.getElementById('itemPriceInclGst').value);
    const hsn = document.getElementById('itemHsn').value.trim();
    if (!hsn) { alert('Please enter the HSN code'); return; }
    if (isNaN(gstRate) || gstRate < 0) { alert('Please enter a valid GST rate'); return; }
    if (isNaN(priceExGst)) { alert('Please enter the price (with or without GST)'); return; }
    // Item code is the primary key: auto-generated and always unique
    let code = document.getElementById('itemCode').value;
    if (!code || inventory.some(i => i.code === code)) code = generateNextItemCode();
    const item = {
        id: uid('item'),
        code,
        name: document.getElementById('itemName').value,
        partNumber: document.getElementById('itemPartNumber').value.trim(),
        hsn,
        gstRate,
        priceExGst,
        priceInclGst,
        rate: priceExGst, // kept for backward compatibility (= price without GST)
        stock: parseInt(document.getElementById('itemStock').value) || 0,
        description: document.getElementById('itemDescription').value
    };

    inventory.push(item);
    saveState();
    hideNewInventoryForm();
    loadInventory();
    updateStockItemSelect();
    alert('Item added successfully!');
});



function loadInventory() {
    const tbody = document.getElementById('inventoryTableBody');

    if (inventory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><p>No items in inventory. Add your first item!</p></td></tr>';
        return;
    }

    tbody.innerHTML = inventory.map(item => `
        <tr>
            <td><strong>${item.code}</strong></td>
            <td>${escHtml(item.name)}</td>
            <td>${escHtml(item.partNumber || '-')}</td>
            <td>${escHtml(item.hsn || '-')}</td>
            <td>${fmtRate(item.gstRate)}</td>
            <td>₹${(item.priceExGst != null ? item.priceExGst : item.rate).toFixed(2)}</td>
            <td>₹${(item.priceInclGst != null ? item.priceInclGst : item.rate).toFixed(2)}</td>
            <td><strong>${item.stock || 0}</strong></td>
            <td>${item.description || 'N/A'}</td>
            <td class="table-actions">
                <button class="btn-edit" onclick="editInventoryItem('${item.id}')">Edit</button>
                <button class="btn-delete" onclick="deleteInventoryItem('${item.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

function editInventoryItem(itemId) {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('itemCode').value = item.code;
    document.getElementById('itemName').value = item.name;
    document.getElementById('itemPartNumber').value = item.partNumber || '';
    document.getElementById('itemHsn').value = item.hsn || '';
    document.getElementById('itemGst').value = item.gstRate || 0;
    document.getElementById('itemRate').value = item.priceExGst != null ? item.priceExGst : item.rate;
    lastPriceEdited = 'ex';
    syncInventoryPrices();
    document.getElementById('itemStock').value = item.stock || 0;
    document.getElementById('itemDescription').value = item.description || '';

    // Remove old item from local inventory so form submit will re-add (acts like edit)
    const idx = inventory.findIndex(i => i.id === itemId);
    if (idx !== -1) inventory.splice(idx, 1);
    saveState();
    showNewInventoryForm();
}

function deleteInventoryItem(itemId) {
    if (!confirm('Are you sure you want to delete this item?')) return;
    const idx = inventory.findIndex(i => i.id === itemId);
    if (idx !== -1) inventory.splice(idx, 1);
    saveState();
    loadInventory();
    updateStockItemSelect();
    alert('Item deleted successfully');
}

// Stock Management
function updateStockItemSelect() {
    const select = document.getElementById('stockItemSelect');
    select.innerHTML = '<option value="">-- Select Item --</option>' +
        inventory.map(item => `<option value="${item.id}">${item.name} (Current: ${item.stock || 0})</option>`).join('');
}

document.getElementById('stockForm').addEventListener('submit', function (e) {
    e.preventDefault();

    const itemId = document.getElementById('stockItemSelect').value;
    const action = document.getElementById('stockAction').value;
    const quantity = parseInt(document.getElementById('stockQuantity').value);
    const reason = document.getElementById('stockReason').value;

    if (!itemId) {
        alert('Please select an item');
        return;
    }

    const item = inventory.find(i => i.id === itemId);
    if (!item) return;

    let newStock = item.stock || 0;

    switch (action) {
        case 'add':
            newStock += quantity;
            break;
        case 'remove':
            newStock = Math.max(0, newStock - quantity);
            break;
        case 'set':
            newStock = quantity;
            break;
    }

    item.stock = newStock;

    // Persist changes locally and add history
    addStockHistory(itemId, action, quantity, newStock, reason);
    saveState();
    document.getElementById('stockForm').reset();
    loadInventory();
    updateStockItemSelect();
    loadStockHistory();
    alert('Stock updated successfully!');
});

function addStockHistory(itemId, action, quantity, stockAfter, reason) {
    const item = inventory.find(i => i.id === itemId);
    if (!item) return;
    const history = {
        id: uid('history'),
        timestamp: new Date().toISOString(),
        itemId: itemId,
        itemName: item.name,
        action: action,
        quantity: quantity,
        stockAfter: stockAfter,
        reason: reason
    };

    stockHistory.unshift(history);
    saveState();
}

function loadStockHistory() {
    const tbody = document.getElementById('stockHistoryBody');

    if (stockHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No stock history yet</p></td></tr>';
        return;
    }

    tbody.innerHTML = stockHistory.slice(0, 50).map(history => `
        <tr>
            <td>${formatDateTime(history.timestamp)}</td>
            <td>${history.itemName}</td>
            <td><span style="text-transform: capitalize;">${history.action}</span></td>
            <td><strong>${history.quantity}</strong></td>
            <td><strong>${history.stockAfter}</strong></td>
            <td>${history.reason || 'N/A'}</td>
        </tr>
    `).join('');
}

// Export Functions
function exportBills() {
    if (bills.length === 0) {
        alert('No bills to export');
        return;
    }

    let csv = 'Invoice No,Date,Customer Name,Phone,Address,Payment Mode,Status,Items,Total Amount\n';

    bills.forEach(bill => {
        const items = bill.items.map(item => `${item.name} (${item.qty}x₹${item.rate})`).join('; ');
        csv += `"${bill.invoiceNo}","${bill.date}","${bill.customer.name}","${bill.customer.phone}","${bill.customer.address}","${bill.paymentMode || ''}","${bill.status || ''}","${items}","${bill.total}"\n`;
    });

    downloadCSV(csv, 'bills_export.csv');
}

function exportInventory() {
    if (inventory.length === 0) {
        alert('No inventory items to export');
        return;
    }

    let csv = 'Item Code,Item Name,Part Number,HSN Code,GST Rate (%),Price w/o GST,Price with GST,Stock,Description\n';

    inventory.forEach(item => {
        csv += `"${item.code}","${item.name}","${item.partNumber || ''}","${item.hsn || ''}","${item.gstRate || 0}","${item.priceExGst != null ? item.priceExGst : item.rate}","${item.priceInclGst != null ? item.priceInclGst : item.rate}","${item.stock || 0}","${item.description || ''}"\n`;
    });

    downloadCSV(csv, 'inventory_export.csv');
}

function exportStockHistory() {
    if (stockHistory.length === 0) {
        alert('No stock history to export');
        return;
    }

    let csv = 'Date & Time,Item,Action,Quantity,Stock After,Reason\n';

    stockHistory.forEach(history => {
        csv += `"${formatDateTime(history.timestamp)}","${history.itemName}","${history.action}","${history.quantity}","${history.stockAfter}","${history.reason || ''}"\n`;
    });

    downloadCSV(csv, 'stock_history_export.csv');
}

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Utility Functions
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(timestamp) {
    let date;

    // Handle Firestore timestamp
    if (timestamp && timestamp.toDate) {
        date = timestamp.toDate();
    } else if (timestamp) {
        // Handle ISO string or regular date
        date = new Date(timestamp);
    } else {
        return 'N/A';
    }

    return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
        date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// Close modal on outside click
window.onclick = function (event) {
    const modal = document.getElementById('billViewModal');
    if (event.target === modal) {
        closeBillModal();
    }
}

// --- Export page initialization and helpers ---
function initExportSection() {
    const datasetSelect = document.getElementById('exportDataset');
    const formatSelect = document.getElementById('exportFormat');

    if (!datasetSelect) return;

    // Prevent double initialization of event listeners
    if (exportInitialized) {
        // still refresh columns/filters in case data changed
        renderExportColumns(datasetSelect.value);
        renderExportFilters(datasetSelect.value);
        return;
    }
    exportInitialized = true;

    // Populate columns for the initial dataset
    datasetSelect.addEventListener('change', () => {
        renderExportColumns(datasetSelect.value);
        renderExportFilters(datasetSelect.value);
    });

    formatSelect.addEventListener('change', () => {
        // nothing special for now
    });

    document.getElementById('previewBtn').addEventListener('click', () => {
        const ds = datasetSelect.value;
        const data = getFilteredData(ds);
        const selected = getSelectedColumns();
        const rows = prepareRows(data, selected);
        document.getElementById('exportPreview').innerHTML = `<p>Preview: ${rows.length} rows</p><pre style="max-height:240px;overflow:auto;background:#fafafa;padding:8px;border:1px solid #eee">${JSON.stringify(rows.slice(0, 20), null, 2)}</pre>`;
    });

    document.getElementById('doExportBtn').addEventListener('click', () => {
        const ds = datasetSelect.value;
        const format = formatSelect.value;
        const data = getFilteredData(ds);
        
        // PDF export only works for bills
        if (format === 'pdf') {
            if (ds !== 'bills') {
                alert('PDF export is only available for Bills');
                return;
            }
            const filename = `bills_export_${new Date().toISOString().slice(0, 10)}`;
            downloadBillsPDF(data, filename);
            return;
        }
        
        const selected = getSelectedColumns();
        const rows = prepareRows(data, selected);
        const filename = `${ds}_export_${new Date().toISOString().slice(0, 10)}`;
        exportRows(rows, selected.map(c => c.label), format, filename);
    });

    // initial render
    renderExportColumns(datasetSelect.value);
    renderExportFilters(datasetSelect.value);
}

// --- Bills UI Controls: search, pagination, sorting, resizing ---
function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
}

function initBillsControls() {
    const search = document.getElementById('billsSearch');
    const perSelect = document.getElementById('billsPerPage');
    const prev = document.getElementById('billsPrev');
    const next = document.getElementById('billsNext');

    if (search) {
        search.value = billsSearch || '';
        search.addEventListener('input', debounce((e) => { billsSearch = e.target.value; billsPage = 1; loadBills(); }, 250));
    }

    if (perSelect) {
        perSelect.value = String(billsPerPage);
        perSelect.addEventListener('change', (e) => { billsPerPage = parseInt(e.target.value); billsPage = 1; loadBills(); });
    }

    if (prev) prev.addEventListener('click', () => { if (billsPage > 1) { billsPage--; loadBills(); } });
    if (next) next.addEventListener('click', () => { billsPage++; loadBills(); });

    // Sorting by clicking header
    const headers = document.querySelectorAll('#billsTableContainer thead th.sortable');
    headers.forEach(h => {
        h.style.cursor = 'pointer';
        h.addEventListener('click', () => {
            const key = h.dataset.key;
            sortBills(key);
            // visual indicator
            headers.forEach(x => x.classList.remove('sorted-asc', 'sorted-desc'));
            h.classList.add(billsSortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        });
    });

    // Make columns resizable
    makeTableResizable(document.querySelector('#billsTableContainer table'));
}

function sortBills(key) {
    if (billsSortKey === key) billsSortDir = billsSortDir === 'asc' ? 'desc' : 'asc';
    else { billsSortKey = key; billsSortDir = 'asc'; }
    loadBills();
}

function makeTableResizable(table) {
    if (!table) return;
    const ths = table.querySelectorAll('th');
    ths.forEach(th => {
        const resizer = th.querySelector('.th-resizer');
        if (!resizer) return;
        resizer.style.display = 'inline-block';
        resizer.style.width = '8px';
        resizer.style.height = '100%';
        resizer.style.float = 'right';
        resizer.style.cursor = 'col-resize';
        resizer.addEventListener('mousedown', initResize);
        function initResize(e) {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = th.offsetWidth;
            function onMove(ev) { th.style.width = (startWidth + (ev.clientX - startX)) + 'px'; }
            function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }
    });
}

function buildColumnList(dataset) {
    if (dataset === 'bills') {
        return [
            { key: 'invoiceNo', label: 'Invoice No.' },
            { key: 'date', label: 'Date' },
            { key: 'customer.name', label: 'Customer Name' },
            { key: 'customer.phone', label: 'Phone' },
            { key: 'customer.address', label: 'Address' },
            { key: 'paymentMode', label: 'Payment Mode' },
            { key: 'status', label: 'Status' },
            { key: 'items', label: 'Items (summary)' },
            { key: 'subtotal', label: 'Total w/o GST' },
            { key: 'totalCgst', label: 'Total CGST' },
            { key: 'totalSgst', label: 'Total SGST' },
            { key: 'totalGst', label: 'Total GST' },
            { key: 'total', label: 'Total after GST' },
            { key: 'timestamp', label: 'Saved At' }
        ];
    } else if (dataset === 'inventory') {
        return [
            { key: 'code', label: 'Item Code' },
            { key: 'name', label: 'Item Name' },
            { key: 'partNumber', label: 'Part Number' },
            { key: 'hsn', label: 'HSN Code' },
            { key: 'gstRate', label: 'GST Rate (%)' },
            { key: 'priceExGst', label: 'Price w/o GST' },
            { key: 'priceInclGst', label: 'Price with GST' },
            { key: 'stock', label: 'Stock' },
            { key: 'description', label: 'Description' },
            { key: 'id', label: 'Internal ID' }
        ];
    } else if (dataset === 'stockHistory') {
        return [
            { key: 'timestamp', label: 'Date & Time' },
            { key: 'itemName', label: 'Item' },
            { key: 'action', label: 'Action' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'stockAfter', label: 'Stock After' },
            { key: 'reason', label: 'Reason' }
        ];
    }
    return [];
}

function renderExportColumns(dataset) {
    const container = document.getElementById('exportColumns');
    container.innerHTML = '';
    const cols = buildColumnList(dataset);
    cols.forEach(col => {
        const id = 'col_' + col.key.replace(/\./g, '_');
        const wrapper = document.createElement('div');
        wrapper.className = 'col-option';
        wrapper.innerHTML = `<label><input type="checkbox" id="${id}" data-key="${col.key}" checked> ${col.label}</label>`;
        container.appendChild(wrapper);
    });
}

function renderExportFilters(dataset) {
    const container = document.getElementById('exportFilters');
    container.innerHTML = '';
    if (dataset === 'bills') {
        container.innerHTML = `
            <label>Date From</label>
            <input type="date" id="filter_date_from">
            <label>Date To</label>
            <input type="date" id="filter_date_to">
            <label>Status</label>
            <select id="filter_status"><option value="">Any</option><option>Paid</option><option>Unpaid</option><option>Pending</option></select>
            <label>Search</label>
            <input type="text" id="filter_search" placeholder="Invoice / Customer / Item">
        `;
    } else if (dataset === 'inventory') {
        container.innerHTML = `
            <label>Search</label>
            <input type="text" id="filter_search" placeholder="Name or Code">
        `;
    } else if (dataset === 'stockHistory') {
        container.innerHTML = `
            <label>Date From</label>
            <input type="date" id="filter_date_from">
            <label>Date To</label>
            <input type="date" id="filter_date_to">
            <label>Item</label>
            <select id="filter_item"><option value="">Any</option>${inventory.map(i => `<option value="${i.id}">${i.name}</option>`).join('')}</select>
        `;
    }
}

function getSelectedColumns() {
    const container = document.getElementById('exportColumns');
    const checks = Array.from(container.querySelectorAll('input[type=checkbox]'));
    return checks.filter(c => c.checked).map(c => ({ key: c.dataset.key, label: c.parentNode.textContent.trim() }));
}

function getFilteredData(dataset) {
    if (dataset === 'bills') {
        let data = bills.slice();
        const from = document.getElementById('filter_date_from') ? document.getElementById('filter_date_from').value : '';
        const to = document.getElementById('filter_date_to') ? document.getElementById('filter_date_to').value : '';
        const status = document.getElementById('filter_status') ? document.getElementById('filter_status').value : '';
        const search = document.getElementById('filter_search') ? (document.getElementById('filter_search').value || '').toLowerCase() : '';

        if (from) data = data.filter(d => d.date >= from);
        if (to) data = data.filter(d => d.date <= to);
        if (status) data = data.filter(d => (d.status || '').toLowerCase() === status.toLowerCase());
        if (search) data = data.filter(d => (d.invoiceNo && d.invoiceNo.toLowerCase().includes(search)) || (d.customer && d.customer.name && d.customer.name.toLowerCase().includes(search)) || (d.items && d.items.some(it => it.name && it.name.toLowerCase().includes(search))));
        return data;
    } else if (dataset === 'inventory') {
        let data = inventory.slice();
        const search = document.getElementById('filter_search') ? (document.getElementById('filter_search').value || '').toLowerCase() : '';
        if (search) data = data.filter(i => (i.name && i.name.toLowerCase().includes(search)) || (i.code && i.code.toLowerCase().includes(search)) || (i.partNumber && i.partNumber.toLowerCase().includes(search)));
        return data;
    } else if (dataset === 'stockHistory') {
        let data = stockHistory.slice();
        const from = document.getElementById('filter_date_from') ? document.getElementById('filter_date_from').value : '';
        const to = document.getElementById('filter_date_to') ? document.getElementById('filter_date_to').value : '';
        const item = document.getElementById('filter_item') ? document.getElementById('filter_item').value : '';
        if (from) data = data.filter(d => d.timestamp >= from);
        if (to) data = data.filter(d => d.timestamp <= to);
        if (item) data = data.filter(d => d.itemId === item);
        return data;
    }
    return [];
}

function getValueByPath(obj, path) {
    if (!path) return '';
    if (path === 'items') {
        if (!obj.items) return '';
        return obj.items.map(it => `${it.name || ''} (${it.qty}x${it.rate})`).join('; ');
    }
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (!cur) return '';
        cur = cur[p];
    }
    if (cur === undefined || cur === null) return '';
    return cur;
}

function prepareRows(data, columns) {
    return data.map(item => {
        const row = {};
        columns.forEach(c => {
            row[c.label] = getValueByPath(item, c.key);
        });
        return row;
    });
}

function exportRows(rows, headers, format, filename) {
    if (!rows || rows.length === 0) {
        alert('No rows to export');
        return;
    }

    if (format === 'json') {
        const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
        downloadBlob(blob, filename + '.json');
        return;
    }

    if (format === 'csv') {
        const cols = Object.keys(rows[0]);
        const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => `"${String(r[c] || '').replace(/"/g, '""')}"`).join(','))).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        downloadBlob(blob, filename + '.csv');
        return;
    }

    if (format === 'xlsx') {
        if (window.XLSX) {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Export');
            XLSX.writeFile(wb, filename + '.xlsx');
            return;
        } else {
            // fallback to CSV
            const cols = Object.keys(rows[0]);
            const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => `"${String(r[c] || '').replace(/"/g, '""')}"`).join(','))).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            downloadBlob(blob, filename + '.csv');
            return;
        }
    }
}

function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// Backwards-compatible quick export functions reuse existing CSV exporters but keep them available

