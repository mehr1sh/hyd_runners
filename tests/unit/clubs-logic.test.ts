import { describe, expect, it } from "vitest";
import { inviteUrl, parseClubForm, slugify } from "@/features/clubs/logic";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
};

describe("clubs", () => {
  it("makes web addresses from names", () => {
    expect(slugify("KBR Dawn Runners!")).toBe("kbr-dawn-runners");
    expect(slugify("  Café — Runners_Club  ")).toBe("cafe-runners-club");
    expect(slugify("a".repeat(80))).toHaveLength(60);
  });

  it("parses the club form, deriving the slug when it is blank", () => {
    expect(parseClubForm(form({ name: "Necklace Road Runners", joinPolicy: "open", area: "" }))).toEqual({
      ok: true,
      data: {
        name: "Necklace Road Runners",
        slug: "necklace-road-runners",
        description: "",
        area: null,
        homeLocationId: null,
        joinPolicy: "open",
      },
    });
    expect(parseClubForm(form({ name: "X", joinPolicy: "open" })).ok).toBe(false);
    expect(parseClubForm(form({ name: "Good name", slug: "Bad Slug", joinPolicy: "open" }))).toEqual({
      ok: false,
      message: "Use lowercase letters, numbers and hyphens.",
    });
    expect(parseClubForm(form({ name: "Good name", joinPolicy: "everyone" })).ok).toBe(false);
  });

  it("builds invite links on the site URL", () => {
    expect(inviteUrl("https://hydrunners.vercel.app/", "abc123")).toBe(
      "https://hydrunners.vercel.app/clubs/join/abc123",
    );
  });
});
