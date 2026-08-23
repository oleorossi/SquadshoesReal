import { convertReservationToOutGuarded } from '@/lib/releaseConsumption';

/** Baixa no faturamento de OPs ainda Reservado — guard da ficha, PV segue. */
export async function convertReservadoOpsOnBilling(ops: Array<{ id: string }>): Promise<void> {
  for (const op of ops) {
    try {
      await convertReservationToOutGuarded(op.id);
    } catch (convErr: unknown) {
      const msg = convErr instanceof Error ? convErr.message : String(convErr);
      throw new Error(`Falha ao consumir reservas da OP ${op.id} no faturamento: ${msg}`);
    }
  }
}
