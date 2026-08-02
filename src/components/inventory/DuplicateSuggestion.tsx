/**
 * Sugestão de item/cor já cadastrado — componente ÚNICO dos 7 caminhos que
 * criam produto ou cor. Ver `specs/duplicata-no-cadastro.md` (R3).
 *
 * Duas decisões de produto moram aqui:
 *   - Salvar fica bloqueado até o usuário escolher. Confirmar é decisão
 *     explícita, não fechar um X (R3.2).
 *   - "É o mesmo" NÃO salva: leva ao produto existente. Cadastrar duplicata tem
 *     que ser mais trabalhoso que achar o original, senão o botão de confirmar
 *     vira o caminho rápido (R3.3).
 */
import { Button } from '@/components/ui/button';
import { Warning } from '@phosphor-icons/react';
import { useGroups } from '@/hooks/useGroups';
import { DUPLICATE_REASON_LABELS, type DuplicateHit } from '@/lib/duplicateDetection';

export function DuplicateSuggestion({
  hit,
  onSameProduct,
  onDifferent,
  className,
}: {
  hit: DuplicateHit;
  /** "É o mesmo" — o chamador leva o usuário ao produto existente. */
  onSameProduct: () => void;
  /** "Não é o mesmo" — libera o salvamento nesta sessão do formulário. */
  onDifferent: () => void;
  className?: string;
}) {
  const { data: groups = [] } = useGroups();
  const { product, reason } = hit;
  const grupo = groups.find((g: any) => g.id === product.group_id)?.name;
  const saldo = Number(product.quantity) || 0;

  return (
    <div
      className={`rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2 ${className ?? ''}`}
      role="alert"
    >
      <p className="text-sm font-semibold text-warning flex items-center gap-1.5">
        <Warning className="h-4 w-4 shrink-0" />
        {DUPLICATE_REASON_LABELS[reason]}
      </p>

      {/* R3.1 — a sugestão diz QUEM achou, não só "duplicado encontrado". */}
      <div className="text-xs text-muted-foreground space-y-0.5">
        <p className="font-medium text-foreground">
          {product.name}
          {product.color ? ` · ${product.color}` : ''}
        </p>
        <p className="font-mono">
          SKU {product.sku || '—'}
          {grupo ? ` · ${grupo}` : ''}
          {' · '}
          {saldo.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {product.unit || ''}
          {!product.active && ' · inativo'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-0.5">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onSameProduct}>
          É o mesmo — abrir o existente
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onDifferent}>
          Não é o mesmo
        </Button>
      </div>
    </div>
  );
}
