import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme } from "./components/Preferences";
import { ToastProvider } from "./components/ui";
import { I18nProvider } from "./i18n";
import { SessionProvider } from "./state/session";
import "./styles.css";

applyTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
