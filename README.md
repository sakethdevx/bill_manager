# Bill Manager - BALAJI SAI AUTO MOBILES

A comprehensive web-based bill management system with inventory tracking and stock management features.

## Features

### 📄 Bill Management

- Create new bills with automatic invoice numbering
- Add customer details (name, phone, address, transport)
- Add multiple items per bill with quantity and rates
- Automatic calculation of total amounts
- View detailed bill information
- Export bills to CSV format
- Print-friendly bill view
- Delete bills with confirmation

### 📦 Inventory Management

- Add new items with item code, name, rate, and description
- Track current stock levels for each item
- Edit existing inventory items
- Delete items from inventory
- Export inventory to CSV format
- Automatic stock updates when bills are created

### 📊 Stock Management (Optional Feature)

- Three stock operations:
  - **Add Stock**: Increase inventory
  - **Remove Stock**: Decrease inventory
  - **Set Stock**: Set absolute stock level
- Track stock changes with reasons/notes
- Complete stock history with timestamps
- View last 50 stock transactions
- Export stock history to CSV format
- Automatic stock tracking from bill creation

## Technology Stack

- **HTML5**: Structure and layout
- **CSS3**: Modern, responsive styling
- **JavaScript (Vanilla)**: Application logic
- **LocalStorage**: Data persistence

## Installation

1. Clone or download this repository to your computer
2. No installation required - it's a standalone web application!
3. Simply open `index.html` in any modern web browser

```bash
# If you have the files, just open:
open index.html  # macOS
start index.html # Windows
xdg-open index.html # Linux
```

## Usage

### Creating a Bill

1. Click on **"Bills"** tab in the navigation
2. Click **"+ New Bill"** button
3. Fill in the invoice details (invoice number is auto-generated)
4. Enter customer information
5. Click **"+ Add Item"** to add items
   - Select from existing inventory items, or
   - Choose "Custom Item" to enter manually
6. Items from inventory will auto-fill rate and deduct stock
7. Review the total amount
8. Click **"Save Bill"** to create the bill

### Managing Inventory

1. Click on **"Inventory"** tab
2. Click **"+ Add Item"** button
3. Enter item details:
   - Item Name (required)
   - Item Code (auto-generated if not provided)
   - Unit Rate (required)
   - Current Stock (optional)
   - Description (optional)
4. Click **"Add Item"** to save
5. Use **Edit** to modify items or **Delete** to remove them

### Stock Management

1. Click on **"Stock Management"** tab
2. Select an item from the dropdown
3. Choose action:
   - **Add Stock**: For purchases or restocking
   - **Remove Stock**: For sales, damages, or adjustments
   - **Set Stock**: To set exact stock level
4. Enter quantity
5. Add a reason/note (optional)
6. Click **"Update Stock"**
7. View complete history in the table below

### Exporting Data

- **Export Bills**: Click "📥 Export Bills" button in Bills section
- **Export Inventory**: Click "📥 Export Inventory" button in Inventory section
- **Export Stock History**: Click "📥 Export History" button in Stock Management section

All exports are in CSV format and can be opened in Excel or Google Sheets.

## Data Storage

All data is stored locally in your browser using LocalStorage:

- **Bills**: Complete bill records with all details
- **Inventory**: All inventory items with current stock levels
- **Stock History**: Complete transaction log

**Note**: Data is stored per browser. Clearing browser data will delete all records. Consider exporting data regularly as backup.

## Browser Compatibility

Works on all modern browsers:

- ✅ Chrome/Edge (Recommended)
- ✅ Firefox
- ✅ Safari
- ✅ Opera

## Features Based on Your Manual Bill

Based on your manual bill image, this system includes:

- ✅ Invoice numbering
- ✅ Date tracking
- ✅ Customer name and address
- ✅ Transport field
- ✅ Items list with S.No, Particulars, Qty, Unit Rate, Amount
- ✅ Total amount calculation
- ❌ Tax calculations (as requested to neglect)
- ❌ HSN Code (simplified)
- ❌ Bank details (can be added to print template if needed)

## Customization

### Change Business Name

Edit the business name in [app.js](app.js#L412):

```javascript
<h2>BALAJI SAI AUTO MOBILES</h2>
<p>Auto Nagar, Eluru Road, JANGAREDDYGUDEM</p>
```

### Modify Colors

Edit CSS variables in [styles.css](styles.css):

```css
:root {
    --primary-color: #2563eb;
    --success-color: #10b981;
    /* ... other colors */
}
```

### Add More Fields

Modify the HTML forms in [index.html](index.html) and corresponding JavaScript functions in [app.js](app.js).

## Backup & Restore

### Manual Backup

1. Export all data (Bills, Inventory, Stock History)
2. Save CSV files safely

### Browser DevTools Method

1. Open browser DevTools (F12)
2. Go to Console tab
3. Export data:

```javascript
// Export all data
console.log(localStorage.getItem('bills'));
console.log(localStorage.getItem('inventory'));
console.log(localStorage.getItem('stockHistory'));
```

## Future Enhancements

Potential features for future versions:

- 📱 Offline PWA support
- 🔐 Multi-user support with authentication
- ☁️ Cloud backup and sync
- 📊 Analytics and reports
- 💳 Payment tracking
- 📧 Email bills to customers
- 🖨️ PDF export
- 📱 Mobile app version

## Troubleshooting

### Data Not Saving

- Ensure browser allows LocalStorage
- Check browser console for errors
- Try a different browser

### Items Not Showing in Bill Form

- Make sure you've added items to Inventory first
- Refresh the page

### Export Not Working

- Ensure you have data to export
- Check if browser blocks downloads
- Try a different browser

## License

Free to use and modify for personal and commercial purposes.

## Support

For issues or questions, please check:

- Browser console for error messages
- Ensure JavaScript is enabled
- Try incognito/private mode to rule out extensions

---

**Created for BALAJI SAI AUTO MOBILES**  
*A simple, efficient, and powerful bill management solution*
