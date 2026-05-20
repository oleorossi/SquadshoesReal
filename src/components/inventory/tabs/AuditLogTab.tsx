import { useState } from 'react';
import { CircleNotch as Loader2, MagnifyingGlass as Search, ArrowUUpLeft as Undo2, Plus, PencilSimple as Pencil, Trash as Trash2 } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useAuditLog, useRevertAuditEntry } from '@/hooks/useAuditLog';
import { useIsAdmin } from '@/hooks/useUserManagement';

const ACTION_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  created: { label: 'Criado', icon: Plus, className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400' },
  updated: { label: 'Editado', icon: Pencil, className: 'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400' },
  deleted: { label: 'Excluído', icon: Trash2, className: 'bg-destructive/15 text-destructive border-destructive/30' },
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  quantity: 'Quantidade',
  unit_price: 'Preço Unit.',
  category: 'Categoria',
  color: 'Cor',
  min_stock: 'Est. Mínimo',
  active: 'Ativo',
};

function ChangesCell({ changes }: { changes: Record<string, { old: any; new: any }> | null }) {
  if (!changes || Object.keys(changes).length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="space-y-0.5 text-xs max-w-[280px]">
      {Object.entries(changes).map(([field, val]) => (
        <div key={field} className="flex gap-1 flex-wrap">
          <span className="font-medium">{FIELD_LABELS[field] || field}:</span>
          <span className="text-destructive line-through">{String(val.old ?? '—')}</span>
          <span>→</span>
          <span className="text-emerald-600 dark:text-emerald-400">{String(val.new ?? '—')}</span>
        </div>
      ))}
    </div>
  );
}

export default function AuditLogTab() {
  const isAdmin = useIsAdmin();
  const [search, setSearch] = useState('');
  const { data: logs = [], isLoading } = useAuditLog(search, isAdmin);
  const revert = useRevertAuditEntry();

  if (!isAdmin) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por material, SKU ou usuário..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Registros dos últimos 15 dias ({logs.length} resultados)
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Nenhum registro encontrado
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="font-semibold">Data/Hora</TableHead>
                <TableHead className="font-semibold">Ação</TableHead>
                <TableHead className="font-semibold">Material</TableHead>
                <TableHead className="font-semibold">SKU</TableHead>
                <TableHead className="font-semibold">Alterações</TableHead>
                <TableHead className="font-semibold">Usuário</TableHead>
                <TableHead className="font-semibold text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const config = ACTION_CONFIG[log.action] || ACTION_CONFIG.updated;
                const Icon = config.icon;
                return (
                  <TableRow key={log.id} className={log.reversed ? 'opacity-50' : ''}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${config.className}`}>
                        <Icon className="h-3 w-3 mr-1" />
                        {config.label}
                      </Badge>
                      {log.reversed && (
                        <Badge variant="secondary" className="ml-1 text-xs">
                          Revertido
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{log.product_name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {log.product_sku || '—'}
                    </TableCell>
                    <TableCell>
                      <ChangesCell changes={log.changes} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.user_email || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {!log.reversed && log.product_id && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="gap-1 text-xs">
                              <Undo2 className="h-3.5 w-3.5" />
                              Reverter
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirmar reversão?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Isso irá desfazer a ação "{config.label}" no material "{log.product_name}".
                                Esta operação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => revert.mutate(log)}
                                disabled={revert.isPending}
                              >
                                Confirmar
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
