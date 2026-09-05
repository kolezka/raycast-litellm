import { describe, expect, it } from "vitest";
import { htmlToText, parseSearchResults } from "../src/lib/web/parse";

describe("htmlToText", () => {
  it("strips tags and keeps the text", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  // A page's script and style bodies are text to a naive tag-stripper, so the
  // model would receive minified JS as though it were page content.
  it("drops script and style bodies entirely", () => {
    expect(htmlToText("<style>p{color:red}</style><p>Real</p><script>var x=1;</script>")).toBe("Real");
  });

  it("decodes the entities a stripped page is left holding", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3 &quot;quotes&quot; &#39;n&#39; &nbsp;things</p>")).toBe(
      `Tom & Jerry <3 "quotes" 'n' things`,
    );
  });

  it("collapses the whitespace left behind by block tags", () => {
    expect(htmlToText("<div>one</div>\n\n\n   <div>two</div>")).toBe("one\n\ntwo");
  });

  it("returns an empty string for markup with no text", () => {
    expect(htmlToText("<html><head><title>x</title></head><body></body></html>")).toBe("");
  });
});

describe("parseSearchResults", () => {
  // Markup copied from a live lite.duckduckgo.com response: single-quoted class
  // attributes, and every href wrapped in a redirect carrying the real URL in
  // an encoded uddg parameter.
  const html = `
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.raycast.com%2Fstore&amp;rut=37e2" class='result-link'>Raycast - Store</a>
    <td class='result-snippet'>Extend Raycast with extensions.</td>
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fraycast%2Fextensions&amp;rut=bb41" class='result-link'>GitHub - raycast/extensions</a>
    <td class='result-snippet'>Everything you need to extend Raycast.</td>`;

  it("unwraps the redirect to the real destination", () => {
    expect(parseSearchResults(html)[0].url).toBe("https://www.raycast.com/store");
  });

  it("pairs each title with its snippet", () => {
    const results = parseSearchResults(html);
    expect(results).toHaveLength(2);
    expect(results[1].title).toBe("GitHub - raycast/extensions");
    expect(results[1].snippet).toBe("Everything you need to extend Raycast.");
  });

  it("returns nothing for a page with no results rather than throwing", () => {
    expect(parseSearchResults("<html><body>No results.</body></html>")).toEqual([]);
  });
});
