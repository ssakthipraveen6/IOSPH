/**
 * Circuit Breaker pattern implementation for telemetry collectors (T2.4).
 * Protects 2,000+ infrastructure and application targets from self-inflicted load.
 * 
 * States:
 * - CLOSED: Normal operation, requests allowed.
 * - OPEN: Target failed 5 consecutive times, requests short-circuited.
 * - HALF_OPEN: Backoff interval expired, allows a single probe attempt.
 */

const FAILURE_THRESHOLD = 5;
const INITIAL_BACKOFF_MS = 10000;       // 10s
const MAX_BACKOFF_MS = 300000;          // 5 minutes ceiling

const breakers = new Map();

class TargetBreaker {
  constructor(targetKey) {
    this.targetKey = targetKey;
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.nextAllowedAttempt = 0;
    this.currentBackoffMs = INITIAL_BACKOFF_MS;
    this.totalTripped = 0;
  }

  canExecute() {
    const now = Date.now();
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      if (now >= this.nextAllowedAttempt) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      // In half-open, allow single attempt
      return true;
    }

    return true;
  }

  recordSuccess() {
    this.consecutiveSuccesses++;
    this.lastSuccessTime = Date.now();
    this.consecutiveFailures = 0;
    this.currentBackoffMs = INITIAL_BACKOFF_MS;
    this.state = 'CLOSED';
  }

  recordFailure(error) {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    this.consecutiveSuccesses = 0;

    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      this.totalTripped++;
      this.nextAllowedAttempt = Date.now() + this.currentBackoffMs;
      // Exponential backoff with 5 min ceiling
      this.currentBackoffMs = Math.min(this.currentBackoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  getStatus() {
    return {
      target: this.targetKey,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      currentBackoffMs: this.currentBackoffMs,
      nextAllowedAttempt: this.nextAllowedAttempt > 0 ? new Date(this.nextAllowedAttempt).toISOString() : null,
      totalTripped: this.totalTripped
    };
  }
}

function getBreaker(targetKey) {
  if (!breakers.has(targetKey)) {
    breakers.set(targetKey, new TargetBreaker(targetKey));
  }
  return breakers.get(targetKey);
}

function canExecute(targetKey) {
  return getBreaker(targetKey).canExecute();
}

function recordSuccess(targetKey) {
  getBreaker(targetKey).recordSuccess();
}

function recordFailure(targetKey, error) {
  getBreaker(targetKey).recordFailure(error);
}

function getAllBreakerStatuses() {
  const result = {};
  for (const [key, breaker] of breakers.entries()) {
    result[key] = breaker.getStatus();
  }
  return result;
}

function resetAll() {
  breakers.clear();
}

module.exports = {
  canExecute,
  recordSuccess,
  recordFailure,
  getAllBreakerStatuses,
  getBreaker,
  resetAll,
  FAILURE_THRESHOLD,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS
};
