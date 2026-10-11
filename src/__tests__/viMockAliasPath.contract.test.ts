import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `vi.mock` (e `doMock`/`importActual`/…) com caminho RELATIVO não é aplicado
 * quando o vitest roda no runtime do Bun — e nesta máquina `node` é symlink pro
 * Bun, então é assim que `bun run test` roda localmente.
 *
 * Mecanismo (vitest 3.2): para resolver `'../x'`, `vi.mock` descobre o arquivo
 * chamador parseando o stack trace (`getImporter`), procurando o frame
 * `" at Object.mock"`. No V8 o frame vem assim; no JavaScriptCore vem só
 * `" at mock"`. O importer sai vazio, o caminho resolve contra a raiz e o mock
 * fica registrado num id que ninguém importa — o teste roda contra o módulo REAL
 * sem aviso nenhum.
 *
 * Em 11/10/2026 isso derrubava 8 testes localmente (`pdfDelivery.ios`,
 * `thermalLabelPdfDelivery`, `palmilhaUnifiedDensity`, `printOrphanBreaks`)
 * enquanto o CI — Node de verdade — seguia verde. Outros 3 passavam só por
 * coincidência: o módulo real se comportava igual ao mock no jsdom.
 *
 * Alias `@/` e pacote (`'sonner'`) não dependem do importer e funcionam nos dois
 * runtimes. Esta trava roda no CI justamente porque lá o problema não aparece.
 */

const SRC = resolve(__dirname, '..');
const RELATIVE_MOCK =
  /vi\.(mock|doMock|unmock|doUnmock|importActual|importMock)(?:<[^>]*>)?\(\s*['"`](\.\.?\/[^'"`]*)/g;

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('vi.mock usa alias @/, nunca caminho relativo', () => {
  it('nenhum teste passa caminho relativo para vi.mock e afins', () => {
    // Este arquivo fica de fora: as fixtures do teste abaixo casam de propósito.
    const others = testFiles(SRC).filter((file) => file !== resolve(__filename));
    expect(others.length).toBeGreaterThan(100);

    const offenders = others.flatMap((file) =>
      Array.from(readFileSync(file, 'utf8').matchAll(RELATIVE_MOCK), (m) =>
        `${relative(SRC, file)}: vi.${m[1]}('${m[2]}')`,
      ),
    );

    expect(
      offenders,
      'troque o caminho relativo pelo alias @/ (ex.: vi.mock(\'@/lib/iosDevice\')) — ' +
        'relativo é ignorado em silêncio quando o vitest roda no Bun',
    ).toEqual([]);
  });

  it('a regex pega as formas que já apareceram no repo', () => {
    const hits = (src: string) => Array.from(src.matchAll(RELATIVE_MOCK), (m) => m[2]);

    expect(hits("vi.mock('../iosDevice', () => ({}))")).toEqual(['../iosDevice']);
    expect(hits("vi.mock(\n  './PaginatedSheet',\n  () => ({}))")).toEqual(['./PaginatedSheet']);
    expect(hits("await vi.importActual<typeof import('x')>('../x')")).toEqual(['../x']);
    expect(hits("vi.mock('@/lib/iosDevice', () => ({}))")).toEqual([]);
    expect(hits("vi.mock('sonner', () => ({}))")).toEqual([]);
  });
});
