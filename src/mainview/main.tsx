import "./style.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { queryClient } from "./query-client";

const container = document.getElementById("root");
const root = createRoot(container!);

root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <Toaster
          offset={{ bottom: 48, right: 32 }}
          icons={{
            success: <CheckCircle2 color="green" size={16} />,
            error: <AlertCircle color="red" size={16} />,
          }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
