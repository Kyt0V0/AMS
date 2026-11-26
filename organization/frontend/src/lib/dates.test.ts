import { afterEach, describe, expect, it } from "vitest";
import { ageInDays, dateFormatters, deviceTimeZone } from "./dates";

const original = process.env.TZ;
function useZone(zone: string) {
  process.env.TZ = zone;
}
afterEach(() => {
  process.env.TZ = original;
});

const STAMP = "2026-11-26T01:02:00+00:00";

describe("time zones", () => {
  it("shows a UTC timestamp in the device's own zone", () => {
    expect(dateFormatters("en", "UTC").formatDate(STAMP)).toBe("Nov 26, 2026, 1:02 AM");
    expect(dateFormatters("en", "Asia/Ho_Chi_Minh").formatDate(STAMP)).toBe("Nov 26, 2026, 8:02 AM");
    expect(dateFormatters("en", "America/Los_Angeles").formatDate(STAMP)).toBe("Nov 25, 2026, 5:02 PM");
    expect(dateFormatters("en", "Asia/Kolkata").formatDate(STAMP)).toBe("Nov 26, 2026, 6:32 AM");
  });

  it("uses the device zone by default", () => {
    useZone("Asia/Tokyo");
    expect(deviceTimeZone()).toBe("Asia/Tokyo");
    expect(dateFormatters("en").formatDate(STAMP)).toBe("Nov 26, 2026, 10:02 AM");
    useZone("America/New_York");
    expect(dateFormatters("en").formatDate(STAMP)).toBe("Nov 25, 2026, 8:02 PM");
    expect(dateFormatters("en").formatDay(STAMP)).toBe("Nov 25, 2026");
  });

  it("accepts the Z form and rejects junk", () => {
    const { formatDate } = dateFormatters("en", "UTC");
    expect(formatDate("2026-11-26T01:02:00.123456Z")).toBe("Nov 26, 2026, 1:02 AM");
    expect(formatDate(null)).toBe("–");
    expect(formatDate("not a date")).toBe("–");
  });

  it("formats in the chosen language", () => {
    expect(dateFormatters("vi", "Asia/Ho_Chi_Minh").formatDate(STAMP)).toContain("08:02");
    expect(dateFormatters("de", "Europe/Berlin").formatDate(STAMP)).toContain("02:02");
  });
});

describe("age in days follows the local calendar", () => {
  const at = (iso: string) => Date.parse(iso);

  it("turns over at local midnight, not 24 hours later", () => {
    useZone("Asia/Ho_Chi_Minh");
    const changed = "2026-11-25T16:50:00Z";
    expect(ageInDays(changed, at("2026-11-25T16:59:00Z"))).toBe(0);
    expect(ageInDays(changed, at("2026-11-25T17:00:00Z"))).toBe(1);
    expect(ageInDays(changed, at("2026-11-26T16:59:00Z"))).toBe(1);
    expect(ageInDays(changed, at("2026-12-25T17:00:00Z"))).toBe(31);
  });

  it("gives a different answer in a zone where it is still the same day", () => {
    useZone("America/Los_Angeles");
    expect(ageInDays("2026-11-25T16:50:00Z", at("2026-11-25T17:00:00Z"))).toBe(0);
  });

  it("is not thrown off by daylight-saving changes", () => {
    useZone("Europe/London");

    expect(ageInDays("2026-03-28T12:00:00Z", at("2026-03-30T12:00:00Z"))).toBe(2);
    expect(ageInDays("2026-10-24T12:00:00Z", at("2026-10-26T12:00:00Z"))).toBe(2);
    expect(ageInDays("2026-01-01T00:30:00Z", at("2026-07-01T00:30:00Z"))).toBe(181);
  });

  it("never goes negative when a clock is slightly behind", () => {
    useZone("UTC");
    expect(ageInDays("2026-11-26T00:10:00Z", at("2026-11-25T23:50:00Z"))).toBe(0);
    expect(ageInDays("", at("2026-11-25T23:50:00Z"))).toBeNull();
  });
});
