import { describe, expect, test } from "bun:test";
import { astToHtml, parseMathStatement, segmentStatement } from "./math-parser";
import { parseMarkdown } from "./markdown";

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

describe("statement segmentation", () => {
    test("extracts centered asy diagram as interactive segment (e.g. Problem 2106)", () => {
        const source =
            "The wheel is shown.<center>[asy=https://latex.artofproblemsolving.com/diag.png]draw((0,0)--(1,1));[/asy]</center>Find the area.";
        const segments = segmentStatement(parseMathStatement(source));

        expect(segments).toEqual([
            { kind: "html", html: "The wheel is shown." },
            {
                kind: "asy",
                imageSrc: "https://latex.artofproblemsolving.com/diag.png",
                code: "draw((0,0)--(1,1));",
            },
            { kind: "html", html: "Find the area." },
        ]);
    });

    test("drops whitespace inside center wrapper around asy diagram", () => {
        const source =
            "<center>\n  [asy=https://example.com/foo.png]\n  draw();\n  [/asy]\n</center>";
        const segments = segmentStatement(parseMathStatement(source));

        expect(segments).toEqual([
            {
                kind: "asy",
                imageSrc: "https://example.com/foo.png",
                code: "draw();",
            },
        ]);
    });

    test("preserves non-whitespace centered content around diagram", () => {
        const source =
            "<center>Figure 1: Spinner<br>[asy=https://example.com/spin.png]draw();[/asy]<br>Note</center>";
        const segments = segmentStatement(parseMathStatement(source));

        expect(segments).toEqual([
            {
                kind: "html",
                html: "<div class=\"pc-center\">Figure 1: Spinner<br /></div>",
            },
            {
                kind: "asy",
                imageSrc: "https://example.com/spin.png",
                code: "draw();",
            },
            {
                kind: "html",
                html: "<div class=\"pc-center\"><br />Note</div>",
            },
        ]);
    });

    test("leaves code-only asy diagram in HTML buffer as fallback pre", () => {
        const source = "<center>[asy]draw((0,0)--(1,1));[/asy]</center>";
        const segments = segmentStatement(parseMathStatement(source));

        expect(segments).toHaveLength(1);
        expect(segments[0].kind).toBe("html");
        if (segments[0].kind === "html") {
            expect(segments[0].html).toContain("<pre");
            expect(segments[0].html).toContain("draw((0,0)--(1,1));");
        }
    });

    test("extracts markdown images from paragraphs into interactive img segments", () => {
        const source = "Paragraph before.\n\n![A triangle](https://example.com/tri.png)\n\nParagraph after.";
        const segments = segmentStatement(parseMarkdown(source));

        expect(segments).toEqual([
            { kind: "html", html: "<p>Paragraph before.</p>" },
            {
                kind: "img",
                src: "https://example.com/tri.png",
                alt: "A triangle",
            },
            { kind: "html", html: "<p>Paragraph after.</p>" },
        ]);
    });
});
