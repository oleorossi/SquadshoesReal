import { ColorVariant } from '@/hooks/useColorVariants';
import { SizeGrid } from './inventory';
import { DefectRegistry } from './defects';

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  reference: string;
  model: string;
  colors: ColorVariant[];
  sizeGrid: SizeGrid;
  productionStages: ProductionStage[];
  qualityChecks: QualityCheck[];
  defects: DefectRegistry[];
  estimatedCompletion: Date;
  actualCompletion?: Date;
}

export interface ProductionStage {
  id: string;
   name: string; // "Corte", "Forração", "Silk", "Colagem", "Montagem", "Acabamento", "Expedição"
  sequence: number;
  estimatedHours: number;
  actualHours?: number;
  responsibleEmployee: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
}

export interface QualityCheck {
  id: string;
  stageId: string;
  checker: string;
  status: 'pass' | 'fail' | 'pending';
  notes?: string;
  checkedAt?: Date;
}
