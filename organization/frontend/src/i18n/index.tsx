import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dateFormatters } from "../lib/dates";
import en from "./locales/en";

export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "ar", label: "العربية" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

const RTL: ReadonlySet<string> = new Set(["ar"]);
const STORAGE_KEY = "ams.lang";
const loaders = import.meta.glob<{ default: Messages }>(["./locales/*.ts", "!./locales/en.ts"]);

function isLang(value: string | null | undefined): value is Lang {
  return LANGUAGES.some((language) => language.code === value);
}

function initialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isLang(stored)) return stored;
  const browser = navigator.language.slice(0, 2).toLowerCase();
  return isLang(browser) ? browser : "en";
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;

  adoptLang: (lang: string | null) => void;
  t: Translate;
  formatDate: (iso: string | null) => string;
  formatDay: (iso: string | null) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [messages, setMessages] = useState<Messages>({});

  useEffect(() => {
    let cancelled = false;
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.has(lang) ? "rtl" : "ltr";
    if (lang === "en") {
      setMessages({});
      return;
    }
    loaders[`./locales/${lang}.ts`]?.()
      .then((module) => !cancelled && setMessages(module.default))
      .catch(() => !cancelled && setMessages({}));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }, []);

  const adoptLang = useCallback((next: string | null) => {
    if (isLang(next) && !localStorage.getItem(STORAGE_KEY)) setLangState(next);
  }, []);

  const value = useMemo<I18n>(() => {
    const t: Translate = (key, vars) => {
      const template: string = messages[key] ?? en[key];
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
    };
    return { lang, setLang, adoptLang, t, ...dateFormatters(lang) };
  }, [lang, messages, setLang, adoptLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("I18nProvider is missing");
  return context;
}
