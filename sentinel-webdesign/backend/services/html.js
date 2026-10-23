/**
 * backend/services/html.js
 *
 * Safe HTML escaping utility for server-rendered HTML reports and templates
 * (Evidence Packs, Weekly Scorecards, ServiceNow payload snippets).
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/**
 * Escapes characters with special meaning in HTML to prevent XSS.
 * Non-string primitives (numbers, booleans) are returned as strings.
 * Null and undefined are returned as empty strings.
 *
 * @param {any} val
 * @returns {string}
 */
function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'string' ? val : String(val);
  return str.replace(/[&<>"']/g, char => ESCAPE_MAP[char]);
}

module.exports = {
  escapeHtml
};
