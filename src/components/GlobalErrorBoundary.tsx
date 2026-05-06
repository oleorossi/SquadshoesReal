import React, { ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { clearStalePwaArtifacts } from '@/utils/pwa-utils';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Clears any service-worker / browser caches then navigates home with a
 * cache-busting query param so the SW (if still alive) cannot serve a stale
 * build on the redirect.
 */
async function clearAndGoHome() {
  try {
    await clearStalePwaArtifacts();
  } catch {
    // ignore — navigate regardless
  }
  // Append a timestamp so any surviving cache layer treats this as a new URL
  window.location.href = '/?_r=' + Date.now();
}

export class GlobalErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('🔴 Global Error Caught:', error);
    console.error('Stack:', errorInfo.componentStack);
  }

   render() {
     if (this.state.hasError) {
        const errorMessage = this.state.error?.message?.toLowerCase() || '';
        const isSessionError = errorMessage.includes('session') || 
                              errorMessage.includes('auth') ||
                              errorMessage.includes('getsession') ||
                              errorMessage.includes('jwt') ||
                              errorMessage.includes('401') ||
                              errorMessage.includes('unauthorized');
        
        const isPwaError = errorMessage.includes('loading chunk') || 
                          errorMessage.includes('failed to fetch dynamically imported module') ||
                          errorMessage.includes('css_chunk_load_failed');

       return (
         <div className="min-h-screen flex items-center justify-center bg-background p-4">
           <Card className="max-w-md w-full border-destructive border-2">
             <CardHeader className="bg-destructive/10 rounded-t-lg">
               <div className="flex items-center gap-3">
                 <AlertCircle className="w-6 h-6 text-destructive" />
                 <CardTitle className="text-destructive">
                    {isSessionError ? "Erro de Autenticação" : (isPwaError ? "Versão Desatualizada" : "Algo deu errado")}
                 </CardTitle>
               </div>
             </CardHeader>
             <CardContent className="space-y-4 mt-4">
               <p className="text-sm text-muted-foreground">
                  {isSessionError 
                    ? "Houve um problema ao verificar sua sessão. Tente fazer login novamente."
                    : isPwaError
                      ? "Detectamos uma nova versão do sistema que não pôde ser carregada automaticamente. Clique abaixo para atualizar."
                      : "Desculpe, encontramos um erro inesperado. Tente novamente ou volte ao início."}
               </p>
 
               <details className="text-xs bg-muted p-3 rounded">
                 <summary className="cursor-pointer text-destructive font-semibold hover:underline">
                   📋 Ver detalhes do erro
                 </summary>
                 <pre className="mt-3 p-2 bg-background rounded overflow-auto max-h-40 text-xs whitespace-pre-wrap break-words">
                   {this.state.error?.toString()}
                 </pre>
               </details>
 
               <div className="flex gap-2 pt-4">
                 <Button
                   onClick={() => {
                     if (isSessionError) {
                       window.location.href = '/auth';
                     } else {
                       void clearAndGoHome();
                     }
                   }}
                   variant="outline"
                   className="flex-1"
                 >
                  {isSessionError ? "Fazer Login" : (isPwaError ? "Forçar Atualização" : "← Ir para início")}
                 </Button>
                 <Button
                   onClick={() => this.setState({ hasError: false, error: null })}
                   className="flex-1 gap-2"
                 >
                   <RefreshCw className="w-4 h-4" />
                   Tentar novamente
                 </Button>
               </div>
             </CardContent>
           </Card>
         </div>
       );
     }
 
     return this.props.children;
   }
}
