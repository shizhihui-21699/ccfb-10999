/**
 * Report transport: sendBeacon on unload, fetch with keepalive otherwise.
 * Never throws into the host page; on failure the report is retried once.
 */
export function send(endpoint: string, payload: string, finalBeacon: boolean): boolean {
  try {
    if (finalBeacon && navigator.sendBeacon) {
      // Beacon queues the request in the browser and does not block unload.
      const blob = new Blob([payload], { type: 'application/json' });
      return navigator.sendBeacon(endpoint, blob);
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      credentials: 'include',
      keepalive: true,
      // Intentional fire-and-forget; scoring failures must not surface to users.
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
