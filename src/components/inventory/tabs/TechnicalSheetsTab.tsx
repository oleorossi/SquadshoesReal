import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { FileText, Info, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export function TechnicalSheetsTab() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <CardTitle>Fichas Técnicas (BOM)</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="default" className="bg-primary/5 border-primary/20">
            <Info className="h-4 w-4 text-primary" />
            <AlertTitle>Consumo por Numeração</AlertTitle>
            <AlertDescription>
              Todo o consumo de material é definido por numeração nas Fichas Técnicas principais.
              O cálculo industrial utiliza exclusivamente os valores por tamanho para precisão máxima.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground text-center max-w-md">
              As fichas técnicas com consumo por numeração estão disponíveis no módulo principal de Fichas Técnicas.
            </p>
            <Button onClick={() => navigate('/fichas-tecnicas')} className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Abrir Fichas Técnicas
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
