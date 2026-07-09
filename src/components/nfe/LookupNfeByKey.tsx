import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowSquareOut as ExternalLink, FileText, FileXls as FileCode } from '@phosphor-icons/react';
import { buildMeudanfeUrl } from '@/hooks/useNfe';
import { toast } from 'sonner';

/**
 * Lookup de NF-e pela chave de acesso (44 dígitos). Como a API do ClickNotas
 * não expõe DANFE/XML pra download direto (confirmado em /docs deles), o fluxo
 * é abrir o visualizador público meudanfe.com.br que aceita a chave e oferece
 * download oficial dos arquivos (XML SEFAZ + DANFE PDF).
 *
 * Pedido user 20/05/2026: "AO JOGAR CHAVE DE ACESSO, JÁ QUE ISSO NÃO DA PRA
 * FAZER DIRETO PELO CLICKNOTAS".
 */
export function LookupNfeByKey() {
  const [rawKey, setRawKey] = useState('');

  const clean = rawKey.replace(/\D/g, '');
  const valid = clean.length === 44;

  const open = () => {
    if (!valid) {
      toast.error(`Chave precisa ter exatamente 44 dígitos. Você digitou ${clean.length}.`);
      return;
    }
    const url = buildMeudanfeUrl(clean);
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      toast.error('Bloqueio de popup ativo. Permita popups pra este site.');
    } else {
      toast.success('Abrindo NF no meudanfe.com.br — XML e DANFE oficiais estão lá');
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <Label className="text-sm font-bold">Consultar NF-e por chave de acesso</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cole a chave de 44 dígitos (com ou sem espaços/pontuação) e abra o XML/DANFE oficial direto da SEFAZ via meudanfe.com.br
            </p>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[280px]">
            <Input
              value={rawKey}
              onChange={(e) => setRawKey(e.target.value)}
              placeholder="44 dígitos · ex: 3526 0512 ..."
              className={`h-9 font-mono text-sm ${rawKey && !valid ? 'border-amber-500' : ''}`}
              onKeyDown={(e) => { if (e.key === 'Enter' && valid) open(); }}
            />
            <p className="text-[10px] text-muted-foreground mt-1 font-mono">
              {clean.length}/44 dígitos
              {clean.length > 0 && !valid && ' — faltam dígitos pra abrir'}
            </p>
          </div>
          <Button
            type="button"
            onClick={open}
            disabled={!valid}
            className="h-9 gap-1.5"
          >
            <FileText className="h-4 w-4" />
            Abrir NF
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={open}
            disabled={!valid}
            className="h-9 gap-1.5"
            title="meudanfe.com.br oferece XML e PDF na mesma tela"
          >
            <FileCode className="h-4 w-4" />
            XML / DANFE
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
