import { useSignedUrl } from '@/hooks/useSignedUrl';

interface SignedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

/**
 * Image component that automatically resolves Supabase storage private URLs
 * to signed URLs. Drop-in replacement for <img>.
 */
export function SignedImage({ src, ...props }: SignedImageProps) {
  const resolvedUrl = useSignedUrl(src);

  if (!resolvedUrl) return null;

  return <img {...props} src={resolvedUrl} />;
}
