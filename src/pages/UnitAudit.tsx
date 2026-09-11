import { Navigate } from 'react-router-dom';

/**
 * A auditoria de unidades mora em /estoque?tab=conversion
 * (UnitConversionAuditTab). Esta rota só preserva bookmarks e o Cmd+K antigo.
 */
export default function UnitAudit() {
  return <Navigate to="/estoque?tab=conversion" replace />;
}
