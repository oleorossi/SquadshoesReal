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
const serviceOrderWizard = read('src/components/contractors/GenerateServiceOrdersWizard.tsx');
const standaloneServiceOrder = read('src/components/contractors/ServiceOrderFormDialog.tsx');
const serviceFocus = read('src/lib/contractorServiceFocus.ts');
const primaryServicesMigration = read('supabase/migrations/20270101004600_priorizar_costura_cabedal_e_aviamento_nas_os.sql');

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

  it('prioriza Costura de cabedal e Aviamento no fluxo de criação', () => {
    expect(serviceOrderWizard).toContain("const STEPS = ['Pedido', 'Serviços e OPs', 'Conferência']");
    expect(serviceOrderWizard).toContain('Costura de cabedal e Aviamento primeiro');
    expect(serviceOrderWizard).toContain('Outros serviços');
    expect(serviceOrderWizard).toContain('Manter produção interna');
    expect(serviceOrderWizard).toContain('.filter((contractor) => contractor.active)');
  });

  it('aplica a mesma disciplina de criação à OS avulsa', () => {
    expect(contractors).toContain('<ServiceOrderFormDialog');
    expect(standaloneServiceOrder).toContain("const STEPS = ['Serviço', 'Prestador e valores', 'Conferência']");
    expect(standaloneServiceOrder).toContain('Costura de cabedal e Aviamento primeiro');
    expect(standaloneServiceOrder).toContain('Outros serviços');
    expect(standaloneServiceOrder).toContain('contractors.filter((contractor) => contractor.active)');
    expect(standaloneServiceOrder).toContain('Comprovante de conferência');
    expect(standaloneServiceOrder).toContain('is_avulsa: !saleOrderId');
    expect(standaloneServiceOrder).toContain('dispatch_tracked: true');
  });

  it('usa o mesmo recorte de serviço na criação e nos relatórios', () => {
    expect(serviceFocus).toContain("sectorText === 'mesa'");
    expect(serviceFocus).toContain("combined.includes('costura') && !combined.includes('palmilha')");
    expect(reports).toContain('Filtrar relatório por serviço');
    expect(reports).toContain('matchesContractorServiceFocus');
    expect(reports).toContain('Mesmo período e serviço dos filtros');
  });

  it('faz a origem de dados reconhecer os nomes atuais das OPs', () => {
    expect(primaryServicesMigration).toContain("('costura',        'Costura de cabedal', 'Costura Cabedal'");
    expect(primaryServicesMigration).toContain("('mesa',           'Aviamento',           'Aviamento'");
    expect(primaryServicesMigration).toContain("WHEN 'costura'        THEN ARRAY['costura cabedal', 'costura']");
    expect(primaryServicesMigration).toContain("WHEN 'mesa'           THEN ARRAY['aviamento', 'mesa']");
  });
});
