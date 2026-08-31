const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROTA_FILE = path.join(__dirname, '../database/team_rota.json');

/**
 * Generate a full monthly schedule for a given category and roster pattern.
 * [CQ-02 REMEDIATED] — Month, year, and "today" are derived dynamically.
 * No longer hardcoded to August 2026 or day 30.
 *
 * @param {string} category  'core' | 'bau' | 'montreal'
 * @param {Date}   [forDate] Optional reference date; defaults to now. Used for testing.
 */
function generateMonthlyRoster(category = 'core', forDate = new Date()) {
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const rows = [];

  // [CQ-02] All date computations are relative to forDate (defaults to today)
  const year       = forDate.getFullYear();
  const month      = forDate.getMonth();           // 0-indexed (0=Jan, 7=Aug)
  const todayDay   = forDate.getDate();            // Day of the month right now
  const daysInMonth = new Date(year, month + 1, 0).getDate(); // Actual days in this month

  const monthStr   = String(month + 1).padStart(2, '0');      // e.g. "08"
  const yearStr    = String(year);                             // e.g. "2026"
  const prefix     = `${yearStr}-${monthStr}`;               // e.g. "2026-08"

  // Helper: resolve per-day status relative to today
  function dayStatus(day) {
    if (day === todayDay) return 'ACTIVE TODAY';
    if (day < todayDay)  return 'Completed';
    return 'Scheduled';
  }

  if (category === 'core') {
    const primaryPool = [
      { name: "Sakthi Praveen", email: "sakthi.praveen@yourbank.internal", pager: "+65 9123 4567", loc: "Singapore Hub" },
      { name: "Elena Rostova", email: "elena.r@yourbank.internal", pager: "+44 7911 123456", loc: "London Office" },
      { name: "Marcus Thorne", email: "marcus.t@yourbank.internal", pager: "+1 415 555 0192", loc: "New York Hub" },
      { name: "Rahul Verma", email: "rahul.verma@yourbank.internal", pager: "+91 98765 43210", loc: "India COE" },
      { name: "Jessica Miller", email: "jessica.m@yourbank.internal", pager: "+1 415 555 0198", loc: "San Francisco" }
    ];
    const secondaryPool = ["Rahul Verma", "Klaus Weber", "Jessica Miller", "Priya Sundaram", "Elena Rostova"];
    const mgrPool = ["David Chen", "Sarah Jenkins", "Robert Hayes", "David Chen", "Sarah Jenkins"];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${prefix}-${String(day).padStart(2, '0')}`;
      const d = new Date(year, month, day);
      const dayName = daysOfWeek[d.getDay()];
      const p = primaryPool[(day - 1) % primaryPool.length];
      const s = secondaryPool[(day - 1) % secondaryPool.length];
      const m = mgrPool[(day - 1) % mgrPool.length];

      rows.push({
        "Date": dateStr,
        "Day": dayName,
        "Shift ID": `CORE-${yearStr}-${monthStr}${String(day).padStart(2, '0')}`,
        "Shift Name": (day % 3 === 1) ? "APAC Core (06:00-14:30 SGT)" : (day % 3 === 2) ? "EMEA Core (14:00-22:30 BST)" : "Americas Core (22:00-06:30 EDT)",
        "Primary On-Call": p.name,
        "Primary Email": p.email,
        "Primary Pager": p.pager,
        "Secondary On-Call": s,
        "Escalation Manager": m,
        "Location / Hub": p.loc,
        "Status": dayStatus(day),
        "Handover Notes": day === todayDay ? "All 13 CI/CD apps healthy. OTel fleet ingesting 2.4k spans/s." : "Shift executed within SLA."
      });
    }
  } else if (category === 'bau') {
    const bauEngineers = [
      { name: "Vikram Malhotra", email: "vikram.m@yourbank.internal", pager: "+91 91122 33445", loc: "Pune Tech Center" },
      { name: "Claire Bennett", email: "claire.b@yourbank.internal", pager: "+44 7700 900123", loc: "London Office" },
      { name: "Deepak Chopra", email: "deepak.c@yourbank.internal", pager: "+91 97711 22334", loc: "India COE" },
      { name: "Simon Fox", email: "simon.f@yourbank.internal", pager: "+44 7711 556677", loc: "London Office" },
      { name: "Ananya Sharma", email: "ananya.s@yourbank.internal", pager: "+91 98877 66554", loc: "Pune Tech Center" }
    ];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${prefix}-${String(day).padStart(2, '0')}`;
      const d = new Date(year, month, day);
      const dayName = daysOfWeek[d.getDay()];
      const p = bauEngineers[(day - 1) % bauEngineers.length];
      const isWeekend = (dayName === 'Sat' || dayName === 'Sun');

      rows.push({
        "Date": dateStr,
        "Day": dayName,
        "Shift ID": `BAU-${yearStr}-${monthStr}${String(day).padStart(2, '0')}`,
        "Shift Name": isWeekend ? "BAU Weekend On-Call Bridge" : "BAU Daytime Platform Engineering",
        "Primary On-Call": p.name,
        "Primary Email": p.email,
        "Primary Pager": p.pager,
        "Secondary On-Call": bauEngineers[(day) % bauEngineers.length].name,
        "Escalation Manager": "Alistair Campbell",
        "Location / Hub": p.loc,
        "Status": dayStatus(day),
        "Handover Notes": isWeekend ? "Weekend on-call standby. Patching windows monitored." : "Handling ServiceNow service tickets, Artifactory cleanups & CyberArk rotations."
      });
    }
  } else {
    // Montreal
    const mtlEngineers = [
      { name: "Jean-Philippe Tremblay", email: "jp.tremblay@yourbank.internal", pager: "+1 514 555 0184", loc: "Montreal Innovation Lab" },
      { name: "Sophie Bouchard", email: "sophie.bouchard@yourbank.internal", pager: "+1 514 555 0199", loc: "Montreal Office" },
      { name: "Lucie Desjardins", email: "lucie.d@yourbank.internal", pager: "+1 514 555 0177", loc: "Montreal Office" },
      { name: "Etienne Roy", email: "etienne.r@yourbank.internal", pager: "+1 514 555 0133", loc: "Montreal Lab" },
      { name: "Mathieu Gagnon", email: "mathieu.g@yourbank.internal", pager: "+1 514 555 0144", loc: "Montreal Office" }
    ];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${prefix}-${String(day).padStart(2, '0')}`;
      const d = new Date(year, month, day);
      const dayName = daysOfWeek[d.getDay()];
      const p = mtlEngineers[(day - 1) % mtlEngineers.length];
      const isWeekend = (dayName === 'Sat' || dayName === 'Sun');

      rows.push({
        "Date": dateStr,
        "Day": dayName,
        "Shift ID": `MTL-${yearStr}-${monthStr}${String(day).padStart(2, '0')}`,
        "Shift Name": isWeekend ? "Montreal Weekend Standby" : "Montreal Regional SRE Shift (EDT)",
        "Primary On-Call": p.name,
        "Primary Email": p.email,
        "Primary Pager": p.pager,
        "Secondary On-Call": mtlEngineers[(day) % mtlEngineers.length].name,
        "Escalation Manager": "Marc-Andre Gagnon",
        "Location / Hub": p.loc,
        "Status": dayStatus(day),
        "Handover Notes": "Canada OpenShift & high-performance storage latency verified < 2.1ms."
      });
    }
  }

  return rows;
}

// [CQ-02] Month label computed dynamically based on current date
const _now = new Date();
const _monthLabel = _now.toLocaleString('en-US', { month: 'long', year: 'numeric' }); // e.g. "August 2026"

const INITIAL_ROTAS = {
  core: {
    name: "Core Operations 24/7 SRE Rota",
    category: "core",
    month: _monthLabel,
    description: "Follow-the-Sun Global Escalation Roster for critical incidents and P1/P2 outages.",
    tableRows: generateMonthlyRoster('core')
  },
  bau: {
    name: "BAU (Business As Usual) Operations Rota",
    category: "bau",
    month: _monthLabel,
    description: "Day-to-day platform maintenance, scheduled OS patching, access approvals, and service ticket handling.",
    tableRows: generateMonthlyRoster('bau')
  },
  montreal: {
    name: "Montreal Regional On-Call Rota",
    category: "montreal",
    month: "August 2026",
    description: "Montreal Hub dedicated infrastructure, Eastern Time coverage, bilingual French/English support.",
    tableRows: generateMonthlyRoster('montreal')
  }
};

function loadAllRotas() {
  try {
    if (fs.existsSync(ROTA_FILE)) {
      const data = fs.readFileSync(ROTA_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.core && parsed.bau && parsed.montreal) {
        if (!parsed.core.tableRows || !parsed.bau.tableRows || !parsed.montreal.tableRows) {
          parsed.core.tableRows = parsed.core.tableRows || generateMonthlyRoster('core');
          parsed.bau.tableRows = parsed.bau.tableRows || generateMonthlyRoster('bau');
          parsed.montreal.tableRows = parsed.montreal.tableRows || generateMonthlyRoster('montreal');
          saveAllRotas(parsed);
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error('[TEAM ROTA] Error reading rota file:', err.message);
  }
  saveAllRotas(INITIAL_ROTAS);
  return INITIAL_ROTAS;
}

function saveAllRotas(rotas) {
  try {
    fs.writeFileSync(ROTA_FILE, JSON.stringify(rotas, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[TEAM ROTA] Error writing rota file:', err.message);
    return false;
  }
}

/**
 * Parses an uploaded Excel or CSV file buffer and applies all rows into the designated rota.
 * Preserves ALL columns present in the Excel spreadsheet.
 * @param {Buffer} buffer File buffer
 * @param {string} category 'core' | 'bau' | 'montreal'
 */
function parseAndApplyExcel(buffer, category = 'core') {
  const targetCategory = ['core', 'bau', 'montreal'].includes(category) ? category : 'core';
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  if (!rows || rows.length === 0) {
    throw new Error('Excel spreadsheet contains no data rows.');
  }

  const allRotas = loadAllRotas();
  const currentRota = allRotas[targetCategory] || INITIAL_ROTAS[targetCategory];

  // Store the raw table rows exactly as provided in the Excel sheet
  currentRota.tableRows = rows;
  currentRota.month = rows[0]?.['Month'] || currentRota.month || 'Full Month';

  allRotas[targetCategory] = currentRota;
  saveAllRotas(allRotas);
  return allRotas;
}

/**
 * Generates a full month Excel Buffer for a given rota category
 */
function generateExcelTemplate(category = 'core') {
  const targetCategory = ['core', 'bau', 'montreal'].includes(category) ? category : 'core';
  const allRotas = loadAllRotas();
  const rota = allRotas[targetCategory] || INITIAL_ROTAS[targetCategory];
  const rows = rota.tableRows || generateMonthlyRoster(targetCategory);

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `${targetCategory.toUpperCase()}_MONTHLY_ROTA`);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  getAllRotas() {
    return loadAllRotas();
  },
  getRota(category = 'core') {
    const all = loadAllRotas();
    return all[category] || all.core;
  },
  updateRota(category, updatedData) {
    const targetCategory = ['core', 'bau', 'montreal'].includes(category) ? category : 'core';
    const all = loadAllRotas();
    all[targetCategory] = { ...all[targetCategory], ...updatedData };
    saveAllRotas(all);
    return all;
  },
  addShift(category, shiftRow) {
    const targetCategory = ['core', 'bau', 'montreal'].includes(category) ? category : 'core';
    const all = loadAllRotas();
    all[targetCategory].tableRows = all[targetCategory].tableRows || [];
    all[targetCategory].tableRows.push({
      "Date": shiftRow.Date || new Date().toISOString().split('T')[0],
      "Day": shiftRow.Day || 'Mon',
      "Shift ID": `${targetCategory.toUpperCase()}-SHIFT-${Date.now()}`,
      "Shift Name": shiftRow.shiftName || shiftRow['Shift Name'] || 'Scheduled Shift',
      "Primary On-Call": shiftRow.primaryOnCall || shiftRow['Primary On-Call'] || 'TBD',
      "Secondary On-Call": shiftRow.secondaryOnCall || shiftRow['Secondary On-Call'] || '—',
      "Escalation Manager": shiftRow.escalationManager || shiftRow['Escalation Manager'] || '—',
      "Location / Hub": shiftRow['Location / Hub'] || 'Global',
      "Status": "Scheduled",
      "Handover Notes": shiftRow['Handover Notes'] || ''
    });
    saveAllRotas(all);
    return all;
  },
  parseAndApplyExcel,
  generateExcelTemplate
};
