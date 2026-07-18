/**
 * Recursive-descent parser over the Asymptote subset. Produces a list of
 * statement AST nodes, each carrying its source span (`start`/`end`).
 *
 * ROBUSTNESS POLICY: a statement is either fully understood (a typed AST node)
 * or captured verbatim as an `UnknownStmt` spanning through its terminating `;`.
 * Recovery happens at `;` boundaries, so one unrecognized statement becomes one
 * raw element and everything around it still parses. The parser never throws to
 * the caller — internal `ParseError`s are caught and turned into `unknown`.
 */

import type { Token } from "./tokens";
import { decodeString, tokenize } from "./lexer";
import type {
    ArcExpr,
    AffineArcExpr,
    AffineEllipseExpr,
    AsyStmt,
    CircleExpr,
    DeclStmt,
    GuideExpr,
    PairExpr,
    PathExpr,
    PenExpr,
    RefExpr,
} from "./ast";
import { namedColorToRGB } from "../scene/pen";

/** A statement plus its exact source span. */
export type SpannedStmt = AsyStmt & { start: number; end: number };

class ParseError extends Error {}

const CALL_STMTS = new Set(["draw", "dot", "label", "fill", "filldraw"]);
const DASH_KEYWORDS = new Set(["dashed", "dotted", "longdashed"]);

class Parser {
    private pos = 0;
    constructor(private readonly tokens: Token[]) {}

    private peek(k = 0): Token {
        return this.tokens[Math.min(this.pos + k, this.tokens.length - 1)];
    }

    private next(): Token {
        const t = this.tokens[this.pos];
        if (this.pos < this.tokens.length - 1) this.pos++;
        return t;
    }

    private prevEnd(): number {
        return this.tokens[Math.max(0, this.pos - 1)].end;
    }

    private at(kind: Token["kind"]): boolean {
        return this.peek().kind === kind;
    }

    private atEof(): boolean {
        return this.peek().kind === "eof";
    }

    private expect(kind: Token["kind"]): Token {
        if (!this.at(kind)) throw new ParseError(`expected ${kind}, got ${this.peek().kind}`);
        return this.next();
    }

    private expectNumber(): number {
        return parseFloat(this.expect("number").value);
    }

    // --- program ---------------------------------------------------------------

    parseProgram(): SpannedStmt[] {
        const out: SpannedStmt[] = [];
        while (!this.atEof()) {
            // Skip stray empty statements.
            if (this.at("semi")) {
                this.next();
                continue;
            }
            const start = this.peek().start;
            const mark = this.pos;
            try {
                const stmt = this.parseStatement();
                out.push({ ...stmt, start, end: this.prevEnd() });
            } catch (err) {
                if (!(err instanceof ParseError)) throw err;
                this.pos = mark;
                const end = this.resync();
                out.push({ kind: "unknown", start, end });
            }
        }
        return out;
    }

    /** Advance to and consume the next `;` (or EOF). Returns the end offset. */
    private resync(): number {
        while (!this.atEof() && !this.at("semi")) this.next();
        if (this.at("semi")) this.next();
        return this.prevEnd();
    }

    // --- statements ------------------------------------------------------------

    private parseStatement(): AsyStmt {
        const t = this.peek();
        if (t.kind === "ident") {
            if (CALL_STMTS.has(t.value) && this.peek(1).kind === "lparen") {
                return this.parseCall(t.value);
            }
            if ((t.value === "pair" || t.value === "path") && this.peek(1).kind === "ident") {
                return this.parseDecl(t.value);
            }
        }
        throw new ParseError(`unrecognized statement start: ${t.kind}`);
    }

    private parseCall(name: string): AsyStmt {
        this.next(); // ident
        this.expect("lparen");
        let stmt: AsyStmt;
        switch (name) {
            case "draw":
                stmt = this.parseDrawArgs();
                break;
            case "dot":
                stmt = this.parseDotArgs();
                break;
            case "label":
                stmt = this.parseLabelArgs();
                break;
            case "fill":
            case "filldraw":
                stmt = this.parseFillArgs(name === "filldraw");
                break;
            default:
                throw new ParseError(`unknown call: ${name}`);
        }
        this.expect("rparen");
        this.expect("semi");
        return stmt;
    }

    private parseDrawArgs(): AsyStmt {
        const path = this.parsePathExpr();
        let pen: PenExpr | undefined;
        if (this.at("comma")) {
            this.next();
            pen = this.parsePenExpr();
        }
        return { kind: "draw", path, ...(pen ? { pen } : {}) };
    }

    private parseDotArgs(): AsyStmt {
        const at = this.parsePairOrRef();
        let pen: PenExpr | undefined;
        if (this.at("comma")) {
            this.next();
            pen = this.parsePenExpr();
        }
        return { kind: "dot", at, ...(pen ? { pen } : {}) };
    }

    private parseFillArgs(filldraw: boolean): AsyStmt {
        const path = this.parsePathExpr();
        let pen: PenExpr | undefined;
        let drawPen: PenExpr | undefined;
        if (this.at("comma")) {
            this.next();
            pen = this.parsePenExpr();
        }
        if (filldraw && this.at("comma")) {
            this.next();
            drawPen = this.parsePenExpr();
        }
        return {
            kind: "fill",
            path,
            filldraw,
            ...(pen ? { pen } : {}),
            ...(drawPen ? { drawPen } : {}),
        };
    }

    private parseLabelArgs(): AsyStmt {
        const text = decodeString(this.expect("string").value);
        let at: PairExpr | RefExpr | undefined;
        let align: PairExpr | RefExpr | undefined;
        let pen: PenExpr | undefined;
        while (this.at("comma")) {
            this.next();
            if (this.isPenStart()) {
                pen = this.parsePenExpr();
            } else {
                const val = this.parsePairOrRef();
                if (!at) at = val;
                else if (!align) align = val;
                else throw new ParseError("too many label positional args");
            }
        }
        return {
            kind: "label",
            text,
            ...(at ? { at } : {}),
            ...(align ? { align } : {}),
            ...(pen ? { pen } : {}),
        };
    }

    private parseDecl(declType: "pair" | "path"): AsyStmt {
        this.next(); // 'pair' | 'path'
        const name = this.expect("ident").value;
        this.expect("equals");
        const decl: DeclStmt = { kind: "decl", declType, name };
        if (declType === "pair") decl.pairValue = this.parsePair();
        else decl.pathValue = this.parsePathExpr();
        this.expect("semi");
        return decl;
    }

    // --- expressions -----------------------------------------------------------

    private parsePathExpr(): PathExpr {
        const t = this.peek();
        if (t.kind === "ident" && t.value === "shift" && this.peek(1).kind === "lparen") {
            return this.parseAffinePath();
        }
        if (t.kind === "ident" && t.value === "circle" && this.peek(1).kind === "lparen") {
            return this.parseCircle();
        }
        if (t.kind === "ident" && t.value === "arc" && this.peek(1).kind === "lparen") {
            return this.parseArc();
        }
        return this.parseGuide();
    }

    /** Parse only the canonical affine form produced by serialize.ts. */
    private parseAffinePath(): AffineEllipseExpr | AffineArcExpr {
        this.next(); // shift
        this.expect("lparen");
        const center = this.parsePairOrRef();
        this.expect("rparen");
        this.expect("star");
        if (this.expect("ident").value !== "transform") throw new ParseError("expected transform");
        this.expect("lparen");
        const translateX = this.expectNumber();
        this.expect("comma");
        const translateY = this.expectNumber();
        this.expect("comma");
        const xx = this.expectNumber();
        this.expect("comma");
        const xy = this.expectNumber();
        this.expect("comma");
        const yx = this.expectNumber();
        this.expect("comma");
        const yy = this.expectNumber();
        this.expect("rparen");
        if (translateX !== 0 || translateY !== 0) {
            throw new ParseError("canonical affine transform must be shiftless");
        }
        this.expect("star");
        const axisX: PairExpr = { kind: "pair", x: xx, y: yx };
        const axisY: PairExpr = { kind: "pair", x: xy, y: yy };
        const primitive = this.expect("ident").value;
        if (primitive === "unitcircle") {
            return { kind: "affine-ellipse", center, axisX, axisY };
        }
        if (primitive !== "arc") throw new ParseError("expected unitcircle or arc");
        this.expect("lparen");
        const localCenter = this.parsePair();
        this.expect("comma");
        const radius = this.expectNumber();
        this.expect("comma");
        const angle1 = this.expectNumber();
        this.expect("comma");
        const angle2 = this.expectNumber();
        this.expect("rparen");
        if (localCenter.x !== 0 || localCenter.y !== 0 || radius !== 1) {
            throw new ParseError("canonical affine arc must use the unit circle");
        }
        return { kind: "affine-arc", center, axisX, axisY, angle1, angle2 };
    }

    private parseCircle(): CircleExpr {
        this.next(); // 'circle'
        this.expect("lparen");
        const center = this.parsePairOrRef();
        this.expect("comma");
        const radius = this.expectNumber();
        this.expect("rparen");
        return { kind: "circle", center, radius };
    }

    private parseArc(): ArcExpr {
        this.next(); // 'arc'
        this.expect("lparen");
        const center = this.parsePairOrRef();
        this.expect("comma");
        const radius = this.expectNumber();
        this.expect("comma");
        const angle1 = this.expectNumber();
        this.expect("comma");
        const angle2 = this.expectNumber();
        this.expect("rparen");
        return { kind: "arc", center, radius, angle1, angle2 };
    }

    private parseGuide(): GuideExpr {
        const nodes: (PairExpr | RefExpr)[] = [this.parseGuideNode()];
        const joins: ("--" | "..")[] = [];
        let cyclic = false;
        while (this.at("join")) {
            const join = this.next().value as "--" | "..";
            if (this.at("ident") && this.peek().value === "cycle") {
                this.next();
                joins.push(join);
                cyclic = true;
                break;
            }
            joins.push(join);
            nodes.push(this.parseGuideNode());
        }
        return { kind: "guide", nodes, joins, cyclic };
    }

    private parseGuideNode(): PairExpr | RefExpr {
        if (this.at("lparen")) return this.parsePair();
        if (this.at("ident")) {
            const name = this.next().value;
            if (name === "cycle") throw new ParseError("unexpected cycle");
            return { kind: "ref", name };
        }
        throw new ParseError("expected guide node");
    }

    private parsePairOrRef(): PairExpr | RefExpr {
        if (this.at("lparen")) return this.parsePair();
        if (this.at("ident")) return { kind: "ref", name: this.next().value };
        throw new ParseError("expected pair or reference");
    }

    private parsePair(): PairExpr {
        this.expect("lparen");
        const x = this.expectNumber();
        this.expect("comma");
        const y = this.expectNumber();
        this.expect("rparen");
        return { kind: "pair", x, y };
    }

    // --- pens ------------------------------------------------------------------

    /** True when the upcoming arg is (heuristically) a pen rather than a position. */
    private isPenStart(): boolean {
        const t = this.peek();
        if (t.kind !== "ident") return false;
        if (DASH_KEYWORDS.has(t.value)) return true;
        // Pen-valued functions.
        if (
            (t.value === "rgb" ||
                t.value === "linewidth" ||
                t.value === "opacity" ||
                t.value === "fontsize") &&
            this.peek(1).kind === "lparen"
        ) {
            return true;
        }
        // A known named color (e.g. `red`) is a pen; an unknown ident (e.g. a
        // compass direction `N`) is treated as a position/align.
        return namedColorToRGB(t.value) !== undefined;
    }

    private parsePenExpr(): PenExpr {
        const pen: PenExpr = {};
        this.parsePenAtom(pen);
        while (this.at("plus")) {
            this.next();
            this.parsePenAtom(pen);
        }
        return pen;
    }

    private parsePenAtom(pen: PenExpr): void {
        if (!this.at("ident")) throw new ParseError("expected pen atom");
        const name = this.next().value;
        if (this.at("lparen")) {
            this.next();
            const args = this.parseNumberList();
            this.expect("rparen");
            switch (name) {
                case "rgb":
                    if (args.length !== 3) throw new ParseError("rgb expects 3 args");
                    pen.rgb = { r: args[0], g: args[1], b: args[2] };
                    break;
                case "linewidth":
                    pen.lineWidth = args[0];
                    break;
                case "opacity":
                    pen.opacity = args[0];
                    break;
                case "fontsize":
                    pen.fontSize = args[0];
                    break;
                default:
                    throw new ParseError(`unknown pen function: ${name}`);
            }
        } else if (DASH_KEYWORDS.has(name)) {
            pen.dash = name;
        } else {
            // Named color — known or unknown; the exact name is preserved for
            // faithful round-trip.
            pen.namedColor = name;
        }
    }

    private parseNumberList(): number[] {
        const nums: number[] = [this.expectNumber()];
        while (this.at("comma")) {
            this.next();
            nums.push(this.expectNumber());
        }
        return nums;
    }
}

/** Tokenize + parse asy source into spanned statements. */
export function parseProgram(src: string): SpannedStmt[] {
    return new Parser(tokenize(src)).parseProgram();
}
