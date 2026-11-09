import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  filterChips,
  filtersFromParams,
  filtersToParams,
  parseRouteQuery,
  searchHref,
  type Place,
} from "@/features/routes/search";

const places: Place[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "KBR Park", lat: 17.42, lon: 78.42 },
  { id: "22222222-2222-4222-8222-222222222222", name: "Necklace Road", lat: 17.41, lon: 78.47 },
  { id: "33333333-3333-4333-8333-333333333333", name: "Park", lat: 17.3, lon: 78.3 },
];

describe("natural-language route queries", () => {
  it("parses a typical request into typed filters and says what it understood", () => {
    const { filters, understood } = parseRouteQuery("Flat 5k loop near KBR Park with lights", places);
    expect(filters).toMatchObject({
      minKm: 4.3,
      maxKm: 5.8,
      terrain: ["flat"],
      lighting: ["lit"],
      loop: true,
      placeId: places[0].id,
      text: null,
      sort: "nearest",
    });
    expect(understood).toEqual(["about 5 km (4.3–5.8)", "near KBR Park", "flat", "lit", "loop"]);
  });

  it("prefers the longest place name", () => {
    expect(parseRouteQuery("run in kbr park", places).filters.placeId).toBe(places[0].id);
  });

  it("reads ranges, bounds, miles and race names", () => {
    expect(parseRouteQuery("between 3 and 6 km", places).filters).toMatchObject({ minKm: 3, maxKm: 6 });
    expect(parseRouteQuery("3-6k trail", places).filters).toMatchObject({ minKm: 3, maxKm: 6, surface: ["trail"] });
    expect(parseRouteQuery("under 4 km", places).filters).toMatchObject({ minKm: null, maxKm: 4 });
    expect(parseRouteQuery("at least 10km hilly", places).filters).toMatchObject({
      minKm: 10,
      maxKm: null,
      terrain: ["hilly"],
    });
    expect(parseRouteQuery("3 miles", places).filters).toMatchObject({ minKm: 4.1, maxKm: 5.6 });
    expect(parseRouteQuery("half marathon route", places).filters).toMatchObject({ minKm: 17.9, maxKm: 24.3 });
  });

  it("maps facilities, beginners, ratings and condition reports", () => {
    const { filters } = parseRouteQuery(
      "beginner friendly shady route with toilets and water, top rated, no hazards",
      places,
    );
    expect(filters).toMatchObject({
      beginner: true,
      shade: ["good"],
      toilets: true,
      water: true,
      minRating: 4,
      sort: "rating",
      noReports: true,
      text: null,
    });
  });

  it("keeps unknown words as plain search text, never as anything else", () => {
    const { filters, understood } = parseRouteQuery("gachibowli stadium'; drop table routes; --", places);
    expect(filters.surface).toEqual(["track"]);
    expect(filters.text).toBe("gachibowli drop table");
    expect(understood.at(-1)).toBe("matching “gachibowli drop table”");
  });

  it("caps distances and input length", () => {
    expect(parseRouteQuery("500 km", places).filters).toMatchObject({ minKm: null, maxKm: null });
    expect(parseRouteQuery("x".repeat(500), places).filters.text?.length).toBeLessThanOrEqual(200);
  });
});

describe("structured filters", () => {
  it("drops anything outside the whitelists and round-trips through the URL", () => {
    const f = filtersFromParams({
      text: " riverside ",
      place: "not-a-uuid",
      min: "8",
      max: "3",
      surface: ["trail", "lava", "road,track"],
      terrain: "flat",
      loop: "1",
      rating: "9",
      sort: "drop",
    });
    expect(f).toMatchObject({
      text: "riverside",
      placeId: null,
      minKm: 3,
      maxKm: 8,
      surface: ["trail", "road", "track"],
      terrain: ["flat"],
      loop: true,
      minRating: null,
      sort: "relevance",
    });
    expect(
      filtersFromParams(
        Object.fromEntries([...filtersToParams(f).keys()].map((k) => [k, filtersToParams(f).getAll(k)])),
      ),
    ).toEqual(f);
    expect(searchHref(EMPTY_FILTERS)).toBe("/routes");
  });

  it("builds removable chips", () => {
    const f = {
      ...EMPTY_FILTERS,
      placeId: places[0].id,
      sort: "nearest" as const,
      terrain: ["flat", "rolling"],
      loop: true,
    };
    const chips = filterChips(f, "KBR Park");
    expect(chips.map((c) => c.label)).toEqual(["Within 5 km of KBR Park", "Flat", "Rolling", "Loop"]);
    expect(chips[0].without).toMatchObject({ placeId: null, sort: "relevance" });
    expect(chips[1].without.terrain).toEqual(["rolling"]);
  });
});
