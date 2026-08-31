/**
 * Unified HTTP Fetch utility with bounded timeout, error isolation, and fallback support.
 */

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error(`Invalid target URL: ${url}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function fetchJsonWithFallback(url, options = {}, timeoutMs = 3500, fallback = null) {
  try {
    const res = await fetchWithTimeout(url, options, timeoutMs);
    if (res.ok) {
      const data = await res.json();
      return { success: true, data, status: res.status };
    }
    return { success: false, error: `HTTP ${res.status}`, fallback };
  } catch (err) {
    return { success: false, error: err.message, fallback };
  }
}

module.exports = {
  fetchWithTimeout,
  fetchJsonWithFallback
};
