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
const consolidatedServiceOrders = read('src/components/contractors/ConsolidatedServiceOrders.tsx');
const consolidatedServiceOrderHook = read('src/hooks/useConsolidatedServiceOrders.ts');
const serviceOrderGenerationHook = read('src/hooks/useGenerateOpServiceOrders.ts');
const referenceTerceirizacoesHook = read('src/hooks/useReferenceTerceirizacoes.ts');
const referenceTerceirizacoesPanel = read('src/components/technical-sheets/ReferenceTerceirizacoesPanel.tsx');
const itemOutsourcing = read('src/components/sale-orders/ItemSectorOutsourcingSection.tsx');
const saleOrderForm = read('src/pages/SaleOrderForm.tsx');
const saleOrderItemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');
const standaloneServiceOrder = read('src/components/contractors/ServiceOrderFormDialog.tsx');
const dispatchDialog = read('src/components/contractors/ServiceOrderDispatchDialog.tsx');
const returnDialog = read('src/components/contractors/ServiceOrderReturnDialog.tsx');
const osCycleOverview = read('src/components/contractors/OsCycleOverview.tsx');
const osStatusIndicators = read('src/components/contractors/OsStatusIndicators.tsx');
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
    expect(serviceOrderWizard).toContain("const STEPS = ['Pedido', 'Serviços e OPs']");
    expect(serviceOrderWizard).not.toContain("const STEPS = ['Pedido', 'Serviços e OPs', 'Conferência']");
    expect(serviceOrderWizard).toContain('Costura de cabedal e Aviamento primeiro');
    expect(serviceOrderWizard).toContain('Outros serviços');
    expect(serviceOrderWizard).toContain('Prosseguir');
    expect(serviceOrderWizard).toContain('keepInternal');
    expect(serviceOrderWizard).toContain('.filter((contractor) => contractor.active)');
  });

  it('conclui a terceirização como opt-in no próprio passo de serviços', () => {
    expect(serviceOrderWizard).toContain('step === 1 && ready.length === 0');
    expect(serviceOrderWizard).toContain('onClick={keepInternal}');
    expect(serviceOrderWizard).toContain('step === 1 && ready.length > 0');
    expect(serviceOrderWizard).toContain('onClick={doGenerate}');
    expect(serviceOrderWizard).toContain('{blockedCount} de fora');
    expect(serviceOrderWizard).not.toContain('canReview');
  });

  it('mostra a prévia de capacidade e prazo sem recalcular no cliente', () => {
    [
      'capacity_pairs_per_day', 'return_before_sector', 'material_components',
      'execution_days', 'queue_days', 'lead_days', 'total_lead_days', 'recommended_send_date',
      'required_return_date', 'planning_source', 'planning_warning',
      'planning_config_ready', 'planning_config_issue',
    ].forEach((field) => expect(serviceOrderGenerationHook).toContain(field));
    ['Capacidade:', 'Execução:', 'Fila:', 'Antecedência:', 'Enviar em:', 'Retornar até:', 'Materiais:']
      .forEach((label) => expect(serviceOrderWizard).toContain(label));
    expect(serviceOrderWizard).toContain('require_planning_config: true');
    expect(serviceOrderWizard).toContain('Prestador desta ficha');
    expect(serviceOrderWizard).not.toContain('onContractorChange');
    expect(serviceOrderWizard).toContain('recalculadas pelo servidor ao gerar');
  });

  it('preserva o prestador e a tarifa definidos por ficha em cada OP', () => {
    expect(serviceOrderWizard).toContain('contractorByKey');
    expect(serviceOrderWizard).toContain('rateByKey');
    expect(serviceOrderWizard).toContain('const key = keyOf(line)');
    expect(serviceOrderWizard).not.toContain('contractorBySector');
    expect(serviceOrderWizard).not.toContain('rateBySector');
    expect(serviceOrderWizard).toContain('dirtyRateOriginByKey');
    expect(serviceOrderWizard).toContain('line.default_contractor_id');
    expect(referenceTerceirizacoesHook).toContain("queryKey: ['pv_outsourceable_lines']");
    expect(referenceTerceirizacoesHook).toContain("queryKey: ['service_order_generation_gaps']");
  });

  it('preserva OS parcial com aviso e não transforma erro de leitura em opt-out', () => {
    expect(serviceOrderWizard).toContain('&& qty > 0');
    expect(serviceOrderWizard).not.toContain('qty === line.quantity');
    expect(serviceOrderWizard).toContain('A OS parcial usa a proporção da grade integral da OP');
    expect(serviceOrderWizard).toContain('isError: linesFailed');
    expect(serviceOrderWizard).toContain('isError: contractorsFailed');
    expect(serviceOrderWizard).toContain('isError: saleOrdersFailed');
    expect(serviceOrderWizard).toContain('refetchSaleOrders()');
    expect(serviceOrderWizard).toContain('Falha ao carregar os dados da terceirização');
    expect(serviceOrderWizard).toContain('loadingWizardData || wizardDataFailed || generate.isPending');
    expect(serviceOrderWizard).toContain('if (created === 0 && exists === 0)');
    expect(serviceOrderWizard).toContain('void refetchLines()');
  });

  it('mantém o assistente navegável por teclado e nomeia os controles por OP', () => {
    expect(serviceOrderWizard).toContain('aria-expanded={isOpen}');
    expect(serviceOrderWizard).toContain('aria-controls={panelId}');
    expect(serviceOrderWizard).toContain("aria-current={state === 'active' ? 'step' : undefined}");
    expect(serviceOrderWizard).toContain("disabled={state === 'future'}");
    expect(serviceOrderWizard).toContain('aria-labelledby={`${lineId}-label`}');
    expect(serviceOrderWizard).toContain('aria-label={`Quantidade da OP ${line.op_number} para ${group.label}`}');
    expect(serviceOrderWizard).toContain('htmlFor={rateId}');
  });

  it('bloqueia envio e conferência quando o saldo físico não pode ser carregado', () => {
    [dispatchDialog, returnDialog].forEach((source) => {
      expect(source).toContain('isError, error: loadError');
      expect(source).toContain('if (!bal) throw new Error');
      expect(source).toContain('loadFailed || !balance');
      expect(source).toContain('Tentar novamente');
      expect(source).toContain("queryKey: ['pv_service_orders']");
      expect(source).toContain("queryKey: ['consolidated_service_orders']");
    });
    expect(returnDialog).toContain('error: cbalsErr');
    expect(returnDialog).toContain('if (cbalsErr) throw cbalsErr;');
    expect(dispatchDialog).toContain('Envio bloqueado.');
    expect(returnDialog).toContain('Conferência bloqueada.');
  });

  it('falha fechado no cadastro da ficha sem impedir a desativação segura', () => {
    expect(referenceTerceirizacoesPanel).toContain('isError,');
    expect(referenceTerceirizacoesPanel).toContain('disabled={isLoading || isError}');
    expect(referenceTerceirizacoesPanel).toContain('Não foi possível carregar as atividades externas');
    expect(referenceTerceirizacoesPanel).toContain('const fullConfigurationValid');
    expect(referenceTerceirizacoesPanel).toContain('const usingDeactivationFallback');
    expect(referenceTerceirizacoesPanel).toContain('if (usingDeactivationFallback)');
    expect(referenceTerceirizacoesPanel).toContain('somente a desativação será aplicada');
  });

  it('só grava no item do PV atividades completas da referência', () => {
    expect(itemOutsourcing).toContain('useActiveReferenceTerceirizacoes(referenceId)');
    expect(itemOutsourcing).toContain('isReferencePlanningReady');
    expect(itemOutsourcing).toContain('activeContractorIds.has(config.contractor_id)');
    expect(itemOutsourcing).toContain('REFERENCE_OUTSOURCE_SECTORS');
    expect(saleOrderItemForm).toContain('referenceId={item.reference_id}');
    expect(saleOrderForm).not.toContain('SendSectorToContractorDialog');
    expect(saleOrderItemForm).toContain("update(idx, 'selected_terceirizacao_ids', [])");
    expect(saleOrderItemForm).toContain("update(idx, 'terceirizacao_quantities', {})");
    expect(saleOrderItemForm).toContain("update(idx, 'outsourced_sectors', {})");
  });

  it('imprime uma OS editada somente com dados e snapshot da versão salva', () => {
    expect(contractors).toContain('Imprimir versão salva');
    expect(contractors).toContain('material_requirements: persisted.material_requirements');
    expect(contractors).toContain('quantity: Number(persisted.quantity || 0)');
    expect(contractors).toContain('fetchReceiptItemsForOs(persisted)');
    expect(contractors).toContain('if (editingOrder.planning_source) return;');
    expect(contractors).toContain('disabled={!!editingOrder.planning_source}');
    expect(contractors).toContain('editingOrder.selected_sale_order_item_ids ?? null');
    expect(contractors).toContain('Escopo travado pela OP que gerou o plano');
    expect(contractors).toContain('plannedPairOverrides');
    expect(contractors).toContain('new Map([[ids[0], Number(o.quantity) || 0]])');
    expect(contractors).toContain('ids.length !== 1');
  });

  it('não gera OS sobre edição ainda não persistida do PV', () => {
    expect(saleOrderForm).toContain('disabled={hasUnsavedEdits}');
    expect(saleOrderForm).toContain('Salve o pedido antes de gerar OS sobre os dados persistidos.');
  });

  it('explica e respeita o bloqueio físico das OS operacionais', () => {
    expect(contractors).toContain('function serviceOrderRequiresPhysicalReturn');
    expect(contractors).toContain('const hasGenericContainerLines');
    expect(contractors).toContain('const hasPhysicalLedger');
    expect(contractors).toContain('const terminalStatusLocked');
    expect(contractors).toContain('const physicalBalanceUnavailable');
    expect(contractors).toContain('const pairsInField');
    expect(contractors).toContain('disabled={terminalStatusLocked}');
    expect(contractors).toContain('disabled={pairsInField || physicalBalanceUnavailable}');
    expect(contractors).toContain('Registre o retorno físico antes de cancelar esta OS.');
    expect(contractors).toContain('O status final desta OS é imutável.');
    expect(contractors).toContain('banco fecha a OS somente depois de zerar o saldo real');
    expect(contractors).not.toContain("update({ status: 'Concluído', materials_sent: updatedMats");
    expect(contractors).toContain("!isValidOsTransition(persistedEditingOrder.status, 'Pendente')");
    expect(contractors).toContain('O fluxo da OS não pode voltar para uma etapa anterior.');
  });

  it('não oferece edição genérica para a OS agregada integrada ao PV', () => {
    expect(contractors).toContain('function isLegacyIntegratedAggregateServiceOrder');
    expect(contractors).toContain('order.source_terceirizacao_id');
    expect(contractors).toContain('order.dispatch_tracked === false');
    expect(contractors).toContain('Ajuste pelo PV de origem');
    expect(contractors).toContain('Use “Atualizar quantidade” na terceirização do pedido.');
    expect(referenceTerceirizacoesHook).toContain("case 'physical_history_exists'");
    expect(referenceTerceirizacoesHook).toContain("queryKey: ['pv_service_orders']");
    expect(referenceTerceirizacoesHook).toContain(".select('status')");
    expect(referenceTerceirizacoesHook).toContain(".eq('status', current.status)");
    expect(referenceTerceirizacoesHook).toContain('A OS mudou enquanto você cancelava.');
  });

  it('mantém o cabeçalho consolidado fora das ações físicas da OS flat', () => {
    expect(contractors).toContain('function isGenericConsolidatedServiceOrder');
    expect(contractors).toContain('if (hasGenericContainerLines) return false;');
    expect(contractors).toContain('Gerida por linhas');
    expect(contractors).toContain('Materiais e retorno desta OS são controlados pelas linhas consolidadas.');
    expect(contractors).toContain('Esta OS é um contêiner consolidado.');
    expect(contractors).toContain('&& !isGenericConsolidatedServiceOrder(o)');
    expect(contractors).toContain('!isContainer && <OsWorkflowRail');
    expect(contractors).toContain('!isContainer && <OsBalanceLine');
  });

  it('reserva a exclusão de OS ao rollback técnico da criação avulsa', () => {
    expect(contractors).not.toContain('setDeleteOsTarget');
    expect(contractors).not.toContain('deleteOrder.mutate');
    expect(contractors).not.toContain('Excluir a OS {deleteOsTarget?.order_number}?');
  });

  it('não reenvia um contêiner consolidado já cancelado', () => {
    expect(consolidatedServiceOrders).toContain("os.status === 'Cancelado'");
    expect(consolidatedServiceOrders).toContain("!os.sent && os.status === 'Pendente'");
    expect(consolidatedServiceOrderHook).toContain("normalizeOsStatus(current?.status) !== OS_STATUS.PENDENTE");
    expect(consolidatedServiceOrderHook).toContain(".eq('status', current.status)");
  });

  it('falha fechado na leitura consolidada e reconhece toda provenance canônica de Tiras', () => {
    expect(consolidatedServiceOrders).toContain('isError, error, refetch');
    expect(consolidatedServiceOrders).toContain('Não foi possível carregar as OS consolidadas.');
    expect(consolidatedServiceOrderHook).not.toContain("return [];");
    expect(consolidatedServiceOrderHook).toContain('sale_order_strap_demand_id');
    expect(consolidatedServiceOrderHook).toContain('strap_stock_floor_contribution_id');
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

  it('une ficha, ciclo físico e recibo na operação diária da OS', () => {
    expect(contractors).toContain('OsCycleOverview');
    expect(osCycleOverview).toContain('Ciclo da ordem de serviço');
    expect(osCycleOverview).toContain('Material enviado');
    expect(osCycleOverview).toContain('Já foi');
    expect(osCycleOverview).toContain('Já voltou');
    expect(osStatusIndicators).toContain('export function OsCycleLine');
    expect(contractors).toContain('OsCycleLine');
    expect(contractors).toContain('SignedReceiptUploadDialog');
    expect(contractors).toContain('Anexar recibo assinado');
    expect(contractors).toContain('Recibo aberto para o prestador assinar e mandar de volta.');
    expect(contractors).toContain('markAsReceived={false}');
    expect(dispatchDialog).toContain('Kit de material da ficha');
    expect(dispatchDialog).toContain('buildDispatchMaterialKit');
    expect(dispatchDialog).toContain('onDispatched');
    expect(serviceOrderWizard).toContain('OPs da ficha já vêm marcadas');
    expect(serviceOrderWizard).toContain('autoSelectedForPvRef');
  });
});
