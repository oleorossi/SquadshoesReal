import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Warning as AlertTriangle, CheckCircle as CheckCircle2, ClipboardText as ClipboardList, MagnifyingGlass as Search, CaretRight as ChevronRight } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { normalizeForSearch } from '@/lib/searchUtils';

type AuditRow = {
  id: string;
  code: string;
  name: string;
  status: string | null;
  sole_drives_consumption: boolean;
  missing_upper_material: boolean;
  missing_upper_consumption: boolean;
  missing_lining_material: boolean;
  missing_lining_consumption: boolean;
  missing_insole_material: boolean;
  missing_insole_consumption: boolean;
  missing_sole_material: boolean;
  missing_sole_consumption: boolean;
  sole_fachetado_sem_fachete: boolean;
  sole_driven_but_specs_missing: boolean;
  missing_sole_color_mapping: boolean;
  straps_without_colors: boolean;
  straps_without_group: boolean;
  missing_mod: boolean;
  upper_per_size_partial_no_fallback: boolean;
  missing_production_sectors: boolean;
};

type SoleAuditRow = {
  sole_id: string;
  sole_name: string;
  sole_color: string | null;
  sole_sku: string | null;
  is_fachetado: boolean;
  sheets_using: number;
  sizes_with_specs_total: number;
  sizes_with_lining: number;
  sizes_with_insole: number;
  sizes_with_fachete: number;
  missing_lining_specs: boolean;
  missing_insole_specs: boolean;
  fachetado_missing_fachete_specs: boolean;
  drives_consumption_but_no_specs: boolean;
};

type AuditSummary = {
  total_fichas: number;
  fichas_100_completas: number;
  fichas_sole_driven: number;
  sole_driven_sem_specs: number;
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
  sem_setores_producao: number;
};

const GAP_LABELS: { key: keyof AuditRow; label: string; severity: 'critical' | 'warn' }[] = [
  { key: 'missing_upper_material', label: 'Grupo do cabedal', severity: 'critical' },
  { key: 'missing_upper_consumption', label: 'Consumo do cabedal', severity: 'critical' },
  { key: 'missing_lining_material', label: 'Grupo da forração', severity: 'critical' },
  { key: 'missing_lining_consumption', label: 'Consumo da forração', severity: 'critical' },
  { key: 'missing_insole_material', label: 'Grupo da palmilha', severity: 'critical' },
  { key: 'missing_insole_consumption', label: 'Consumo da palmilha', severity: 'critical' },
  { key: 'missing_sole_material', label: 'Grupo do solado', severity: 'critical' },
  { key: 'missing_sole_consumption', label: 'Consumo do solado', severity: 'critical' },
  { key: 'sole_driven_but_specs_missing', label: 'Solado dirige consumo mas não tem specs', severity: 'critical' },
  { key: 'missing_sole_color_mapping', label: 'Cores do solado', severity: 'warn' },
  { key: 'sole_fachetado_sem_fachete', label: 'Fachete (solado fachetado)', severity: 'warn' },
  { key: 'straps_without_colors', label: 'Tiras sem cores', severity: 'warn' },
  { key: 'straps_without_group', label: 'Tiras sem grupo', severity: 'warn' },
  { key: 'missing_mod', label: 'MOD (mão-de-obra)', severity: 'warn' },
  { key: 'upper_per_size_partial_no_fallback', label: 'Cabedal per-size parcial', severity: 'warn' },
  { key: 'missing_production_sectors', label: 'Setores de produção não configurados', severity: 'critical' },
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
      return data as unknown as AuditSummary;
    },
  });
}

function useSolesAudit() {
  return useQuery({
    queryKey: ['soles_audit'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_soles_audit' as any)
        .select('*')
        .order('drives_consumption_but_no_specs', { ascending: false })
        .order('sole_name');
      if (error) throw error;
      return (data as any[]) as SoleAuditRow[];
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
  const { data: solesAudit = [], isLoading: solesLoading } = useSolesAudit();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'complete' | 'critical'>('incomplete');
  const [tab, setTab] = useState<'sheets' | 'soles'>('sheets');

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === 'incomplete') r = r.filter(row => getGapsForRow(row).length > 0);
    else if (filter === 'complete') r = r.filter(row => getGapsForRow(row).length === 0);
    else if (filter === 'critical') r = r.filter(row =>
      getGapsForRow(row).some(g => g.severity === 'critical')
    );
    if (search.trim()) {
      const q = normalizeForSearch(search);
      r = r.filter(row => normalizeForSearch(row.code).includes(q) || normalizeForSearch(row.name).includes(q));
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
          <DialogDescription className="sr-only">
            Pendências de cadastro por ficha técnica e por solado.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="sheets" className="text-xs">
              Fichas Técnicas
              {summary && (summary.total_fichas - summary.fichas_100_completas) > 0 && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/40 text-xs h-4 px-1.5 ml-2">
                  {summary.total_fichas - summary.fichas_100_completas}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="soles" className="text-xs">
              Solados
              {solesAudit.filter(s => s.missing_lining_specs || s.missing_insole_specs || s.fachetado_missing_fachete_specs).length > 0 && (
                <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/40 text-xs h-4 px-1.5 ml-2">
                  {solesAudit.filter(s => s.missing_lining_specs || s.missing_insole_specs || s.fachetado_missing_fachete_specs).length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'soles' ? (
          <div className="space-y-3 mt-2">
            <p className="text-xs text-muted-foreground">
              <strong>Solado é o driver primário do consumo</strong> — quando uma ficha tem
              "Solado dirige consumo", os valores de forração/palmilha vêm das specs do solado.
              Se aqui o solado não tiver specs, o cálculo cai em fallback (média da ficha) e
              fica impreciso. Cadastre as specs por tamanho na página do produto-solado.
            </p>
            {solesLoading ? (
              <p className="text-center py-12 text-muted-foreground">Carregando…</p>
            ) : solesAudit.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2">
                <CheckCircle2 className="h-8 w-8 opacity-30" />
                <p>Nenhum solado em uso por fichas técnicas.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {solesAudit.map(sole => {
                  const isProblem = sole.missing_lining_specs || sole.missing_insole_specs || sole.fachetado_missing_fachete_specs;
                  const isCritical = sole.drives_consumption_but_no_specs;
                  return (
                    <div
                      key={sole.sole_id}
                      className={cn(
                        'rounded-lg border p-3',
                        isCritical ? 'bg-red-500/5 border-red-500/30'
                        : isProblem ? 'bg-amber-500/5 border-amber-500/30'
                        : 'bg-emerald-500/5 border-emerald-500/30',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm">{sole.sole_name}</span>
                            {sole.sole_color && <Badge variant="outline" className="text-xs h-4">{sole.sole_color}</Badge>}
                            {sole.is_fachetado && (
                              <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/40 text-xs h-4">
                                fachetado
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {sole.sheets_using} {sole.sheets_using === 1 ? 'ficha usando' : 'fichas usando'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2 text-xs">
                            <Badge variant="outline" className={sole.missing_lining_specs ? 'bg-red-500/10 text-red-700 border-red-500/40' : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/40'}>
                              Forração: {sole.sizes_with_lining} tamanho{sole.sizes_with_lining !== 1 ? 's' : ''}
                            </Badge>
                            <Badge variant="outline" className={sole.missing_insole_specs ? 'bg-red-500/10 text-red-700 border-red-500/40' : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/40'}>
                              Palmilha: {sole.sizes_with_insole}
                            </Badge>
                            {sole.is_fachetado && (
                              <Badge variant="outline" className={sole.fachetado_missing_fachete_specs ? 'bg-red-500/10 text-red-700 border-red-500/40' : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/40'}>
                                Fachete: {sole.sizes_with_fachete}
                              </Badge>
                            )}
                            {sole.drives_consumption_but_no_specs && (
                              <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/40 gap-1">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Driver de consumo SEM specs
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <SheetsAuditTab
            rows={rows}
            isLoading={isLoading}
            search={search}
            setSearch={setSearch}
            filter={filter}
            setFilter={setFilter}
            summary={summary}
            onJumpToSheet={(id) => { onJumpToSheet(id); onOpenChange(false); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SheetsAuditTab({
  rows, isLoading, search, setSearch, filter, setFilter, summary, onJumpToSheet,
}: {
  rows: AuditRow[];
  isLoading: boolean;
  search: string;
  setSearch: (v: string) => void;
  filter: 'all' | 'incomplete' | 'complete' | 'critical';
  setFilter: (v: 'all' | 'incomplete' | 'complete' | 'critical') => void;
  summary: AuditSummary | undefined;
  onJumpToSheet: (id: string) => void;
}) {
  const filtered = useMemo(() => {
    let r = rows;
    if (filter === 'incomplete') r = r.filter(row => getGapsForRow(row).length > 0);
    else if (filter === 'complete') r = r.filter(row => getGapsForRow(row).length === 0);
    else if (filter === 'critical') r = r.filter(row =>
      getGapsForRow(row).some(g => g.severity === 'critical')
    );
    if (search.trim()) {
      const q = normalizeForSearch(search);
      r = r.filter(row => normalizeForSearch(row.code).includes(q) || normalizeForSearch(row.name).includes(q));
    }
    return r;
  }, [rows, filter, search]);

  return (
    <>
        {/* KPIs do resumo */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Total de fichas</p>
              <p className="display text-xl tabular-nums mt-1">{summary.total_fichas}</p>
            </div>
            <div className="rounded-lg border bg-emerald-500/10 border-emerald-500/40 p-3">
              <p className="text-xs uppercase tracking-wider text-emerald-700 font-semibold">100% completas</p>
              <p className="display text-xl tabular-nums mt-1 text-emerald-700">
                {summary.fichas_100_completas} / {summary.total_fichas}
              </p>
            </div>
            <div className="rounded-lg border bg-red-500/10 border-red-500/40 p-3">
              <p className="text-xs uppercase tracking-wider text-red-700 font-semibold">Sem cabedal</p>
              <p className="display text-xl tabular-nums mt-1 text-red-700">
                {summary.sem_consumo_cabedal}
              </p>
              <p className="text-xs text-muted-foreground">consumo / {summary.sem_grupo_cabedal} grupo</p>
            </div>
            <div className="rounded-lg border bg-red-500/10 border-red-500/40 p-3">
              <p className="text-xs uppercase tracking-wider text-red-700 font-semibold">Sem MOD</p>
              <p className="display text-xl tabular-nums mt-1 text-red-700">
                {summary.sem_mod_cadastrado}
              </p>
              <p className="text-xs text-muted-foreground">não tem operação cadastrada</p>
            </div>
          </div>
        )}

        {/* Outros KPIs em linha mais compacta */}
        {summary && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-1 text-xs">
            <div className="rounded bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">Forração: </span>
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
                  onClick={() => onJumpToSheet(row.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{row.code}</span>
                        <span className="text-xs text-muted-foreground truncate">{row.name}</span>
                        {row.status && (
                          <Badge variant="outline" className="text-xs h-4">{row.status}</Badge>
                        )}
                        {row.sole_drives_consumption && (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/40 text-xs h-4">
                            sole-driven
                          </Badge>
                        )}
                      </div>
                      {gaps.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {gaps.map(g => (
                            <Badge
                              key={g.key}
                              variant="outline"
                              className={cn(
                                'text-xs gap-1',
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
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/40 mt-2 text-xs gap-1">
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
    </>
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
          <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/40 text-xs h-4 px-1.5 ml-1">
            {incomplete}
          </Badge>
        )}
      </Button>
      <SheetsAuditPanel open={open} onOpenChange={setOpen} onJumpToSheet={onJumpToSheet} />
    </>
  );
}
