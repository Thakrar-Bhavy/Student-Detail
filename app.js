// Main Application
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the app
    const app = {
        // Configuration
        config: {
            adminPassword: 'superadmin123', // In production, use proper authentication
            coordinatorPasswords: {
                coordinator1: 'coord1pass',
                coordinator2: 'coord2pass',
                coordinator3: 'coord3pass'
            },
            googleSheetsWebAppUrl: 'https://script.google.com/macros/s/AKfycbz8liq_FCStOoUG-JD6TzsJptWzw9G9sttYS7G4mC5CcMqEIS7e5mP7cn_wOJWRSGO1/exec',
            spreadsheetId: 'YOUR_SPREADSHEET_ID' // Replace with your actual Google Sheet ID
        },
        
        // State
        state: {
            currentUser: null,
            isOnline: navigator.onLine,
            masterData: null,
            activeSheet: null,
            attendanceRecords: [],
            pendingSync: [],
            scannerActive: false,
            sheets: [],
            quaggaInitialized: false
        },
        
        // Initialize the application
        init: function() {
            this.checkLoginState();
            this.setupEventListeners();
            this.checkConnection();
            
            // Listen for online/offline events
            window.addEventListener('online', () => this.handleConnectionChange(true));
            window.addEventListener('offline', () => this.handleConnectionChange(false));
            
            // Initialize Quagga when needed
            this.initQuagga();
        },
        
        // Initialize Quagga scanner
        initQuagga: function() {
            if (this.state.quaggaInitialized) return;
            
            Quagga.init({
                inputStream: {
                    name: "Live",
                    type: "LiveStream",
                    target: document.querySelector('#scanner-container'),
                    constraints: {
                        width: 480,
                        height: 320,
                        facingMode: "environment"
                    },
                },
                decoder: {
                    readers: ["code_128_reader", "ean_reader", "ean_8_reader", "code_39_reader", 
                            "code_39_vin_reader", "codabar_reader", "upc_reader", "upc_e_reader"]
                },
                locator: {
                    patchSize: "medium",
                    halfSample: true
                },
                locate: true,
                numOfWorkers: 4
            }, function(err) {
                if (err) {
                    console.error("Quagga initialization error:", err);
                    return;
                }
                console.log("Quagga initialized successfully");
                app.state.quaggaInitialized = true;
            });
            
            Quagga.onDetected((result) => {
                const code = result.codeResult.code;
                this.handleScannedCode(code);
            });
        },
        
        // Check if user is already logged in
        checkLoginState: function() {
            const user = localStorage.getItem('attendanceSystemUser');
            if (user) {
                this.state.currentUser = JSON.parse(user);
                this.showPanel(this.state.currentUser.role);
                
                // Load necessary data based on role
                if (this.state.currentUser.role === 'coordinator') {
                    this.fetchAvailableSheets();
                    if (this.state.masterData) {
                        this.updateAttendanceList();
                    }
                } else if (this.state.currentUser.role === 'admin') {
                    this.fetchAllSheets();
                }
            }
        },
        
        // Setup event listeners
        setupEventListeners: function() {
            // Login form
            document.getElementById('role-select').addEventListener('change', (e) => {
                document.getElementById('coordinator-login').classList.add('hidden');
                document.getElementById('admin-login').classList.add('hidden');
                
                if (e.target.value === 'coordinator') {
                    document.getElementById('coordinator-login').classList.remove('hidden');
                } else if (e.target.value === 'admin') {
                    document.getElementById('admin-login').classList.remove('hidden');
                }
            });
            
            document.getElementById('login-btn').addEventListener('click', () => this.handleLogin());
            
            // Coordinator panel
            document.getElementById('coordinator-logout').addEventListener('click', () => this.logout());
            document.getElementById('excel-upload').addEventListener('change', (e) => this.handleExcelUpload(e));
            document.getElementById('load-sheet-btn').addEventListener('click', () => this.loadSheetData());
            document.getElementById('toggle-scanner-btn').addEventListener('click', () => this.toggleScanner());
            document.getElementById('manual-submit').addEventListener('click', () => this.handleManualEntry());
            document.getElementById('download-attendance-btn').addEventListener('click', () => this.downloadAttendanceCSV());
            
            // Admin panel
            document.getElementById('admin-logout').addEventListener('click', () => this.logout());
            document.getElementById('create-sheet-btn').addEventListener('click', () => this.createSheet());
            document.getElementById('delete-sheet-btn').addEventListener('click', () => this.deleteSheet());
            document.getElementById('download-sheet-btn').addEventListener('click', () => this.downloadSheet());
            document.getElementById('toggle-visibility-btn').addEventListener('click', () => this.toggleSheetVisibility());
            document.getElementById('refresh-sheets-btn').addEventListener('click', () => this.fetchAllSheets());
            
            // Handle manual entry on Enter key
            document.getElementById('manual-enrollment').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleManualEntry();
                }
            });
        },
        
        // Handle login
        handleLogin: function() {
            const role = document.getElementById('role-select').value;
            
            if (role === 'coordinator') {
                const coordinator = document.getElementById('coordinator-select').value;
                const password = document.getElementById('coordinator-password').value;
                
                if (!coordinator || !password) {
                    alert('Please select a coordinator and enter password');
                    return;
                }
                
                if (password === this.config.coordinatorPasswords[coordinator]) {
                    this.state.currentUser = { role: 'coordinator', id: coordinator };
                    localStorage.setItem('attendanceSystemUser', JSON.stringify(this.state.currentUser));
                    this.showPanel('coordinator');
                    this.fetchAvailableSheets();
                } else {
                    alert('Invalid password');
                }
            } else if (role === 'admin') {
                const password = document.getElementById('admin-password').value;
                
                if (!password) {
                    alert('Please enter admin password');
                    return;
                }
                
                if (password === this.config.adminPassword) {
                    this.state.currentUser = { role: 'admin' };
                    localStorage.setItem('attendanceSystemUser', JSON.stringify(this.state.currentUser));
                    this.showPanel('admin');
                    this.fetchAllSheets();
                } else {
                    alert('Invalid admin password');
                }
            } else {
                alert('Please select a role');
            }
        },
        
        // Logout
        logout: function() {
            this.state.currentUser = null;
            localStorage.removeItem('attendanceSystemUser');
            
            // Stop scanner if active
            if (this.state.scannerActive) {
                this.stopScanner();
            }
            
            // Show login screen
            document.getElementById('login-section').classList.remove('hidden');
            document.getElementById('coordinator-panel').classList.add('hidden');
            document.getElementById('admin-panel').classList.add('hidden');
            
            // Reset form fields
            document.getElementById('role-select').value = '';
            document.getElementById('coordinator-select').value = '';
            document.getElementById('coordinator-password').value = '';
            document.getElementById('admin-password').value = '';
        },
        
        // Show the appropriate panel based on role
        showPanel: function(role) {
            document.getElementById('login-section').classList.add('hidden');
            
            if (role === 'coordinator') {
                document.getElementById('coordinator-panel').classList.remove('hidden');
                document.getElementById('admin-panel').classList.add('hidden');
            } else if (role === 'admin') {
                document.getElementById('admin-panel').classList.remove('hidden');
                document.getElementById('coordinator-panel').classList.add('hidden');
            }
        },
        
        // Handle Excel file upload
        handleExcelUpload: function(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    // Assuming first sheet contains the data
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    
                    // Convert to JSON
                    this.state.masterData = XLSX.utils.sheet_to_json(worksheet);
                    
                    // Ensure enrollment numbers are treated as strings
                    this.state.masterData.forEach(student => {
                        if (student.enrollment) {
                            student.enrollment = student.enrollment.toString();
                        }
                    });
                    
                    alert(`Successfully loaded ${this.state.masterData.length} student records`);
                    
                    // Enable sheet selection
                    document.getElementById('load-sheet-btn').disabled = false;
                } catch (error) {
                    console.error('Error processing Excel file:', error);
                    alert('Error processing Excel file. Please ensure it is a valid Excel file.');
                }
            };
            reader.onerror = () => {
                alert('Error reading file. Please try again.');
            };
            reader.readAsArrayBuffer(file);
        },
        
        // Fetch sheets available to coordinators
        fetchAvailableSheets: async function() {
            try {
                const response = await fetch(`${this.config.googleSheetsWebAppUrl}?action=listSheets`);
                if (!response.ok) throw new Error('Network response was not ok');
                
                const result = await response.json();
                
                if (result.sheets && result.sheets.length > 0) {
                    const sheetSelect = document.getElementById('sheet-select');
                    sheetSelect.innerHTML = '<option value="">-- Select Sheet --</option>';
                    
                    result.sheets.forEach(sheet => {
                        const option = document.createElement('option');
                        option.value = sheet.name;
                        option.textContent = sheet.name;
                        sheetSelect.appendChild(option);
                    });
                    
                    sheetSelect.disabled = false;
                } else {
                    alert('No sheets available. Please create sheets in Admin panel.');
                }
            } catch (error) {
                console.error('Error fetching sheets:', error);
                alert('Failed to load available sheets. ' + error.message);
            }
        },
        
        // Load data from selected sheet
        loadSheetData: function() {
            const sheetName = document.getElementById('sheet-select').value;
            if (!sheetName) {
                alert('Please select a sheet');
                return;
            }
            
            this.state.activeSheet = sheetName;
            alert(`Active sheet set to: ${sheetName}`);
        },
        
        // Toggle barcode scanner
        toggleScanner: function() {
            if (this.state.scannerActive) {
                this.stopScanner();
            } else {
                this.startScanner();
            }
        },
        
        // Start barcode scanner
        startScanner: function() {
            if (!this.state.quaggaInitialized) {
                this.initQuagga();
            }
            
            this.state.scannerActive = true;
            document.getElementById('scanner-container').classList.remove('hidden');
            document.getElementById('toggle-scanner-btn').textContent = 'Stop Scanner';
            
            Quagga.start();
        },
        
        // Stop barcode scanner
        stopScanner: function() {
            this.state.scannerActive = false;
            document.getElementById('scanner-container').classList.add('hidden');
            document.getElementById('toggle-scanner-btn').textContent = 'Start Scanner';
            
            if (Quagga) {
                Quagga.stop();
            }
        },
        
        // Handle scanned barcode
        handleScannedCode: function(code) {
            if (!this.state.activeSheet) {
                alert('Please select an active sheet first');
                return;
            }
            
            // Convert code to string for comparison
            const enrollment = code.toString();
            
            // Check if already marked
            if (this.isStudentMarked(enrollment)) {
                alert('Student already marked present');
                return;
            }
            
            // Find student in master data
            const student = this.findStudent(enrollment);
            
            if (!student) {
                alert('Student not found in master data');
                return;
            }
            
            // Create attendance record
            const record = {
                enrollment: enrollment,
                name: student.name,
                timestamp: new Date().toISOString(),
                method: 'scanner',
                synced: false
            };
            
            this.addAttendanceRecord(record);
        },
        
        // Check if student is already marked
        isStudentMarked: function(enrollment) {
            return this.state.attendanceRecords.some(record => 
                record.enrollment.toString() === enrollment.toString()
            );
        },
        
        // Find student in master data
        findStudent: function(enrollment) {
            if (!this.state.masterData) {
                alert('Master student data not loaded. Please upload Excel file first.');
                return null;
            }
            
            // Convert both to string for comparison
            const enrollmentStr = enrollment.toString();
            return this.state.masterData.find(s => 
                s.enrollment && s.enrollment.toString() === enrollmentStr
            );
        },
        
        // Handle manual enrollment entry
        handleManualEntry: function() {
            const enrollmentInput = document.getElementById('manual-enrollment');
            const enrollment = enrollmentInput.value.trim();
            
            if (!enrollment) {
                alert('Please enter an enrollment number');
                return;
            }
            
            if (!this.state.activeSheet) {
                alert('Please select an active sheet first');
                return;
            }
            
            // Check if already marked
            if (this.isStudentMarked(enrollment)) {
                alert('Student already marked present');
                enrollmentInput.value = '';
                return;
            }
            
            // Find student in master data
            const student = this.findStudent(enrollment);
            
            if (!student) {
                alert('Student not found in master data');
                return;
            }
            
            // Create attendance record
            const record = {
                enrollment: enrollment,
                name: student.name,
                timestamp: new Date().toISOString(),
                method: 'manual',
                synced: false
            };
            
            this.addAttendanceRecord(record);
            enrollmentInput.value = '';
        },
        
        // Add attendance record and update UI
        addAttendanceRecord: function(record) {
            this.state.attendanceRecords.push(record);
            this.updateAttendanceList();
            
            if (this.state.isOnline) {
                this.syncRecord(record);
            } else {
                this.state.pendingSync.push(record);
                this.updateConnectionStatus();
            }
        },
        
        // Update the attendance list UI
        updateAttendanceList: function() {
            const list = document.getElementById('attendance-list');
            list.innerHTML = '';
            
            this.state.attendanceRecords.forEach(record => {
                const row = document.createElement('tr');
                
                const enrollmentCell = document.createElement('td');
                enrollmentCell.textContent = record.enrollment;
                
                const nameCell = document.createElement('td');
                nameCell.textContent = record.name;
                
                const timeCell = document.createElement('td');
                timeCell.textContent = new Date(record.timestamp).toLocaleTimeString();
                
                const methodCell = document.createElement('td');
                methodCell.textContent = record.method === 'scanner' ? 'Scanner' : 'Manual';
                
                const statusCell = document.createElement('td');
                statusCell.textContent = record.synced ? 'Synced' : 'Pending';
                statusCell.className = record.synced ? 'text-success' : 'text-warning';
                
                row.appendChild(enrollmentCell);
                row.appendChild(nameCell);
                row.appendChild(timeCell);
                row.appendChild(methodCell);
                row.appendChild(statusCell);
                
                list.appendChild(row);
            });
        },
        
        // Download attendance as CSV
        downloadAttendanceCSV: function() {
            if (this.state.attendanceRecords.length === 0) {
                alert('No attendance records to download');
                return;
            }
            
            // Create CSV content
            let csv = 'Enrollment,Name,Time,Method,Status\n';
            this.state.attendanceRecords.forEach(record => {
                const time = new Date(record.timestamp).toLocaleString();
                csv += `"${record.enrollment}","${record.name}","${time}","${record.method}","${record.synced ? 'Synced' : 'Pending'}"\n`;
            });
            
            // Create download link
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `attendance_${this.state.activeSheet || 'session'}_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },
        
        // Fetch all sheets for admin
        fetchAllSheets: async function() {
            try {
                const response = await fetch(`${this.config.googleSheetsWebAppUrl}?action=listSheets`);
                if (!response.ok) throw new Error('Network response was not ok');
                
                const result = await response.json();
                
                if (result.sheets) {
                    this.state.sheets = result.sheets;
                    this.updateSheetsList();
                    
                    // Update dropdowns
                    const deleteSelect = document.getElementById('delete-sheet-select');
                    const downloadSelect = document.getElementById('download-sheet-select');
                    const visibilitySelect = document.getElementById('visibility-sheet-select');
                    
                    deleteSelect.innerHTML = '<option value="">-- Select Sheet --</option>';
                    downloadSelect.innerHTML = '<option value="">-- Select Sheet --</option>';
                    visibilitySelect.innerHTML = '<option value="">-- Select Sheet --</option>';
                    
                    result.sheets.forEach(sheet => {
                        const option1 = document.createElement('option');
                        option1.value = sheet.name;
                        option1.textContent = sheet.name;
                        deleteSelect.appendChild(option1.cloneNode(true));
                        
                        const option2 = document.createElement('option');
                        option2.value = sheet.name;
                        option2.textContent = sheet.name;
                        downloadSelect.appendChild(option2.cloneNode(true));
                        
                        const option3 = document.createElement('option');
                        option3.value = sheet.name;
                        option3.textContent = sheet.name;
                        visibilitySelect.appendChild(option3.cloneNode(true));
                    });
                } else {
                    alert('No sheets found in the spreadsheet');
                }
            } catch (error) {
                console.error('Error fetching sheets:', error);
                alert('Failed to load sheets. ' + error.message);
            }
        },
        
        // Update sheets list UI
        updateSheetsList: function() {
            const list = document.getElementById('sheets-list');
            list.innerHTML = '';
            
            this.state.sheets.forEach(sheet => {
                const row = document.createElement('tr');
                
                const nameCell = document.createElement('td');
                nameCell.textContent = sheet.name;
                
                const visibleCell = document.createElement('td');
                visibleCell.textContent = sheet.visible ? 'Yes' : 'No';
                
                const actionsCell = document.createElement('td');
                const toggleBtn = document.createElement('button');
                toggleBtn.className = 'btn btn-sm btn-outline-secondary me-2';
                toggleBtn.textContent = 'Toggle Visibility';
                toggleBtn.onclick = () => this.toggleSheetVisibility(sheet.name);
                
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'btn btn-sm btn-outline-primary';
                downloadBtn.textContent = 'Download';
                downloadBtn.onclick = () => this.downloadSheet(sheet.name);
                
                actionsCell.appendChild(toggleBtn);
                actionsCell.appendChild(downloadBtn);
                
                row.appendChild(nameCell);
                row.appendChild(visibleCell);
                row.appendChild(actionsCell);
                
                list.appendChild(row);
            });
        },
        
        // Create new sheet
        createSheet: async function() {
            const sheetName = document.getElementById('new-sheet-name').value.trim();
            if (!sheetName) {
                alert('Please enter a sheet name');
                return;
            }
            
            try {
                const response = await fetch(this.config.googleSheetsWebAppUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'createSheet',
                        sheetName: sheetName
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.state.sheets.push({ name: sheetName, visible: true });
                    this.updateSheetsList();
                    
                    // Update dropdowns
                    const option = document.createElement('option');
                    option.value = sheetName;
                    option.textContent = sheetName;
                    
                    document.getElementById('delete-sheet-select').appendChild(option.cloneNode(true));
                    document.getElementById('download-sheet-select').appendChild(option.cloneNode(true));
                    document.getElementById('visibility-sheet-select').appendChild(option.cloneNode(true));
                    
                    document.getElementById('new-sheet-name').value = '';
                    alert(`Sheet "${sheetName}" created successfully`);
                } else {
                    alert(`Error creating sheet: ${result.error}`);
                }
            } catch (error) {
                console.error('Error creating sheet:', error);
                alert('Failed to create sheet. ' + error.message);
            }
        },
        
        // Delete sheet
        deleteSheet: async function() {
            const sheetName = document.getElementById('delete-sheet-select').value;
            if (!sheetName) {
                alert('Please select a sheet to delete');
                return;
            }
            
            if (!confirm(`Are you sure you want to delete "${sheetName}"? This cannot be undone.`)) {
                return;
            }
            
            try {
                const response = await fetch(this.config.googleSheetsWebAppUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'deleteSheet',
                        sheetName: sheetName
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.state.sheets = this.state.sheets.filter(sheet => sheet.name !== sheetName);
                    this.updateSheetsList();
                    
                    // Update dropdowns
                    const deleteSelect = document.getElementById('delete-sheet-select');
                    const downloadSelect = document.getElementById('download-sheet-select');
                    const visibilitySelect = document.getElementById('visibility-sheet-select');
                    
                    deleteSelect.value = '';
                    downloadSelect.value = '';
                    visibilitySelect.value = '';
                    
                    Array.from(deleteSelect.options).forEach(option => {
                        if (option.value === sheetName) {
                            deleteSelect.removeChild(option);
                        }
                    });
                    
                    Array.from(downloadSelect.options).forEach(option => {
                        if (option.value === sheetName) {
                            downloadSelect.removeChild(option);
                        }
                    });
                    
                    Array.from(visibilitySelect.options).forEach(option => {
                        if (option.value === sheetName) {
                            visibilitySelect.removeChild(option);
                        }
                    });
                    
                    alert(`Sheet "${sheetName}" deleted successfully`);
                } else {
                    alert(`Error deleting sheet: ${result.error}`);
                }
            } catch (error) {
                console.error('Error deleting sheet:', error);
                alert('Failed to delete sheet. ' + error.message);
            }
        },
        
        // Download sheet as CSV
        downloadSheet: async function(sheetName) {
            if (!sheetName) {
                sheetName = document.getElementById('download-sheet-select').value;
                if (!sheetName) {
                    alert('Please select a sheet to download');
                    return;
                }
            }
            
            try {
                const response = await fetch(`${this.config.googleSheetsWebAppUrl}?action=getSheetData&sheetName=${encodeURIComponent(sheetName)}`);
                if (!response.ok) throw new Error('Network response was not ok');
                
                const result = await response.json();
                
                if (result.data) {
                    // Create CSV content
                    let csv = '';
                    result.data.forEach(row => {
                        csv += row.map(field => `"${field}"`).join(',') + '\n';
                    });
                    
                    // Create download link
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${sheetName}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } else {
                    alert('No data found in the sheet');
                }
            } catch (error) {
                console.error('Error downloading sheet:', error);
                alert('Failed to download sheet. ' + error.message);
            }
        },
        
        // Toggle sheet visibility
        toggleSheetVisibility: async function(sheetName) {
            if (!sheetName) {
                sheetName = document.getElementById('visibility-sheet-select').value;
                if (!sheetName) {
                    alert('Please select a sheet');
                    return;
                }
            }
            
            try {
                const sheet = this.state.sheets.find(s => s.name === sheetName);
                if (!sheet) {
                    alert('Sheet not found');
                    return;
                }
                
                const newVisibility = !sheet.visible;
                
                const response = await fetch(this.config.googleSheetsWebAppUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'toggleVisibility',
                        sheetName: sheetName,
                        visible: newVisibility
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    sheet.visible = newVisibility;
                    this.updateSheetsList();
                    alert(`Sheet "${sheetName}" visibility set to ${newVisibility ? 'visible' : 'hidden'}`);
                } else {
                    alert(`Error toggling visibility: ${result.error}`);
                }
            } catch (error) {
                console.error('Error toggling sheet visibility:', error);
                alert('Failed to toggle visibility. ' + error.message);
            }
        },
        
        // Sync record with Google Sheets
        syncRecord: async function(record) {
            try {
                const response = await fetch(this.config.googleSheetsWebAppUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        studentId: record.enrollment,
                        studentName: record.name,
                        sheetName: this.state.activeSheet,
                        markedBy: this.state.currentUser?.id || 'System',
                        method: record.method
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    const index = this.state.attendanceRecords.findIndex(r => 
                        r.enrollment === record.enrollment && r.timestamp === record.timestamp);
                    
                    if (index !== -1) {
                        this.state.attendanceRecords[index].synced = true;
                        this.updateAttendanceList();
                    }
                    return true;
                } else {
                    console.error('Sync failed:', result.error);
                    return false;
                }
            } catch (error) {
                console.error('Error syncing record:', error);
                return false;
            }
        },
        
        // Sync pending records when connection is restored
        syncPendingRecords: async function() {
            this.updateConnectionStatus();
            
            // Process pending records in order
            while (this.state.pendingSync.length > 0) {
                const record = this.state.pendingSync[0]; // Peek at first record
                const success = await this.syncRecord(record);
                
                if (success) {
                    this.state.pendingSync.shift(); // Remove only if successful
                } else {
                    break; // Stop on first failure
                }
            }
            
            this.updateConnectionStatus();
        },
        
        // Check connection status
        checkConnection: function() {
            this.state.isOnline = navigator.onLine;
            this.updateConnectionStatus();
            
            if (this.state.isOnline && this.state.pendingSync.length > 0) {
                this.syncPendingRecords();
            }
        },
        
        // Handle connection change
        handleConnectionChange: function(online) {
            this.state.isOnline = online;
            this.updateConnectionStatus();
            
            if (online && this.state.pendingSync.length > 0) {
                this.syncPendingRecords();
            }
        },
        
        // Update connection status UI
        updateConnectionStatus: function() {
            const statusElement = document.getElementById('connection-status');
            
            if (this.state.isOnline) {
                if (this.state.pendingSync.length > 0) {
                    statusElement.className = 'connection-status sync-pending';
                    statusElement.innerHTML = `<i class="bi bi-arrow-repeat"></i> Syncing (${this.state.pendingSync.length} pending)`;
                } else {
                    statusElement.className = 'connection-status online';
                    statusElement.innerHTML = '<i class="bi bi-wifi"></i> Online';
                }
            } else {
                statusElement.className = 'connection-status offline';
                statusElement.innerHTML = `<i class="bi bi-wifi-off"></i> Offline (${this.state.pendingSync.length} pending)`;
            }
        }
    };
    
    // Initialize the app
    app.init();
});
