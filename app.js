// Bill Manager Application

// Data Storage
let bills = [];
let inventory = [];
let stockHistory = [];
let currentBillItems = [];
let currentBill = null;

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

        loadInventory();
        updateStockItemSelect();
        loadBills();
        loadStockHistory();
        generateNextInvoiceNumber();
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

    if (bills.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No bills found. Create your first bill!</p></td></tr>';
        return;
    }

    tbody.innerHTML = bills.map(bill => `
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

document.getElementById('inventoryForm').addEventListener('submit', function (e) {
    e.preventDefault();
    const item = {
        id: uid('item'),
        code: document.getElementById('itemCode').value || `ITM${Date.now()}`,
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
