#!/usr/bin/env node
/**
 * Validação de CI: garante que toda rota declarada em src/data/navigation.ts
 * (menuGroups, topItem e systemItems) está mapeada em ROUTE_MODULE_MAP
 * (src/hooks/useAccessControl.ts). Falha o build se houver discrepâncias,
 * evitando que itens de menu fiquem inacessíveis para perfis não-admin.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const NAV_FILE = resolve(ROOT, 'src/data/navigation.ts');
const ACCESS_FILE = resolve(ROOT, 'src/hooks/useAccessControl.ts');

function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`❌ Não foi possível ler ${file}: ${err.message}`);
    process.exit(2);
  }
}

/** Extrai todas as ocorrências de path/to: '/algo' em navigation.ts */
function extractNavRoutes(src) {
  const routes = new Set();
  // path: "/foo" | path: '/foo'
  const reA = /\bpath\s*:\s*["']([^"']+)["']/g;
  // to: "/foo"  (usado em systemItems)
  const reB = /\bto\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = reA.exec(src)) !== null) {
    if (m[1].startsWith('/')) routes.add(m[1]);
  }
  while ((m = reB.exec(src)) !== null) {
    if (m[1].startsWith('/')) routes.add(m[1]);
  }
  return routes;
}

/** Extrai chaves do objeto ROUTE_MODULE_MAP em useAccessControl.ts */
function extractRouteMap(src) {
  const start = src.indexOf('ROUTE_MODULE_MAP');
  if (start < 0) {
    console.error('❌ ROUTE_MODULE_MAP não encontrado em useAccessControl.ts');
    process.exit(2);
  }
  const open = src.indexOf('{', start);
  // Acha o fechamento balanceado
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) {
    console.error('❌ Não foi possível parsear o objeto ROUTE_MODULE_MAP.');
    process.exit(2);
  }
  const body = src.slice(open + 1, end);
  const routes = new Set();
  const re = /^\s*["']([^"']+)["']\s*:/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[1].startsWith('/')) routes.add(m[1]);
  }
  return routes;
}

const navSrc = read(NAV_FILE);
const accessSrc = read(ACCESS_FILE);

const navRoutes = extractNavRoutes(navSrc);
const mapRoutes = extractRouteMap(accessSrc);

const missing = [...navRoutes].filter((r) => !mapRoutes.has(r)).sort();

if (missing.length > 0) {
  console.error('\n❌ Falha na validação de navegação ↔ controle de acesso\n');
  console.error('As seguintes rotas estão declaradas em src/data/navigation.ts');
  console.error('mas NÃO estão registradas em ROUTE_MODULE_MAP');
  console.error('(src/hooks/useAccessControl.ts) — ficarão inacessíveis para');
  console.error('usuários não-admin:\n');
  for (const r of missing) console.error(`  • ${r}`);
  console.error('\nAdicione cada rota acima ao ROUTE_MODULE_MAP com o módulo apropriado.\n');
  process.exit(1);
}

console.log(`✅ Navegação OK — ${navRoutes.size} rotas verificadas, todas mapeadas em ROUTE_MODULE_MAP.`);
