import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  validatePvSystemCiEnvironment,
  validatePvSystemVitestReport,
} from '../../scripts/pv-system-vitest-report.mjs';

const cwd = '/tmp/pv-system-ci';
const required = ['a.test.ts', 'b.test.ts'];

function report(statuses: string[]) {
  const split = Math.ceil(statuses.length / 2);
  const files = [statuses.slice(0, split), statuses.slice(split)];
  const assertions = files.flatMap((file) => file);
  return {
    numTotalTests: assertions.length,
    numPassedTests: assertions.filter((status) => status === 'passed').length,
    numFailedTests: assertions.filter((status) => status === 'failed').length,
    numPendingTests: assertions.filter((status) => status === 'skipped').length,
    numTodoTests: assertions.filter((status) => status === 'todo').length,
    success: assertions.every((status) => status === 'passed'),
    testResults: files.map((fileStatuses, fileIndex) => ({
      name: resolve(cwd, required[fileIndex]),
      assertionResults: fileStatuses.map((status, testIndex) => ({
        status,
        title: `case-${fileIndex}-${testIndex}`,
        fullName: `suite case-${fileIndex}-${testIndex}`,
      })),
    })),
  };
}

describe('PV System — gate do relatório Vitest', () => {
  it('aceita service role somente no projeto isolado de CI', () => {
    expect(validatePvSystemCiEnvironment({
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      VITE_SUPABASE_URL: 'https://ciworkspaceref.supabase.co',
      SUPABASE_CI_PROJECT_ID: 'ciworkspaceref',
      SUPABASE_SERVICE_ROLE_KEY: 'ci-service-role',
    })).toEqual({
      url: 'https://ciworkspaceref.supabase.co',
      ciProjectId: 'ciworkspaceref',
      serviceRoleKey: 'ci-service-role',
    });
  });

  it('recusa service role fora do CI e recusa o projeto de produção', () => {
    expect(() => validatePvSystemCiEnvironment({
      CI: 'false',
      VITE_SUPABASE_URL: 'https://ciworkspaceref.supabase.co',
      SUPABASE_CI_PROJECT_ID: 'ciworkspaceref',
      SUPABASE_SERVICE_ROLE_KEY: 'ci-service-role',
    })).toThrow(/GitHub Actions dedicado/);

    expect(() => validatePvSystemCiEnvironment({
      CI: 'true',
      GITHUB_ACTIONS: 'false',
      VITE_SUPABASE_URL: 'https://ciworkspaceref.supabase.co',
      SUPABASE_CI_PROJECT_ID: 'ciworkspaceref',
      SUPABASE_SERVICE_ROLE_KEY: 'ci-service-role',
    })).toThrow(/GitHub Actions dedicado/);

    expect(() => validatePvSystemCiEnvironment({
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      VITE_SUPABASE_URL: 'https://ssvxfoybzmjlypnipqzn.supabase.co',
      SUPABASE_CI_PROJECT_ID: 'ssvxfoybzmjlypnipqzn',
      SUPABASE_SERVICE_ROLE_KEY: 'production-service-role',
    })).toThrow(/produção nunca recebe fixtures/);

    expect(() => validatePvSystemCiEnvironment({
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      VITE_SUPABASE_URL: 'https://anotherproject.supabase.co',
      SUPABASE_CI_PROJECT_ID: 'ciworkspaceref',
      SUPABASE_SERVICE_ROLE_KEY: 'ci-service-role',
    })).toThrow(/ambiente Supabase isolado de CI/);
  });

  it('aceita somente quando todos os arquivos e casos foram executados', () => {
    expect(validatePvSystemVitestReport(report(['passed', 'passed']), required, cwd)).toEqual({
      executedCases: 2,
      reportedFiles: 2,
    });
  });

  it('rejeita suíte obrigatória skipped mesmo quando o Vitest marca success', () => {
    const skipped = report(['passed', 'skipped']);
    skipped.success = true;

    expect(() => validatePvSystemVitestReport(skipped, required, cwd))
      .toThrow(/skipped\/todo/);
  });

  it('rejeita relatório sem casos executados', () => {
    const empty = report([]);
    empty.testResults = required.map((file) => ({ name: resolve(cwd, file), assertionResults: [] }));
    empty.success = true;

    expect(() => validatePvSystemVitestReport(empty, required, cwd))
      .toThrow(/0 casos executados/);
  });

  it('rejeita arquivo obrigatório ausente do relatório', () => {
    const incomplete = report(['passed', 'passed']);
    incomplete.testResults.pop();

    expect(() => validatePvSystemVitestReport(incomplete, required, cwd))
      .toThrow(/Suítes obrigatórias ausentes/);
  });

  it('rejeita uma suíte vazia mesmo quando outra suíte executou casos', () => {
    const oneEmpty = report(['passed', 'passed']);
    oneEmpty.testResults[1].assertionResults = [];
    oneEmpty.numTotalTests = 1;
    oneEmpty.numPassedTests = 1;
    oneEmpty.success = true;

    expect(() => validatePvSystemVitestReport(oneEmpty, required, cwd))
      .toThrow(/suítes obrigatórias com 0 casos executados/i);
  });

  it('carrega a paridade DB sem criar cliente anônimo e nunca converte falta de credencial em skip', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/__tests__/consumptionParity.integration.test.ts'),
      'utf8',
    );

    expect(source).not.toContain('supabase as anonClient');
    expect(source).toContain("vi.mock('@/integrations/supabase/client'");
    expect(source).toContain('RUN_DB_INTEGRATION=1 exige VITE_SUPABASE_URL');
    expect(source).not.toContain('testCtx.skip');
    expect(source).not.toContain('VITE_SUPABASE_SERVICE_ROLE_KEY');
  });

  it('documenta que a paridade real exige seed sanitizado e versionado', () => {
    const setup = readFileSync(
      resolve(process.cwd(), 'docs/PV_SYSTEM_CI_SETUP.md'),
      'utf8',
    );

    expect(setup).toContain('seed sanitizado e versionado');
    for (const reference of ['CF 09 ', 'DS21', 'S-039']) {
      expect(setup).toContain(`\`${reference}\``);
    }
    expect(setup).toContain('não existe seed versionado');
    expect(setup).toContain('não pode ficar verde por skip');
  });
});
