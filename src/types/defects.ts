export type DefectSeverity = 'minor' | 'major' | 'critical';
export type DefectStatus = 'open' | 'resolved' | 'dismissed';

export interface DefectRegistry {
  id: string;
  productionOrderId: string;
  stage: string; // "Corte", "Costura", "Montagem", "Acabamento"
  defectType: string; // "Costura irregular", "Material danificado", "Mancha", "Erro de medida", etc.
  severity: DefectSeverity;
  quantity: number;
  description?: string;
  registeredBy: string; // employeeId or userId
  registeredAt: Date;
  status: DefectStatus;
  canRework: boolean;
  cost: number;
  resolvedAt?: Date;
  resolvedBy?: string;
}
