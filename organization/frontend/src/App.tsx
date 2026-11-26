import { useEffect } from "react";
import Layout from "./components/Layout";
import { navigate, useRoute } from "./lib/router";
import AdminPage from "./pages/AdminPage";
import { JoinPage, LoginPage, RecoverPage, SetupPage, StatusPage, UnlockPage } from "./pages/AuthPages";
import SecurityPage from "./pages/SecurityPage";
import SettingsPage from "./pages/SettingsPage";
import VaultPage from "./pages/VaultPage";
import { useSession } from "./state/session";
import { VaultProvider } from "./state/vault";

function Workspace({ route }: { route: string[] }) {
  const { session } = useSession();
  const [section = "vault", detail] = route;
  const isAdmin = session?.user.role === "admin";
  const known = ["vault", "security", "settings", ...(isAdmin ? ["admin"] : [])].includes(section);

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
        {active === "admin" && <AdminPage tab={detail} />}
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
      return <UnlockPage />;
    case "ready":
      return <Workspace route={route} />;
    case "signedOut":
      if (route[0] === "join") return <JoinPage token={route[1]} />;
      if (route[0] === "recover") return <RecoverPage />;
      return <LoginPage />;
  }
}
