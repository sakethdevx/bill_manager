// Bill Manager Application

// PDF Design Constants - Elegant and Professional
const PDF_COLORS = {
    PRIMARY_DARK: [45, 55, 72],        // Dark slate for headers
    ACCENT_BLUE: [71, 85, 105],        // Muted blue for accents
    WHITE: [255, 255, 255],
    BORDER_LIGHT: [226, 232, 240],     // Light border
    BORDER_MEDIUM: [203, 213, 225],    // Medium border
    TEXT_PRIMARY: [15, 23, 42],        // Almost black for text
    TEXT_SECONDARY: [100, 116, 139],   // Gray for secondary text
    TEXT_MUTED: [148, 163, 184],       // Muted gray
    BG_SUBTLE: [248, 250, 252],        // Very light background
    STATUS_PAID: [34, 197, 94],        // Green
    STATUS_PENDING: [251, 146, 60],    // Orange
    STATUS_OTHER: [239, 68, 68]        // Red
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

// Initialize App
document.addEventListener('DOMContentLoaded', function () {
    // Wait for Supabase auth to initialize in `supabase-config.js` which will call `loadAllData()` when signed in.
});

// Load all data from serverless KV state
async function loadAllData() {
    try {
        setDefaultDate();

        // Include Authorization header if available
        const sessionResp = await (window.supabaseClient ? window.supabaseClient.auth.getSession() : Promise.resolve({ data: { session: null } }));
        const token = sessionResp && sessionResp.data && sessionResp.data.session ? sessionResp.data.session.access_token : null;
        const headers = token ? { 'Authorization': 'Bearer ' + token } : {};

        const res = await fetch('/api/state', { headers });
        if (!res.ok) throw new Error('Failed to fetch state');
        const state = await res.json();

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
        // Include Authorization header if available
        const sessionResp = await (window.supabaseClient ? window.supabaseClient.auth.getSession() : Promise.resolve({ data: { session: null } }));
        const token = sessionResp && sessionResp.data && sessionResp.data.session ? sessionResp.data.session.access_token : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch('/api/state', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to save state');
    } catch (err) {
        console.error('Error saving state:', err);
        alert('Unable to persist data. Check console for details.');
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
}

function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('invoiceDate').value = today;
}

function generateNextInvoiceNumber() {
    let nextNumber = 1;
    if (bills.length > 0) {
        const lastBill = bills[bills.length - 1];
        const lastNumber = parseInt(lastBill.invoiceNo.replace(/\D/g, '')) || 0;
        nextNumber = lastNumber + 1;
    }
    document.getElementById('invoiceNo').value = nextNumber.toString().padStart(3, '0');
}

function addBillItem() {
    const itemRow = document.createElement('div');
    itemRow.className = 'item-row';
    itemRow.innerHTML = `
        <div class="item-field">
            <label>Item</label>
            <select class="item-select" onchange="fillItemDetails(this)">
                <option value="">-- Select or Type --</option>
                ${inventory.map(item => `<option value="${item.id}" data-rate="${item.rate}">${item.name}</option>`).join('')}
                <option value="custom">Custom Item</option>
            </select>
            <input type="text" class="item-name" placeholder="Item name" style="margin-top: 5px;">
        </div>
        <div class="item-field">
            <label>Quantity</label>
            <input type="number" class="item-qty" min="1" value="1" onchange="calculateItemTotal(this)">
        </div>
        <div class="item-field">
            <label>Rate (₹)</label>
            <input type="number" class="item-rate" step="0.01" min="0" onchange="calculateItemTotal(this)">
        </div>
        <div class="item-field">
            <label>Amount (₹)</label>
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

    if (select.value === 'custom') {
        nameInput.value = '';
        rateInput.value = '';
        nameInput.focus();
    } else if (select.value) {
        const item = inventory.find(i => i.id === select.value);
        if (item) {
            nameInput.value = item.name;
            rateInput.value = item.rate;
            calculateItemTotal(row.querySelector('.item-qty'));
        }
    }
}

function calculateItemTotal(input) {
    const row = input.closest('.item-row');
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
    const amount = qty * rate;
    row.querySelector('.item-amount').value = amount.toFixed(2);
    calculateBillTotal();
}

function calculateBillTotal() {
    let total = 0;
    document.querySelectorAll('.item-amount').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('billTotal').textContent = total.toFixed(2);
}

function removeBillItem(button) {
    button.closest('.item-row').remove();
    calculateBillTotal();
}

// Submit Bill Form
document.getElementById('billForm').addEventListener('submit', function (e) {
    e.preventDefault();

    const items = [];
    document.querySelectorAll('.item-row').forEach(row => {
        const name = row.querySelector('.item-name').value;
        const qty = parseFloat(row.querySelector('.item-qty').value);
        const rate = parseFloat(row.querySelector('.item-rate').value);
        const amount = parseFloat(row.querySelector('.item-amount').value);
        const itemSelect = row.querySelector('.item-select');
        const itemId = itemSelect.value !== 'custom' ? itemSelect.value : null;

        if (name && qty && rate) {
            items.push({ itemId, name, qty, rate, amount });
        }
    });

    if (items.length === 0) {
        alert('Please add at least one item');
        return;
    }

    const bill = {
        id: uid('bill'),
        invoiceNo: document.getElementById('invoiceNo').value,
        date: document.getElementById('invoiceDate').value,
        customer: {
            name: document.getElementById('customerName').value,
            phone: document.getElementById('customerPhone').value,
            address: document.getElementById('customerAddress').value
        },
        transport: document.getElementById('transport').value,
        paymentMode: document.getElementById('paymentMode') ? document.getElementById('paymentMode').value : 'Cash',
        status: document.getElementById('paymentStatus') ? document.getElementById('paymentStatus').value : 'Unpaid',
        items: items,
        total: parseFloat(document.getElementById('billTotal').textContent),
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
            <td>${bill.customer.name}</td>
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
                <p>${bill.customer.name}</p>
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
                <h4>Transport</h4>
                <p>${bill.transport || 'N/A'}</p>
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
                        <th>Particulars</th>
                        <th>Qty</th>
                        <th>Unit Rate</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${bill.items.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${item.name}</td>
                            <td>${item.qty}</td>
                            <td>₹${item.rate.toFixed(2)}</td>
                            <td>₹${item.amount.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="bill-total">
            Total Amount: ₹${bill.total.toFixed(2)}
        </div>
    `;

    document.getElementById('billViewContent').innerHTML = content;
    document.getElementById('billViewModal').classList.add('active');
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
        const margin = 50;

        // Elegant top border
        doc.setDrawColor(...PDF_COLORS.PRIMARY_DARK);
        doc.setLineWidth(3);
        doc.line(margin, 40, pageWidth - margin, 40);
        
        // Company name - elegant and refined
        doc.setFontSize(22);
        doc.setTextColor(...PDF_COLORS.PRIMARY_DARK);
        doc.setFont(undefined, 'bold');
        doc.text(COMPANY_INFO.NAME, margin, 65);
        
        doc.setFontSize(9);
        doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
        doc.setFont(undefined, 'normal');
        doc.text(COMPANY_INFO.ADDRESS, margin, 82);
        
        // GST and Phone number
        doc.setFontSize(8);
        doc.text(`GSTIN: ${COMPANY_INFO.GSTIN}  |  Cell: ${COMPANY_INFO.PHONE}`, margin, 95);

        // Invoice title - right aligned, elegant
        doc.setFontSize(28);
        doc.setTextColor(...PDF_COLORS.TEXT_MUTED);
        doc.setFont(undefined, 'bold');
        doc.text('INVOICE', pageWidth - margin, 65, { align: 'right' });

        // Thin separator line
        doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
        doc.setLineWidth(0.5);
        doc.line(margin, 108, pageWidth - margin, 108);

        // Invoice details - clean layout
        let currentY = 133;
        doc.setFontSize(9);
        doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
        doc.setFont(undefined, 'bold');
        doc.text('INVOICE NUMBER', pageWidth - margin - 150, currentY, { align: 'right' });
        doc.text('DATE', pageWidth - margin - 150, currentY + 20, { align: 'right' });
        
        doc.setTextColor(...PDF_COLORS.TEXT_PRIMARY);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        doc.text(currentBill.invoiceNo, pageWidth - margin, currentY, { align: 'right' });
        doc.text(formatDate(currentBill.date), pageWidth - margin, currentY + 20, { align: 'right' });

        // Bill To section - refined
        currentY = 133;
        doc.setFontSize(9);
        doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
        doc.setFont(undefined, 'bold');
        doc.text('BILL TO', margin, currentY);
        
        currentY += 18;
        doc.setFontSize(11);
        doc.setTextColor(...PDF_COLORS.TEXT_PRIMARY);
        doc.setFont(undefined, 'bold');
        doc.text(currentBill.customer.name, margin, currentY);
        
        currentY += 15;
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
        const addressLines = doc.splitTextToSize(currentBill.customer.address || 'N/A', 250);
        doc.text(addressLines, margin, currentY);
        
        currentY += (addressLines.length * 12) + 10;
        doc.text(`Phone: ${currentBill.customer.phone || 'N/A'}`, margin, currentY);

        // Additional details - single row, clean
        currentY += 35;
        doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
        doc.setLineWidth(0.5);
        doc.line(margin, currentY, pageWidth - margin, currentY);
        
        currentY += 18;
        doc.setFontSize(8);
        doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
        doc.setFont(undefined, 'bold');
        doc.text('TRANSPORT', margin, currentY);
        doc.text('PAYMENT METHOD', margin + 180, currentY);
        doc.text('STATUS', margin + 360, currentY);
        
        currentY += 12;
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...PDF_COLORS.TEXT_PRIMARY);
        doc.text(currentBill.transport || 'N/A', margin, currentY);
        doc.text(currentBill.paymentMode || 'N/A', margin + 180, currentY);
        
        // Status with subtle color
        const status = currentBill.status || 'N/A';
        if (status.toLowerCase() === 'paid') {
            doc.setTextColor(...PDF_COLORS.STATUS_PAID);
        } else if (status.toLowerCase() === 'pending') {
            doc.setTextColor(...PDF_COLORS.STATUS_PENDING);
        } else {
            doc.setTextColor(...PDF_COLORS.STATUS_OTHER);
        }
        doc.setFont(undefined, 'bold');
        doc.text(status, margin + 360, currentY);

        currentY += 18;
        doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
        doc.setLineWidth(0.5);
        doc.line(margin, currentY, pageWidth - margin, currentY);

        // Items table - elegant and clean
        const tableStartY = currentY + 15;
        const cols = ['#', 'Description', 'Qty', 'Unit Price', 'Amount'];
        const rows = currentBill.items.map((it, idx) => [
            idx + 1, 
            it.name, 
            String(it.qty), 
            `₹${it.rate.toFixed(2)}`, 
            `₹${it.amount.toFixed(2)}`
        ]);

        doc.autoTable({ 
            startY: tableStartY, 
            head: [cols], 
            body: rows,
            theme: 'plain',
            headStyles: {
                fillColor: PDF_COLORS.BG_SUBTLE,
                textColor: PDF_COLORS.TEXT_SECONDARY,
                fontSize: 9,
                fontStyle: 'bold',
                halign: 'left',
                cellPadding: 8
            },
            bodyStyles: {
                fontSize: 9,
                textColor: PDF_COLORS.TEXT_PRIMARY,
                cellPadding: 8
            },
            columnStyles: {
                0: { halign: 'center', cellWidth: 30 },
                1: { cellWidth: 'auto' },
                2: { halign: 'center', cellWidth: 50 },
                3: { halign: 'right', cellWidth: 80 },
                4: { halign: 'right', cellWidth: 90 }
            },
            margin: { left: margin, right: margin },
            didDrawPage: function(data) {
                // Add subtle borders
                doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
                doc.setLineWidth(0.5);
            }
        });

        // Total section - refined and elegant
        const finalY = doc.lastAutoTable.finalY || 400;
        
        // Subtle separator
        doc.setDrawColor(...PDF_COLORS.BORDER_MEDIUM);
        doc.setLineWidth(1);
        doc.line(pageWidth - margin - 200, finalY + 15, pageWidth - margin, finalY + 15);
        
        // Total amount - elegant presentation
        doc.setFontSize(10);
        doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
        doc.setFont(undefined, 'bold');
        doc.text('TOTAL AMOUNT', pageWidth - margin - 200, finalY + 35, { align: 'left' });
        
        doc.setFontSize(16);
        doc.setTextColor(...PDF_COLORS.PRIMARY_DARK);
        doc.setFont(undefined, 'bold');
        doc.text(`₹${currentBill.total.toFixed(2)}`, pageWidth - margin, finalY + 37, { align: 'right' });

        // Footer - minimalist and professional
        const footerY = pageHeight - 60;
        doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
        doc.setLineWidth(0.5);
        doc.line(margin, footerY, pageWidth - margin, footerY);
        
        doc.setFontSize(8);
        doc.setTextColor(...PDF_COLORS.TEXT_MUTED);
        doc.setFont(undefined, 'normal');
        doc.text('Thank you for your business', pageWidth / 2, footerY + 15, { align: 'center' });
        doc.text('For inquiries, please contact us at the address above', pageWidth / 2, footerY + 27, { align: 'center' });

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
        const margin = 50;

        billsToExport.forEach((bill, billIndex) => {
            if (billIndex > 0) {
                doc.addPage();
            }

            // Elegant top border
            doc.setDrawColor(...PDF_COLORS.PRIMARY_DARK);
            doc.setLineWidth(3);
            doc.line(margin, 40, pageWidth - margin, 40);
            
            // Company name - elegant and refined
            doc.setFontSize(22);
            doc.setTextColor(...PDF_COLORS.PRIMARY_DARK);
            doc.setFont(undefined, 'bold');
            doc.text(COMPANY_INFO.NAME, margin, 65);
            
            doc.setFontSize(9);
            doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
            doc.setFont(undefined, 'normal');
            doc.text(COMPANY_INFO.ADDRESS, margin, 82);
            
            // GST and Phone number
            doc.setFontSize(8);
            doc.text(`GSTIN: ${COMPANY_INFO.GSTIN}  |  Cell: ${COMPANY_INFO.PHONE}`, margin, 95);

            // Invoice title - right aligned, elegant
            doc.setFontSize(28);
            doc.setTextColor(...PDF_COLORS.TEXT_MUTED);
            doc.setFont(undefined, 'bold');
            doc.text('INVOICE', pageWidth - margin, 65, { align: 'right' });

            // Thin separator line
            doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
            doc.setLineWidth(0.5);
            doc.line(margin, 108, pageWidth - margin, 108);

            // Invoice details - clean layout
            let currentY = 133;
            doc.setFontSize(9);
            doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
            doc.setFont(undefined, 'bold');
            doc.text('INVOICE NUMBER', pageWidth - margin - 150, currentY, { align: 'right' });
            doc.text('DATE', pageWidth - margin - 150, currentY + 20, { align: 'right' });
            
            doc.setTextColor(...PDF_COLORS.TEXT_PRIMARY);
            doc.setFont(undefined, 'normal');
            doc.setFontSize(10);
            doc.text(bill.invoiceNo, pageWidth - margin, currentY, { align: 'right' });
            doc.text(formatDate(bill.date), pageWidth - margin, currentY + 20, { align: 'right' });

            // Bill To section - refined
            currentY = 133;
            doc.setFontSize(9);
            doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
            doc.setFont(undefined, 'bold');
            doc.text('BILL TO', margin, currentY);
            
            currentY += 18;
            doc.setFontSize(11);
            doc.setTextColor(...PDF_COLORS.TEXT_PRIMARY);
            doc.setFont(undefined, 'bold');
            doc.text(bill.customer.name, margin, currentY);
            
            currentY += 15;
            doc.setFontSize(9);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
            const addressLines = doc.splitTextToSize(bill.customer.address || 'N/A', 250);
            doc.text(addressLines, margin, currentY);
            
            currentY += (addressLines.length * 12) + 10;
            doc.text(`Phone: ${bill.customer.phone || 'N/A'}`, margin, currentY);

            // Additional details - single row, clean
            currentY += 35;
            doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
            doc.setLineWidth(0.5);
            doc.line(margin, currentY, pageWidth - margin, currentY);
            
            currentY += 18;
            doc.setFontSize(8);
            doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
            doc.setFont(undefined, 'bold');
            doc.text('TRANSPORT', margin, currentY);
            doc.text('PAYMENT METHOD', margin + 180, currentY);
            doc.text('STATUS', margin + 360, currentY);
            
            currentY += 12;
            doc.setFontSize(9);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(...PDF_COLORS.TEXT_PRIMARY);
            doc.text(bill.transport || 'N/A', margin, currentY);
            doc.text(bill.paymentMode || 'N/A', margin + 180, currentY);
            
            // Status with subtle color
            const status = bill.status || 'N/A';
            if (status.toLowerCase() === 'paid') {
                doc.setTextColor(...PDF_COLORS.STATUS_PAID);
            } else if (status.toLowerCase() === 'pending') {
                doc.setTextColor(...PDF_COLORS.STATUS_PENDING);
            } else {
                doc.setTextColor(...PDF_COLORS.STATUS_OTHER);
            }
            doc.setFont(undefined, 'bold');
            doc.text(status, margin + 360, currentY);

            currentY += 18;
            doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
            doc.setLineWidth(0.5);
            doc.line(margin, currentY, pageWidth - margin, currentY);

            // Items table - elegant and clean
            const tableStartY = currentY + 15;
            const cols = ['#', 'Description', 'Qty', 'Unit Price', 'Amount'];
            const rows = bill.items.map((it, idx) => [
                idx + 1, 
                it.name, 
                String(it.qty), 
                `₹${it.rate.toFixed(2)}`, 
                `₹${it.amount.toFixed(2)}`
            ]);

            doc.autoTable({ 
                startY: tableStartY, 
                head: [cols], 
                body: rows,
                theme: 'plain',
                headStyles: {
                    fillColor: PDF_COLORS.BG_SUBTLE,
                    textColor: PDF_COLORS.TEXT_SECONDARY,
                    fontSize: 9,
                    fontStyle: 'bold',
                    halign: 'left',
                    cellPadding: 8
                },
                bodyStyles: {
                    fontSize: 9,
                    textColor: PDF_COLORS.TEXT_PRIMARY,
                    cellPadding: 8
                },
                columnStyles: {
                    0: { halign: 'center', cellWidth: 30 },
                    1: { cellWidth: 'auto' },
                    2: { halign: 'center', cellWidth: 50 },
                    3: { halign: 'right', cellWidth: 80 },
                    4: { halign: 'right', cellWidth: 90 }
                },
                margin: { left: margin, right: margin },
                didDrawPage: function(data) {
                    // Add subtle borders
                    doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
                    doc.setLineWidth(0.5);
                }
            });

            // Total section - refined and elegant
            const finalY = doc.lastAutoTable.finalY || 400;
            
            // Subtle separator
            doc.setDrawColor(...PDF_COLORS.BORDER_MEDIUM);
            doc.setLineWidth(1);
            doc.line(pageWidth - margin - 200, finalY + 15, pageWidth - margin, finalY + 15);
            
            // Total amount - elegant presentation
            doc.setFontSize(10);
            doc.setTextColor(...PDF_COLORS.TEXT_SECONDARY);
            doc.setFont(undefined, 'bold');
            doc.text('TOTAL AMOUNT', pageWidth - margin - 200, finalY + 35, { align: 'left' });
            
            doc.setFontSize(16);
            doc.setTextColor(...PDF_COLORS.PRIMARY_DARK);
            doc.setFont(undefined, 'bold');
            doc.text(`₹${bill.total.toFixed(2)}`, pageWidth - margin, finalY + 37, { align: 'right' });

            // Footer - minimalist and professional
            const footerY = pageHeight - 60;
            doc.setDrawColor(...PDF_COLORS.BORDER_LIGHT);
            doc.setLineWidth(0.5);
            doc.line(margin, footerY, pageWidth - margin, footerY);
            
            doc.setFontSize(8);
            doc.setTextColor(...PDF_COLORS.TEXT_MUTED);
            doc.setFont(undefined, 'normal');
            doc.text('Thank you for your business', pageWidth / 2, footerY + 15, { align: 'center' });
            doc.text('For inquiries, please contact us at the address above', pageWidth / 2, footerY + 27, { align: 'center' });
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

document.getElementById('inventoryForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const item = {
        id: uid('item'),
        // Use shorter, sequential auto-generated code when not provided
        code: document.getElementById('itemCode').value || generateNextItemCode(),
        name: document.getElementById('itemName').value,
        rate: parseFloat(document.getElementById('itemRate').value),
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
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><p>No items in inventory. Add your first item!</p></td></tr>';
        return;
    }

    tbody.innerHTML = inventory.map(item => `
        <tr>
            <td><strong>${item.code}</strong></td>
            <td>${item.name}</td>
            <td>₹${item.rate.toFixed(2)}</td>
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
    document.getElementById('itemRate').value = item.rate;
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

    let csv = 'Invoice No,Date,Customer Name,Phone,Address,Transport,Payment Mode,Status,Items,Total Amount\n';

    bills.forEach(bill => {
        const items = bill.items.map(item => `${item.name} (${item.qty}x₹${item.rate})`).join('; ');
        csv += `"${bill.invoiceNo}","${bill.date}","${bill.customer.name}","${bill.customer.phone}","${bill.customer.address}","${bill.transport}","${bill.paymentMode || ''}","${bill.status || ''}","${items}","${bill.total}"\n`;
    });

    downloadCSV(csv, 'bills_export.csv');
}

function exportInventory() {
    if (inventory.length === 0) {
        alert('No inventory items to export');
        return;
    }

    let csv = 'Item Code,Item Name,Unit Rate,Stock,Description\n';

    inventory.forEach(item => {
        csv += `"${item.code}","${item.name}","${item.rate}","${item.stock || 0}","${item.description || ''}"\n`;
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
            { key: 'total', label: 'Total Amount' },
            { key: 'timestamp', label: 'Saved At' }
        ];
    } else if (dataset === 'inventory') {
        return [
            { key: 'code', label: 'Item Code' },
            { key: 'name', label: 'Item Name' },
            { key: 'rate', label: 'Unit Rate' },
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
        if (search) data = data.filter(i => (i.name && i.name.toLowerCase().includes(search)) || (i.code && i.code.toLowerCase().includes(search)));
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

