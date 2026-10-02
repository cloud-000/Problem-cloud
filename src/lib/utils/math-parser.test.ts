import { describe, expect, test } from "bun:test";
import { astToHtml, matchListItem, parseMathStatement, preprocessFormatting, segmentStatement, MATH_REGION_REGEX } from "./math-parser";
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

describe("list item detection and block parsing in math statements", () => {
    test("detects standard unordered bullet markers", () => {
        expect(matchListItem("* item")).toEqual({ ordered: false, content: "item" });
        expect(matchListItem("- item")).toEqual({ ordered: false, content: "item" });
        expect(matchListItem("+ item")).toEqual({ ordered: false, content: "item" });
        expect(matchListItem("• item")).toEqual({ ordered: false, content: "item" });
        expect(matchListItem("•item")).toEqual({ ordered: false, content: "item" });
    });

    test("detects ordered list markers", () => {
        expect(matchListItem("1. item")).toEqual({ ordered: true, content: "item" });
        expect(matchListItem("2) item")).toEqual({ ordered: true, content: "item" });
        expect(matchListItem("(3) item")).toEqual({ ordered: true, content: "item" });
    });

    test("detects bare MediaWiki bullets without space", () => {
        expect(matchListItem("*If $x=1$, then $y=2$")).toEqual({
            ordered: false,
            content: "If $x=1$, then $y=2$",
        });
        expect(matchListItem("*Item without space")).toEqual({
            ordered: false,
            content: "Item without space",
        });
    });

    test("disambiguates bare asterisks from bold, italics, dividers, and comments", () => {
        expect(matchListItem("***")).toBeNull();
        expect(matchListItem("****")).toBeNull();
        expect(matchListItem("**bold text**")).toBeNull();
        expect(matchListItem("*italic text*")).toBeNull();
        expect(matchListItem("*Note:* This is important")).toBeNull();
        expect(matchListItem("*Remark.* Some comment")).toBeNull();
        expect(matchListItem("*/")).toBeNull();
    });

    test("renders standard bullet list with blank lines between items (2024 AMC 10A #13)", () => {
        const source = [
            "A game is played under the following rules:",
            "",
            "* A player rolls a fair 6-sided die.",
            "",
            "* If the roll is even, the score increases by 2.",
            "",
            "* If the roll is odd, the score decreases by 1.",
            "",
            "Find the probability.",
        ].join("\n");

        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>A player rolls a fair 6-sided die.</li>");
        expect(html).toContain("<li>If the roll is even, the score increases by 2.</li>");
        expect(html).toContain("<li>If the roll is odd, the score decreases by 1.</li>");
        expect(html).toContain("</ul>");
        expect(html).toContain("Find the probability.");
    });

    test("renders bare MediaWiki bullet list without space (2024 AMC 10A #20)", () => {
        const source = [
            "Consider the conditions:",
            "*If $a < b$, then $f(a) < f(b)$.",
            "*If $a = b$, then $f(a) = f(b)$.",
            "*If $a > b$, then $f(a) > f(b)$.",
            "What is the maximum value?",
        ].join("\n");

        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>If $a &lt; b$, then $f(a) &lt; f(b)$.</li>");
        expect(html).toContain("<li>If $a = b$, then $f(a) = f(b)$.</li>");
        expect(html).toContain("<li>If $a &gt; b$, then $f(a) &gt; f(b)$.</li>");
        expect(html).toContain("</ul>");
    });

    test("supports indented continuation lines in list items", () => {
        const source = [
            "* Step 1: Initialize variables",
            "  with default values.",
            "* Step 2: Iterate over entries.",
        ].join("\n");

        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>Step 1: Initialize variables\nwith default values.</li>");
        expect(html).toContain("<li>Step 2: Iterate over entries.</li>");
        expect(html).toContain("</ul>");
    });

    test("protects verbatim [code] and [asy] from list splitting", () => {
        const source = [
            "Before code:",
            "[code]",
            "* not a bullet",
            "* still not a bullet",
            "[/code]",
            "After code.",
        ].join("\n");

        const html = astToHtml(parseMathStatement(source));
        expect(html).not.toContain("<ul>");
        expect(html).toContain("* not a bullet");
    });
});

describe("formatting preprocessing in math statements", () => {
    test("converts MediaWiki bold and italics to BBCode tags", () => {
        const source = "This is '''bold''' and this is ''italic''.";
        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("<em>italic</em>");
    });

    test("converts markdown bold to strong", () => {
        const source = "This is **bold** text.";
        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("<strong>bold</strong>");
    });

    test("preserves prime derivatives in math regions without converting to italics", () => {
        const source = "Let $f''(x) + f(x) = 0$ and $y'' = 1$.";
        const preprocessed = preprocessFormatting(source);
        expect(preprocessed).toBe(source);

        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("$f&#39;&#39;(x) + f(x) = 0$");
        expect(html).not.toContain("<em>");
    });

    test("preserves bold and italic delimiters inside verbatim [code]", () => {
        const source = "[code]'''not bold'''[/code]";
        const preprocessed = preprocessFormatting(source);
        expect(preprocessed).toBe(source);
    });

    test("converts HTML formatting tags (b, strong, i, em, u, s, del) and <p> to styled nodes", () => {
        const source = "<b>bold</b> <strong>strong</strong> <i>italic</i> <em>em</em> <u>underline</u> <s>strike</s> <p>Paragraph</p>";
        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("<strong>strong</strong>");
        expect(html).toContain("<em>italic</em>");
        expect(html).toContain("<em>em</em>");
        expect(html).toContain("<u>underline</u>");
        expect(html).toContain("<s>strike</s>");
        expect(html).toContain("Paragraph");
        expect(html).not.toContain("&lt;b&gt;");
        expect(html).not.toContain("&lt;p&gt;");
    });

    test("preserves math comparisons like $x < y$ without treating them as HTML", () => {
        const source = "If $x < y$ and $a > b$, then $f(x) < f(y)$.";
        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("$x &lt; y$");
        expect(html).toContain("$a &gt; b$");
        expect(html).not.toContain("<strong>");
    });

    test("parses HTML unordered and ordered lists into semantic list elements", () => {
        const source = '<ul style="list-style-type:square;">\n  <li>First item with $x$</li>\n  <li>Second item with <b>bold</b></li>\n</ul>';
        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>First item with $x$</li>");
        expect(html).toContain("<li>Second item with <strong>bold</strong></li>");
        expect(html).toContain("</ul>");
        expect(html).not.toContain("&lt;ul");
        expect(html).not.toContain("&lt;li");
    });

    test("parses 2024 AMC 10A #13 Solution 1 HTML list and formatting structure", () => {
        const source = `Note that:
<ul style="list-style-type:square;">
  <li>Applying $T_1$ and then $T_2$ gives $(x,y)\\to(x+2,y)\\to(-y,x+2).$ <p>
Therefore, $T_1$ and $T_2$ do not commute.
</li>
<li>Applying $T_1$ and then $T_3$ commute. They form a <b>glide reflection</b>.
</li>
</ul>
<u><b>Remark</b></u>`;
        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>Applying $T_1$");
        expect(html).toContain("<strong>glide reflection</strong>");
        expect(html).toContain("<u><strong>Remark</strong></u>");
        expect(html).not.toContain("&lt;ul");
        expect(html).not.toContain("&lt;li");
    });

describe("LaTeX math environments (align*, align, gather*, equation*, etc.)", () => {
    test("MATH_REGION_REGEX matches display environments with and without asterisks", () => {
        const text = "\\begin{align*} x &= 1 \\\\ y &= 2 \\end{align*} and \\begin{gather} a = b \\end{gather}";
        const matches = text.match(MATH_REGION_REGEX);
        expect(matches).not.toBeNull();
        expect(matches?.length).toBe(2);
        expect(matches?.[0]).toBe("\\begin{align*} x &= 1 \\\\ y &= 2 \\end{align*}");
        expect(matches?.[1]).toBe("\\begin{gather} a = b \\end{gather}");
    });

    test("preserves prime derivatives and formatting inside align*", () => {
        const source = "\\begin{align*}\nf''(x) &= 0 \\\\n**bold** &= 1\n\\end{align*}";
        const preprocessed = preprocessFormatting(source);
        // Primes f'' and **bold** inside align* are masked and preserved untouched
        expect(preprocessed).toContain("f''(x)");
        expect(preprocessed).toContain("**bold**");
        expect(preprocessed).not.toContain("[i]");
    });

    test("unwraps single dollar delimiters around display environments for KaTeX", () => {
        const source = "We have $\\begin{align*}\nx &= 1 \\\\ny &= 2\n\\end{align*}$ in our calculation.";
        const preprocessed = preprocessFormatting(source);
        expect(preprocessed).toContain("We have \\begin{align*}");
        expect(preprocessed).toContain("\\end{align*} in our calculation.");
        expect(preprocessed).not.toContain("$\begin{align*}");
    });

    test("does not split multiline align* blocks into bullet list items when lines contain * or numbers", () => {
        const source = [
            "We have the following system:",
            "\\begin{align*}",
            "* x &= 1 \\\\",
            "1.5 &= y",
            "\\end{align*}",
            "Solve for x and y.",
        ].join("\n");

        const ast = parseMathStatement(source);
        // Should not produce a list node inside the align block
        const listNodes = ast.filter((n) => n.type === "list");
        expect(listNodes.length).toBe(0);

        const html = astToHtml(ast);
        expect(html).toContain("\\begin{align*}");
        expect(html).toContain("* x &amp;= 1 \\\\");
        expect(html).toContain("\\end{align*}");
    });

    test("renders intact align* block for KaTeX auto-render in Solution 17 fixture", () => {
        const source = [
            "From the answer choices, we have",
            "\\begin{align*}",
            "    \\frac{1}{5} + \\frac{x}{40} &= \\frac{1}{4} + \\frac{5-x}{40}\\\\",
            "    8 + x &= 10 + 5-x,",
            "\\end{align*}",
            "so $2x = 7$.",
        ].join("\n");

        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain("\\begin{align*}");
        expect(html).toContain("\\end{align*}");
        expect(html).not.toContain("<ul>");
        expect(html).not.toContain("<li>");
    });
});
});
