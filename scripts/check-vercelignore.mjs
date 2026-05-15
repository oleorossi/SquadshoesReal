#!/usr/bin/env node
/**
 * Guard: simula o .vercelignore localmente e quebra o build se algum
 * arquivo CRÍTICO ao funcionamento da app for ignorado por engano.
 *
 * Por que existe: em 15/05/2026, 18 deploys consecutivos do Vercel falharam
 * porque o pattern `supabase/` (sem `/` inicial) no .vercelignore fez o
 * Vercel deletar `src/integrations/supabase/client.ts` antes do build —
 * a intenção era só ignorar a pasta `supabase/` da raiz (migrations + edge
 * functions). O `vite build` local não detectou porque ele ignora .vercelignore.
 *
 * Como roda: chamado pelo `npm run build` ANTES do `vite build`. Se quebrar
 * aqui, o deploy do Vercel também quebraria — mas a falha aparece localmente
 * em segundos, antes do push.
 *
 * Como adicionar exceções: edite SAFE_OVERRIDES com o pattern e o motivo.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VERCELIGNORE_PATH = join(ROOT, '.vercelignore');

if (!existsSync(VERCELIGNORE_PATH)) {
  console.log('[check-vercelignore] .vercelignore não existe — skip.');
  process.exit(0);
}

// Arquivos que SEMPRE precisam estar no bundle deployado.
// Adicionar aqui qualquer arquivo cuja ausência quebra o build do Vite.
const CRITICAL_PATHS = [
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tailwind.config.ts',
  'postcss.config.js',
  'index.html',
  'vercel.json',
  // Entry points + módulos críticos
  'src/main.tsx',
  'src/App.tsx',
  'src/index.css',
  // Supabase (regressão de 15/05/2026)
  'src/integrations/supabase/client.ts',
  'src/integrations/supabase/types.ts',
  // Hooks fundamentais (qualquer rota usa)
  'src/hooks/useAuth.ts',
  'src/hooks/useOrders.ts',
  'src/hooks/useSaleOrders.ts',
  // Páginas raiz
  'src/pages/Auth.tsx',
  // Scripts chamados durante build
  'scripts/verify-no-branding.mjs',
  'scripts/check-navigation-access.mjs',
];

// Patterns que CASAM com arquivos críticos mas o usuário marcou como OK.
// Vazio por default — toda exceção precisa justificativa explícita.
const SAFE_OVERRIDES = new Set([
  // ex: 'src/pages/Old.tsx', // motivo
]);

const raw = readFileSync(VERCELIGNORE_PATH, 'utf8');
const patterns = raw
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));

if (patterns.length === 0) {
  console.log('[check-vercelignore] sem patterns ativos — skip.');
  process.exit(0);
}

const violations = [];
for (const path of CRITICAL_PATHS) {
  if (SAFE_OVERRIDES.has(path)) continue;

  for (const pattern of patterns) {
    // Negation patterns (!pat) re-incluem — ignora aqui (comportamento gitignore-like).
    if (pattern.startsWith('!')) continue;

    // Vercel/git aplica patterns gitignore-style:
    // - sem `/`: case match em qualquer profundidade
    // - com `/`: ancorado na raiz
    // - termina `/`: só pasta
    // picomatch resolve a maioria dos casos quando passamos `matchBase: true`
    // pra patterns sem `/` e `dot: true` pra incluir dotfiles.
    const opts = { dot: true, matchBase: !pattern.includes('/') };
    let normalized = pattern;
    if (pattern.endsWith('/')) {
      // Pattern de pasta: testa se `path` está sob essa pasta
      const folder = pattern.replace(/\/$/, '');
      if (folder.startsWith('/')) {
        // pasta ancorada na raiz: /supabase/ → casa "supabase/anything"
        const stripped = folder.slice(1);
        if (path === stripped || path.startsWith(stripped + '/')) {
          violations.push({ path, pattern });
        }
      } else {
        // pasta NÃO ancorada: supabase/ → casa "anywhere/supabase/anything"
        const segments = path.split('/');
        if (segments.includes(folder)) {
          violations.push({ path, pattern });
        }
      }
    } else if (pattern.startsWith('/')) {
      // Pattern ancorado na raiz: /App.tsx → casa só "App.tsx"
      normalized = pattern.slice(1);
      if (picomatch.isMatch(path, normalized, opts)) {
        violations.push({ path, pattern });
      }
    } else {
      // Pattern não-ancorado: App.tsx → casa "App.tsx" e "src/App.tsx"
      if (picomatch.isMatch(path, pattern, opts)) {
        violations.push({ path, pattern });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`[check-vercelignore] OK — ${patterns.length} patterns, nenhum casa com ${CRITICAL_PATHS.length} arquivos críticos.`);
  process.exit(0);
}

console.error('\n❌ [check-vercelignore] PATTERNS PERIGOSOS NO .vercelignore:\n');
for (const v of violations) {
  console.error(`  Pattern  "${v.pattern}"  ignora arquivo crítico  "${v.path}"`);
}
console.error('\nProvável fix: adicionar `/` na frente do pattern pra ancorar à raiz.');
console.error('Exemplo: trocar `supabase/` por `/supabase/` (ignora só a pasta da raiz, não src/integrations/supabase/).');
console.error('\nSe o pattern está correto e a exceção é intencional, adicione o path em SAFE_OVERRIDES no script.');
console.error('\nReferência: 18 deploys do Vercel falharam em 15/05/2026 por exatamente esse bug.\n');
process.exit(1);
