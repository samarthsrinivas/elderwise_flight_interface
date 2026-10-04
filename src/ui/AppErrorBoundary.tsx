import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  readonly children: ReactNode;
}

interface AppErrorBoundaryState {
  readonly message: string;
}

export function describeRenderFailure(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  const described = String(error);
  return described === "" ? "Unknown error" : described;
}

/**
 * Last resort for a render that throws.
 *
 * Without a boundary, React 19 unmounts the whole tree when any render throws:
 * the participant is left on a permanently blank page with no text, no error
 * and no way back short of force-quitting. On an iPad that is a real risk
 * rather than a theoretical one — WKWebView's `localStorage` accessors throw
 * `SecurityError` when the web-site data store is non-persistent, which a
 * `typeof localStorage` guard does not catch, and that read happens during the
 * very first render.
 *
 * Note it also closes a hole in the CI launch gate: a JS throw does not kill
 * the process, so "still alive after 10s" scores a white screen green. The
 * workflow now checks the screenshot is not a flat frame, and this turns the
 * remaining case into something legible instead of nothing at all.
 *
 * Deliberately not localised: it renders when the provider that supplies the
 * translations may itself be what failed, so it cannot depend on it. This is
 * the one screen in the app aimed at whoever is operating the session rather
 * than the participant.
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { message: "" };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { message: describeRenderFailure(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Elderwise failed to render:", error, info.componentStack);
  }

  override render() {
    if (this.state.message === "") return this.props.children;
    return (
      <main className="app-crash" role="alert">
        <h1>Elderwise could not start</h1>
        <p>
          Something went wrong while drawing the screen. No assessment data has
          been sent anywhere.
        </p>
        <p className="app-crash__detail">{this.state.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
