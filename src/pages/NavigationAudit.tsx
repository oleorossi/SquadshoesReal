import { useState, useEffect } from 'react';
import { Warning as AlertTriangle, CheckCircle as CheckCircle2, ArrowsClockwise as RefreshCw, Gear as Settings, ArrowLeft, ArrowSquareOut as ExternalLink, ShieldCheck } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  auditNavigation,
  describeIssue,
  type NavigationIssue
} from '@/lib/navigationAudit';
import { Badge } from '@/components/ui/badge';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';

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
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 h-8 px-2 mb-1">
          <Link to="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Link>
        </Button>
        <EditorialPageHeader
          sectionLabel="SISTEMA · AUDITORIA NAV"
          title="Auditoria de Navegação"
          description="Verificação de consistência entre itens do menu lateral e regras de permissões."
          actions={
            <Button
              onClick={runAudit}
              disabled={isScanning}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
              Reexecutar Auditoria
            </Button>
          }
        />
      </div>

      <StatGrid>
        <StatCard
          label="Status Geral"
          value={issues.length === 0 ? 'Saudável' : `${issues.length} Issues`}
          tone={issues.length === 0 ? 'success' : 'destructive'}
          icon={issues.length === 0 ? ShieldCheck : AlertTriangle}
          hint={lastScan ? `Último scan: ${lastScan.toLocaleTimeString()}` : 'Aguardando primeiro scan...'}
        />
      </StatGrid>

      <Panel
        eyebrow="SISTEMA · AUDITORIA"
        title="Inconsistências Detectadas"
        subtitle="Abaixo estão listadas as rotas que apresentam divergência entre o menu e o mapeamento de módulos."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings">
              <Settings className="h-4 w-4 mr-2 text-muted-foreground" />
              Permissões
            </Link>
          </Button>
        }
        flush={issues.length > 0}
      >
          {issues.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Tudo certo!"
              description="Não foram encontradas inconsistências. Todos os itens de menu estão corretamente mapeados para seus respectivos módulos de permissão."
            />
          ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr className="[&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <th className="px-4 py-3 text-left">Tipo</th>
                    <th className="px-4 py-3 text-left">Item / Rota</th>
                    <th className="px-4 py-3 text-left">Descrição</th>
                    <th className="px-4 py-3 text-right">Ações</th>
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
          )}
      </Panel>

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