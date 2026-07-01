import { Link } from 'react-router-dom';
import { ArrowLeft } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Button } from '@/components/ui/button';
import SectorDistributionPlanner from '@/components/production/SectorDistributionPlanner';

export default function CapacityDistribution() {
  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionNumber="02"
        sectionLabel="PRODUÇÃO · CAPACIDADE · DISTRIBUIR"
        title="Distribuição por Referência"
        description="Aloca pares por referência × setor × dia da semana. Trava células pra preservar decisões antes de re-rodar o auto-fill."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/pcp?tab=capacidade">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Capacidade
            </Link>
          </Button>
        }
      />
      <SectorDistributionPlanner />
    </div>
  );
}
