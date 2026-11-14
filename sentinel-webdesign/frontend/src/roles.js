/**
 * frontend/src/roles.js
 *
 * Which roles may use which controls. The server enforces the same rules
 * (requireRole in backend/server.js); the UI only disables what would be refused.
 */

const OPERATE_ROLES = ['Super Admin', 'SRE Lead', 'NOC Operator', 'Operator'];
const ADMINISTER_ROLES = ['Super Admin', 'SRE Lead'];

// Tooltip shown on a control the current role cannot use.
export const NEEDS_LEAD = 'Needs SRE Lead or Super Admin';

// True for roles that may trigger recoveries and similar operator actions.
export function canOperate(role) {
  return OPERATE_ROLES.includes(role);
}

// True for roles that may change settings, approve recoveries and edit the rota.
export function canAdminister(role) {
  return ADMINISTER_ROLES.includes(role);
}
