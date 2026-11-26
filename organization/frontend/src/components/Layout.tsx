import type { ReactNode } from "react";
import { KeyRound, Lock, LogOut, Settings, ShieldCheck, UsersRound } from "lucide-react";
import { useI18n } from "../i18n";
import { useUnlocked } from "../state/session";
import { Logo } from "../pages/AuthPages";
import { Avatar, IconButton } from "./ui";

export default function Layout({ section, children }: { section: string; children: ReactNode }) {
  const { t } = useI18n();
  const { user, lock, signOut } = useUnlocked();

  const links = [
    { id: "vault", label: t("nav_vault"), icon: <KeyRound /> },
    { id: "security", label: t("nav_security"), icon: <ShieldCheck /> },
    { id: "settings", label: t("nav_settings"), icon: <Settings /> },
    ...(user.role === "admin" ? [{ id: "admin", label: t("nav_admin"), icon: <UsersRound /> }] : []),
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="sidebar-logo" href="#/vault">
          <Logo />
        </a>
        <nav className="nav" aria-label={t("app_name")}>
          {links.map((link) => (
            <a key={link.id} href={`#/${link.id}`} className={section === link.id ? "nav-link on" : "nav-link"} aria-current={section === link.id ? "page" : undefined}>
              {link.icon}
              <span>{link.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-user">
          <Avatar name={user.username} />
          <span className="entry-main">
            <strong>{user.username}</strong>
            <span className="muted">{t(`role_${user.role}`)}</span>
          </span>
          <IconButton label={t("lock")} onClick={lock}>
            <Lock />
          </IconButton>
          <IconButton label={t("sign_out")} onClick={() => void signOut()}>
            <LogOut />
          </IconButton>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
