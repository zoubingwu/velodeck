import { Button } from "@/components/ui/button";
import { logError } from "@/lib/logger";
import { AlertCircle } from "lucide-react";
import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Use our centralized error logger
    logError(error, {
      componentStack: errorInfo.componentStack || undefined,
    });

    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-screen p-6 bg-background">
          <div className="max-w-md w-full bg-card p-6 rounded-lg shadow-lg">
            <div className="flex items-center gap-2 text-destructive mb-4">
              <AlertCircle size={24} />
              <h2 className="text-xl font-semibold">Something went wrong</h2>
            </div>

            <div className="bg-muted p-4 rounded-md mb-4 overflow-auto max-h-[300px]">
              <p className="font-mono text-sm text-muted-foreground mb-2">
                {this.state.error?.toString()}
              </p>
              {this.state.errorInfo && (
                <pre className="font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                  {this.state.errorInfo.componentStack}
                </pre>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
              <Button onClick={this.handleReset}>Try Again</Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
