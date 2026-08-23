import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const PAGE = read('src/pages/Timesheet.tsx');
const QUEUE = read('src/components/timesheet/PendingTimeRecordsPanel.tsx');

describe('central operacional de correção do ponto', () => {
  it('não empilha fila, calendário e exceções na mesma rolagem', () => {
    expect(PAGE).toContain("values: ['queue', 'calendar', 'exceptions']");
    expect(PAGE).toContain('param: \'correction\'');
    expect(PAGE).toContain('<TabsContent value="queue"><PendingTimeRecordsPanel /></TabsContent>');
    expect(PAGE).toContain('<TabsContent value="calendar"><ManualEntryTab /></TabsContent>');
    expect(PAGE).toContain('<TabsContent value="exceptions"><ExceptionsTab /></TabsContent>');
    expect(PAGE).not.toMatch(/<PendingTimeRecordsPanel\s*\/>\s*<Separator\s*\/>\s*<ManualEntryTab\s*\/>/);
  });

  it('mantém etapas principais e ferramentas de apoio visualmente separadas', () => {
    expect(PAGE).toContain('const processSections = sections.filter(section => section.step)');
    expect(PAGE).toContain('const supportSections = sections.filter(section => !section.step)');
    expect(PAGE).toContain('aria-label="Etapas do controle de ponto"');
    expect(PAGE).toContain('aria-label="Ferramentas do controle de ponto"');
    expect(PAGE).toContain("clearOnChange: ['correction']");
  });

  it('oferece uma fila priorizada, filtrável e operável por teclado', () => {
    expect(QUEUE).toContain("const [queueSort, setQueueSort] = useState<QueueSort>('oldest')");
    expect(QUEUE).toContain("value: 'one-punch'");
    expect(QUEUE).toContain("value: 'missing-exit'");
    expect(QUEUE).toContain("value: 'extra-punch'");
    expect(QUEUE).toContain("value: 'ambiguous'");
    expect(QUEUE).toContain('aria-pressed={queueFilter === option.value}');
    expect(QUEUE).toContain('aria-expanded={expanded}');
    expect(QUEUE).toContain("String(rank).padStart(2, '0')");
  });
});
