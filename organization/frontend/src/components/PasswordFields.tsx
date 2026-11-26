import { useEffect, useState, type ReactNode } from "react";
import type { Policy } from "../lib/api";
import { passwordStrength } from "../lib/password";
import { useI18n } from "../i18n";
import { Alert, CopyButton, Field, PasswordInput, StrengthMeter } from "./ui";

export interface NewPassword {
  value: string;
  valid: boolean;
}

export function NewPasswordFields({ policy, onChange }: { policy: Policy; onChange: (next: NewPassword) => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const score = passwordStrength(password);
  const longEnough = password.length >= policy.min_password_length;
  const matches = password === confirm;

  useEffect(() => {
    onChange({ value: password, valid: longEnough && score >= 2 && matches });
  }, [password, longEnough, score, matches, onChange]);

  let hint: ReactNode = t("password_rule", { count: policy.min_password_length });
  if (password && !longEnough) hint = <span className="text-danger">{t("password_too_short", { count: policy.min_password_length })}</span>;
  else if (password && score < 2) hint = <span className="text-danger">{t("password_too_weak")}</span>;

  return (
    <>
      <Field label={t("new_master_password")} hint={hint}>
        <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
        <StrengthMeter score={score} empty={!password} />
      </Field>
      <Field
        label={t("confirm_password")}
        hint={confirm && !matches ? <span className="text-danger">{t("passwords_differ")}</span> : undefined}
      >
        <PasswordInput value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" required />
      </Field>
    </>
  );
}

export function RecoveryCodeBox({ code }: { code: string }) {
  const { t } = useI18n();
  return (
    <>
      <Alert tone="warn">{t("recovery_explain")}</Alert>
      <div className="code-box">
        <code>{code}</code>
        <CopyButton value={code} secret />
      </div>
    </>
  );
}
