import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validatePvSystemCiEnvironment,
  validatePvSystemVitestReport,
} from './pv-system-vitest-report.mjs';

const REQUIRED_TEST_FILES = [
  'src/services/__tests__/consumptionService.parity.test.ts',
  'src/services/__tests__/consumptionService.integration.test.ts',
  'src/services/__tests__/debitGuards.integration.test.ts',
  'src/lib/__tests__/consumptionParity.integration.test.ts',
  'src/__tests__/pvSystemDatabase.integration.test.ts',
];

const { url, serviceRoleKey, ciProjectId } = validatePvSystemCiEnvironment(process.env);
console.log(`Projeto Supabase CI validado: ${ciProjectId} (produção recusada pelo gate).`);

const reportDir = resolve(process.cwd(), 'reports');
const reportPath = resolve(reportDir, 'pv-system-integration.json');
mkdirSync(reportDir, { recursive: true });

const result = Bun.spawnSync({
  cmd: [
    'bunx',
    'vitest',
    'run',
    ...REQUIRED_TEST_FILES,
    '--reporter=json',
    `--outputFile=${reportPath}`,
  ],
  cwd: process.cwd(),
  env: {
    ...process.env,
    RUN_DB_INTEGRATION: '1',
    VITE_SUPABASE_URL: url,
    SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  },
  stdout: 'pipe',
  stderr: 'pipe',
});

const stdout = result.stdout.toString();
const stderr = result.stderr.toString();
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

if (result.exitCode !== 0) {
  throw new Error(`Vitest encerrou com código ${result.exitCode}.`);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const summary = validatePvSystemVitestReport(report, REQUIRED_TEST_FILES);

console.log(
  `PV System: ${summary.executedCases} caso(s) executado(s), 0 skipped/todo, ${summary.reportedFiles} arquivo(s).`,
);
