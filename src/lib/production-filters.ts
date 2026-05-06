import { addDays, isBefore } from 'date-fns';

/**
 * Filtro para adiantamento de setores independentes
 * @param orders Lista de ordens de produção
 * @param daysAhead Horizonte de dias para adiantamento
 * @param bottleneckCleared Se o gargalo principal foi liberado
 */
export const filterByProductionHorizon = (orders: any[], daysAhead: number, bottleneckCleared: boolean) => {
  if (!bottleneckCleared) {
    return orders.filter(o => o.dueDate === 'Today');
  }
  
  return orders.filter(order => {
    const horizonDate = addDays(new Date(), daysAhead);
    return isBefore(new Date(order.scheduledDate), horizonDate) && order.materialsReady;
  });
};
