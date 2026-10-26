import { describe, it, expect } from "vitest";
import { citySlug, isPlaceId, parsePlace, parseSearch, writeReviewUrl } from "./places";

const ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

describe("Google Listing helpers", () => {
  it("accepts a real place ID and rejects anything else", () => {
    expect(isPlaceId(ID)).toBe(true);
    expect(isPlaceId("../places/x")).toBe(false);
    expect(isPlaceId("short")).toBe(false);
    expect(isPlaceId("ChIJ space here 123")).toBe(false);
  });

  it("builds Google's write-a-review link", () => {
    expect(writeReviewUrl(ID)).toBe(`https://search.google.com/local/writereview?placeid=${ID}`);
  });

  it("parses search results and drops malformed ones", () => {
    const out = parseSearch({
      places: [
        { id: ID, displayName: { text: "Vault Studios" }, formattedAddress: "1 Main St, Atlanta, GA" },
        { id: "bad id!", displayName: { text: "Nope" } },
      ],
    });
    expect(out).toEqual([{ placeId: ID, name: "Vault Studios", address: "1 Main St, Atlanta, GA" }]);
    expect(parseSearch(null)).toEqual([]);
  });

  it("keeps Google's reviews as returned, low ratings included, with attribution", () => {
    const p = parsePlace(
      {
        id: ID,
        displayName: { text: "Vault Studios" },
        rating: 3.94,
        userRatingCount: 41,
        googleMapsUri: "https://maps.google.com/?cid=1",
        reviews: [
          { rating: 5, text: { text: "Great room" }, relativePublishTimeDescription: "a week ago", authorAttribution: { displayName: "Ana", uri: "https://www.google.com/maps/contrib/1", photoUri: "https://lh3.googleusercontent.com/a" } },
          { rating: 1, text: { text: "Late start" }, authorAttribution: { displayName: "Ben", uri: "javascript:alert(1)" } },
        ],
      },
      ID,
    )!;
    expect(p.rating).toBe(3.9);
    expect(p.count).toBe(41);
    expect(p.reviews.map((r) => r.rating)).toEqual([5, 1]);
    expect(p.reviews[0].authorUrl).toBe("https://www.google.com/maps/contrib/1");
    expect(p.reviews[1].authorUrl).toBeNull(); // only https links survive
    expect(p.reviewsUrl).toBe("https://maps.google.com/?cid=1");
  });

  it("makes a stable City Page key", () => {
    expect(citySlug("Los Angeles", "CA")).toBe("los-angeles-ca");
    expect(citySlug("São Paulo", null)).toBe("sao-paulo");
    expect(citySlug("  St. Louis ", "MO")).toBe("st-louis-mo");
  });
});
