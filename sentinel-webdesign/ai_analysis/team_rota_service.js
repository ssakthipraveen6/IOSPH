/**
 * On-call rota: loads, edits and saves the team rotas (.runtime/team_rota.json).
 */
const fs = require('fs');
const path = require('path');

const candidatePaths = [
  path.resolve(__dirname, '../../.runtime/team_rota.json'),
  path.resolve(__dirname, '../database/team_rota.json'),
  path.resolve(__dirname, '../../database/team_rota.json'),
  path.resolve(__dirname, '../../../../../.runtime/team_rota.json'),
  path.resolve(__dirname, '../../../../../database/team_rota.json')
];
const ROTA_FILE = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];

/**
 * Generate a full monthly schedule for a given category and roster pattern.
 * [T0.19] All PII purged — replaced with synthetic non-identifying personas.
 * [CQ-02 REMEDIATED] — Month, year, and "today" are derived dynamically.
 *
 * @param {string} category  'core' | 'bau' | 'montreal'
 * @param {Date}   [forDate] Optional reference date; defaults to now. Used for testing.
 */
function generateMonthlyRoster(category = 'core', forDate = new Date()) {
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const rows = [];

  const year       = forDate.getFullYear();
  const month      = forDate.getMonth();           // 0-indexed (0=Jan, 7=Aug)
  const todayDay   = forDate.getDate();            // Day of the month right now
  const daysInMonth = new Date(year, month + 1, 0).getDate(); // Actual days in this month

  const monthStr   = String(month + 1).padStart(2, '0');      // e.g. "08"
  const yearStr    = String(year);                             // e.g. "2026"
  const prefix     = `${yearStr}-${monthStr}`;               // e.g. "2026-08"

  function dayStatus(day) {
    if (day === todayDay) return 'ACTIVE TODAY';
    if (day < todayDay)  return 'Completed';
    return 'Scheduled';
  }

  if (category === 'core') {
    const primaryPool = [
      { name: "Primary SRE Alpha", email: "sre-alpha@sentinel.local", pager: "PAGER-01", loc: "Hub East" },
      { name: "Primary SRE Bravo", email: "sre-bravo@sentinel.local", pager: "PAGER-02", loc: "Hub Central" },
      { name: "Primary SRE Charlie", email: "sre-charlie@sentinel.local", pager: "PAGER-03", loc: "Hub West" },
      { name: "Primary SRE Delta", email: "sre-delta@sentinel.local", pager: "PAGER-04", loc: "Hub Asia" },
      { name: "Primary SRE Echo", email: "sre-echo@sentinel.local", pager: "PAGER-05", loc: "Hub EMEA" }
    ];
    const secondaryPool = ["Secondary SRE 1", "Secondary SRE 2", "Secondary SRE 3", "Secondary SRE 4", "Secondary SRE 5"];
    const mgrPool = ["Incident Commander 1", "Incident Commander 2", "Incident Commander 3"];

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
        "Handover Notes": day === todayDay ? "All CI/CD applications healthy. Observability fleet active." : "Shift executed within SLA."
      });
    }
  } else if (category === 'bau') {
    const bauEngineers = [
      { name: "Platform Engineer 1", email: "pe1@sentinel.local", pager: "PAGER-BAU-01", loc: "Ops Center Alpha" },
      { name: "Platform Engineer 2", email: "pe2@sentinel.local", pager: "PAGER-BAU-02", loc: "Ops Center Beta" },
      { name: "Platform Engineer 3", email: "pe3@sentinel.local", pager: "PAGER-BAU-03", loc: "Ops Center Gamma" },
      { name: "Platform Engineer 4", email: "pe4@sentinel.local", pager: "PAGER-BAU-04", loc: "Ops Center Delta" },
      { name: "Platform Engineer 5", email: "pe5@sentinel.local", pager: "PAGER-BAU-05", loc: "Ops Center Epsilon" }
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
        "Escalation Manager": "Platform Duty Manager",
        "Location / Hub": p.loc,
        "Status": dayStatus(day),
        "Handover Notes": isWeekend ? "Weekend on-call standby. Maintenance windows monitored." : "Handling platform service tickets & standard changes."
      });
    }
  } else {
    // Montreal
    const mtlEngineers = [
      { name: "Regional SRE MTL-1", email: "sre-mtl1@sentinel.local", pager: "PAGER-MTL-01", loc: "Montreal Hub" },
      { name: "Regional SRE MTL-2", email: "sre-mtl2@sentinel.local", pager: "PAGER-MTL-02", loc: "Montreal Hub" },
      { name: "Regional SRE MTL-3", email: "sre-mtl3@sentinel.local", pager: "PAGER-MTL-03", loc: "Montreal Hub" },
      { name: "Regional SRE MTL-4", email: "sre-mtl4@sentinel.local", pager: "PAGER-MTL-04", loc: "Montreal Hub" },
      { name: "Regional SRE MTL-5", email: "sre-mtl5@sentinel.local", pager: "PAGER-MTL-05", loc: "Montreal Hub" }
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
        "Escalation Manager": "Regional Incident Lead",
        "Location / Hub": p.loc,
        "Status": dayStatus(day),
        "Handover Notes": "Regional infrastructure and storage verified normal."
      });
    }
  }

  return rows;
}

const _now = new Date();
const _monthLabel = _now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

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
    month: _monthLabel,
    description: "Montreal Hub dedicated infrastructure, Eastern Time coverage, bilingual French/English support.",
    tableRows: generateMonthlyRoster('montreal')
  }
};

// Loads all rotas.
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

// Saves all rotas.
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
 * Robust RFC 4180 CSV serializer
 */
function serializeToCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);

  function escapeCsvCell(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const csvLines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    csvLines.push(headers.map(h => escapeCsvCell(row[h])).join(','));
  }
  return csvLines.join('\r\n');
}

/**
 * Robust RFC 4180 CSV parser
 */
function parseCsvString(csvText) {
  const lines = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const nextCh = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && nextCh === '"') {
        cell += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell.trim());
        cell = '';
      } else if (ch === '\r') {
        // ignore CR
      } else if (ch === '\n') {
        row.push(cell.trim());
        cell = '';
        if (row.some(c => c.length > 0)) {
          lines.push(row);
        }
        row = [];
      } else {
        cell += ch;
      }
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some(c => c.length > 0)) {
      lines.push(row);
    }
  }

  if (lines.length === 0) return [];
  const headers = lines[0];
  const result = [];

  for (let r = 1; r < lines.length; r++) {
    const dataRow = lines[r];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = dataRow[c] !== undefined ? dataRow[c] : '';
    }
    result.push(obj);
  }

  return result;
}

/**
 * Parses an uploaded CSV / tabular rota file buffer and applies all rows into the designated rota.
 * [T0.19 / D7] Replaces vulnerable xlsx library with native hand-rolled CSV parser.
 *
 * @param {Buffer|string} buffer File buffer or string
 * @param {string} category 'core' | 'bau' | 'montreal'
 */
function parseAndApplyExcel(buffer, category = 'core') {
  const targetCategory = ['core', 'bau', 'montreal'].includes(category) ? category : 'core';
  const csvText = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  const rows = parseCsvString(csvText);

  if (!rows || rows.length === 0) {
    throw new Error('Rota CSV contains no data rows.');
  }

  const allRotas = loadAllRotas();
  const currentRota = allRotas[targetCategory] || INITIAL_ROTAS[targetCategory];

  currentRota.tableRows = rows;
  currentRota.month = rows[0]?.['Month'] || currentRota.month || 'Full Month';

  allRotas[targetCategory] = currentRota;
  saveAllRotas(allRotas);
  return allRotas;
}

/**
 * Generates a full month CSV template buffer for a given rota category (T0.19 / D7).
 * Retains signature and buffer return for caller compatibility.
 */
function generateExcelTemplate(category = 'core') {
  const targetCategory = ['core', 'bau', 'montreal'].includes(category) ? category : 'core';
  const allRotas = loadAllRotas();
  const rota = allRotas[targetCategory] || INITIAL_ROTAS[targetCategory];
  const rows = rota.tableRows || generateMonthlyRoster(targetCategory);

  const csvString = serializeToCsv(rows);
  return Buffer.from(csvString, 'utf8');
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
  generateExcelTemplate,
  serializeToCsv,
  parseCsvString
};
