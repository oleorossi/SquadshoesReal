import { describe, expect, it } from 'vitest';
import { isAllowedPrintResource } from '../printResourceSecurity';

describe('render-pdf — recursos remotos', () => {
  const hosts = new Set(['squadshoes-real.vercel.app']);

  it('aceita apenas origens necessárias ao documento', () => {
    expect(isAllowedPrintResource('https://squadshoes-real.vercel.app/assets/app.css', hosts)).toBe(true);
    expect(isAllowedPrintResource('https://ssvxfoybzmjlypnipqzn.supabase.co/storage/v1/a.png', hosts)).toBe(true);
    expect(isAllowedPrintResource('https://cdn.jsdelivr.net/npm/jsbarcode/x.js', hosts)).toBe(true);
    expect(isAllowedPrintResource('data:image/png;base64,AAA', hosts)).toBe(true);
  });

  it('bloqueia SSRF e hosts arbitrários', () => {
    expect(isAllowedPrintResource('http://127.0.0.1:5432/', hosts)).toBe(false);
    expect(isAllowedPrintResource('http://169.254.169.254/latest/meta-data', hosts)).toBe(false);
    expect(isAllowedPrintResource('file:///etc/passwd', hosts)).toBe(false);
    expect(isAllowedPrintResource('https://example.net/tracker', hosts)).toBe(false);
  });
});
