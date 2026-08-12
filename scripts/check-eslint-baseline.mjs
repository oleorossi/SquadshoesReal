/**
 * Bloqueia regressão enquanto a dívida histórica do ESLint é eliminada.
 *
 * Não silencia regras no eslint.config: o lint continua sendo a fonte de
 * diagnóstico completa. Este gate compara a contagem por regra com o baseline
 * aprovado, portanto um erro novo não entra em main, mas uma correção em massa
 * pode reduzir a dívida sem precisar regravar a lista inteira de arquivos.
 * Atualize deliberadamente os limites somente depois de revisar uma redução.
 */
import { spawnSync } from 'node:child_process';

const baseline = {
  'no-empty': 21,
  '@typescript-eslint/no-explicit-any': 4814,
  '@typescript-eslint/no-unused-expressions': 14,
  'no-constant-binary-expression': 5,
  '@typescript-eslint/no-empty-object-type': 2,
  '@typescript-eslint/ban-ts-comment': 3,
  'no-fallthrough': 1,
  'no-async-promise-executor': 1,
  'no-useless-escape': 15,
  'no-irregular-whitespace': 2,
  'no-control-regex': 2,
  'prefer-const': 37,
  '@typescript-eslint/no-require-imports': 1,
};

const run = spawnSync('bunx', ['eslint', '.', '--format', 'json'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

if (!run.stdout.trim()) {
  console.error(run.stderr || 'ESLint não produziu JSON.');
  process.exit(2);
}

let files;
try {
  files = JSON.parse(run.stdout);
} catch {
  console.error('Não foi possível interpretar o relatório JSON do ESLint.');
  process.exit(2);
}

const current = {};
for (const file of files) {
  for (const message of file.messages) {
    if (message.severity === 2) {
      const rule = message.ruleId ?? 'eslint-fatal';
      current[rule] = (current[rule] ?? 0) + 1;
    }
  }
}

const regressions = [];
for (const [rule, count] of Object.entries(current)) {
  const allowed = baseline[rule] ?? 0;
  if (count > allowed) regressions.push(`${rule}: ${allowed} → ${count}`);
}

if (regressions.length) {
  console.error('❌ Regressão de lint detectada:');
  regressions.forEach((line) => console.error(`  • ${line}`));
  process.exit(1);
}

const remaining = Object.values(current).reduce((sum, count) => sum + count, 0);
console.log(`✅ ESLint sem regressões (${remaining} erros históricos ou menos).`);
