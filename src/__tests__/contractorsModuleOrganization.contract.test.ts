import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const contractors = read('src/pages/Contractors.tsx');
const planning = read('src/components/contractors/OutsourcingPlanningTab.tsx');
const reports = read('src/pages/ContractorReports.tsx');
const coverage = read('src/components/contractors/TerceirizacaoCoberturaPanel.tsx');
const contractorForm = read('src/components/contractors/ContractorFormDialog.tsx');

describe('Terceirizados — contrato visual e organizacional do módulo', () => {
  it('mantém a mesma hierarquia nas cinco áreas operacionais', () => {
    expect(contractors).toContain('OPERAÇÃO · EXPEDIÇÃO EXTERNA');
    expect(contractors).toContain('CADASTRO · REDE PRODUTIVA');
    expect(planning).toContain('PLANEJAMENTO · CAPACIDADE EXTERNA');
    expect(reports).toContain('ANÁLISE · DESEMPENHO EXTERNO');
    expect(coverage).toContain('CADASTRO · TARIFA POR REFERÊNCIA');

    [contractors, planning, reports, coverage].forEach((source) => {
      expect(source).toContain('ContractorSectionHeader');
      expect(source).toContain('ContractorSummaryRail');
    });
  });

  it('preserva as decisões de operação em vez de expor apenas totais decorativos', () => {
    expect(contractors).toContain('Controle de saída e retorno');
    expect(contractors).toContain('Prestadores e capacidade externa');
    expect(planning).toContain('Antecipação de excedentes');
    expect(reports).toContain('Produção, prazo e pagamento');
    expect(coverage).toContain('Cobertura da terceirização');
  });

  it('organiza o cadastro do prestador e explica o efeito da inativação', () => {
    expect(contractorForm).toContain('01 · Identificação');
    expect(contractorForm).toContain('02 · Contato e localização');
    expect(contractorForm).toContain('03 · Operação e pagamento');
    expect(contractorForm).toContain('Inativar preserva OS, tarifas e pagamentos anteriores.');
  });
});
