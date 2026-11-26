import { useEffect, useState } from "react";
import { Globe, Monitor, Moon, Sun } from "lucide-react";
import { LANGUAGES, useI18n, type Lang } from "../i18n";

export type Theme = "system" | "light" | "dark";
const THEME_KEY = "ams.theme";

function storedTheme(): Theme {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export function applyTheme(theme: Theme = storedTheme()): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return [
    theme,
    (next) => {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
      setTheme(next);
    },
  ];
}

export function LanguageSelect() {
  const { lang, setLang, t } = useI18n();
  return (
    <span className="select-pill">
      <Globe aria-hidden="true" />
      <select
        aria-label={t("language")}
        value={lang}
        onChange={(event) => setLang(event.target.value as Lang)}
      >
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function ThemeSwitch() {
  const { t } = useI18n();
  const [theme, setTheme] = useTheme();
  const options: { value: Theme; icon: React.ReactNode; label: string }[] = [
    { value: "light", icon: <Sun />, label: t("theme_light") },
    { value: "system", icon: <Monitor />, label: t("theme_system") },
    { value: "dark", icon: <Moon />, label: t("theme_dark") },
  ];
  return (
    <span className="segmented" role="radiogroup" aria-label={t("theme")}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          aria-label={option.label}
          title={option.label}
          className={theme === option.value ? "on" : ""}
          onClick={() => setTheme(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </span>
  );
}
