/**
 * Error logging utility that centralizes error handling.
 * This can be extended to send errors to external services like Sentry.
 */

interface ErrorInfo {
  componentStack?: string;
  context?: Record<string, unknown>;
}

export function logError(error: Error, errorInfo?: ErrorInfo): void {
  // Always log to console
  console.error("[Error Logger]", error);

  if (errorInfo?.componentStack) {
    console.error("[Component Stack]", errorInfo.componentStack);
  }

  if (errorInfo?.context) {
    console.error("[Error Context]", errorInfo.context);
  }

  // Here you could add integrations with error monitoring services
  // Example: Sentry.captureException(error, { extra: errorInfo });
}

/**
 * Captures unexpected promise rejections
 */
export function setupGlobalErrorHandlers(): void {
  // Handle unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    logError(
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason)),
      { context: { type: "unhandledRejection" } },
    );
  });

  // Handle global errors
  window.addEventListener("error", (event) => {
    logError(event.error || new Error(event.message), {
      context: {
        type: "globalError",
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });
}

// Other utility functions could be added here, such as:
// - formatErrorForUser: to provide user-friendly error messages
// - isNetworkError: to detect network connectivity issues
// - isAuthError: to detect authentication problems
