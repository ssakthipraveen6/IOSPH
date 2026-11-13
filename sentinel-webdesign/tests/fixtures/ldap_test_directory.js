'use strict';

/**
 * tests/fixtures/ldap_test_directory.js
 *
 * In-process LDAP test directory using ldapjs createServer for integration testing.
 */

const ldap = require('ldapjs');

/**
 * Starts an in-process LDAP server listening on 127.0.0.1 port 0.
 * @param {object} opts
 * @param {Array<{ sAMAccountName: string, password: string, mail?: string, memberOf?: string[] }>} opts.users
 * @param {string} [opts.bindDn='cn=svc-sentinel-sso,ou=ServiceAccounts,dc=enterprise,dc=corp']
 * @param {string} [opts.bindPassword='secret-service-password']
 * @param {string} [opts.baseDn='dc=enterprise,dc=corp']
 * @returns {Promise<{ url: string, bindDn: string, bindPassword: string, stop: () => Promise<void> }>}
 */
function startTestDirectory(opts = {}) {
  const users = opts.users || [];
  const serviceBindDn = (opts.bindDn || 'cn=svc-sentinel-sso,ou=ServiceAccounts,dc=enterprise,dc=corp').toLowerCase();
  const serviceBindPassword = opts.bindPassword || 'secret-service-password';
  const baseDn = (opts.baseDn || 'dc=enterprise,dc=corp').toLowerCase();

  const userMapByDn = new Map();
  const userList = [];

  for (const u of users) {
    const sAMAccountName = u.sAMAccountName;
    const dn = `cn=${sAMAccountName},ou=Users,${baseDn}`.toLowerCase();
    const mail = u.mail || `${sAMAccountName.toLowerCase()}@enterprise.corp`;
    const userPrincipalName = `${sAMAccountName.toLowerCase()}@enterprise.corp`;
    const memberOf = u.memberOf || [];
    const entry = {
      dn,
      sAMAccountName,
      mail,
      userPrincipalName,
      password: u.password,
      memberOf
    };
    userMapByDn.set(dn, entry);
    userList.push(entry);
  }

  const server = ldap.createServer();

  server.bind(baseDn, (req, res, next) => {
    const reqDn = req.dn.toString().toLowerCase();
    const reqPw = req.credentials;

    if (reqDn === serviceBindDn) {
      if (reqPw === serviceBindPassword) {
        res.end();
        return next();
      }
      return next(new ldap.InvalidCredentialsError());
    }

    if (userMapByDn.has(reqDn)) {
      const u = userMapByDn.get(reqDn);
      if (reqPw === u.password) {
        res.end();
        return next();
      }
      return next(new ldap.InvalidCredentialsError());
    }

    return next(new ldap.InvalidCredentialsError());
  });

  function matchesFilter(filter, entry) {
    if (!filter) return false;
    if (filter.filters && Array.isArray(filter.filters) && filter.filters.length > 0) {
      if (filter.type === 'or' || filter.constructor.name === 'OrFilter') {
        return filter.filters.some(sub => matchesFilter(sub, entry));
      }
      return filter.filters.every(sub => matchesFilter(sub, entry));
    }
    if (filter.attribute && filter.value !== undefined) {
      const attr = filter.attribute.toLowerCase();
      const val = String(filter.value).toLowerCase();
      for (const [k, v] of Object.entries(entry)) {
        if (k.toLowerCase() === attr) {
          if (Array.isArray(v)) {
            if (v.some(item => String(item).toLowerCase() === val)) return true;
          } else if (String(v).toLowerCase() === val) {
            return true;
          }
        }
      }
      return false;
    }
    return filter.matches(entry);
  }

  server.search(baseDn, (req, res, next) => {
    for (const entry of userList) {
      if (matchesFilter(req.filter, entry)) {
        res.send({
          dn: entry.dn,
          attributes: {
            dn: entry.dn,
            sAMAccountName: entry.sAMAccountName,
            mail: entry.mail,
            memberOf: entry.memberOf,
            userPrincipalName: entry.userPrincipalName
          }
        }, true);
      }
    }
    res.end();
    return next();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => {
      if (err) return reject(err);
      const port = server.address().port;
      const url = `ldap://127.0.0.1:${port}`;
      resolve({
        url,
        bindDn: serviceBindDn,
        bindPassword: serviceBindPassword,
        stop() {
          return new Promise(resClose => {
            server.close(() => resClose());
          });
        }
      });
    });
  });
}

module.exports = {
  startTestDirectory
};
