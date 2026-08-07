import { describe, expect, test } from "bun:test";
import { markdownToHtml } from "./markdown";
import { astToHtml, parseMathStatement } from "./math-parser";

describe("block structure", () => {
    test("blank lines become paragraphs", () => {
        expect(markdownToHtml("First idea.\n\nSecond idea.")).toBe(
            "<p>First idea.</p><p>Second idea.</p>",
        );
    });

    test("a single newline is a hard break, not a reflow", () => {
        // The whole point: a model puts each step on its own line and expects it
        // to stay there.
        expect(markdownToHtml("Step one\nStep two")).toBe("<p>Step one<br />Step two</p>");
    });

    test("collapses runs of blank lines rather than emitting empty paragraphs", () => {
        expect(markdownToHtml("a\n\n\n\nb")).toBe("<p>a</p><p>b</p>");
    });

    test("bulleted lists", () => {
        expect(markdownToHtml("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
    });

    test("numbered lists, in either delimiter", () => {
        expect(markdownToHtml("1. one\n2) two")).toBe("<ol><li>one</li><li>two</li></ol>");
    });

    test("a list ends where prose resumes", () => {
        expect(markdownToHtml("- one\n\nAfter.")).toBe("<ul><li>one</li></ul><p>After.</p>");
    });

    test("headings clamp to a real tag", () => {
        expect(markdownToHtml("### Setup")).toBe("<h3>Setup</h3>");
        expect(markdownToHtml("####### Deep")).toBe("<p>####### Deep</p>");
    });

    test("blockquotes nest their own blocks", () => {
        expect(markdownToHtml("> quoted\n> more")).toBe(
            "<blockquote><p>quoted<br />more</p></blockquote>",
        );
    });

    test("fenced code is verbatim and skipped by KaTeX", () => {
        const html = markdownToHtml("```py\nx = **1**\n```");
        expect(html).toContain("katex-ignore");
        expect(html).toContain("x = **1**");
        expect(html).not.toContain("<strong>");
    });

    test("an unterminated fence still closes", () => {
        expect(markdownToHtml("```\nx = 1")).toContain("x = 1");
    });

    test("horizontal rules", () => {
        expect(markdownToHtml("a\n\n---\n\nb")).toBe("<p>a</p><hr /><p>b</p>");
    });

    test("pipe tables reuse the statement table renderer", () => {
        const html = markdownToHtml("| n | f(n) |\n| --- | --- |\n| 1 | 2 |");
        expect(html).toContain('<table class="pc-table">');
        expect(html).toContain("<th>n</th>");
        expect(html).toContain("<td>2</td>");
    });
});

describe("inline markup", () => {
    test("bold, italic, strike, code", () => {
        expect(markdownToHtml("**b** *i* ~~s~~")).toBe(
            "<p><strong>b</strong> <em>i</em> <s>s</s></p>",
        );
        expect(markdownToHtml("`code`")).toContain("<code");
    });

    test("links are sanitized like every other href", () => {
        expect(markdownToHtml("[docs](https://example.com)")).toContain(
            '<a href="https://example.com"',
        );
        expect(markdownToHtml("[x](javascript:alert(1))")).toContain('href="#"');
    });

    test("text is escaped", () => {
        expect(markdownToHtml("<script>alert(1)</script>")).toBe(
            "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
        );
    });

    test("a code span is verbatim", () => {
        expect(markdownToHtml("`**not bold**`")).not.toContain("<strong>");
    });
});

describe("math is masked before any markup rule runs", () => {
    test("subscripts do not become emphasis", () => {
        expect(markdownToHtml("$x_1 + x_2$")).toBe("<p>$x_1 + x_2$</p>");
    });

    test("asterisks inside math are not bold", () => {
        expect(markdownToHtml("$a*b*c$")).toBe("<p>$a*b*c$</p>");
    });

    test("a display block keeps its delimiters and its own paragraph", () => {
        expect(markdownToHtml("Note:\n\n$$a^2 - b^2$$")).toBe("<p>Note:</p><p>$$a^2 - b^2$$</p>");
    });

    test("a dash inside math never opens a list", () => {
        expect(markdownToHtml("$$\n- b\n$$")).toBe("<p>$$\n- b\n$$</p>");
    });

    test("a comparison inside math is escaped for the DOM, as it always was", () => {
        // KaTeX reads text content, so the entity decodes back to `<` before it
        // parses. This matches how statements have always rendered.
        expect(markdownToHtml("$a < b$")).toBe("<p>$a &lt; b$</p>");
    });

    test("markup around math still works", () => {
        expect(markdownToHtml("**Try** $x = 2$")).toBe(
            "<p><strong>Try</strong> $x = 2$</p>",
        );
    });
});

describe("arithmetic is not markup", () => {
    test("spaced asterisks stay literal", () => {
        expect(markdownToHtml("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>");
    });

    test("a bare underscore pair is not emphasis", () => {
        // `_italic_` is unsupported on purpose: `x_1` outside math is common here.
        expect(markdownToHtml("x_1 and y_2")).toBe("<p>x_1 and y_2</p>");
    });
});

describe("the BBCode statement path is untouched", () => {
    // A regression fence: every problem in the app renders through this call, and
    // the markdown work must not have changed a single character of it.
    const cases = [
        "The value of $x$ is [b]five[/b].",
        "A [i]nested [b]tag[/b][/i] and a [url=https://x.test]link[/url].",
        "Line one\nLine two\n\nLine four",
        "- not a list\n- still not a list",
        "**not bold**",
        "[code]x = 1[/code]",
        "<table><tr><td>a</td></tr></table>",
    ];

    for (const source of cases) {
        test(`unchanged: ${JSON.stringify(source.slice(0, 32))}`, () => {
            const html = astToHtml(parseMathStatement(source));
            expect(html).not.toContain("<p>");
            expect(html).not.toContain("<br />");
        });
    }

    test("statements still collapse newlines exactly as before", () => {
        expect(astToHtml(parseMathStatement("a\n\nb"))).toBe("a\n\nb");
    });
});
