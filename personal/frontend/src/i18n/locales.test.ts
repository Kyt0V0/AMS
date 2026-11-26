import { describe, expect, it } from "vitest";
import en from "./locales/en";

const modules = import.meta.glob<{ default: Record<string, string> }>(["./locales/*.ts", "!./locales/en.ts"], {
  eager: true,
});
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");
const keys = Object.keys(en) as (keyof typeof en)[];

describe("translations", () => {
  it("ships every supported language", () => {
    const codes = Object.keys(modules).map((path) => path.replace(/^.*\/(\w+)\.ts$/, "$1")).sort();
    expect(codes).toEqual(["ar", "de", "es", "fr", "ja", "ko", "pt", "ru", "vi", "zh"]);
  });

  for (const [path, module] of Object.entries(modules)) {
    it(`${path} is complete and keeps placeholders intact`, () => {
      const messages = module.default;
      expect(Object.keys(messages).filter((key) => !(key in en))).toEqual([]);
      expect(keys.filter((key) => !messages[key]?.trim())).toEqual([]);
      expect(keys.filter((key) => placeholders(messages[key]) !== placeholders(en[key]))).toEqual([]);
    });
  }
});
