import { describe, expect, test } from "bun:test";
import { astToHtml, parseMathStatement } from "./math-parser";

describe("allowlisted HTML fragments in statements", () => {
    test("converts br variants to explicit line breaks and drops attributes", () => {
        const source = "before<br>middle<br />after<br class=ignored/>done";

        expect(astToHtml(parseMathStatement(source))).toBe(
            "before<br />middle<br />after<br />done",
        );
    });

    test("centers content without exposing source HTML", () => {
        const source = '<center class="ignored">$x^2$ and [b]text[/b]</center>';

        expect(astToHtml(parseMathStatement(source))).toBe(
            '<div class="pc-center">$x^2$ and <strong>text</strong></div>',
        );
    });

    test("supports breaks and tables inside centered content", () => {
        const source =
            "<center>top<br><table><tr><td>$x$<br>y</td></tr></table></center>";
        const html = astToHtml(parseMathStatement(source));

        expect(html).toContain('<div class="pc-center">top<br />');
        expect(html).toContain('<table class="pc-table">');
        expect(html).toContain("$x$<br />y");
    });

    test("keeps arbitrary and unterminated HTML escaped", () => {
        expect(astToHtml(parseMathStatement("<script>alert(1)</script>"))).toBe(
            "&lt;script&gt;alert(1)&lt;/script&gt;",
        );
        expect(astToHtml(parseMathStatement("<center>not closed"))).toBe(
            "&lt;center&gt;not closed",
        );
    });

    test("does not reinterpret HTML-looking text in verbatim BBCode", () => {
        const html = astToHtml(
            parseMathStatement("[code]<br><center>literal</center>[/code]"),
        );

        expect(html).toContain("&lt;br&gt;&lt;center&gt;literal&lt;/center&gt;");
        expect(html).not.toContain("<br />");
    });
});
