import { resolve } from 'node:path';

const PRODUCTION_PROJECT_ID = 'ssvxfoybzmjlypnipqzn';

export function validatePvSystemCiEnvironment(env) {
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const ciProjectId = env.SUPABASE_CI_PROJECT_ID || '';

  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true') {
    throw new Error(
      'O runner com service role e fixtures de banco só pode executar no GitHub Actions dedicado.',
    );
  }

  if (!url || !serviceRoleKey || !ciProjectId) {
    throw new Error(
      'Configure SUPABASE_CI_URL, SUPABASE_CI_PROJECT_ID e SUPABASE_CI_SERVICE_ROLE_KEY nos Secrets do GitHub; '
        + 'o workflow os mapeia para VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  if (!url.startsWith('https://') || url.includes('localhost')) {
    throw new Error('VITE_SUPABASE_URL deve apontar para o projeto Supabase isolado de CI via HTTPS.');
  }

  const supabaseHost = new URL(url).hostname;
  if (supabaseHost !== `${ciProjectId}.supabase.co` || ciProjectId === PRODUCTION_PROJECT_ID) {
    throw new Error(
      'O runner recusou um projeto que não é o ambiente Supabase isolado de CI; produção nunca recebe fixtures.',
    );
  }

  return { url, serviceRoleKey, ciProjectId };
}

export function validatePvSystemVitestReport(report, requiredTestFiles, cwd = process.cwd()) {
  const testResults = report.testResults || [];
  const assertions = testResults.flatMap((suite) => suite.assertionResults || []);
  const skipped = assertions.filter((test) =>
    ['skipped', 'pending', 'todo', 'disabled'].includes(test.status));
  const executed = assertions.filter((test) => ['passed', 'failed'].includes(test.status));
  const requiredFiles = requiredTestFiles.map((file) => resolve(cwd, file));
  const suitesByFile = new Map(
    testResults.map((suite) => [resolve(cwd, suite.name), suite]),
  );
  const reportedFiles = new Set(suitesByFile.keys());
  const missingFiles = requiredFiles
    .filter((file) => !reportedFiles.has(file));

  if (missingFiles.length > 0) {
    throw new Error(`Suítes obrigatórias ausentes do relatório: ${missingFiles.join(', ')}`);
  }

  if (assertions.length === 0 || executed.length === 0 || Number(report.numTotalTests || 0) === 0) {
    throw new Error('A integração devolveu 0 casos executados; zero casos não é verde.');
  }

  if (skipped.length > 0 || Number(report.numPendingTests || 0) > 0 || Number(report.numTodoTests || 0) > 0) {
    const names = skipped.map((test) => test.fullName || test.title).join(' | ');
    throw new Error(`Suíte obrigatória com caso skipped/todo: ${names || 'caso não identificado'}`);
  }

  const zeroCaseFiles = requiredFiles.filter((file) => {
    const suiteAssertions = suitesByFile.get(file)?.assertionResults || [];
    return !suiteAssertions.some((test) => ['passed', 'failed'].includes(test.status));
  });
  if (zeroCaseFiles.length > 0) {
    throw new Error(`Suítes obrigatórias com 0 casos executados: ${zeroCaseFiles.join(', ')}`);
  }

  if (Number(report.numFailedTests || 0) > 0 || report.success !== true) {
    throw new Error(`Integração falhou em ${report.numFailedTests || 0} caso(s).`);
  }

  return {
    executedCases: executed.length,
    reportedFiles: reportedFiles.size,
  };
}
