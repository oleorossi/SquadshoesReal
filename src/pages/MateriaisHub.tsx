import { Link } from 'react-router-dom';
import { HubLanding } from '@/components/layout/HubLanding';

export default function MateriaisHub() {
  return (
    <div className="space-y-3">
    <p className="px-1 text-sm">
      Para dar entrada pelo XML da nota, use <Link to="/compras/entrada-nf" className="underline font-medium">Entrada por NF</Link>.
    </p>
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
        '/compras/entrada-nf': 'Dar entrada no estoque pelo XML da NF',
      }}
    />
    </div>
  );
}
