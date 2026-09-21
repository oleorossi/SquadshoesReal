import { HubLanding } from '@/components/layout/HubLanding';

export default function ComprasHub() {
  return (
    <HubLanding
      hubPath="/compras"
      sectionLabel="Compras"
      description="Planejamento, cotações, ordens e fornecedores."
      hints={{
        '/purchase-planning': 'MRP e plano semanal',
        '/quotations': 'RFQ e comparação de propostas',
        '/purchase-orders': 'OCs em andamento',
        '/purchase-orders/per-pv': 'Compras amarradas a um PV',
        '/compras/inspecao': 'Recebimento e qualidade de entrada',
        '/suppliers': 'Cadastro de fornecedores',
        '/custos-insumos': 'Histórico de custo por material',
        '/compras/alcadas': 'Limites de aprovação',
      }}
    />
  );
}
