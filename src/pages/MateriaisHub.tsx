import { HubLanding } from '@/components/layout/HubLanding';

export default function MateriaisHub() {
  return (
    <HubLanding
      hubPath="/materiais"
      sectionLabel="Estoque"
      description="Saldos, grupos, ajustes e inventário do almoxarifado."
      hints={{
        '/estoque': 'Saldos, movimentações e conversões',
        '/grupos': 'Famílias e variantes de material',
        '/ajuste-estoque': 'Correção de saldo com motivo',
        '/estoque/qualidade': 'Bloqueios e liberação de lote',
        '/estoque/inventario': 'Contagem ABC e divergências',
      }}
    />
  );
}
