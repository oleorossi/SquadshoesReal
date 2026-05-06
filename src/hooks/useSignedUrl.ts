import { useState, useEffect } from 'react';
import { getSignedUrl } from '@/lib/getSignedUrl';

/**
 * Hook that resolves a Supabase storage public URL to a signed URL.
 * Returns the signed URL (or original if not a storage URL).
 */
export function useSignedUrl(url: string | null | undefined): string {
  const [signedUrl, setSignedUrl] = useState<string>(url || '');

  useEffect(() => {
    if (!url) {
      setSignedUrl('');
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    // Only resolve if it's a Supabase storage public URL
    if (!url.includes(`${supabaseUrl}/storage/v1/object/public/`)) {
      setSignedUrl(url);
      return;
    }

    let cancelled = false;
    getSignedUrl(url).then(signed => {
      if (!cancelled) setSignedUrl(signed);
    });
    return () => { cancelled = true; };
  }, [url]);

  return signedUrl;
}
