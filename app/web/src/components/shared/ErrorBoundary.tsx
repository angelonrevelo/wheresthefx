import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Rendered instead of the default panel when provided. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a single bad component cannot white-screen the app.
 *
 * The app previously had no error boundary anywhere, which meant any throw
 * — a malformed event from the API, a Leaflet failure, a lazy chunk that
 * failed to load — took the whole page down to a blank screen with no way
 * back except a manual reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Unhandled render error:", error, errorInfo.componentStack);
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Something broke</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            That is on us, not you. Try again — if it keeps happening, reload the page.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={this.handleReset}>Try again</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
