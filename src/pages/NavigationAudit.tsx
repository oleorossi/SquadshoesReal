import { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Settings, 
  ArrowLeft,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  auditNavigation, 
  describeIssue, 
  type NavigationIssue 
} from '@/lib/navigationAudit';
import { Badge } from '@/components/ui/badge';

export default function NavigationAuditPage() {
  const [issues, setIssues] = useState<NavigationIssue[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);

  const runAudit = () => {
    setIsScanning(true);
    // Pequeno delay visual para simular scan
    setTimeout(() => {
      const found = auditNavigation();
      setIssues(found);
      setIsScanning(false);
      setLastScan(new Date());
    }, 600);
  };

  useEffect(() => {
    runAudit();
  }, []);

  const getIssueColor = (kind: NavigationIssue['kind']) => {
    switch (kind) {
      case 'missing-mapping': return 'destructive';
      case 'admin-only-in-menu': return 'warning';
      case 'system-item-not-admin': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <div className="container mx-auto py-8 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="-ml-2 h-8 px-2">
              <Link to="/settings">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Voltar
              </Link>
            </Button>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Auditoria de Navegação</h1>
          <p className="text-muted-foreground">
            Verificação de consistência entre itens do menu lateral e regras de permissões.
          </p>
        </div>
        <Button 
          onClick={runAudit} 
          disabled={isScanning}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
          Reexecutar Auditoria
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status Geral</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {issues.length === 0 ? (
                <>
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                  <span className="text-2xl font-bold">Saudável</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  <span className="text-2xl font-bold text-destructive">{issues.length} Issues</span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {lastScan ? `Último scan: ${lastScan.toLocaleTimeString()}` : 'Aguardando primeiro scan...'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Acesso Rápido</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" size="sm" asChild className="w-full justify-start">
              <Link to="/settings">
                <Settings className="h-4 w-4 mr-2 text-muted-foreground" />
                Permissões
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inconsistências Detectadas</CardTitle>
          <CardDescription>
            Abaixo estão listadas as rotas que apresentam divergência entre o menu e o mapeamento de módulos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-medium">Tudo certo!</h3>
              <p className="text-muted-foreground max-w-sm">
                Não foram encontradas inconsistências. Todos os itens de menu estão corretamente mapeados para seus respectivos módulos de permissão.
              </p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Tipo</th>
                    <th className="px-4 py-3 text-left font-medium">Item / Rota</th>
                    <th className="px-4 py-3 text-left font-medium">Descrição</th>
                    <th className="px-4 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {issues.map((issue, idx) => (
                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        <Badge variant={getIssueColor(issue.kind) as any} className="text-[10px] uppercase">
                          {issue.kind.replace(/-/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium">{'label' in issue ? issue.label : 'N/A'}</div>
                        <code className="text-xs text-muted-foreground bg-muted px-1 rounded">
                          {'path' in issue ? issue.path : ''}
                        </code>
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground leading-snug">
                        {describeIssue(issue)}
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <Button variant="ghost" size="icon" asChild>
                          <Link to="/settings" title="Corrigir em Permissões">
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800 flex gap-3">
        <Settings className="h-5 w-5 shrink-0 text-blue-500" />
        <div>
          <p className="font-semibold">Como corrigir?</p>
          <p className="mt-1">
            Vá para a tela de <strong>Permissões</strong> e certifique-se de que a rota em questão está incluída no objeto <code>ROUTE_MODULE_MAP</code> dentro de <code>src/hooks/useAccessControl.ts</code>. 
            Itens no menu que não estão mapeados ficarão invisíveis para usuários comuns.
          </p>
        </div>
      </div>
    </div>
  );
}