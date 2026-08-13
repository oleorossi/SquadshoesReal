/** Allowlist estrita usada pelo Chromium de impressão contra SSRF. */
export function isAllowedPrintResource(raw: string, allowedHosts: Set<string>, isLocal = false): boolean {
  if (raw.startsWith('data:') || raw.startsWith('blob:') || raw === 'about:blank') return true;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) return false;
  const host = url.hostname.toLowerCase();
  if (allowedHosts.has(host)) return true;
  if (host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) return true;
  return host === 'fonts.googleapis.com'
    || host === 'fonts.gstatic.com'
    || host === 'cdn.jsdelivr.net'
    || host === 'cdnjs.cloudflare.com';
}
