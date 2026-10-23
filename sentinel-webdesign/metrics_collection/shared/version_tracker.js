/**
 * metrics_collection/shared/version_tracker.js
 *
 * Product version capture and change detection.
 * Updates inventory entity labels and emits normalized 'version_change' events.
 */

const crypto = require('crypto');
const eventStore = require('@sentinel/database/event_store');
const inventory = require('@sentinel/inventory');

// In-memory debounce cache: `${productId}:${environment}` -> version
const lastSeenVersions = new Map();

/**
 * Updates product version in inventory and emits a version_change event when changed.
 *
 * @param {string} productId - Application/product identifier (e.g., 'artifactory', 'bitbucket', 'jenkins', 'sonarqube')
 * @param {string} version - Detected version string
 * @param {string} environment - Target environment ('prod', 'staging', 'demo')
 * @param {string} source - Origin source tag (default 'product_api')
 * @returns {Promise<object|null>} The emitted event if version changed, or null if unchanged
 */
async function updateProductVersion(productId, version, environment = 'staging', source = 'product_api') {
  if (!productId || !version || typeof version !== 'string' || !version.trim()) {
    return null;
  }

  const cleanVersion = version.trim();
  const env = (environment || 'staging').toLowerCase();
  const cacheKey = `${productId}:${env}`;

  // Read existing entity from inventory (checks app:id first, then id)
  let entity = await inventory.getEntityById(`app:${productId}`);
  if (!entity) {
    entity = await inventory.getEntityById(productId);
  }

  const existingVersion = entity?.labels?.version || lastSeenVersions.get(cacheKey) || null;

  // Debounce: if version is identical, do nothing
  if (existingVersion === cleanVersion) {
    return null;
  }

  // Update in-memory tracker
  lastSeenVersions.set(cacheKey, cleanVersion);

  let event = null;
  // If there was a prior known version and it changed, emit version_change event
  if (existingVersion && existingVersion !== cleanVersion) {
    const eventId = crypto.randomUUID();
    const eventPayload = {
      event_id: eventId,
      kind: 'version_change',
      entity_id: entity?.entity_id || `app:${productId}`,
      environment: env,
      title: `${productId} upgraded to ${cleanVersion}`,
      summary: `${productId} upgraded to ${cleanVersion}`,
      details: {
        old_version: existingVersion,
        new_version: cleanVersion,
        source
      },
      payload: {
        old_version: existingVersion,
        new_version: cleanVersion,
        source
      },
      timestamp: new Date().toISOString()
    };
    event = await eventStore.addEvent(eventPayload);
  }

  // Upsert updated inventory entity label
  const targetEntityId = entity?.entity_id || `app:${productId}`;
  const updatedLabels = {
    ...(entity?.labels || {}),
    version: cleanVersion,
    last_version_check: new Date().toISOString()
  };

  await inventory.upsertEntity({
    entity_id: targetEntityId,
    id: targetEntityId,
    kind: 'application',
    name: entity?.name || productId,
    app_id: productId,
    environment: env,
    status: entity?.status || 'HEALTHY',
    labels: updatedLabels
  });

  return event;
}

/**
 * Resets the in-memory version tracker state (used for testing).
 */
function clear() {
  lastSeenVersions.clear();
}

module.exports = {
  updateProductVersion,
  clear
};
