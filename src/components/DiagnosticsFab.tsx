import { Stethoscope } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Botão flutuante de acesso rápido ao Diagnóstico do Sistema.
 * Útil quando o usuário enfrenta erros como "Importing a module script failed"
 * e precisa rapidamente verificar versão / cache / migrations sem navegar pelos menus.
 */
export function DiagnosticsFab() {
  const navigate = useNavigate();
  const location = useLocation();

  // Não renderiza na própria página de diagnóstico nem na tela de Auth
  if (location.pathname.startsWith('/system-diagnostics') || location.pathname.startsWith('/auth')) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Abrir diagnóstico do sistema"
          onClick={() => navigate('/system-diagnostics')}
          className="fixed bottom-4 right-4 z-50 h-10 w-10 rounded-full shadow-lg bg-card/95 backdrop-blur border-border/80 hover:bg-muted"
        >
          <Stethoscope className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">Diagnóstico do sistema</TooltipContent>
    </Tooltip>
  );
}
