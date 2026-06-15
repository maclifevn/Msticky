import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { App } from "./App";

// ── Crash visibility ─────────────────────────────────────────────────────────
// A blank/frozen window means JS threw before anything painted. Surface the
// error on-screen (and via an overlay for async errors) so it can be diagnosed
// instead of showing an empty white window.

function errOverlay(text: string) {
  let el = document.getElementById("msticky-err");
  if (!el) {
    el = document.createElement("div");
    el.id = "msticky-err";
    el.style.cssText =
      "position:fixed;inset:0;z-index:99999;padding:14px;font:12px/1.5 ui-monospace,monospace;color:#7f1d1d;background:#fffbe6;overflow:auto;white-space:pre-wrap";
    document.body.appendChild(el);
  }
  el.textContent += text + "\n\n";
}

window.addEventListener("error", (e) =>
  errOverlay(`error: ${e.message}\n${e.error?.stack ?? ""}`),
);
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as { stack?: string; message?: string } | undefined;
  errOverlay(`unhandledrejection: ${r?.stack ?? r?.message ?? String(e.reason)}`);
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <pre
          style={{
            padding: 14,
            font: "12px/1.5 ui-monospace, monospace",
            color: "#7f1d1d",
            background: "#fffbe6",
            height: "100vh",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            margin: 0,
          }}
        >
          {`Msticky render error:\n${this.state.error.message}\n\n${this.state.error.stack ?? ""}`}
        </pre>
      );
    }
    return this.props.children;
  }
}

try {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
} catch (err) {
  errOverlay(`bootstrap crash: ${(err as Error)?.stack ?? String(err)}`);
}
