/**
 * tests/helpers/fake_change_window_pool.js
 *
 * In-memory stand-in for the pg pool used by backend/routes/changeRoutes.js.
 * Understands exactly the four statements that module sends; anything else throws.
 */
function fakeChangeWindowPool({ failWrites = false } = {}) {
  const rows = new Map();
  return {
    rows,
    async query(sql, params = []) {
      if (/^\s*INSERT INTO change_window/i.test(sql)) {
        if (failWrites) throw new Error('connection terminated');
        const [id, title, description, environment, product_id, host, start_time, end_time, created_by, status] = params;
        const row = { id, title, description, environment, product_id, host, start_time, end_time, created_by, status, closed_by: null, closed_at: null, created_at: new Date().toISOString() };
        rows.set(id, row);
        return { rows: [row] };
      }
      if (/^\s*UPDATE change_window/i.test(sql)) {
        const [id, env, user] = params;
        const row = rows.get(id);
        if (!row || row.environment !== env || row.status === 'CLOSED') return { rows: [] };
        const now = new Date().toISOString();
        Object.assign(row, { status: 'CLOSED', closed_by: user, closed_at: now, end_time: row.end_time < now ? row.end_time : now });
        return { rows: [row] };
      }
      if (/FROM change_window\s+WHERE \(environment = \$1 OR environment = 'all'\)\s+AND status/i.test(sql)) {
        const [env, ts, productId, host] = params;
        const match = [...rows.values()].filter(w =>
          (w.environment === env || w.environment === 'all') && w.status !== 'CLOSED' &&
          w.start_time <= ts && w.end_time >= ts &&
          (!w.product_id || !productId || w.product_id === productId) &&
          (!w.host || !host || w.host === host));
        return { rows: match.slice(0, 1) };
      }
      if (/SELECT \* FROM change_window WHERE environment = \$1 OR environment = 'all'/i.test(sql)) {
        return { rows: [...rows.values()].filter(w => w.environment === params[0] || w.environment === 'all') };
      }
      throw new Error('unexpected SQL in fake change_window pool: ' + sql);
    }
  };
}

module.exports = { fakeChangeWindowPool };
