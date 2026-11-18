/**
 * Aplica cada comando das migrations num Postgres vazio, um por transação.
 * Erro de sintaxe (SQLSTATE 42601 e afins) derruba o check. Relação ausente
 * passa: o histórico legado não cabe num banco zerado, mas o parser pega
 * UNION/ORDER BY/LIMIT sem parênteses dentro de função LANGUAGE sql.
 *
 * Uso: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE bun scripts/check-migration-syntax.mjs [arquivos.sql]
 * Sem arquivos, confere o que mudou contra LINT_BASE ou origin/main.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SYNTAX = new Set(['42601', '42602', '42622']);

function changedFiles() {
  const base = process.env.LINT_BASE || 'origin/main';
  try {
    const out = execSync(`git diff --name-only --diff-filter=AM ${base}...HEAD -- supabase/migrations`, {
      encoding: 'utf8',
    });
    const files = out.split('\n').map((line) => line.trim()).filter((line) => line.endsWith('.sql'));
    if (files.length > 0) return files;
  } catch {
    /* base ausente */
  }
  return [];
}

function splitSql(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  let dollar = null;
  while (i < sql.length) {
    if (!dollar && sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (!dollar && sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (!dollar && sql[i] === "'") {
      current += sql[i++];
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += sql[++i];
          i += 1;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (!dollar && sql[i] === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        dollar = match[0];
        current += dollar;
        i += dollar.length;
        continue;
      }
    }
    if (dollar && sql.startsWith(dollar, i)) {
      current += dollar;
      i += dollar.length;
      dollar = null;
      continue;
    }
    if (!dollar && sql[i] === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      i += 1;
      continue;
    }
    current += sql[i++];
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function runPsql(sql) {
  const result = spawnSync('psql', [
    '-v', 'ON_ERROR_STOP=1',
    '-X', '-q',
    '-c', sql,
  ], {
    encoding: 'utf8',
    env: process.env,
  });
  return {
    ok: result.status === 0,
    out: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function sqlState(text) {
  const match = text.match(/SQLSTATE[=:\s]+([0-9A-Z]{5})/);
  if (match) return match[1];
  if (/syntax error at or near/i.test(text)) return '42601';
  if (/unterminated (quoted|dollar)/i.test(text)) return '42601';
  return null;
}

const files = process.argv.slice(2).filter((arg) => arg.endsWith('.sql'));
const targets = files.length > 0 ? files : changedFiles();
if (targets.length === 0) {
  console.log('Nenhuma migration nova para conferir.');
  process.exit(0);
}

const failures = [];
for (const file of targets) {
  if (!existsSync(file)) continue;
  const statements = splitSql(readFileSync(file, 'utf8'));
  statements.forEach((statement, index) => {
    const wrapped = `BEGIN;\n${statement};\nROLLBACK;`;
    const result = runPsql(wrapped);
    if (result.ok) return;
    const state = sqlState(result.out);
    if (state && SYNTAX.has(state)) {
      failures.push({ file, index: index + 1, state, detail: result.out.trim().split('\n').slice(-6).join('\n') });
    }
  });
  console.log(`${file}: ${statements.length} comandos`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} comando(s) com erro de sintaxe:`);
  for (const failure of failures) {
    console.error(`\n${failure.file} comando ${failure.index} (${failure.state})\n${failure.detail}`);
  }
  process.exit(1);
}
console.log('Sintaxe das migrations conferida.');
