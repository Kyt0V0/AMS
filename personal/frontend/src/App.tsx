import { useEffect } from "react";
import Layout from "./components/Layout";
import { navigate, useRoute } from "./lib/router";
import { RecoverPage, SetupPage, StatusPage, UnlockPage } from "./pages/AuthPages";
import SecurityPage from "./pages/SecurityPage";
import SettingsPage from "./pages/SettingsPage";
import VaultPage from "./pages/VaultPage";
import { useSession } from "./state/session";
import { VaultProvider } from "./state/vault";

const SECTIONS = ["vault", "security", "settings"];

function Workspace({ route }: { route: string[] }) {
  const [section = "vault", detail] = route;
  const known = SECTIONS.includes(section);

  useEffect(() => {
    if (!known) navigate("vault", true);
  }, [known]);

  const active = known ? section : "vault";
  return (
    <VaultProvider>
      <Layout section={active}>
        {active === "vault" && <VaultPage selectedId={known ? detail : undefined} />}
        {active === "security" && <SecurityPage />}
        {active === "settings" && <SettingsPage />}
      </Layout>
    </VaultProvider>
  );
}

export default function App() {
  const { phase, start } = useSession();
  const route = useRoute();

  switch (phase) {
    case "loading":
      return <StatusPage kind="loading" />;
    case "insecure":
      return <StatusPage kind="insecure" />;
    case "unreachable":
      return <StatusPage kind="unreachable" onRetry={() => void start()} />;
    case "setup":
      return <SetupPage />;
    case "locked":
      return route[0] === "recover" ? <RecoverPage /> : <UnlockPage />;
    case "ready":
      return <Workspace route={route} />;
  }
}
