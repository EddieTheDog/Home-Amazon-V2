// tiny helper to poll reservation status and call a callback when changed.
// usage: startPolling('/api/reservations/R123', (data) => { ... });
export async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Fetch error');
  return r.json();
}
