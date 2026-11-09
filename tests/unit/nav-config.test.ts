import { describe, expect, it } from "vitest";
import { RUNNER_NAV, isActiveItem, sectionTabsFor } from "@/components/layout/nav-config";

describe("navigation", () => {
  it("has the six sections in order, four on the mobile bar", () => {
    expect(RUNNER_NAV.map((i) => i.label)).toEqual(["Today", "Train", "Explore", "Community", "Events", "Profile"]);
    expect(RUNNER_NAV.filter((i) => i.mobilePrimary).map((i) => i.label)).toEqual([
      "Today",
      "Train",
      "Explore",
      "Community",
    ]);
  });

  it("keeps a section highlighted on its sub-pages", () => {
    const train = RUNNER_NAV.find((i) => i.label === "Train")!;
    const explore = RUNNER_NAV.find((i) => i.label === "Explore")!;
    const community = RUNNER_NAV.find((i) => i.label === "Community")!;
    expect(isActiveItem("/workouts/new", train)).toBe(true);
    expect(isActiveItem("/programmes/couch-to-5k", train)).toBe(true);
    expect(isActiveItem("/routes/kbr-park-nature-trail", explore)).toBe(true);
    expect(isActiveItem("/clubs/dawn-runners", community)).toBe(true);
    expect(isActiveItem("/events", train)).toBe(false);
    expect(isActiveItem("/reportsx", train)).toBe(false);
  });

  it("shows section tabs only inside sections", () => {
    expect(sectionTabsFor("/schedule")?.map((t) => t.label)).toEqual([
      "Overview",
      "HYD Coach",
      "Race prep",
      "Schedule",
      "Programmes",
      "Workouts",
      "Activities",
      "Performance",
      "Reports",
      "Recovery",
      "Strength",
    ]);
    expect(sectionTabsFor("/runs/abc")?.[0].href).toBe("/explore");
    expect(sectionTabsFor("/events")).toBeNull();
    expect(sectionTabsFor("/dashboard")).toBeNull();
  });
});
