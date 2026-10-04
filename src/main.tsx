import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./ui/AppErrorBoundary";

const root = document.getElementById("root");
if (root === null) throw new Error("root element not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
