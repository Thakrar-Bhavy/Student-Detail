/*************************************************
 * GLOBAL CONFIG
 *************************************************/
const SPREADSHEET = SpreadsheetApp.getActive();
const SESSION_CACHE = CacheService.getScriptCache();
const SESSION_TTL = 6 * 60 * 60; // 6 hours

/*************************************************
 * UTILITIES
 *************************************************/
function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function createSession(user) {
  const token = Utilities.getUuid();
  SESSION_CACHE.put(token, JSON.stringify(user), SESSION_TTL);
  return token;
}

function getSession(token) {
  const data = SESSION_CACHE.get(token);
  return data ? JSON.parse(data) : null;
}

function requireSession(token) {
  const user = getSession(token);
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

/*************************************************
 * LOGIN & SESSION
 *************************************************/
function login(id, password) {
  const sheet = SPREADSHEET.getSheetByName("credentials");
  if (!sheet) return { success: false };

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === id && data[i][2] === password) {
      const user = { id: id, role: data[i][3] };
      const token = createSession(user);
      return { success: true, token: token, role: user.role };
    }
  }
  return { success: false };
}

function checkSession(token) {
  const user = getSession(token);
  return user ? { valid: true, user } : { valid: false };
}

/*************************************************
 * SHEET MANAGEMENT
 *************************************************/
function listSheets(token) {
  requireSession(token);
  return SPREADSHEET.getSheets()
    .map(s => s.getName())
    .filter(name => name !== "credentials");
}

function deleteSheet(token, name) {
  const user = requireSession(token);
  if (user.role !== "Admin") return { success: false };

  const sheet = SPREADSHEET.getSheetByName(name);
  if (!sheet || name === "credentials") return { success: false };

  SPREADSHEET.deleteSheet(sheet);
  return { success: true };
}

/*************************************************
 * DOWNLOAD SHEET AS EXCEL
 *************************************************/
function downloadSheet(token, name) {
  const user = requireSession(token);
  if (user.role !== "Admin") throw new Error("Unauthorized");

  const sheet = SPREADSHEET.getSheetByName(name);
  if (!sheet) throw new Error("Sheet not found");

  // Get spreadsheet ID
  const ssId = SPREADSHEET.getId();
  
  // Get sheet ID (GID)
  const sheets = SPREADSHEET.getSheets();
  let sheetId = 0;
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === name) {
      sheetId = sheets[i].getSheetId();
      break;
    }
  }

  // Create export URL
  const url = `https://docs.google.com/spreadsheets/d/${ssId}/export?format=xlsx&gid=${sheetId}`;
  
  return { 
    success: true, 
    downloadUrl: url,
    fileName: `${name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.xlsx`
  };
}

/*************************************************
 * CSV UPLOAD - PRESERVE ALL COLUMNS + ADD EXTRA
 *************************************************/
function uploadExcel(token, name, fileData) {
  const user = requireSession(token);
  if (user.role !== "Admin") return { success: false, error: "Unauthorized" };

  try {
    // Decode base64 data
    const base64Data = fileData.replace(/^data:.*;base64,/, '');
    
    // Parse CSV data
    const csvString = Utilities.newBlob(Utilities.base64Decode(base64Data)).getDataAsString();
    const rows = parseCSV(csvString);
    
    if (rows.length === 0) {
      return { success: false, error: "CSV file is empty" };
    }
    
    // Create or get sheet
    let newSheet = SPREADSHEET.getSheetByName(name);
    if (newSheet) {
      SPREADSHEET.deleteSheet(newSheet);
    }
    newSheet = SPREADSHEET.insertSheet(name);
    
    // Original CSV headers (first row)
    const originalHeaders = rows[0];
    
    // Add extra columns to headers
    const allHeaders = [...originalHeaders, "Status", "Remark", "Timestamp", "Coordinator", "Method"];
    
    // Write headers
    newSheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]);
    
    // Process data rows
    const allRowData = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0) continue;
      
      // Create a new array with original data + empty values for new columns
      const newRow = [...row];
      
      // Fill missing columns if CSV row has fewer columns than headers
      while (newRow.length < originalHeaders.length) {
        newRow.push("");
      }
      
      // Add empty values for the 4 new columns (will be filled later)
      newRow.push(""); // Status
      newRow.push(""); // Remark
      newRow.push(""); // Timestamp
      newRow.push(""); // Coordinator
      newRow.push(""); // Method
      
      allRowData.push(newRow);
    }
    
    // Write all data
    if (allRowData.length > 0) {
      newSheet.getRange(2, 1, allRowData.length, allHeaders.length).setValues(allRowData);
    }
    
    // Format the sheet
    newSheet.getRange(1, 1, 1, allHeaders.length).setFontWeight('bold');
    
    // Auto-resize columns
    for (let i = 1; i <= allHeaders.length; i++) {
      newSheet.autoResizeColumn(i);
    }
    
    // Add timestamp formatting for Timestamp column
    const timestampColIndex = originalHeaders.length + 3; // Status, Remark, then Timestamp
    const timestampRange = newSheet.getRange(2, timestampColIndex, allRowData.length, 1);
    timestampRange.setNumberFormat("yyyy-mm-dd hh:mm:ss");
    
    return { 
      success: true, 
      message: `Successfully imported ${allRowData.length} records`,
      count: allRowData.length,
      originalColumns: originalHeaders.length,
      totalColumns: allHeaders.length
    };
    
  } catch (error) {
    console.error("Upload error:", error);
    return { 
      success: false, 
      error: `Upload failed: ${error.message || error.toString()}` 
    };
  }
}

/*************************************************
 * CSV PARSER HELPER
 *************************************************/
function parseCSV(csvString) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;
  
  for (let i = 0; i < csvString.length; i++) {
    const char = csvString[i];
    const nextChar = i < csvString.length - 1 ? csvString[i + 1] : '';
    
    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote
        currentCell += '"';
        i++; // Skip next char
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // End of cell
      currentRow.push(currentCell);
      currentCell = '';
    } else if (char === '\n' && !insideQuotes) {
      // End of row
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else if (char === '\r') {
      // Skip carriage return
      continue;
    } else {
      currentCell += char;
    }
  }
  
  // Add last cell and row
  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }
  
  return rows;
}

/*************************************************
 * COORDINATOR FUNCTIONS - UPDATED FOR NEW COLUMNS
 *************************************************/
function getAllStudents(token, sheetName) {
  requireSession(token);

  const sheet = SPREADSHEET.getSheetByName(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  let list = [];

  // Find Enrolment No column index
  const headers = data[0];
  let enrollmentIndex = -1;
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).toLowerCase().trim();
    if (header.includes('enrol') || header.includes('roll')) {
      enrollmentIndex = i;
      break;
    }
  }

  // Find First Name column index
  let firstNameIndex = -1;
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).toLowerCase().trim();
    if (header.includes('first') || header.includes('fname') || header.includes('name')) {
      firstNameIndex = i;
      break;
    }
  }

  for (let i = 1; i < data.length; i++) {
    const enrollment = enrollmentIndex !== -1 ? data[i][enrollmentIndex] : '';
    const firstName = firstNameIndex !== -1 ? data[i][firstNameIndex] : '';
    
    if (enrollment || firstName) {
      list.push({
        enroll: enrollment ? enrollment.toString() : '',
        name: firstName ? firstName.toString() : ''
      });
    }
  }
  return list;
}

function markPresent(token, sheetName, enroll, remark) {
  requireSession(token);

  const sheet = SPREADSHEET.getSheetByName(sheetName);
  if (!sheet) return { success: false };

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // Find column indices
  let enrollmentIndex = -1;
  let statusIndex = -1;
  let remarkIndex = -1;
  let timestampIndex = -1;
  let coordinatorIndex = -1;
  let methodIndex = -1;

  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).toLowerCase().trim();
    if (header.includes('enrol') || header.includes('roll')) {
      enrollmentIndex = i;
    } else if (header === 'status') {
      statusIndex = i;
    } else if (header === 'remark') {
      remarkIndex = i;
    } else if (header === 'timestamp') {
      timestampIndex = i;
    } else if (header === 'coordinator') {
      coordinatorIndex = i;
    } else if (header === 'method') {
      methodIndex = i;
    }
  }

  // If Status column not found (shouldn't happen with new upload), find it
  if (statusIndex === -1) {
    // Status is added as the first extra column
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === 'Status') {
        statusIndex = i;
        break;
      }
    }
  }

  for (let i = 1; i < data.length; i++) {
    if (enrollmentIndex !== -1 && data[i][enrollmentIndex] && 
        data[i][enrollmentIndex].toString() === enroll) {
      
      // Set Status
      if (statusIndex !== -1) {
        sheet.getRange(i + 1, statusIndex + 1).setValue("Present");
      }
      
      // Set Remark
      if (remarkIndex !== -1 && remark) {
        sheet.getRange(i + 1, remarkIndex + 1).setValue(remark);
      }
      
      // Set Timestamp
      if (timestampIndex !== -1) {
        sheet.getRange(i + 1, timestampIndex + 1).setValue(new Date());
      }
      
      // Get coordinator name from session
      const user = getSession(token);
      if (coordinatorIndex !== -1 && user) {
        sheet.getRange(i + 1, coordinatorIndex + 1).setValue(user.id);
      }
      
      // Set Method (assuming web interface)
      if (methodIndex !== -1) {
        sheet.getRange(i + 1, methodIndex + 1).setValue("Web");
      }
      
      return { success: true };
    }
  }
  return { success: false };
}

function countPresent(token, sheetName) {
  requireSession(token);

  const sheet = SPREADSHEET.getSheetByName(sheetName);
  if (!sheet) return { count: 0 };

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Find Status column
  let statusIndex = -1;
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase().trim() === 'status') {
      statusIndex = i;
      break;
    }
  }
  
  if (statusIndex === -1) return { count: 0 };
  
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][statusIndex] === "Present") count++;
  }
  return { count };
}

/*************************************************
 * WEB APP ROUTER
 *************************************************/
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);

    switch (req.action) {
      case "login":
        return json(login(req.id, req.password));

      case "checkSession":
        return json(checkSession(req.token));

      case "sheets":
        return json(listSheets(req.token));

      case "deleteSheet":
        return json(deleteSheet(req.token, req.name));

      case "downloadSheet":
        return json(downloadSheet(req.token, req.name));

      case "uploadExcel":
        return json(uploadExcel(req.token, req.name, req.data));

      case "getAll":
        return json(getAllStudents(req.token, req.sheet));

      case "present":
        return json(markPresent(
          req.token,
          req.sheet,
          req.enroll,
          req.remark
        ));

      case "count":
        return json(countPresent(req.token, req.sheet));

      default:
        return json({ error: "INVALID_ACTION" });
    }
  } catch (err) {
    return json({ error: err.message });
  }
}

// Add doGet for direct download links
function doGet(e) {
  const { token, sheet, action } = e.parameter;
  
  if (action === "directDownload" && token && sheet) {
    try {
      const user = requireSession(token);
      if (user.role !== "Admin") {
        return HtmlService.createHtmlOutput("<h1>Unauthorized</h1>");
      }
      
      const sheetObj = SPREADSHEET.getSheetByName(sheet);
      if (!sheetObj) {
        return HtmlService.createHtmlOutput("<h1>Sheet not found</h1>");
      }
      
      // Get spreadsheet and sheet IDs
      const ssId = SPREADSHEET.getId();
      const sheets = SPREADSHEET.getSheets();
      let sheetId = 0;
      
      for (let i = 0; i < sheets.length; i++) {
        if (sheets[i].getName() === sheet) {
          sheetId = sheets[i].getSheetId();
          break;
        }
      }
      
      // Redirect to Google's export URL
      const redirectUrl = `https://docs.google.com/spreadsheets/d/${ssId}/export?format=xlsx&gid=${sheetId}`;
      return HtmlService.createHtmlOutput(`
        <script>
          window.location.href = "${redirectUrl}";
        </script>
        <p>Downloading... If not started, <a href="${redirectUrl}">click here</a></p>
      `);
      
    } catch (err) {
      return HtmlService.createHtmlOutput(`<h1>Error: ${err.message}</h1>`);
    }
  }
  
  return HtmlService.createHtmlOutput("<h1>Invalid request</h1>");
}
/*************************************************
 * BARCODE SCANNER SPECIFIC FUNCTIONS
 *************************************************/

// Get student data for scanner cache
function getStudentsForScanner(token, sheetName) {
  const user = requireSession(token);
  
  const sheet = SPREADSHEET.getSheetByName(sheetName);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Find relevant column indices
  let enrollmentIndex = -1;
  let nameIndex = -1;
  
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).toLowerCase().trim();
    if (header.includes('enrol') || header.includes('roll') || header.includes('id')) {
      enrollmentIndex = i;
    } else if (header.includes('first') || header.includes('name') || header.includes('student')) {
      nameIndex = i;
    }
  }
  
  const students = [];
  for (let i = 1; i < data.length; i++) {
    const enrollment = enrollmentIndex !== -1 ? data[i][enrollmentIndex] : '';
    const name = nameIndex !== -1 ? data[i][nameIndex] : '';
    
    if (enrollment || name) {
      students.push({
        enroll: enrollment ? enrollment.toString().trim() : '',
        name: name ? name.toString().trim() : ''
      });
    }
  }
  
  return students;
}

// Batch attendance marking (for pending queue sync)
function batchMarkAttendance(token, sheetName, attendanceList) {
  const user = requireSession(token);
  
  const sheet = SPREADSHEET.getSheetByName(sheetName);
  if (!sheet) return { success: false, error: "Sheet not found" };
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Find column indices
  let enrollmentIndex = -1;
  let statusIndex = -1;
  let remarkIndex = -1;
  let timestampIndex = -1;
  let coordinatorIndex = -1;
  let methodIndex = -1;
  
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).toLowerCase().trim();
    if (header.includes('enrol') || header.includes('roll')) {
      enrollmentIndex = i;
    } else if (header === 'status') {
      statusIndex = i;
    } else if (header === 'remark') {
      remarkIndex = i;
    } else if (header === 'timestamp') {
      timestampIndex = i;
    } else if (header === 'coordinator') {
      coordinatorIndex = i;
    } else if (header === 'method') {
      methodIndex = i;
    }
  }
  
  const results = [];
  const userData = getSession(token);
  
  attendanceList.forEach(att => {
    let marked = false;
    
    for (let i = 1; i < data.length; i++) {
      if (enrollmentIndex !== -1 && data[i][enrollmentIndex] && 
          data[i][enrollmentIndex].toString().trim() === att.enroll) {
        
        // Set Status
        if (statusIndex !== -1) {
          sheet.getRange(i + 1, statusIndex + 1).setValue("Present");
        }
        
        // Set Remark
        if (remarkIndex !== -1) {
          const remark = att.remark || `Batch synced at ${new Date().toLocaleString()}`;
          sheet.getRange(i + 1, remarkIndex + 1).setValue(remark);
        }
        
        // Set Timestamp
        if (timestampIndex !== -1) {
          sheet.getRange(i + 1, timestampIndex + 1).setValue(new Date());
        }
        
        // Set Coordinator
        if (coordinatorIndex !== -1 && userData) {
          sheet.getRange(i + 1, coordinatorIndex + 1).setValue(userData.id);
        }
        
        // Set Method
        if (methodIndex !== -1) {
          sheet.getRange(i + 1, methodIndex + 1).setValue("Barcode Scanner");
        }
        
        marked = true;
        results.push({ enroll: att.enroll, success: true });
        break;
      }
    }
    
    if (!marked) {
      results.push({ enroll: att.enroll, success: false, error: "Student not found" });
    }
  });
  
  return { success: true, results: results };
}

// Update doPost to handle new actions
// Add to existing switch statement:
/*
case "getScannerStudents":
  return json(getStudentsForScanner(req.token, req.sheet));
  
case "batchAttendance":
  return json(batchMarkAttendance(req.token, req.sheet, req.attendanceList));
*/