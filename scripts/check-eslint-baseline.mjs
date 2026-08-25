/**
 * Bloqueia regressão enquanto a dívida histórica do ESLint é eliminada.
 *
 * Não silencia regras no eslint.config: o lint continua sendo a fonte de
 * diagnóstico completa. Este gate reprova erros em linhas adicionadas desde a
 * base do CI. Assim uma correção em massa pode reduzir a dívida, mas não pode
 * compensar um erro novo removendo outro da mesma regra em um arquivo diferente.
 */
import { spawnSync } from 'node:child_process';

const base = process.env.LINT_BASE || 'HEAD^';

const diff = spawnSync('git', ['diff', '--unified=0', base, '--'], {
  encoding: 'utf8',
  // Regenerações legítimas de artefatos grandes (por exemplo, types.ts do
  // Supabase) podem ultrapassar o limite padrão do spawnSync. Sem um buffer
  // explícito o processo termina com ENOBUFS e o gate falha antes de analisar
  // qualquer linha de lint.
  maxBuffer: 32 * 1024 * 1024,
});

if (diff.status !== 0) {
  console.error(diff.stderr || `Não foi possível comparar o lint com ${base}.`);
  process.exit(2);
}

const addedLines = new Map();
let currentFile;
for (const line of diff.stdout.split('\n')) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice(6);
    continue;
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!hunk || !currentFile) continue;
  const start = Number(hunk[1]);
  const count = Number(hunk[2] ?? 1);
  if (count === 0) continue;
  const lines = addedLines.get(currentFile) ?? new Set();
  for (let lineNumber = start; lineNumber < start + count; lineNumber += 1) lines.add(lineNumber);
  addedLines.set(currentFile, lines);
}

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

const regressions = [];
for (const file of files) {
  for (const message of file.messages) {
    if (message.severity !== 2) continue;
    const relativeFile = file.filePath.replace(`${process.cwd()}/`, '');
    if (!addedLines.get(relativeFile)?.has(message.line)) continue;
    regressions.push(`${relativeFile}:${message.line} ${message.ruleId ?? 'eslint-fatal'} — ${message.message}`);
  }
}

if (regressions.length) {
  console.error('❌ Erros de ESLint em linhas adicionadas:');
  regressions.forEach((line) => console.error(`  • ${line}`));
  process.exit(1);
}

console.log(`✅ ESLint sem erros nas linhas adicionadas desde ${base}.`);
