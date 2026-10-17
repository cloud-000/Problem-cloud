import { describe, expect, test } from "bun:test";
import {
    astToHtml,
    parseMathStatement,
    segmentStatement,
    parseImageAttributes,
    parseAsyAttributes,
} from "./math-parser";

describe("image dimension and proxying parser extensions", () => {
    test("parseImageAttributes extracts width, height, and label correctly", () => {
        expect(parseImageAttributes("width=300 height=200")).toEqual({
            label: undefined,
            width: 300,
            height: 200,
        });

        expect(parseImageAttributes("My Diagram width=400 height=150")).toEqual({
            label: "My Diagram",
            width: 400,
            height: 150,
        });

        expect(parseImageAttributes("300x200")).toEqual({
            label: undefined,
            width: 300,
            height: 200,
        });
    });

    test("parseAsyAttributes extracts imageSrc and dimensions", () => {
        expect(
            parseAsyAttributes("https://latex.artofproblemsolving.com/diag.png width=500 height=400"),
        ).toEqual({
            imageSrc: "https://latex.artofproblemsolving.com/diag.png",
            width: 500,
            height: 400,
        });
    });

    test("resolves known AoPS diagram hashes to intrinsic dimensions", () => {
        // Problem 1 diagram on /library: 56638188764158bdffa266bc933d11b6acd2fb76 -> 504x504
        const source =
            "[asy=https://latex.artofproblemsolving.com/5/6/6/56638188764158bdffa266bc933d11b6acd2fb76.png]code[/asy]";
        const ast = parseMathStatement(source);
        expect(ast[0]).toMatchObject({
            type: "asy",
            width: 504,
            height: 504,
        });

        const segments = segmentStatement(ast);
        expect(segments[0]).toMatchObject({
            kind: "asy",
            width: 504,
            height: 504,
        });
    });

    test("astToHtml emits width, height, aspect-ratio style and proxied media URL", () => {
        const source =
            "[asy=https://latex.artofproblemsolving.com/5/6/6/56638188764158bdffa266bc933d11b6acd2fb76.png]code[/asy]";
        const html = astToHtml(parseMathStatement(source));
        expect(html).toContain('width="504"');
        expect(html).toContain('height="504"');
        expect(html).toContain('style="aspect-ratio: 504 / 504;"');
        expect(html).toContain('/api/media?url=https%3A%2F%2Flatex.artofproblemsolving.com');
    });

    test("splitMarkdownImages preserves dimensions from alt text", () => {
        const source =
            "![Diagram|300x200](https://cdn.jsdelivr.net/gh/cloud-000/Math-Images@main/test.png)";
        const ast = parseMathStatement(source);
        const imgNode = ast.find((n) => n.type === "img");
        expect(imgNode).toMatchObject({
            type: "img",
            label: "Diagram",
            width: 300,
            height: 200,
        });
    });
});
