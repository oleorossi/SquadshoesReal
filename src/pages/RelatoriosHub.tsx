/** Hub de Relatórios A4. */
import { Card, CardContent } from '@/components/ui/card';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';

export default function RelatoriosHub() {
  return (
    <div className="space-y-6 page-enter">
      {/* Header */}
      <EditorialPageHeader
        sectionLabel="RELATÓRIOS · HUB"
        title="Relatórios"
        description="Os relatórios oficiais serão disponibilizados aqui após a integração e validação da fonte de dados da fábrica."
      />

      {/* Os cards saíram porque os templates ainda exibem dados de exemplo; só
          voltam após receberem fonte real e validação do documento impresso. */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Relatórios em homologação. Os modelos A4 permanecem acessíveis por bookmarks
          existentes, mas não devem ser usados como documentos da fábrica.
        </CardContent>
      </Card>

      {/* Footer info */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p>
            <strong className="text-foreground">Próximos passos:</strong> conectar dados reais aos templates
            (orders, order_stages, order_costs, defect_records) e validar os indicadores antes de publicar
            os relatórios novamente no hub.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
