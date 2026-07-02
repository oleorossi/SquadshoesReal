import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, MagnifyingGlass as Search, CircleNotch as Loader2, Warning as AlertTriangle, Footprints, Calendar } from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { normalizeForSearch } from '@/lib/searchUtils';

type SoleWithSpecs = {
  id: string;
  name: string;
  color: string | null;
  sku: string | null;
  is_fachetado: boolean;
  sizes_count: number;
  sizes_list: string;
  last_updated_at: string | null;
  sheets_using: number;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetSoleId: string;
  targetSoleName?: string;
  hasExistingSpecs: boolean;
  onCopied: () => void;
};

export function CopyFromAnySoleDialog({
  open, onOpenChange, targetSoleId, targetSoleName, hasExistingSpecs, onCopied,
}: Props) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [copying, setCopying] = useState(false);

  const { data: soles = [], isLoading } = useQuery({
    queryKey: ['soles_with_specs'],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_soles_with_specs' as any)
        .select('*')
        .order('last_updated_at', { ascending: false });
      if (error) throw error;
      return ((data as any[]) || []) as SoleWithSpecs[];
    },
  });

  const filtered = useMemo(() => {
    const list = soles.filter(s => s.id !== targetSoleId);
    if (!search.trim()) return list;
    const q = normalizeForSearch(search);
    return list.filter(s =>
      normalizeForSearch(s.name).includes(q) ||
      normalizeForSearch(s.color).includes(q) ||
      normalizeForSearch(s.sku).includes(q),
    );
  }, [soles, search, targetSoleId]);

  const handleCopy = async () => {
    if (!selectedId) return;
    setCopying(true);
    try {
      const { data, error } = await (supabase as any).rpc('copy_sole_specs_from', {
        p_source_sole_id: selectedId,
        p_target_sole_id: targetSoleId,
        p_overwrite: overwrite,
      });
      if (error) throw error;
      const result = data as { copied_specs: number; copied_structures: number };
      toast.success(
        `${result.copied_specs} tamanho(s) e ${result.copied_structures} estrutura(s) copiados.`,
      );
      onCopied();
      onOpenChange(false);
      // Reset
      setSelectedId(null);
      setOverwrite(false);
      setSearch('');
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao copiar specs');
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5 text-primary" />
            Copiar specs de outro solado
          </DialogTitle>
          <DialogDescription>
            Selecione um solado já cadastrado como base. As specs (forração, palmilha,
            fachete por tamanho) serão copiadas pra <strong>{targetSoleName || 'este solado'}</strong>.
            Você pode ajustar os valores depois.
          </DialogDescription>
        </DialogHeader>

        {hasExistingSpecs && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs space-y-2 flex-1">
              <p className="font-semibold text-amber-700 dark:text-amber-400">
                Este solado já tem specs cadastradas.
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="overwrite-check"
                  checked={overwrite}
                  onCheckedChange={(v) => setOverwrite(!!v)}
                />
                <Label htmlFor="overwrite-check" className="cursor-pointer text-amber-700 dark:text-amber-400">
                  Substituir specs existentes pelas do solado escolhido
                </Label>
              </div>
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, cor ou SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground flex flex-col items-center gap-2">
              <Footprints className="h-8 w-8 opacity-30" />
              <p className="text-sm">Nenhum solado com specs disponíveis.</p>
              <p className="text-xs">
                Cadastre specs em algum solado primeiro pra usá-lo como base.
              </p>
            </div>
          ) : (
            filtered.map(sole => (
              <button
                key={sole.id}
                type="button"
                onClick={() => setSelectedId(sole.id)}
                className={cn(
                  'w-full text-left rounded-lg border p-3 transition cursor-pointer',
                  selectedId === sole.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'hover:bg-muted/40',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{sole.name}</span>
                      {sole.color && (
                        <Badge variant="outline" className="text-xs h-4">{sole.color}</Badge>
                      )}
                      {sole.is_fachetado && (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/40 text-xs h-4">
                          fachetado
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Footprints className="h-3 w-3" />
                        {sole.sizes_count} tamanho(s) — {sole.sizes_list}
                      </span>
                      {sole.last_updated_at && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(sole.last_updated_at).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                      {sole.sheets_using > 0 && (
                        <span>{sole.sheets_using} ficha(s) usando</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={copying}>
            Cancelar
          </Button>
          <Button
            onClick={handleCopy}
            disabled={!selectedId || copying || (hasExistingSpecs && !overwrite)}
            className="gap-2"
          >
            {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            Copiar specs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
