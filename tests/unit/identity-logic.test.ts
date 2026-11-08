import { describe, expect, it } from "vitest";
import { authErrorMessage, safeNextPath } from "@/features/identity/logic/auth";
import {
  difficultiesFromPrimaryNeed,
  isValidTimeZone,
  parseExperienceForm,
  parsePlacesForm,
  parseTrainingForm,
  primaryNeedFromDifficulties,
  resumeStep,
} from "@/features/identity/logic/onboarding";

function form(entries: Record<string, string | string[] | null>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) continue;
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/community?tab=feedback")).toBe("/community?tab=feedback");
  });

  it("rejects open redirects and non-strings", () => {
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("/path://x")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });

  it.each([
    ["protocol-relative", "//evil.com"],
    ["backslash", "/\\evil.com"],
    ["leading backslash", "\\\\evil.com"],
    ["tab (browsers strip it, leaving //)", "/\t/evil.com"],
    ["newline", "/\n/evil.com"],
    ["carriage return", "/\r/evil.com"],
    ["null byte", "/dash\0board"],
    ["javascript scheme", "javascript:alert(1)"],
    ["scheme with path", "/x/https://evil.com"],
    ["relative without slash", "evil.com"],
    ["empty", ""],
    ["too long", `/${"a".repeat(2048)}`],
  ])("rejects %s", (_label, value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("uses the given fallback", () => {
    expect(safeNextPath("//evil.com", "/sign-in")).toBe("/sign-in");
  });

  it("keeps encoded characters as a same-origin path", () => {
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
  });
});

describe("authErrorMessage", () => {
  it("maps known Supabase codes", () => {
    expect(authErrorMessage("invalid_credentials", "sign-in")).toBe("Email or password is incorrect.");
    expect(authErrorMessage("user_already_exists", "sign-up")).toMatch(/already exists/i);
    expect(authErrorMessage("weak_password", "sign-up")).toMatch(/8 characters/);
  });

  it("falls back per mode", () => {
    expect(authErrorMessage(undefined, "sign-in")).toMatch(/sign in/i);
    expect(authErrorMessage("unexpected", "sign-up")).toMatch(/create your account/i);
  });
});

describe("primary need mapping", () => {
  it("combines both difficulties", () => {
    expect(primaryNeedFromDifficulties(true, true)).toBe("both");
    expect(primaryNeedFromDifficulties(true, false)).toBe("consistency");
    expect(primaryNeedFromDifficulties(false, true)).toBe("schedule_conflicts");
    expect(primaryNeedFromDifficulties(false, false)).toBeNull();
  });

  it("round-trips through difficultiesFromPrimaryNeed", () => {
    for (const need of ["consistency", "schedule_conflicts", "both", null] as const) {
      const flags = difficultiesFromPrimaryNeed(need);
      expect(primaryNeedFromDifficulties(flags.consistency, flags.schedule)).toBe(need);
    }
  });
});

describe("parseExperienceForm", () => {
  const base = {
    displayName: "Runner A",
    fitnessLevel: "returning",
    consistency: "yes",
    timezone: "Asia/Kolkata",
  };

  it("derives the primary need from checkboxes", () => {
    const result = parseExperienceForm(form(base));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.primaryNeed).toBe("consistency");
  });

  it("accepts both difficulties at once", () => {
    const result = parseExperienceForm(form({ ...base, scheduleConflicts: "yes" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.primaryNeed).toBe("both");
  });

  it("rejects a submission with no difficulties", () => {
    const result = parseExperienceForm(form({ ...base, consistency: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/consistency/i);
  });

  it("rejects a blank display name", () => {
    const result = parseExperienceForm(form({ ...base, displayName: "   " }));
    expect(result.ok).toBe(false);
  });

  it("rejects a timezone that is not an IANA name", () => {
    const result = parseExperienceForm(form({ ...base, timezone: "Mars/Olympus" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/timezone/i);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects anything else", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("parseTrainingForm", () => {
  const valid = {
    goal: "first_5k",
    preferredActivities: ["run", "walk_run"],
    preferredDays: ["1", "3"],
    preferredTimesOfDay: ["morning"],
    sessionsPerWeek: "3",
    maxSessionMinutes: "45",
  };

  it("parses a valid training form", () => {
    const result = parseTrainingForm(form(valid));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.preferredDays).toEqual([1, 3]);
      expect(result.data.sessionsPerWeek).toBe(3);
      expect(result.data.maxSessionMinutes).toBe(45);
    }
  });

  it("requires at least one activity and one day", () => {
    expect(parseTrainingForm(form({ ...valid, preferredActivities: [] })).ok).toBe(false);
    expect(parseTrainingForm(form({ ...valid, preferredDays: [] })).ok).toBe(false);
  });

  it("rejects session counts outside 1-7", () => {
    expect(parseTrainingForm(form({ ...valid, sessionsPerWeek: "0" })).ok).toBe(false);
    expect(parseTrainingForm(form({ ...valid, sessionsPerWeek: "8" })).ok).toBe(false);
  });

  it("rejects session lengths under 10 minutes", () => {
    expect(parseTrainingForm(form({ ...valid, maxSessionMinutes: "5" })).ok).toBe(false);
  });
});

describe("parsePlacesForm", () => {
  it("drops empty location selections", () => {
    const result = parsePlacesForm(
      form({
        preferredLocationIds: ["", "33333333-3333-4333-8333-333333333333"],
        remindersEnabled: "yes",
        notifyInApp: null,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.preferredLocationIds).toEqual(["33333333-3333-4333-8333-333333333333"]);
      expect(result.data.remindersEnabled).toBe(true);
      expect(result.data.notifyInApp).toBe(false);
    }
  });

  it("rejects non-uuid location ids", () => {
    const result = parsePlacesForm(form({ preferredLocationIds: ["not-a-uuid"], notifyInApp: "yes" }));
    expect(result.ok).toBe(false);
  });
});

describe("resumeStep", () => {
  it("routes to the first incomplete step", () => {
    expect(resumeStep({ fitnessLevel: null, hasPreferences: false, onboarded: false })).toBe(1);
    expect(resumeStep({ fitnessLevel: "regular", hasPreferences: false, onboarded: false })).toBe(2);
    expect(resumeStep({ fitnessLevel: "regular", hasPreferences: true, onboarded: false })).toBe(3);
    expect(resumeStep({ fitnessLevel: "regular", hasPreferences: true, onboarded: true })).toBe(4);
  });
});
