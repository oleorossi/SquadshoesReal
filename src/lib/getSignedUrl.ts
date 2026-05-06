import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Cache: url -> { signedUrl, expiresAt }
const cache = new Map<string, { signedUrl: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string>>();
const CACHE_TTL_MS = 50 * 60 * 1000; // 50 min (signed URLs valid for 60 min)

/**
 * Converts a stored Supabase storage public URL into a signed URL.
 * Results are cached in memory for 50 minutes to avoid redundant API calls.
 */
export async function getSignedUrl(url: string | null | undefined): Promise<string> {
  if (!url) return '';

  const storagePrefix = `${SUPABASE_URL}/storage/v1/object/public/`;
  if (!url.startsWith(storagePrefix)) return url;

  // Check cache
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.signedUrl;

  // Deduplicate in-flight requests for the same URL
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    const rest = url.slice(storagePrefix.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) return url;

    const bucket = rest.slice(0, slashIdx);
    const path = rest.slice(slashIdx + 1);

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600);

    if (error || !data?.signedUrl) {
      console.error('Failed to create signed URL:', error);
      return url;
    }

    cache.set(url, { signedUrl: data.signedUrl, expiresAt: Date.now() + CACHE_TTL_MS });
    return data.signedUrl;
  })();

  inflight.set(url, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(url);
  }
}

/**
 * Converts multiple URLs to signed URLs in parallel.
 */
export async function getSignedUrls(urls: (string | null | undefined)[]): Promise<string[]> {
  return Promise.all(urls.map(u => getSignedUrl(u)));
}
