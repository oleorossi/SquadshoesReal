import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack || null });
    // Janela global pra debug — `window.__lastError` no Console mostra o erro.
    try { (window as any).__lastError = { error, errorInfo }; } catch {}
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[300px] flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-2xl w-full">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
            <h3 className="text-lg font-semibold">
              {this.props.fallbackTitle || 'Algo deu errado'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {this.state.error?.message || 'Ocorreu um erro inesperado.'}
            </p>
            <details className="text-left text-xs bg-muted p-3 rounded">
              <summary className="cursor-pointer text-destructive font-semibold hover:underline">
                Ver stack do erro
              </summary>
              <pre className="mt-2 p-2 bg-background rounded overflow-auto max-h-72 text-xs whitespace-pre-wrap break-words">
                {this.state.error?.stack || this.state.error?.toString()}
                {this.state.componentStack ? `\n\nComponent stack:${this.state.componentStack}` : ''}
              </pre>
            </details>
            <Button variant="outline" onClick={this.handleReset} className="gap-2">
              <RotateCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
