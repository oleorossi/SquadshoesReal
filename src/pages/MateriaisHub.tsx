import { HubLanding } from '@/components/layout/HubLanding';

export default function MateriaisHub() {
  return (
    <HubLanding
      hubPath="/materiais"
      sectionLabel="Materiais"
      description="Estoque, grupos, ajustes e inventário — o saldo da fábrica."
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
