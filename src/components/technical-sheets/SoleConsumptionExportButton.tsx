import { useState } from 'react';
import { Download, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  soleProductId: string;
  soleLabel: string;
}

/**
 * Exporta para CSV todos os itens de consumo base configurados para um solado.
 * Inclui nome do item, cor (se houver), categoria, numeração, consumo e unidade.
 */
export function SoleConsumptionExportButton({ soleProductId, soleLabel }: Props) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const { data: rows, error } = await (supabase as any)
        .from('sole_standard_items_consumption')
        .select('size, consumption, unit, standard_item_id, products:standard_item_id (name, color, category, sku)')
        .eq('sole_product_id', soleProductId)
        .order('size');
      if (error) throw error;
      if (!rows || rows.length === 0) {
        toast.info('Não há itens de consumo base configurados para este solado.');
        return;
      }

      const escape = (v: any) => {
        if (v == null) return '';
        const s = String(v);
        // Escape CSV: wrap in quotes if contains , " or newline; double quotes inside.
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const header = ['Solado', 'Item Padrão', 'SKU', 'Cor', 'Categoria', 'Numeração', 'Consumo', 'Unidade'];
      const lines = [header.join(';')];
      for (const r of rows as any[]) {
        const p = r.products || {};
        lines.push([
          soleLabel,
          p.name ?? '',
          p.sku ?? '',
          p.color ?? '',
          p.category ?? '',
          r.size,
          // pt-BR decimal comma to open clean in Excel BR
          String(Number(r.consumption ?? 0)).replace('.', ','),
          r.unit ?? '',
        ].map(escape).join(';'));
      }

      // BOM for Excel UTF-8
      const csv = '\uFEFF' + lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = soleLabel.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60);
      const ts = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `consumo-base_${safeName}_${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Exportado: ${rows.length} ${rows.length === 1 ? 'linha' : 'linhas'}`);
    } catch (err: any) {
      toast.error(`Erro ao exportar: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleExport} disabled={loading} size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Exportar CSV
    </Button>
  );
}
