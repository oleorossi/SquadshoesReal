import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRASIL_API_CNPJ_ORIGIN } from '@/lib/cnpjLookup';

interface VercelHeader {
  key: string;
  value: string;
}

interface VercelConfig {
  headers?: Array<{ headers?: VercelHeader[] }>;
}

function getConnectSrcOrigins(): string[] {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
  ) as VercelConfig;
  const csp = config.headers
    ?.flatMap(entry => entry.headers ?? [])
    .find(header => header.key.toLowerCase() === 'content-security-policy')
    ?.value;

  expect(csp, 'vercel.json precisa publicar Content-Security-Policy').toBeTruthy();

  const connectSrc = csp
    ?.split(';')
    .map(directive => directive.trim())
    .find(directive => directive.startsWith('connect-src '));

  expect(connectSrc, 'a CSP precisa declarar connect-src').toBeTruthy();
  return connectSrc?.split(/\s+/).slice(1) ?? [];
}

describe('contrato CSP da consulta de CNPJ', () => {
  it('autoriza exatamente a origem utilizada pelo cliente BrasilAPI', () => {
    const allowedOrigins = getConnectSrcOrigins();

    expect(allowedOrigins).toContain(BRASIL_API_CNPJ_ORIGIN);
    expect(allowedOrigins).not.toContain('https://api.brasilapi.com.br');
  });
});
