import { HubLanding } from '@/components/layout/HubLanding';

export default function FiscalHub() {
  return (
    <HubLanding
      hubPath="/fiscal"
      sectionLabel="Fiscal"
      description="NF-e, CT-e, MDF-e, SPED e apuração de impostos."
      hints={{
        '/nfe': 'Emissão e consulta de notas',
        '/cte': 'Conhecimento de transporte',
        '/mdfe': 'Manifesto de documentos fiscais',
        '/sped': 'Escrituração digital',
        '/apuracao-impostos': 'Impostos e obrigações',
      }}
    />
  );
}
