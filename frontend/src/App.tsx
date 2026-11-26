import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import RegisterForm from "./components/RegisterForm";
import LoginForm from "./components/LoginForm";
import Dashboard from "./components/Dashboard";
import BootstrapAdminForm from "./components/BootstrapAdminForm";
import { getApiBase, getBootstrapStatusApi, setApiBase } from "./api";
import { useTranslation } from "./TranslationContext";
import { LANGUAGE_OPTIONS, type Lang } from "./translation";

export default function App() {
  const auth = useAuth();
  const { lang, setLang, t } = useTranslation();

  const [authView, setAuthView] = useState<"login" | "register">("login");
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(null);
  const [apiBaseInput, setApiBaseInput] = useState<string>(() => getApiBase());
  const [apiBaseMsg, setApiBaseMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // AQA NEA note: first-run check decides whether to show bootstrap admin creation flow.
        const s = await getBootstrapStatusApi();
        setNeedsBootstrap(s.needs_bootstrap);
      } catch {
        setNeedsBootstrap(false);
      }
    })();
  }, []);

  if (needsBootstrap === null) return <div style={{ padding: 24 }}>{t("loading")}</div>;

  if (needsBootstrap) {
    const saveApiBase = () => {
      setApiBase(apiBaseInput);
      setApiBaseInput(getApiBase());
      setApiBaseMsg(t("server_url_saved"));
    };

    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 18, position: "relative" }}>
        <div style={{ position: "absolute", top: 24, right: 24, display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <small style={{ opacity: 0.8 }}>{t("server_connection")}</small>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={apiBaseInput}
                onChange={(e) => setApiBaseInput(e.target.value)}
                placeholder={t("backend_server_url")}
                style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", minWidth: 260 }}
              />
              <button type="button" onClick={saveApiBase}>
                {t("save_server_url")}
              </button>
            </div>
            {apiBaseMsg ? <small>{apiBaseMsg}</small> : null}
          </div>
        </div>

        <div style={{ width: "100%", maxWidth: 620, border: "1px solid #ddd", borderRadius: 12, padding: 18, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>{t("app_title")}</h1>
          </div>
          <BootstrapAdminForm onDone={() => setNeedsBootstrap(false)} />
        </div>
        <div
          style={{
            position: "absolute",
            right: 24,
            bottom: 24,
            display: "flex",
            gap: 8,
            alignItems: "center",
            border: "1px solid #ddd",
            borderRadius: 999,
            background: "#fff",
            padding: "6px 10px",
          }}
        >
          <span aria-hidden="true">🌐</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            style={{ border: "none", background: "transparent", minWidth: 170 }}
            aria-label={t("language")}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (auth.token) return <Dashboard />;

  const saveApiBase = () => {
    // AQA NEA note: backend URL is saved per device so LAN/company deployments can point clients at one server.
    setApiBase(apiBaseInput);
    setApiBaseInput(getApiBase());
    setApiBaseMsg(t("server_url_saved"));
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 18, position: "relative" }}>
      <div style={{ position: "absolute", top: 24, right: 24, display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <small style={{ opacity: 0.8 }}>{t("server_connection")}</small>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={apiBaseInput}
              onChange={(e) => setApiBaseInput(e.target.value)}
              placeholder={t("backend_server_url")}
              style={{ padding: 8, borderRadius: 8, border: "1px solid #ddd", minWidth: 260 }}
            />
            <button type="button" onClick={saveApiBase}>
              {t("save_server_url")}
            </button>
          </div>
          {apiBaseMsg ? <small>{apiBaseMsg}</small> : null}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 24,
          bottom: 24,
          display: "flex",
          gap: 8,
          alignItems: "center",
          border: "1px solid #ddd",
          borderRadius: 999,
          background: "#fff",
          padding: "6px 10px",
        }}
      >
        <span aria-hidden="true">🌐</span>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          style={{ border: "none", background: "transparent", minWidth: 170 }}
          aria-label={t("language")}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div style={{ width: "100%", maxWidth: 620, border: "1px solid #ddd", borderRadius: 12, padding: 18, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>{t("app_title")}</h1>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setAuthView("login")} disabled={authView === "login"}>
            {t("login")}
          </button>
          <button onClick={() => setAuthView("register")} disabled={authView === "register"}>
            {t("register")}
          </button>
        </div>

        {authView === "register" ? <RegisterForm onDone={() => setAuthView("login")} /> : null}
        {authView === "login" ? <LoginForm /> : null}
      </div>
    </div>
  );
}
