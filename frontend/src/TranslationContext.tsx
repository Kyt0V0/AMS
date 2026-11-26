import React, { createContext, useContext, useMemo, useState } from "react";
import { LANGS, type Lang, type TranslationKey, tKey } from "./translation";

type TranslationContextType = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TranslationKey) => string;
};

const TranslationContext = createContext<TranslationContextType | null>(null);

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    // AQA NEA note: language preference is persisted locally so UI remains consistent between sessions.
    const saved = localStorage.getItem("lang");
    return (LANGS as readonly string[]).includes(saved ?? "") ? (saved as Lang) : "en";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("lang", l);
  };

  const value = useMemo<TranslationContextType>(() => {
    return {
      lang,
      setLang,
      t: (k) => tKey(k, lang),
    };
  }, [lang]);

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(TranslationContext);
  if (!ctx) throw new Error("TranslationContext not found");
  return ctx;
}
