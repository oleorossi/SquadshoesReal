import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Check, CaretUpDown as ChevronsUpDown, CircleNotch as Loader2, Warning as AlertTriangle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn, getSoleModelName } from '@/lib/utils';
import { normalizeForSearch, searchMatchesAllTerms } from '@/lib/searchUtils';

/**
 * Seletores de cadastro da Ficha Tecnica.
 *
 * Extraidos de `src/pages/TechnicalSheets.tsx` em 10/08/2026 — a pagina tinha
 * 7.297 linhas e 25 componentes definidos dentro do proprio arquivo, o que
 * fazia de qualquer ajuste um exercicio de achar onde mexer.
 *
 * Estes 7 vieram primeiro porque sao os unicos com superficie ZERO: nenhum
 * referencia simbolo de modulo da pagina — nem helper, nem constante, nem
 * estado. So props e imports. Foi transporte, nao refatoracao: o corpo de cada
 * um esta identico ao que era.
 *
 * ⚠ Os que NAO vieram (SheetDetail, SheetBOM, CostsTab, PhotosByColorTab…)
 * dependem de estado e helpers do escopo da pagina. Extrai-los exige DESENHAR
 * a fronteira antes — enfiar 20 props num componente e pior que o monolito.
 */

/* ===== Component Group Select (for Cores tab — selects group and shows available colors) ===== */

export function ComponentGroupSelect({ label, value, onChange, groups, products, required }: {
  label: string; value: string | null; onChange: (v: string | null) => void;
  groups: any[]; products: any[]; required?: boolean;
}) {
  const availableColors = useMemo(() => {
    if (!value) return [];
    const groupProducts = products.filter((p: any) => p.active && p.group_id === value);
    const colors = new Set<string>();
    groupProducts.forEach((p: any) => {
      if (p.color?.trim()) {
        p.color.split(',').forEach((c: string) => {
          const t = c.trim();
          if (t) colors.add(t);
        });
      }
    });
    return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [value, products]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}{required && ' *'}</Label>
      <Select value={value || 'none'} onValueChange={v => onChange(v === 'none' ? null : v)}>
        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Selecionar grupo..." /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— Nenhum —</SelectItem>
          {groups.map((g: any) => (
            <SelectItem key={g.id} value={g.id} className="text-xs">{g.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {availableColors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          <span className="text-xs text-muted-foreground mr-1">Cores disponíveis:</span>
          {availableColors.map(c => (
            <Badge key={c} variant="outline" className="text-xs h-5">{c}</Badge>
          ))}
        </div>
      )}
      {value && availableColors.length === 0 && (
        <p className="text-xs text-warning mt-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Nenhuma cor cadastrada neste grupo
        </p>
      )}
    </div>
  );
}

/* ===== Group Material Select — seleciona o tipo de material (grupo) ===== */
export function GroupMaterialSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { data: groups = [] } = useQuery({
    queryKey: ['product_groups_select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('product_groups').select('id, name, description').order('name');
      if (error) throw error;
      return data;
    },
  });
  // Produtos (SKU/cor) por grupo — permite ACHAR o material por SKU ou cor (não só
  // pelo nome do grupo) e mostrar quantos produtos/cores cada grupo tem.
  // Auditoria 2026-06-28: o caso "T32121-PALHA" não aparecia porque a busca só
  // casava nome/descrição do grupo.
  const { data: groupProducts = [] } = useQuery({
    queryKey: ['products_for_group_select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('group_id, name, sku, color, active').eq('active', true);
      if (error) throw error;
      return data ?? [];
    },
  });
  const groupIndex = useMemo(() => {
    const map: Record<string, { count: number; colors: Set<string>; blob: string }> = {};
    for (const p of groupProducts as any[]) {
      if (!p.group_id) continue;
      const e = map[p.group_id] || (map[p.group_id] = { count: 0, colors: new Set<string>(), blob: '' });
      e.count++;
      if (p.color?.trim()) e.colors.add(p.color.trim());
      e.blob += ' ' + normalizeForSearch([p.name, p.sku, p.color].filter(Boolean).join(' '));
    }
    return map;
  }, [groupProducts]);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    return groups.filter((g: any) =>
      searchMatchesAllTerms(search, g.name, g.description, groupIndex[g.id]?.blob));
  }, [groups, search, groupIndex]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="mt-1 h-9 w-full justify-between text-sm font-normal">
            {value || 'Selecionar material...'}
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar por grupo, SKU ou cor..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>Nenhum grupo encontrado</CommandEmpty>
              <CommandGroup heading={`Grupos disponíveis (${filtered.length})`}>
                {filtered.map((g: any) => {
                  const idx = groupIndex[g.id];
                  return (
                    <CommandItem key={g.id} value={g.id} onSelect={() => { onChange(g.name); setOpen(false); setSearch(''); }}>
                      <Check className={cn("mr-2 h-4 w-4", value === g.name ? "opacity-100" : "opacity-0")} />
                      <div className="flex flex-col">
                        <span className="text-sm">{g.name}</span>
                        {idx ? (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {idx.count} produto{idx.count !== 1 ? 's' : ''}{idx.colors.size > 0 ? ` · ${idx.colors.size} cor${idx.colors.size !== 1 ? 'es' : ''}` : ''}
                          </span>
                        ) : g.description ? (
                          <span className="text-xs text-muted-foreground">{g.description}</span>
                        ) : null}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ===== Sole Classification Badge =====
 * Mostra o tipo do solado (tradicional/palmilha_pronta/conjugado) + número
 * de conjugações/coligações cadastradas, ajudando o usuário a saber se o
 * solado está totalmente configurado.
 */
export function SoleClassificationBadge({ groupId, soleMaterial, process, products }: {
  groupId: string;
  soleMaterial: string;
  process: string;
  products: any[];
}) {
  // Pega a classificação do produto específico (não agrega o grupo — pode ter
  // variantes com tipos diferentes em teoria, embora a recomendação seja
  // separar em grupos próprios).
  const matchedProduct = products.find(p => {
    if (p.group_id !== groupId) return false;
    const n = (p.name || '').toLowerCase().trim();
    const m = (soleMaterial || '').toLowerCase().trim();
    return n === m || n.startsWith(m + ' ') || n.startsWith(m + '-');
  });
  const classification = (matchedProduct as any)?.sole_classification || 'tradicional';

  // Query auxiliar pra contar conjugações/coligações
  const { data: extras } = useQuery({
    queryKey: ['sole_extras', groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { count: conjCount } = await supabase
        .from('sole_size_conjugations')
        .select('id', { count: 'exact', head: true })
        .eq('sole_group_id', groupId);
      return { conjCount: conjCount || 0 };
    },
    staleTime: 5 * 60_000,
  });

  const styles = {
    tradicional: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', fg: 'text-emerald-700 dark:text-emerald-400', label: 'TRADICIONAL', hint: 'Cada número individual · palmilha cortada (dm²)' },
    palmilha_pronta: { bg: 'bg-violet-50 dark:bg-violet-950/30', border: 'border-violet-200 dark:border-violet-800', fg: 'text-violet-700 dark:text-violet-400', label: 'PALMILHA PRONTA', hint: 'Palmilha em un · coligação cor cabedal → palmilha' },
    conjugado: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800', fg: 'text-amber-700 dark:text-amber-400', label: 'CONJUGADO', hint: 'Algumas numerações agrupadas (ex.: 33/34)' },
  } as const;
  const s = styles[classification as keyof typeof styles] || styles.tradicional;

  return (
    <div className={`p-3 rounded-md border-2 ${s.bg} ${s.border}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <Check className={`h-3.5 w-3.5 ${s.fg}`} />
        <span className={`text-xs font-bold uppercase tracking-wider ${s.fg}`}>{s.label}</span>
        <span className="text-xs font-medium text-foreground">
          {soleMaterial}{process && ` • ${process}`}
        </span>
        {classification === 'conjugado' && extras && (
          <Badge variant="outline" className="text-xs h-5">
            {extras.conjCount} conjugação{extras.conjCount !== 1 ? 'ões' : ''} cadastrada{extras.conjCount !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>
      <p className={`text-xs mt-1 ${s.fg} opacity-80`}>{s.hint}</p>
      {classification === 'conjugado' && extras?.conjCount === 0 && (
        <p className="text-xs mt-1 text-destructive font-semibold">
          ⚠ Nenhuma conjugação cadastrada — configure em Solados → editar este solado → aba Conjugações.
        </p>
      )}
    </div>
  );
}

/* ===== Sole Product Select (products from Solado groups — color-independent) ===== */
export function StrapGroupCombobox({ value, groups, onChange }: {
  value: string;
  groups: any[];
  onChange: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = groups.find((g: any) => g.id === value);
  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    return groups.filter((g: any) => searchMatchesAllTerms(search, g.name));
  }, [groups, search]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className="w-[200px] h-8 px-2 text-xs font-normal justify-between">
          <span className="truncate">{selected?.name || 'Grupo de material...'}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar tira/material..." value={search} onValueChange={setSearch} className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
            <CommandGroup>
              {filtered.map((g: any) => (
                <CommandItem key={g.id} value={g.id} onSelect={() => { onChange(g.id); setOpen(false); setSearch(''); }} className="text-xs">
                  <Check className={cn('mr-2 h-3.5 w-3.5', value === g.id ? 'opacity-100' : 'opacity-0')} />
                  {g.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SoleProductSelect({ label, value, onChange }: { label: string; value: string; onChange: (productName: string, groupId: string | null, productId?: string) => void }) {
  const { data: soleModels = [] } = useQuery({
    queryKey: ['products_solado_groups_unified'],
    queryFn: async () => {
      // Antes filtrava product_groups por nome ILIKE '%solado%' — perdia grupos
      // como "SALTINHO BLOCO" cujo nome não contém 'solado'. Filtra direto pela
      // categoria do produto pra cobrir todos os saltos/solados, independente
      // do nome do grupo.
      // Qualificador explícito do FK (products_group_id_fkey) evita
      // "more than one relationship was found" se o schema cache do
      // PostgREST estiver stale ou alguma FK secundária for adicionada.
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, color, group_id, unit_price, quantity, product_groups!products_group_id_fkey(id, name)')
        .ilike('category', '%solado%')
        .eq('active', true)
        .order('name');
      if (error) throw error;

      // Deduplicate by base model — sole is color-independent
      const normalizeBaseName = (name: string, color?: string | null): string => {
        return getSoleModelName(name, color).toLowerCase();
      };

      const modelMap = new Map<string, { id: string; name: string; group_id: string; groupName: string; totalStock: number; primaryStock: number; variantCount: number; sku: string | null }>();
      (data || []).forEach((p: any) => {
        const key = normalizeBaseName(p.name, p.color);
        const groupName = (p.product_groups?.name as string | undefined) || '';
        const displayName = getSoleModelName(p.name, p.color);
        const existing = modelMap.get(key);
        if (existing) {
          const stock = Number(p.quantity || 0);
          existing.totalStock += stock;
          existing.variantCount += 1;
          // O UUID salvo na ficha é o fallback do motor de consumo. Entre as
          // variantes de cor do mesmo modelo, escolhe uma variante ativa e
          // operacional, em vez de depender da ordem arbitrária do SELECT.
          if (stock > existing.primaryStock) {
            existing.id = p.id;
            existing.sku = p.sku;
            existing.primaryStock = stock;
          }
        } else {
          modelMap.set(key, {
            id: p.id,
            name: displayName,
            group_id: p.group_id,
            groupName,
            totalStock: Number(p.quantity || 0),
            primaryStock: Number(p.quantity || 0),
            variantCount: 1,
            sku: p.sku,
          });
        }
      });
      return Array.from(modelMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return soleModels;
    return soleModels.filter((m) => searchMatchesAllTerms(search, m.name, m.sku, m.groupName));
  }, [soleModels, search]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="mt-1 h-9 w-full justify-between text-sm font-normal">
            {value || 'Selecionar solado...'}
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar solado..." value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>Nenhum solado encontrado nos grupos de solado.</CommandEmpty>
              <CommandGroup heading={`Modelos de solado (${filtered.length})`}>
                {filtered.map((m) => (
                  <CommandItem key={m.id} value={m.id} onSelect={() => { onChange(m.name, m.group_id, m.id); setOpen(false); setSearch(''); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === m.name ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.groupName} • {m.variantCount} cor{m.variantCount !== 1 ? 'es' : ''} • Estoque total: {m.totalStock.toLocaleString('pt-BR')}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function DirectComponentSelect({ label, value, onChange }: { label: string; value: string; onChange: (productId: string, productName: string, unitPrice: number, unit: string) => void }) {
  const { data: products = [] } = useQuery({
    queryKey: ['products_direct_components_all'],
    queryFn: async () => {
      // Trazemos tudo que está ativo. Solados/cabedais/forrações/palmilhas/tiras
      // têm os próprios seletores em outras seções, mas alguns usuários cadastram
      // acessórios na mesma categoria, então NÃO filtramos por category aqui —
      // a busca por nome já cobre.
      const { data, error } = await supabase
        .from('products')
        .select('id, name, sku, unit_price, unit, color, group_id, product_groups!products_group_id_fkey(name)')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        groupName: (p.product_groups?.name || '').toString(),
      }));
    },
  });
  // Fluxo grupo → item: primeiro escolhe o GRUPO, depois o ITEM daquele grupo.
  // Assim o débito usa o product_id exato (direct_components debita por product_id).
  const groups = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products as any[]) {
      if (p.group_id && p.groupName && !m.has(p.group_id)) m.set(p.group_id, p.groupName);
    }
    return Array.from(m, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }, [products]);

  const selected = (products as any[]).find((p: any) => p.id === value);
  // Sem override, o grupo segue o produto já selecionado (edição de ficha existente).
  const [groupOverride, setGroupOverride] = useState<string | null>(null);
  const effectiveGroupId = groupOverride !== null ? groupOverride : (selected?.group_id || '');
  const effectiveGroupName = groups.find(g => g.id === effectiveGroupId)?.name || '';

  const itemsOfGroup = useMemo(
    () => (products as any[]).filter((p: any) => p.group_id === effectiveGroupId),
    [products, effectiveGroupId],
  );

  const [groupOpen, setGroupOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [itemOpen, setItemOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');

  const filteredGroups = useMemo(() => {
    if (!groupSearch.trim()) return groups;
    return groups.filter(g => searchMatchesAllTerms(groupSearch, g.name));
  }, [groups, groupSearch]);

  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return itemsOfGroup;
    return itemsOfGroup.filter((p: any) => searchMatchesAllTerms(itemSearch, p.name, p.sku, p.color));
  }, [itemsOfGroup, itemSearch]);

  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {/* Passo 1 — Grupo */}
      <Popover open={groupOpen} onOpenChange={setGroupOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={groupOpen} className="mt-1 h-9 w-full justify-between text-sm font-normal">
            <span className="truncate">{effectiveGroupName || '1) Selecionar grupo...'}</span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar grupo..." value={groupSearch} onValueChange={setGroupSearch} />
            <CommandList>
              <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
              <CommandGroup heading={`Grupos (${filteredGroups.length})`}>
                {filteredGroups.map(g => (
                  <CommandItem key={g.id} value={g.id} onSelect={() => {
                    setGroupOverride(g.id);
                    // trocar de grupo invalida um item selecionado de outro grupo
                    if (selected && selected.group_id !== g.id) onChange('', '', 0, 'un');
                    setGroupOpen(false); setGroupSearch('');
                  }}>
                    <Check className={cn("mr-2 h-4 w-4", effectiveGroupId === g.id ? "opacity-100" : "opacity-0")} />
                    <span className="text-sm">{g.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {/* Passo 2 — Item do grupo (habilita só após escolher o grupo) */}
      <Popover open={itemOpen} onOpenChange={(o) => { if (o && !effectiveGroupId) return; setItemOpen(o); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={itemOpen} disabled={!effectiveGroupId}
            className="mt-1 h-9 w-full justify-between text-sm font-normal">
            <span className="truncate">
              {selected ? `${selected.name}${selected.color ? ` (${selected.color})` : ''}` : (effectiveGroupId ? '2) Selecionar item...' : '2) Escolha o grupo primeiro')}
            </span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[350px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Buscar item por nome, SKU ou cor..." value={itemSearch} onValueChange={setItemSearch} />
            <CommandList>
              <CommandEmpty>Nenhum item ativo nesse grupo.</CommandEmpty>
              <CommandGroup heading={`Itens do grupo (${filteredItems.length})`}>
                {filteredItems.map((p: any) => (
                  <CommandItem key={p.id} value={p.id} onSelect={() => { onChange(p.id, p.name, Number(p.unit_price || 0), (p.unit || 'un').toString().trim() || 'un'); setItemOpen(false); setItemSearch(''); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span className="text-sm">
                        {p.name} {p.color ? `(${p.color})` : ''}
                        <span className="text-xs text-muted-foreground font-mono ml-1">[{p.unit || 'un'}]</span>
                      </span>
                      {p.sku && <span className="text-xs text-muted-foreground font-mono">{p.sku}</span>}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ===== BOM / Materials ===== */
/**
 * Editor inline de NCM por produto.
 * - Validação leve: 8 dígitos + capítulo NCM válido (01-99 — captulos com 00,
 *   98, 99 são reservados e geralmente bloqueiam emissão)
 * - Mostra histórico das últimas 3 mudanças (audit log via ncm_change_log)
 * - Atualiza products.ncm direto, trigger DB grava no log automaticamente
 */
export function NcmInlineEditor({ productId, currentNcm }: { productId: string; currentNcm: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentNcm);

  useEffect(() => { if (open) setValue(currentNcm); }, [open, currentNcm]);

  // Histórico de mudanças (carregado só quando o popover abre)
  const { data: history = [] } = useQuery({
    queryKey: ['ncm_change_log', productId],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('ncm_change_log')
        .select('old_ncm, new_ncm, changed_at, changed_by')
        .eq('product_id', productId)
        .order('changed_at', { ascending: false })
        .limit(3);
      return (data || []) as Array<{ old_ncm: string | null; new_ncm: string | null; changed_at: string; changed_by: string | null }>;
    },
    staleTime: 30_000,
  });

  const cleaned = value.replace(/\D/g, '');
  const isFormatValid = !cleaned || /^\d{8}$/.test(cleaned);
  // Capítulo NCM = primeiros 2 dígitos. 00, 98, 99 são reservados/inválidos.
  const chapter = cleaned.slice(0, 2);
  const isChapterValid = !cleaned || (cleaned.length === 8 && chapter !== '00' && chapter !== '99');
  const willBeValid = isFormatValid && isChapterValid;

  const save = useMutation({
    mutationFn: async () => {
      if (cleaned && !willBeValid) {
        throw new Error('NCM inválido: precisa 8 dígitos e capítulo válido (01-98).');
      }
      const { error } = await supabase
        .from('products')
        .update({ ncm: cleaned || null } as any)
        .eq('id', productId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheet_materials'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['ncm_change_log', productId] });
      toast.success('NCM atualizado.');
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isCurrentValid = !currentNcm || /^\d{8}$/.test(currentNcm);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'px-1.5 py-0.5 rounded text-xs font-mono w-full text-left hover:bg-muted transition-colors',
            !isCurrentValid && 'text-warning bg-warning/10',
            !currentNcm && 'text-muted-foreground/60 italic',
          )}
          title={currentNcm ? (isCurrentValid ? 'Clique pra editar NCM' : 'NCM inválido — clique pra corrigir') : 'Clique pra adicionar NCM'}
        >
          {currentNcm || '+ NCM'}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 space-y-2">
        <Label className="text-xs uppercase tracking-wider font-bold">NCM (8 dígitos)</Label>
        <Input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="00000000"
          maxLength={20}
          className={cn('font-mono text-sm h-8', !willBeValid && 'border-destructive')}
          onKeyDown={e => { if (e.key === 'Enter') save.mutate(); if (e.key === 'Escape') setOpen(false); }}
        />
        {cleaned && !isFormatValid && (
          <p className="text-xs text-destructive">⚠ NCM precisa ter exatamente 8 dígitos (atual: {cleaned.length})</p>
        )}
        {cleaned && isFormatValid && !isChapterValid && (
          <p className="text-xs text-destructive">⚠ Capítulo "{chapter}" é reservado/inválido. Use 01-97.</p>
        )}
        {!cleaned && (
          <p className="text-xs text-muted-foreground">
            Usado na emissão de NF-e. Validação: 8 dígitos numéricos + capítulo válido (01-97).
          </p>
        )}
        {history.length > 0 && (
          <div className="pt-2 border-t space-y-1">
            <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Últimas mudanças</Label>
            {history.map((h, i) => (
              <div key={i} className="text-xs font-mono text-muted-foreground">
                <span>{new Date(h.changed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} · </span>
                <span>{h.old_ncm || '—'} → <strong className="text-foreground">{h.new_ncm || '—'}</strong></span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-1.5 pt-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => save.mutate()} disabled={save.isPending || (!!cleaned && !willBeValid)}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
