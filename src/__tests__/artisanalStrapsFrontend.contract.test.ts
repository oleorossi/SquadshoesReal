import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const hooks = read('src/hooks/useArtisanalStraps.ts');
const incrementalApplyHook = hooks.slice(
  hooks.indexOf('export function useApplyResolvedLegacyStrapProductMappingIncremental'),
  hooks.indexOf('export function useApplyArtisanalStrapMigration'),
);
const operations = read('src/components/artisanal-straps/ArtisanalStrapExternalOperations.tsx');
const planning = read('src/components/artisanal-straps/ArtisanalStrapPlanningConfig.tsx');
const purchasePdf = read('src/lib/strapPurchaseOrderZip.ts');
const serviceOrderPdf = read('src/lib/printArtisanalStrapServiceOrder.ts');
const saleOrderForm = read('src/pages/SaleOrderForm.tsx');
const saleOrderHooks = read('src/hooks/useSaleOrders.ts');
const strapSourcingOverrideDialog = read('src/components/sale-orders/StrapSourcingAdminOverrideDialog.tsx');
const strapSourcingOverrideHelper = read('src/lib/strapSourcingOverride.ts');
const saleOrderItemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');
const groupEditDialog = read('src/components/groups/GroupEditDialog.tsx');
const contractors = read('src/pages/Contractors.tsx');
const notifications = read('src/hooks/useNotifications.ts');
const batchMatrix = read('src/components/artisanal-straps/ArtisanalStrapBatchMatrix.tsx');
const groupColorProducts = read('src/lib/groupColorProducts.ts');
const contractorHooks = read('src/hooks/useContractors.ts');
const technicalSheets = read('src/pages/TechnicalSheets.tsx');
const canonicalPreview = read('src/lib/canonicalStrapDemandPreview.ts');
const strapCutBlock = read('src/components/sale-orders/ArtisanalStrapRollCutBlock.tsx');
const pickingList = read('src/pages/PickingListPage.tsx');
const hub = read('src/pages/ArtisanalStraps.tsx');
const calculator = read('src/pages/StrapCalculator.tsx');
const legacyProductMigration = read('src/components/artisanal-straps/ArtisanalStrapLegacyProductMigrationDialog.tsx');
const migrationControl = read('src/components/artisanal-straps/ArtisanalStrapMigrationControl.tsx');
const migrationDialogs = read('src/components/artisanal-straps/ArtisanalStrapMigrationDialogs.tsx');
const incrementalMigrationDialog = read('src/components/artisanal-straps/ArtisanalStrapIncrementalApplyDialog.tsx');
const incrementalMigrationHelper = read('src/lib/legacyStrapIncrementalApply.ts');
const performanceHistory = read('src/components/artisanal-straps/ArtisanalStrapPerformanceHistory.tsx');
const strapEditor = read('src/components/artisanal-straps/ArtisanalStrapEditor.tsx');
const conversionEditor = read('src/components/artisanal-straps/ArtisanalStrapConversionEditor.tsx');
const legacyRecipeHistoryMigration = read('supabase/migrations/20270101005000_expor_historico_receitas_tiras_legadas.sql');
const legacyRecipeReuseMigration = read('supabase/migrations/20270101005100_reaproveitar_receitas_tiras_legadas.sql');

describe('Tiras artesanais — contrato do frontend canônico', () => {
  it('consulta somente RPCs e views operacionais nas áreas sensíveis', () => {
    [
      'v_strap_service_order_items_operational',
      'v_strap_purchase_order_items_operational',
      'v_strap_contractor_loss_claims_operational',
      'v_strap_contractor_payment_cycles_operational',
      'v_contractor_material_custody_balances',
      'v_strap_rework_material_requests_operational',
      'list_strap_executor_planning_config',
    ].forEach((source) => expect(hooks).toContain(source));

    [
      'contractor_payment_cycles',
      'contractor_accruals',
      'contractor_loss_claims',
      'purchase_receipt_items',
      'strap_executor_capacities',
      'contractor_payment_schedules',
    ].forEach((table) => expect(hooks).not.toContain(`from('${table}')`));
  });

  it('congela OC por upload imutável com referência SHA-256 nos metadados', () => {
    expect(operations).toMatch(/upsert:\s*false/);
    expect(operations).toMatch(/metadata:\s*\{\s*sha256\s*\}/);
    expect(operations).not.toMatch(/upsert:\s*true/);
    expect(hooks).toContain('createSignedUrl');
    expect(hooks).toContain('get_strap_purchase_order_document');
    expect(operations).toContain('usePrepareArtisanalStrapPurchaseOrderApproval');
    expect(operations).toContain('Aprovar em lote');
    expect(operations).toContain('Uma falha nunca impede a tentativa das OCs seguintes');
    expect(operations).toContain('PurchaseOrderBulkSummary');
    expect(operations).toContain('Entrada integralmente rejeitada');
    expect(operations).toMatch(/invoiceTotal <= 0\.01\s*\? installments\.length === 0/);
    expect(operations).toContain('approverName: prepared.approver_name');
    expect(operations).toContain('approvalToken: prepared.approval_token');
    expect(hooks).toContain('prepare_strap_purchase_order_approval');
    expect(hooks).toContain('adjust_strap_purchase_order');
    expect(hooks).toContain('p_expected_commercial_digest');
    expect(operations).toContain('Ajustar OC antes da aprovação');
    expect(operations).toContain('Salvar ajuste auditado');
    expect(purchasePdf).toContain('DOCUMENTO OFICIAL APROVADO');
    expect(purchasePdf).toContain('AGUARDANDO APROVAÇÃO — NÃO ENVIAR');
    expect(purchasePdf).toContain('DOCUMENTO SUSPENSO — NÃO ENVIAR');
  });

  it('expõe capacidade, calendário, periodicidade e retrabalho somente pelas RPCs públicas', () => {
    [
      'save_strap_operational_calendar',
      'save_strap_executor_capacity',
      'save_contractor_payment_schedule',
      'request_strap_rework_material',
      'decide_strap_rework_material_request',
    ].forEach((rpc) => expect(hooks).toContain(rpc));
    expect(planning).toContain('Capacidade e calendários por executor');
    expect(planning).toContain('Semanal');
    expect(planning).toContain('Quinzenal');
  });

  it('remove a janela legada e mantém o pós-save do PV sem escritor paralelo', () => {
    expect(existsSync(resolve(ROOT, 'src/components/sale-orders/StrapShortageDialog.tsx'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'src/lib/strapShortages.ts'))).toBe(false);
    expect(saleOrderForm).not.toContain('StrapShortageDialog');
    expect(saleOrderItemForm).not.toContain('createGroupColorProducts');
    expect(saleOrderItemForm).not.toContain('Cadastrar todas');
    expect(groupEditDialog).toContain('isCanonicalStrapGroup');
    expect(groupEditDialog).toContain('Abrir cadastro canônico');
    expect(groupEditDialog).toContain('id="edit-is-artisanal-strap"');
    expect(groupEditDialog).toContain('is_artisanal_strap: isContainer ? false : isArtisanalStrap');
    expect(groupColorProducts).toContain('Família de tira artesanal só pode ser criada pelo Hub');
    expect(groupColorProducts).not.toMatch(/is_artisanal:\s*true/);
    expect(contractors).not.toMatch(/use(Create|Update|Delete)ArtisanalRecipe/);
    expect(contractors).not.toContain('Nova Receita Artesanal');
  });

  it('detecta OS canônica pela identidade das linhas e remove ações legadas', () => {
    expect(contractorHooks).toContain('v_strap_service_order_items_operational');
    expect(contractors).toContain('isCanonicalStrapServiceOrder(o)');
    expect(contractors).toContain('Abrir no Hub de Tiras');
  });

  it('separa RBAC administrativo e documentos/unidades operacionais', () => {
    expect(hooks).toContain('administer_strap_operations');
    expect(operations).toContain('catalog.capabilities.administer_strap_operations');
    expect(operations).not.toContain('catalog.capabilities.manage_strap_catalog');
    expect(operations).toContain("entityType: 'purchase_order'");
    expect(operations).toContain('Recebimento com rejeição');
    expect(hooks).toContain('p_production_receipt_id: productionReceiptId');
    expect(operations).toContain('row.stock_unit_snapshot');
    expect(serviceOrderPdf).toContain('ORDEM DE SERVIÇO');
    expect(serviceOrderPdf).toContain('Reposição de estoque mínimo');
    expect(notifications).toContain('v_strap_purchase_order_notifications_operational');
    expect(notifications).toContain("link: '/admin/aprovacao-ordens-compra'");
  });

  it('obriga revisão da alocação parcial e respeita estados operacionais da OS', () => {
    expect(hooks).toContain('p_allocations: input.allocations');
    expect(operations).toContain('Sugestão normativa');
    expect(operations).toContain('Revisada pelo operador');
    expect(operations).toContain('Revisei a sugestão e confirmo a distribuição');
    expect(operations).toContain('isTerminalStrapOperationStatus');
    expect(operations).toContain('const canSend = canExecute && !terminal && !suspended');
    expect(operations).toContain('const canReturn = canExecute && hasCustody');
    expect(operations).toContain('const hasContractorRemittance = Boolean(item.sent_at)');
    expect(operations).toMatch(/const canReceive[\s\S]*&& hasContractorRemittance[\s\S]*const canSend/);
    expect(operations).toContain('Recebimento liberado somente após registrar a remessa da napa');
    expect(hooks).toMatch(/schedule_strap_batch_item[\s\S]*p_reason:\s*reason/);
    expect(hooks).toMatch(/start_strap_production_batch[\s\S]*p_reason:\s*reason/);
    expect(hooks).toMatch(/replan_strap_production_batch[\s\S]*p_reason:\s*reason/);
  });

  it('faz a matriz resolver napa candidata sem writer paralelo nem SKU truncado', () => {
    expect(batchMatrix).toContain('useDesignateBaseMaterialOfficialProduct');
    expect(batchMatrix).toContain("alias.status === 'approved'");
    expect(batchMatrix).toContain('crypto.randomUUID().toUpperCase()');
    expect(batchMatrix).toContain('Compra pronta habilitada');
    expect(batchMatrix).toContain('config.purchaseEnabled || config.floorMode');
    expect(batchMatrix).not.toContain('.slice(0, 6)');
    expect(batchMatrix).not.toContain("from('products')");
  });

  it('grava família e medida canônicas na linha UUID da ficha técnica', () => {
    expect(technicalSheets).toContain('applyCanonicalTechnicalStrapMeasure');
    expect(technicalSheets).toContain('hasCanonicalTechnicalStrapIdentity');
    expect(technicalSheets).toContain("setAbaAtiva('range-aviamento')");
    expect(technicalSheets).toContain('activeStrapMeasures.length === 0');
    expect(technicalSheets).toContain('Nenhuma família e medida está ativa');
    expect(technicalSheets).toContain('Catálogo sem família e medida ativa');
    expect(technicalSheets).toContain('target="_blank"');
    expect(technicalSheets).not.toContain('<StrapGroupCombobox');
  });

  it('executa a migração 03300 sem falso resolved de produto legado', () => {
    [
      'artisanal_strap_legacy_migration_diagnostics',
      'resolve_legacy_strap_product_migration',
      'apply_artisanal_strap_migration',
      'preview_artisanal_strap_migration_rollback',
      'rollback_artisanal_strap_migration',
      'v_artisanal_strap_legacy_migration_admin',
      'apply_resolved_legacy_strap_product_mapping_incremental',
    ].forEach((contract) => expect(hooks).toContain(contract));
    expect(legacyProductMigration).toContain('buildLegacyStrapProductAllocations');
    expect(legacyProductMigration).toContain('remainingReserved: reservation.remaining_reserved');
    expect(legacyProductMigration).toContain('isLegacySelfTargetAllocation');
    expect(legacyProductMigration).toContain('Estes IDs ficam somente leitura e não entram no payload de reescrita');
    expect(legacyProductMigration).toContain('const assignableServiceItems');
    expect(legacyProductMigration).toContain('serviceOrderItemIds: assignableServiceItems.map');
    expect(legacyProductMigration).toContain('O cabeçalho está terminal; estas linhas não são obrigatórias');
    expect(hub).toContain("['legacy_product_mapping_required', 'resolved_product_mapping_blocked']");
    expect(hub).toContain("['legacy_replenishment_mode', 'legacy_replenishment_source_unavailable']");
    expect(hub).toContain("issue.issue_code === 'legacy_replenishment_source_unavailable'");
    expect(migrationDialogs).toContain("['legacy_replenishment_mode', 'legacy_replenishment_source_unavailable']");
    expect(migrationDialogs).toContain("useState<ArtisanalStrapSourceMode | ''>('')");
    expect(migrationDialogs).toContain('Variante canônica do diagnóstico');
    expect(migrationDialogs).not.toContain('setBaseGroupId');
    expect(migrationDialogs).not.toContain('setVariantId');
    expect(migrationControl).toContain('expectedChecksum: dryRun.overall_checksum');
    expect(migrationControl).toContain('expectedPostChecksum: preview.expected_post_checksum');
    expect(migrationControl).toContain('Confirmo que revisei o dry-run');
    expect(migrationControl).toContain('dryRunPending || dryRunBlocked');
    expect(migrationControl).toContain('Novo dry-run bloqueado por cutover ativo');
    expect(migrationControl).toContain('O dry-run permanece desabilitado até a consulta administrativa confirmar');
    expect(hub).toContain("issue.issue_code === 'resolved_product_mapping_ready_to_apply'");
    expect(hub).toContain('Aplicar resolução');
    expect(incrementalMigrationDialog).toContain("diagnostic?.issue_code !== 'resolved_product_mapping_ready_to_apply'");
    expect(incrementalMigrationDialog).toContain('createLegacyStrapIncrementalIdempotencyKey');
    expect(incrementalMigrationDialog).toContain('Repetir mesma tentativa');
    expect(incrementalMigrationDialog).toContain('Replay idempotente confirmado');
    expect(incrementalMigrationDialog).not.toContain("from('");
    expect(incrementalMigrationHelper).toContain('crypto.randomUUID()');
    [
      'p_cutover_id: cutoverId',
      'p_mapping_id: mappingId',
      'p_expected_scope_checksum: expectedScopeChecksum',
      'p_reason: reason',
      'p_idempotency_key: idempotencyKey',
    ].forEach((argument) => expect(incrementalApplyHook).toContain(argument));
    expect(incrementalApplyHook).toContain('invalidateArtisanalStraps(queryClient)');
    [
      "['artisanal-strap-legacy-migration-diagnostics']",
      "['artisanal-strap-migration-cutovers']",
      "['artisanal-strap-demands']",
      "['artisanal-strap-external-operations']",
    ].forEach((queryKey) => expect(incrementalApplyHook).toContain(queryKey));
  });

  it('oferece override administrativo somente após recusa da edição normal da origem', () => {
    expect(saleOrderHooks).toContain("rpc('override_sale_order_item_strap_sourcing'");
    [
      'p_sale_order_item_id: saleOrderItemId',
      'p_expected_revision: expectedRevision',
      'p_lines: lines',
      'p_reason: reason',
      'p_correlation_id: correlationId || crypto.randomUUID()',
      "['artisanal-strap-demands']",
      "['artisanal-strap-production']",
      "['artisanal-strap-external-operations']",
    ].forEach((contract) => expect(saleOrderHooks).toContain(contract));
    expect(saleOrderForm).toContain('if (!isCommittedStrapSourcingError(error)) return');
    expect(saleOrderForm).toContain('if (!isAdmin)');
    expect(saleOrderForm).toContain('sameStrapSourcingSelection(baseline.lines, lines)');
    expect(saleOrderForm).toContain('nenhum override foi tentado');
    expect(strapSourcingOverrideDialog).toContain('Motivo obrigatório');
    expect(strapSourcingOverrideDialog).toContain('revisão esperada');
    expect(strapSourcingOverrideDialog).toContain('Confirmar override e reconciliar');
    expect(strapSourcingOverrideDialog).toContain('target.lines');
    expect(strapSourcingOverrideHelper).toMatch(/origem comprometida\.\*override_sale_order_item_strap_sourcing/i);
    expect(strapSourcingOverrideHelper).toContain("detail?.code === 'strap_source_override_blocked'");
    expect(strapSourcingOverrideHelper).toContain('Ação necessária:');
    expect(strapSourcingOverrideHelper).toContain("String(record.code || '') === '40001'");
  });

  it('compara rendimento e custo pelas views canônicas sem alterar receita aprovada', () => {
    expect(hooks).toContain("from('v_strap_real_yield_history')");
    expect(hooks).toContain("from('v_strap_cost_variance_operational')");
    expect(performanceHistory).toContain('Confirmado × realizado');
    expect(performanceHistory).toContain('Variação prevista × realizada');
    expect(performanceHistory).toContain('Criar versão sugerida');
    expect(conversionEditor).toContain('rendimento realizado');
    expect(conversionEditor).toContain('Nova versão em rascunho');
    expect(conversionEditor).toContain('id: createRecipeVersion ? undefined');
    expect(conversionEditor).not.toContain('status: \'approved\'');
  });

  it('orienta a fábrica pela napa e rendimento canônicos, sem rolo fixo legado', () => {
    expect(canonicalPreview).toContain('baseRequiredM: baseRequired');
    expect(canonicalPreview).toContain('confirmedYieldMPerM: yieldPerMeter');
    expect(strapCutBlock).toContain('separação da napa-base');
    expect(strapCutBlock).toContain('snapshot.baseRequiredM');
    expect(strapCutBlock).not.toContain('ROLO_COMPRIMENTO_M');
    expect(pickingList).toContain('separação da napa-base');
    expect(pickingList).not.toContain('ROLO_LARGURA_MM');
    expect(calculator).toContain("type BaseRendimento = 'teorico' | 'real'");
    expect(calculator).toContain('rendimentoDaSimulacao');
    expect(calculator).toContain('A necessidade usa o rendimento informado apenas nesta simulação');
    expect(calculator).not.toContain('confirmedStrapYieldFromLossPercentage');
    expect(calculator).not.toContain('perdaPercentual');
    expect(conversionEditor).not.toContain('loss_percentage');
    expect(conversionEditor).not.toContain('Perda percentual');
  });

  it('mantém a calculadora livre, temporária e independente das receitas persistidas', () => {
    expect(hub).toContain('Simulação livre de novas medidas');
    expect(hub).toContain('Os valores são temporários e não são salvos');
    expect(hub).toContain('<StrapCalculator');
    expect(hub).not.toContain('selectedRecipe');
    expect(hub).not.toContain('approvedRecipes');
    expect(hub).not.toContain('rendimentoConfirmadoInicialMPerM');
    expect(calculator).toContain('Base desta simulação');
    expect(calculator).toContain('Rendimento real medido');
    expect(calculator).not.toContain('Perda estimada');
    expect(calculator).toContain('nenhum valor desta aba é salvo');
    expect(calculator).not.toMatch(/from\(['"]/);
  });

  it('abre variantes de grupos no editor canônico de estoque', () => {
    const strapEditorLinks = groupEditDialog.match(/\/tiras-artesanais\?tab=cadastro&editor=1[^`]+/g) || [];
    expect(strapEditorLinks.length).toBeGreaterThan(0);
    strapEditorLinks.forEach((link) => expect(link).toContain('purpose=stock_variant'));
  });

  it('abre em Operação e reduz a navegação principal a três áreas sem perder os links antigos', () => {
    expect(hub).toContain("defaultValue: 'operacao'");
    expect(hub).toContain("type PrimaryTab = 'operacao' | 'configuracao' | 'controle'");
    expect(hub).toContain("receitas: 'configuracao'");
    expect(hub).toContain("variantes: 'configuracao'");
    expect(hub).toContain("diagnostico: 'controle'");
    expect(hub).toContain('<TabsContent value="operacao"');
    expect(hub).toContain('<TabsContent value="configuracao"');
    expect(hub).toContain('<TabsContent value="controle"');
    expect(hub).not.toContain('<TabsContent value="receitas"');
    expect(hub).not.toContain('<TabsContent value="diagnostico"');
  });

  it('oferece configuração guiada em duas etapas e concentra histórico e simulação', () => {
    expect(hub).toContain('Configure em duas etapas');
    expect(hub).toContain('Tipo, material e rendimento');
    expect(hub).toContain('Origem, cor e estoque');
    expect(hub).toContain("type ConfigurationView = 'cadastro' | 'variantes' | 'ferramentas'");
    expect(hub).toContain('Histórico e simulação');
    expect(hub).toMatch(/configurationView === 'ferramentas'[\s\S]*<RecipesTab[\s\S]*<CalculatorTab/);
  });

  it('mantém o planejamento junto da produção, fora do catálogo de engenharia', () => {
    const catalogTab = hub.slice(hub.indexOf('function CatalogTab'), hub.indexOf('function RecipesTab'));
    const productionTab = hub.slice(hub.indexOf('function ProductionTab'), hub.indexOf('function ProductionBatchCard'));
    expect(catalogTab).not.toContain('<ArtisanalStrapPlanningConfig');
    expect(productionTab).toContain('<ArtisanalStrapPlanningConfig');
  });

  it('mostra uma tira real em foco e elimina a identidade demonstrativa fixa', () => {
    expect(hub).toContain('const focusDemand');
    expect(hub).toContain('const focusVariant');
    expect(hub).toContain('Tira em foco');
    expect(hub).not.toContain('typeName="TIRA CHATA"');
    expect(hub).not.toContain('measureName="8mm"');
    expect(hub).not.toContain('baseName="NAPA SOFT"');
    expect(hub).not.toContain('colorName="OFF WHITE"');
  });

  it('completa a leitura da receita com executor e custo protegido por permissão', () => {
    expect(hub).toContain('useContractors');
    expect(hub).toContain('executorLabel');
    expect(hub).toContain('transformation_cost_per_m');
    expect(hub).toContain('catalog.capabilities.can_see_financial_values');
  });

  it('preserva o histórico anterior e oferece reaproveitamento explícito', () => {
    expect(hooks).toContain("rpc('list_legacy_artisanal_strap_recipe_history')");
    expect(hooks).toContain("rpc('reuse_legacy_artisanal_strap_recipe'");
    expect(hooks).toContain('legacy_recipes:');
    expect(hub).toContain('Cadastros do sistema anterior');
    expect(hub).toContain('Histórico legado');
    expect(hub).toContain('Reaproveitar');
    expect(hub).toContain('legacyRecipeId: recipe.id');
    expect(conversionEditor).toContain('Confirmar e ativar');
    expect(legacyRecipeHistoryMigration).toContain('FROM public.artisanal_recipes recipe');
    expect(legacyRecipeHistoryMigration).toContain('LEFT JOIN public.legacy_artisanal_recipe_map mapping');
    expect(legacyRecipeHistoryMigration).toContain('WHEN v_can_financial THEN recipe.labor_cost_per_meter');
    expect(legacyRecipeHistoryMigration).toContain("coalesce(mapping.status, 'review_required')");
    expect(legacyRecipeHistoryMigration).toContain('REVOKE ALL ON FUNCTION public.list_legacy_artisanal_strap_recipe_history()');
    expect(legacyRecipeHistoryMigration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.artisanal_recipes/i);
    expect(legacyRecipeReuseMigration).toContain('CREATE OR REPLACE FUNCTION public.reuse_legacy_artisanal_strap_recipe');
    expect(legacyRecipeReuseMigration).toContain('public.save_base_material_width_profile(');
    expect(legacyRecipeReuseMigration).toContain('public.approve_base_material_width_profile(');
    expect(legacyRecipeReuseMigration).toContain('public.save_artisanal_strap_conversion(');
    expect(legacyRecipeReuseMigration).toContain('public.submit_artisanal_strap_recipe(');
    expect(legacyRecipeReuseMigration).toContain('public.approve_artisanal_strap_recipe(');
    expect(legacyRecipeReuseMigration).toContain('public.resolve_legacy_artisanal_recipe_migration(');
  });

  it('usa linguagem operacional nas telas de rotina', () => {
    expect(hub).not.toContain('NETTING CANÔNICO');
    expect(hub).not.toContain('aguarde o worker');
    expect(performanceHistory).not.toContain('view canônica');
    expect(performanceHistory).not.toContain('fallback');
  });
});
