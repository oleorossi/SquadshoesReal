export function buildHangtagBarcode(
  refCode: string,
  size: string,
  useSerialization: boolean,
  serial: number,
  fallback: string,
): string {
  if (!refCode) return fallback;
  const base = `${refCode}${size.padStart(2, '0')}`;
  return useSerialization ? `${base}${Math.max(0, serial).toString().padStart(4, '0')}` : base;
}
