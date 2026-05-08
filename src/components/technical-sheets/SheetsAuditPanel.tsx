import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardList, Search, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

type AuditRow = {
  id: string;
  code: string;
  name: string;
  status: string | null;
  missing_upper_material: boolean;
  missing_upper_consumption: boolean;
  missing_lining_material: boolean;
  missing_lining_consumption: boolean;
  missing_insole_material: boolean;
  missing_insole_consumption: boolean;
  missing_sole_material: boolean;
  missing_sole_consumption: boolean;
  sole_fachetado_sem_fachete: boolean;
  missing_sole_color_mapping: boolean;
  straps_without_colors: boolean;
  straps_without_group: boolean;
  missing_mod: boolean;
  upper_per_size_partial_no_fallback: boolean;
};

type AuditSummary = {
  total_fichas: number;
  fichas_100_completas: number;
  sem_grupo_cabedal: number;
  sem_consumo_cabedal: number;
  sem_grupo_forro: number;
  sem_consumo_forro: number;
  sem_grupo_palmilha: number;
  sem_consumo_palmilha: number;
  sem_grupo_solado: number;
  sem_consumo_solado: number;
  sem_cores_solado: number;
  fachetado_sem_fachete: number;
  tiras_sem_cores: number;
  tiras_sem_grupo: number;
  sem_mod_cadastrado: number;
};

const GAP_LABELS: { key: keyof AuditRow; label: string; severity: 'critical' | 'warn' }[] = [
  { key: 'missing_upper_material', label: 'Grupo do cabedal', severity: 'critical' },
  { key: 'missing_upper_consumption', label: 'Consumo do cabedal', severity: 'critical' },
  { key: 'missing_lining_material', label: 'Grupo do forro', severity: 'critical' },
  { key: 'missing_lining_consumption', label: 'Consumo do forro', severity: 'critical' },
  { key: 'missing_insole_material', label: 'Grupo da palmilha', severity: 'critical' },
  { key: 'missing_insole_consumption', label: 'Consumo da palmilha', severity: 'critical' },
  { key: 'missing_sole_material', label: 'Grupo do solado', severity: 'critical' },
  { key: 'missing_sole_consumption', label: 'Consumo do solado', severity: 'critical' },
  { key: 'missing_sole_color_mapping', label: 'Cores do solado', severity: 'warn' },
  { key: 'sole_fachetado_sem_fachete', label: 'Fachete (solado fachetado)', severity: 'warn' },
  { key: 'straps_without_colors', label: 'Tiras sem cores', severity: 'warn' },
  { key: 'straps_without_group', label: 'Tiras sem grupo', severity: 'warn' },
  { key: 'missing_mod', label: 'MOD (mão-de-obra)', severity: 'warn' },
  { key: 'upper_per_size_partial_no_fallback', label: 'Cabedal per-size parcial', severity: 'warn' },
];

function useSheetsAudit() {
  return useQuery({
    queryKey: ['sheets_audit'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_technical_sheets_audit' as any)
        .select('*')
        .order('code');
      if (error) throw error;
      return (data as any[]) as AuditRow[];
    },
  });
}

function useSheetsAuditSummary() {
  return useQuery({
    queryKey: ['sheets_audit_summary'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_technical_sheets_audit_summary' as any)
        .select('*')
        .single();
      if (error) throw error;
      return data as AuditSummary;
    },
  });
}

function getGapsForRow(row: AuditRow) {
  return GAP_LABELS.filter(g => row[g.key]);
}

export function SheetsAuditPanel({
  open, onOpenChange, onJumpToSheet,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onJumpToSheet: (sheetId: string) => void;
}) {
  const { data: rows = [], isLoading } = useSheetsAudit();
  const { data: summary } = useSheetsAuditSummary();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'complete' | 'critical'>('incomplete');

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === 'incomplete') r = r.filter(row => getGapsForRow(row).length > 0);
    else if (filter === 'complete') r = r.filter(row => getGapsForRow(row).length === 0);
    else if (filter === 'critical') r = r.filter(row =>
      getGapsForRow(row).some(g => g.severity === 'critical')
    );
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      r = r.filter(row => row.code?.toLowerCase().includes(q) || row.name?.toLowerCase().includes(q));
    }
    return r;
  }, [rows, filter, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            Auditoria de Fichas Técnicas
          </DialogTitle>
        </DialogHeader>

        {/* KPIs do resumo */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Total de fichas</p>
              <p className="text-xl font-bold tabular-nums mt-1">{summary.total_fichas}</p>
            </div>
            <div className="rounded-lg border bg-emerald-500/10 border-emerald-500/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">100% completas</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-emerald-700">
                {summary.fichas_100_completas} / {summary.total_fichas}
              </p>
            </div>
            <div className="rounded-lg border bg-red-500/10 border-red-500/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-red-700 font-semibold">Sem cabedal</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-red-700">
                {summary.sem_consumo_cabedal}
              </p>
              <p className="text-[10px] text-muted-foreground">consumo / {summary.sem_grupo_cabedal} grupo</p>
            </div>
            <div className="rounded-lg border bg-red-500/10 border-red-500/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-red-700 font-semibold">Sem MOD</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-red-700">
                {summary.sem_mod_cadastrado}
              </p>
              <p className="text-[10px] text-muted-foreground">não tem operação cadastrada</p>
            </div>
          </div>
        )}

        {/* Outros KPIs em linha mais compacta */}
        {summary && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-1 text-[11px]">
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">Forro: </span>
              <strong>{summary.sem_consumo_forro}</strong>
              <span className="text-muted-foreground"> / </span>
              <strong>{summary.sem_grupo_forro}</strong>
            </div>
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">Palmilha: </span>
              <strong>{summary.sem_consumo_palmilha}</strong>
              <span className="text-muted-foreground"> / </span>
              <strong>{summary.sem_grupo_palmilha}</strong>
            </div>
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">Solado: </span>
              <strong>{summary.sem_consumo_solado}</strong>
              <span className="text-muted-foreground"> / </span>
              <strong>{summary.sem_grupo_solado}</strong>
            </div>
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">S/ cores solado: </span>
              <strong>{summary.sem_cores_solado}</strong>
            </div>
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">Fachetado s/ fachete: </span>
              <strong>{summary.fachetado_sem_fachete}</strong>
            </div>
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">Tiras s/ cor: </span>
              <strong>{summary.tiras_sem_cores}</strong>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="flex items-center gap-3 mt-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
            <TabsList>
              <TabsTrigger value="incomplete" className="text-xs">Incompletas</TabsTrigger>
              <TabsTrigger value="critical" className="text-xs">Críticas</TabsTrigger>
              <TabsTrigger value="complete" className="text-xs">100% OK</TabsTrigger>
              <TabsTrigger value="all" className="text-xs">Todas</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Código ou nome…" value={search}
              onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8 text-xs" />
          </div>
        </div>

        {/* Lista */}
        {isLoading ? (
          <p className="text-center py-12 text-muted-foreground">Carregando…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2">
            <CheckCircle2 className="h-8 w-8 opacity-30" />
            <p>Nenhuma ficha pra mostrar com esse filtro.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(row => {
              const gaps = getGapsForRow(row);
              const hasCritical = gaps.some(g => g.severity === 'critical');
              return (
                <div
                  key={row.id}
                  className={cn(
                    'rounded-lg border p-3 cursor-pointer transition hover:bg-muted/40',
                    gaps.length === 0 ? 'bg-emerald-500/5 border-emerald-500/30'
                    : hasCritical ? 'bg-red-500/5 border-red-500/30'
                    : 'bg-amber-500/5 border-amber-500/30',
                  )}
                  onClick={() => { onJumpToSheet(row.id); onOpenChange(false); }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{row.code}</span>
                        <span className="text-xs text-muted-foreground truncate">{row.name}</span>
                        {row.status && (
                          <Badge variant="outline" className="text-[9px] h-4">{row.status}</Badge>
                        )}
                      </div>
                      {gaps.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {gaps.map(g => (
                            <Badge
                              key={g.key}
                              variant="outline"
                              className={cn(
                                'text-[10px] gap-1',
                                g.severity === 'critical'
                                  ? 'bg-red-500/10 text-red-700 border-red-500/40'
                                  : 'bg-amber-500/10 text-amber-700 border-amber-500/40',
                              )}
                            >
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {g.label}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/40 mt-2 text-[10px] gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Ficha 100% completa
                        </Badge>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Botão pra abrir o painel de auditoria — pode ir em qualquer toolbar. */
export function SheetsAuditButton({ onJumpToSheet }: { onJumpToSheet: (sheetId: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: summary } = useSheetsAuditSummary();
  const incomplete = summary ? summary.total_fichas - summary.fichas_100_completas : 0;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 h-8"
      >
        <ClipboardList className="h-3.5 w-3.5" />
        Auditoria
        {incomplete > 0 && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/40 text-[9px] h-4 px-1.5 ml-1">
            {incomplete}
          </Badge>
        )}
      </Button>
      <SheetsAuditPanel open={open} onOpenChange={setOpen} onJumpToSheet={onJumpToSheet} />
    </>
  );
}
