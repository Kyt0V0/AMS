import { useMemo } from "react";
import { CalendarClock, Copy, KeyRound, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { navigate } from "../lib/router";
import type { Entry } from "../lib/vault";
import { useI18n } from "../i18n";
import { useUnlocked } from "../state/session";
import { useVault } from "../state/vault";
import { Alert, Avatar, EmptyState, Spinner } from "../components/ui";

function Stat({ icon, value, label, tone = "neutral" }: { icon: React.ReactNode; value: number | string; label: string; tone?: "neutral" | "ok" | "warn" | "danger" }) {
  return (
    <div className={`stat stat-${tone}`}>
      <span className="stat-icon">{icon}</span>
      <strong>{value}</strong>
      <span className="muted">{label}</span>
    </div>
  );
}

function IssueList({ title, hint, entries }: { title: string; hint: string; entries: Entry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="card">
      <h2>
        {title} <span className="chip-count">{entries.length}</span>
      </h2>
      <p className="muted">{hint}</p>
      <ul className="entry-list compact">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button type="button" className="entry-row" onClick={() => navigate(`vault/${entry.id}`)}>
              <Avatar name={entry.data?.title || "?"} />
              <span className="entry-main">
                <strong>{entry.data?.title}</strong>
                <span className="muted">{[entry.data?.system, entry.data?.username].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SecurityPage() {
  const { t } = useI18n();
  const { policy } = useUnlocked();
  const { entries, health, loading, error } = useVault();

  const report = useMemo(() => {
    const mine = entries.filter((entry) => entry.isOwner && entry.data?.password);
    const pick = (flag: "weak" | "reused" | "old") => mine.filter((entry) => health.get(entry.id)?.[flag]);
    const weak = pick("weak");
    const reused = pick("reused");
    const old = pick("old");
    const flagged = new Set([...weak, ...reused, ...old].map((entry) => entry.id)).size;
    const score = mine.length === 0 ? 100 : Math.round(((mine.length - flagged) / mine.length) * 100);
    return { mine, weak, reused, old, flagged, score, shared: entries.filter((e) => e.isOwner && e.sharedWith > 0).length };
  }, [entries, health]);

  if (loading) {
    return (
      <div className="center-block">
        <Spinner large />
      </div>
    );
  }

  const tone = report.score >= 90 ? "ok" : report.score >= 60 ? "warn" : "danger";
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{t("nav_security")}</h1>
          <p className="muted">{t("security_subtitle")}</p>
        </div>
      </header>
      {error && <Alert tone="error">{error}</Alert>}

      <div className="stats">
        <Stat icon={<ShieldCheck />} value={`${report.score}%`} label={t("health_score")} tone={tone} />
        <Stat icon={<ShieldAlert />} value={report.weak.length} label={t("health_weak_count")} tone={report.weak.length ? "danger" : "ok"} />
        <Stat icon={<Copy />} value={report.reused.length} label={t("health_reused_count")} tone={report.reused.length ? "warn" : "ok"} />
        <Stat icon={<CalendarClock />} value={report.old.length} label={t("health_old_count")} tone={report.old.length ? "warn" : "ok"} />
        <Stat icon={<KeyRound />} value={report.mine.length} label={t("health_total")} />
        <Stat icon={<Users />} value={report.shared} label={t("health_shared")} />
      </div>

      {report.flagged === 0 ? (
        <EmptyState icon={<ShieldCheck />} title={t("health_all_good")}>
          <p className="muted">{t("health_all_good_body")}</p>
        </EmptyState>
      ) : (
        <div className="stack">
          <IssueList title={t("health_weak_count")} hint={t("health_weak_hint")} entries={report.weak} />
          <IssueList title={t("health_reused_count")} hint={t("health_reused_hint")} entries={report.reused} />
          <IssueList title={t("health_old_count")} hint={t("health_old_hint", { days: policy.password_max_age_days })} entries={report.old} />
        </div>
      )}
    </section>
  );
}
