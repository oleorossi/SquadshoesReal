/**
 * @deprecated Use UnitConversionAuditTab — a aba Conversões virou Auditoria de unidades.
 * Reexport mantido só pra imports legados / testes que ainda apontam o nome antigo.
 */
export {
  UnitConversionAuditTab as ConversionReportTab,
  classifyProduct,
  effectivePurchaseUnit,
  UNIT_AUDIT_QUERY_KEYS,
} from './UnitConversionAuditTab';
export type { IssueInfo, IssueLevel } from './UnitConversionAuditTab';
