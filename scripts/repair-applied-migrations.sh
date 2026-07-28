#!/usr/bin/env bash
# =============================================================================
# Helper: marca migrations como APLICADAS no Supabase remoto sem re-rodar.
# =============================================================================
# Uso depois que algumas migrations já foram aplicadas manualmente no SQL Editor
# (ou aplicadas em outro lugar) e o GitHub Action começou a tentar rodá-las de
# novo. O script marca elas como "applied" na tabela supabase_migrations.schema_migrations
# sem executar o SQL — essencial pra não causar duplicações ou erros.
#
# Pré-requisitos:
#   - supabase CLI instalado: brew install supabase/tap/supabase
#   - SUPABASE_ACCESS_TOKEN exportado (token de https://supabase.com/dashboard/account/tokens)
#   - SUPABASE_DB_PASSWORD exportado (senha do banco)
#
# Uso:
#   export SUPABASE_ACCESS_TOKEN=sbp_xxx
#   export SUPABASE_DB_PASSWORD=xxx
#   ./scripts/repair-applied-migrations.sh
# =============================================================================
set -euo pipefail

PROJECT_ID="${SUPABASE_PROJECT_ID:-ssvxfoybzmjlypnipqzn}"

# Lista de migrations que JÁ foram aplicadas manualmente.
# Edite esta lista conforme o histórico real do banco.
# Formato: timestamp da migration (YYYYMMDDHHMMSS, sem o resto do nome).
ALREADY_APPLIED=(
  # ✅ Lista COMPLETA regenerada em 2026-07-28 (auditoria M32): todos os arquivos
  # de supabase/migrations/ SEM registro em supabase_migrations.schema_migrations,
  # com conteúdo CONFIRMADO aplicado no vivo (aplicações via MCP com versão auto-gerada).
  # Regenerar: comparar list_migrations (MCP) × arquivos 14-dígitos do repo.
  20260512130000  # fk-nfe-cce-to-nfe-emitidas
  20260512150000  # ops-auto-create-on-approval
  20260512170000  # palmilha-pronta-color-conjugations
  20260512180000  # sole-drives-consumption-always-true
  20260512190000  # zero-default-overhead-packaging
  20260512200000  # drop-technical-sheets-gender
  20260512210000  # drop-dead-technical-sheets-fields
  20260512230000  # shipping-manifests-transporter-fk
  20260513140000  # compute-material-ready-date
  20260513170000  # add-client-id-store-name-to-wave-items
  20260513200000  # ncm_autofill_from_sole
  20260513210000  # sector_bottleneck_monitoring
  20260513220000  # fix_service_order_ap_trigger
  20260513230000  # service_order_flow_finalization
  20260513240000  # op_consolidation_ref_color
  20260514100000  # auto_wave_from_sale_order
  20260514110000  # sector_workload_aggregated
  20260514130000  # drop_old_suggest_ncm_signature
  20260515130000  # payroll-runs-create-and-migrate
  20260515140000  # fix-stage-transition-guard-parallel-prep
  20260515150000  # fix-wave-stage-transition-guard-parallel-prep
  20260515160000  # fix-cola-quantity-typos-in-4-sheets
  20260515170000  # audit-followup-forro-and-sole-backfill
  20260515200000  # re-backfill-primary-sole-prefer-stocked
  20260515210000  # drop-adjust-stock-6arg-overload
  20260515220000  # blinda-sale-order-triggers
  20260516130000  # packaging-consolidate-in-box-types
  20260516140000  # debit-packaging-from-new-model-and-nfe-volumes
  20260516150000  # pay-bank-hours-rpc
  20260516160000  # force-delete-product
  20260516170000  # fix-products-category-trigger-and-backfill
  20260516180000  # drop_calc_consumption_by_grade_3arg_overload
  20260516190000  # nfe_audit_hardening
  20260516200000  # technical_sheets_aviamento_steps
  20260517160000  # sale-orders-picking-individually-done-at
  20260517170000  # capacity-overflow-outsourcing
  20260517180000  # check-stock-includes-straps
  20260517181000  # check-stock-straps-uses-item-colors
  20260517190000  # overtime-resolution-debits-bank-on-pay
  20260517200000  # group-color-sources
  20260519180000  # sale_orders_soft_delete
  20260520140000  # cleanup_sheet_materials_orphan_soles
  20260522180000  # pending-two-punches-short-day
  20260523130000  # outsourced-in-field-view
  20260523140000  # order_lots
  20260524330000  # trigger-creates-ops-with-soft-debit
  20260529120000  # fix_upsert_open_po_idempotency_per_pv
  20260529130000  # cleanup_orphan_image_urls_old_project
  20260529140000  # crm_external_contact_name
  20260529150000  # sale_orders_nfe_external_flag
  20260529160000  # supplier_lead_time_stats_auto
  20260529170000  # service_orders_sale_order_id_consistency
  20260530130000  # notes_parent_id_hierarchy
  20260530140000  # drop-stale-check-stock-availability-overloads
  20260530150000  # debit-packaging-read-from-product-groups
  20260530160000  # cost-policies-default-tax-commission
  20260530170000  # create-pricing-simulations
  20260531130000  # v_bom_audit_issues
  20260531140000  # cleanup_inflated_bom_full_purge
  20260531150000  # v_bom_audit_issues_v2_qty1
  20260531170000  # note_tasks_table
  20260605130000  # fix-has-straps-overwrite-by-construction-routing
  20260605140000  # backfill-dublagem-widths-and-warn-ui
  20260605160000  # weight-fallback-via-sole-group-avg
  20260605170000  # box-types-supplier-fk
  20260605180000  # create-solo-wave-idempotent
  20260606121000  # fix-rop-suggestions-supplier-and-qty
  20260606130000  # release-phantom-reservations-from-terminal-orders
  20260606140000  # check-stock-availability-net-reserved
  20260606150000  # check-stock-availability-emit-unregistered-strap
  20260607120100  # fn-projected-demand-mixed-unit-fix
  20260607120200  # debit-sole-apply-conjugation-all-classifications
  20260607120300  # outsourcing-link-os-to-op-and-idempotency
  20260607120400  # get-purchase-projection-exclude-suggested
  20260607120500  # resync-ficha-sizes-backfill
  20260607120600  # outsourcing-validate-sector-in-flow
  20260607120700  # debit-strap-stock-nongraded-cm-to-m
  20260607120800  # check-stock-availability-nongraded-cm-to-m
  20260607130000  # update-sale-order-atomic-persist-strap-colors
  20260607140000  # debit-component-honor-pinned-product-id
  20260607150000  # fix-lining-accessory-dm2-both-consumption-functions
  20260607160000  # components-accessories-into-consumption-cost
  20260610130000  # recompute-wave-timeline-on-delivery-change
  20260610140000  # restore-parallelism-and-costura-sector
  20260611130000  # fix-solo-wave-code-double-pv-prefix
  20260613121000  # drop-dead-picking-lists
  20260613130000  # sector-labor-rates
  20260613140000  # labor-cost-results
  20260613150000  # technical-sheets-grading-config
  20260613160000  # pv-outsource-to-contractor-by-sector
  20260613170000  # service-order-overview-payment-balance
  20260613180000  # po-item-received-quantity
  20260623130000  # consumo-B1-warning-M2-guard
  20260623140000  # consumo-A3-tiras-no-custeio-e-mrp
  20260623150000  # oc-cancel-duplicatas-restock-global
  20260628160000  # infer-order-stage-started-at-material-flow
  20260628170000  # fix-started-at-inference-real-dag
  20260628180000  # technical-sheets-material-pins
  20260628181000  # cost-policies-single-active
  20260628181100  # bom-classify-sector-part-name
  20260628181200  # consolidate-componentes-group
  20260628181300  # by-grade-read-direct-components
  20260628181400  # strip-invalid-direct-components-trigger
  20260628181500  # bom-operations-generator
  20260628200000  # consolidate-transporters-canonical
  20260701120100  # strap-needs-exact-by-quantity
  20260707120000  # fix-lining-alternatives-pick-one
  20260718120000  # repair-palmilha-colors-product-group-drift
  20260719120000  # capacity-engine-params-headcount
  20260719120100  # rpc-model-productivity
  20260719120200  # model-productivity-snapshots
  20260719120300  # capacity-engine-review-fixes
  20260719130000  # fix-costs-dirty-direct-components-key
  20260719140000  # set-model-sector-capacity
  20260719150000  # capacity-team-source-and-orphan-fix
  20260719150100  # employee-productivity
  20260719150200  # capacity-measured-layer-and-planning
  20260719150300  # create-production-sector-rpc
  20260719150400  # capacity-engine-v5-measured-layer
  20260719160000  # capacity-review-fixes
  20260719160100  # capacity-engine-v6
  20260719160200  # capacity-review-fixes-round2
  20260719170000  # costura-cabedal-palmilha-fase1
  20260726150000  # contractor-os-financials-and-real-paid
  20260726170000  # service-order-payables-both-paths
  20260726180000  # version-orphan-service-order-triggers
  20260726190000  # overflow-os-uses-contractor-rate
  20260726200000  # service-order-rework-and-loss
  20260818130000  # auto-po-consolidate-by-supplier
  20260830120000  # p0-security-lockdown-anon
  20260830130000  # p1-b1-mark-costs-dirty-from-bom
  20260830140000  # p1-b2-cancel-cmv-on-revenue-reversal
  20260830150000  # p2-c5-auto-po-purchase-multiple
  20260831120000  # payroll-runs-financial-entry-sync
  20260831130000  # overtime-reconciliation-view
  20260901120000  # ficha-montadores-chamada-do-dia
  20260901130000  # ficha-montadores-setor
  20260901140000  # payroll-payments
  20260901150000  # by_grade_propagate_conversion_warning
  20260901160000  # fix-resolve-sole-color-unaccent
  20260901170000  # resolve_sole_color_unaccent_hardening
  20260901180000  # costura_parallel_guards_and_billing_date
  20260901190000  # reassert_calculate_order_cost_item_with_strap_loop
  20260901200000  # product_groups_sector_not_null
  20260902120000  # pcp-apontamento-quantidade
  20260902121000  # caixa-packaging-mode-freeze-hybrid
  20260902130000  # pcp-ledger-sobrevive-resync
  20260902131000  # strap-sql-warnings-parity
  20260902140000  # sole-resolution-unified
  20260902150000  # reserve-gate-and-sync
  20260902160000  # purchase-aggregators-parity
  20260902170000  # drop-material-status-fiction
  20260902180000  # mrp-po-ceil-placa-current
  20260903110000  # rls-backup-table
  20260903120000  # bom-operations-time-source-e-dirty-trigger
  20260903121000  # generate-bom-operations-v2-preserva-manual
  20260903122000  # seed-sector-minutes-default-e-trigger-regen
  20260903123000  # cost-item-tempo-pendente-explicito
  20260903123500  # order-costs-limpa-orfaos
  20260903124000  # stock-movements-movement-reason
  20260903125000  # record-order-consumption
  20260903126000  # trigger-consumo-na-finalizacao
  20260903127000  # backfill-consumo-ops-finalizadas
  20260903130000  # v-faturado-sem-ar-e-indice
  20260903131000  # sync-ar-cron
  20260903140000  # fix-force-delete-product-multi-reservation
  20260904120000  # service-order-orphan-guard
  20260904130000  # service-order-legacy-triage
  20260904140000  # ar-reconciliation-review-fixes
  20260905120000  # user-permissions-crud-actions
  20260906120000  # component-color-mappings
  20260907120000  # variant-material-group-columns
  20260907120500  # variant-group-resolution
  20260907130000  # fix-box-types-rls-insert-policy
  20260907140000  # reassert-rls-policies-orphan-tables
  20260908120000  # grupos-estoque-hierarchy-rollup-invariants
  20260909120000  # pcp-costura-parallel-finalize
  20260909120100  # mrp-dedup-po-item-upsert
  20260909120200  # try-reserve-width-guard-and-po-dedup
  20260910120000  # rh-he-rates-per-employee
  20260910130000  # drop-bank-hours
  20260910140000  # component-colors-reserve-gate-and-guardrails
  20260910150000  # try-reserve-derives-from-consumption-engine
  20260910160000  # fix-debit-sole-enum-coercion
  20260910170000  # parity-runtime-smoke-and-enum-guard
  20260911120000  # fix-forracao-cabedal-palmilha-duplicity
  20260911130000  # scalar-consumption-wrapper-parity
  20260911140000  # sole-grade-debit-variant-aware
  20260911150000  # double-upper-consumption-rpc
  20260911160000  # strap-artisanal-flag-and-base-color-guard
  20260911170000  # remove-forracao-multigrupo-and-additive-debit
  20260911180000  # extend-search-norm-system-wide
  20260912120000  # production-engine-schema
  20260912120100  # production-engine-recompute
  20260912120200  # production-engine-pointing-and-cutover
  20260912120300  # fix-ficha-join-reference-id
  20260913120000  # production-engine-audit-fixes
  20260913121000  # fix-cutover-ghost-stages
  20260914120000  # employee-payment-type-producao-por-par
  20260915100000  # debit-consistency-report
  20260915110000  # audit-debito-ficha-grade-fixes
  20260916120000  # audit-debito-pendencias-secao3
  20260917120000  # fix-area-material-width-silence
  20260918120000  # consumption-color-on-direct-components
  20260919120000  # sale-order-items-stable-identity
  20260920100000  # fix-costura-fallback-and-legacy-mapping
  20260920101000  # rebuild-sector-load-views
  20260920102000  # fix-wizard-distribution-and-lots
  20260920103000  # schedule-holidays
  20260920120000  # rop-purchase-unit-and-artisanal
  20260920121000  # wave-needs-reservations-and-shortage-gate
  20260920122000  # purchase-date-anchors-unify
  20260920123000  # drop-dead-purchase-views
  20260920130000  # snapshot-invalidation-and-costs-dirty-mesh
  20260920131000  # artisanal-estorno-ledger
  20260920132000  # retire-legacy-stock-out-and-availability-floor
  20260920140000  # unit-entry-hardening
  20260920150000  # order-cost-overhead-and-strap-unit
  20260920160000  # shortage-gate-color-aware
  20260920160001  # rollback-shortage-gate-recursion
  20260920161000  # shortage-gate-color-aware-v2
  20260921120000  # fix-convert-reservation-p-alias
  20260921130000  # fix-artisanal-auto-os-orphan-guard
  20260921140000  # reapply-artisanal-os-is-avulsa-over-rop
  20260922120000  # strap-base-follows-reference-napa
  20260923120000  # fix-create-product-rpc-description-and-add-color-supplier-co
  20260924120000  # napa-sudani-roll-width
  20260925120000  # list-ops-with-stale-reservations
  20260925130000  # audit-data-corrections-pv
  20260925131000  # consumption-unresolved-warnings
  20260925132000  # purchase-order-integrity
  20260925133000  # stock-debit-hole-prevention
  20260926120000  # resync-op-material-reservations
  20260928120000  # component-color-defaults
  20260928121000  # component-color-defaults-consumption
  20260929120000  # component-color-defaults-straps
  20261001120000  # split-costura-palmilha-cabedal
  # Adicione aqui timestamps de outras migrations já rodadas manualmente
  # via SQL Editor ou MCP que precisam ser marcadas como applied:
)

if [ ${#ALREADY_APPLIED[@]} -eq 0 ]; then
  echo "⚠️  Nenhum timestamp listado em ALREADY_APPLIED. Edite o script primeiro."
  echo ""
  echo "Pra ver quais migrations o supabase considera aplicadas no remoto:"
  echo "  supabase migration list --linked"
  exit 0
fi

echo "🔗 Linkando projeto $PROJECT_ID..."
supabase link --project-ref "$PROJECT_ID"

echo ""
echo "📋 Marcando ${#ALREADY_APPLIED[@]} migrations como aplicadas..."
for ts in "${ALREADY_APPLIED[@]}"; do
  echo "  ↪ $ts"
  supabase migration repair --status applied "$ts" || {
    echo "  ⚠️  Falha em $ts (talvez já marcada). Continuando..."
  }
done

echo ""
echo "✅ Concluído. Status final:"
supabase migration list --linked
