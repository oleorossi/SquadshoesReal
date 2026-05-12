/**
 * Alerta amigável para `ConsumptionSchemaError` (validação Zod do retorno da
 * RPC `calculate_order_consumption`). Mostra os 5 primeiros campos inválidos
 * em PT-BR e oferece um botão "Copiar detalhes" com o JSON completo do erro
 * (issues + payload bruto recebido) para diagnóstico/suporte.
 */
import { useState } from 'react';
import { Warning as AlertTriangle, Copy, Check, CaretDown as ChevronDown, CaretUp as ChevronUp } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConsumptionSchemaError } from '@/services/consumptionService';
import { toast } from 'sonner';

interface Props {
  error: ConsumptionSchemaError;
  /** Contexto opcional (ex.: "Pedido #123") para o título do alerta. */
  context?: string;
  /** Callback opcional para fechar o alerta. */
  onDismiss?: () => void;
}

const MAX_ISSUES = 5;

export function ConsumptionErrorAlert({ error, context, onDismiss }: Props) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const visibleIssues = error.issues.slice(0, MAX_ISSUES);
  const hiddenCount = Math.max(0, error.issues.length - MAX_ISSUES);

  async function handleCopy() {
    const payload = {
      error: error.message,
      context: context ?? null,
      timestamp: new Date().toISOString(),
      issuesCount: error.issues.length,
      issues: error.issues,
      raw: error.raw,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      toast.success('Detalhes copiados para a área de transferência');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar. Use o botão "Expandir" e copie manualmente.');
    }
  }

  return (
    <Alert variant="destructive" className="border-destructive/40">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2 flex-wrap">
        <span>Erro de validação no cálculo de consumo</span>
        {context && (
          <Badge variant="outline" className="text-[10px] font-normal">
            {context}
          </Badge>
        )}
        <Badge variant="destructive" className="text-[10px]">
          {error.issues.length} {error.issues.length === 1 ? 'problema' : 'problemas'}
        </Badge>
      </AlertTitle>
      <AlertDescription className="space-y-3 mt-2">
        <p className="text-xs">
          A RPC <code className="px-1 py-0.5 rounded bg-destructive/10 text-[11px]">calculate_order_consumption</code>{' '}
          retornou um payload com campos inválidos. Os{' '}
          {Math.min(MAX_ISSUES, error.issues.length)} primeiros são:
        </p>

        <ul className="space-y-1 text-xs font-mono bg-destructive/5 rounded-md p-2.5 border border-destructive/20">
          {visibleIssues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-destructive shrink-0">•</span>
              <span>
                <span className="font-semibold">{issue.path}</span>
                <span className="text-muted-foreground"> — </span>
                <span>{issue.message}</span>
                {issue.received !== undefined && (
                  <span className="text-muted-foreground/70 ml-1">
                    (recebido: {JSON.stringify(issue.received)})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {hiddenCount > 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            …e mais {hiddenCount} problema{hiddenCount === 1 ? '' : 's'} oculto{hiddenCount === 1 ? '' : 's'}.
            Use "Copiar detalhes" para ver todos.
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-7 text-xs gap-1.5"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copiado!' : 'Copiar detalhes'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            className="h-7 text-xs gap-1.5"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Ocultar payload' : 'Expandir payload bruto'}
          </Button>
          {onDismiss && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="h-7 text-xs ml-auto"
            >
              Dispensar
            </Button>
          )}
        </div>

        {expanded && (
          <pre className="mt-2 p-2.5 rounded-md bg-destructive/5 border border-destructive/20 text-[10px] font-mono overflow-x-auto max-h-60 whitespace-pre-wrap break-all">
            {JSON.stringify(error.raw, null, 2)}
          </pre>
        )}
      </AlertDescription>
    </Alert>
  );
}
