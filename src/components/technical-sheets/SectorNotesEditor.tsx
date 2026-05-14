import { useEffect, useState } from 'react';
import { Note, FloppyDisk as Save, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

/** Ordem canônica dos setores produtivos. Usada como fallback quando a
 *  ficha não tem production_sectors configurado. */
const ALL_SECTORS = [
  'Corte Palmilha', 'Corte Forração', 'Corte Cabedal', 'Costura',
  'Silk', 'Aviamento', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
] as const;

interface Props {
  /** Setores ativos do modelo (production_sectors). Define quais campos aparecem. */
  sectors: string[];
  /** Observações atuais — JSONB keyed por nome de setor. */
  value: Record<string, string>;
  /** Persiste as observações na ficha técnica. */
  onSave: (notes: Record<string, string>) => void;
  saving?: boolean;
}

/**
 * Editor de observações por setor da ficha técnica. A observação é uma
 * característica da REFERÊNCIA — preenchida 1x aqui, reflete automaticamente
 * nas fichas de operador do setor correspondente em toda OP.
 */
export function SectorNotesEditor({ sectors, value, onSave, saving }: Props) {
  const [notes, setNotes] = useState<Record<string, string>>(value || {});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNotes(value || {});
    setDirty(false);
  }, [value]);

  // Setores a exibir: os ativos do modelo, na ordem canônica. Se a ficha não
  // tem production_sectors, mostra todos.
  const visibleSectors = (sectors && sectors.length > 0)
    ? ALL_SECTORS.filter(s => sectors.includes(s))
    : [...ALL_SECTORS];

  const handleChange = (sector: string, text: string) => {
    setNotes(prev => ({ ...prev, [sector]: text }));
    setDirty(true);
  };

  const handleSave = () => {
    // Remove chaves vazias pra não poluir o JSONB
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(notes)) {
      if (v && v.trim()) cleaned[k] = v.trim();
    }
    onSave(cleaned);
    setDirty(false);
  };

  const filledCount = Object.values(notes).filter(v => v && v.trim()).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Note className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold">Observações por setor</h3>
          {filledCount > 0 && (
            <Badge variant="outline" className="text-[10px] h-5">{filledCount} preenchida(s)</Badge>
          )}
        </div>
        <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Salvar
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-2">
        Orientações fixas da referência por setor (ex.: <em>"usar linha reforçada nº 40"</em>).
        Aparecem como aviso na ficha de operador daquele setor em toda OP deste modelo.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visibleSectors.map(sector => (
          <div key={sector} className="rounded-lg border bg-card p-3 space-y-1.5">
            <Label className="text-xs font-medium">{sector}</Label>
            <Textarea
              value={notes[sector] || ''}
              onChange={e => handleChange(sector, e.target.value)}
              rows={2}
              placeholder="Sem observação"
              className="text-sm resize-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
