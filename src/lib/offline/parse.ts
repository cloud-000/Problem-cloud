/**
 * Runtime validation for everything that crosses into offline storage.
 *
 * `docs/offline-contracts.md` §1 is explicit that "a TypeScript assertion alone
 * is not validation". Offline data outlives the code that wrote it — a package
 * staged by one deployment is read by the next, an outbox record must survive a
 * schema upgrade, and a page arrives over the network — so every one of those
 * boundaries parses rather than casts.
 *
 * These are deliberately hand-rolled rather than a schema library: the app ships
 * no validation dependency today, the shapes are closed and versioned, and the
 * error path here has to name the exact field (a package that fails to install
 * is otherwise unreportable). Each combinator carries the JSON path so a failure
 * reads `records.problems[3].answerIndex: expected integer, got "2"`.
 */

/** A validation failure, carrying the path of the offending field. */
export class OfflineParseError extends Error {
    readonly path: string;

    constructor(path: string, detail: string) {
        super(path ? `${path}: ${detail}` : detail);
        this.name = "OfflineParseError";
        this.path = path;
    }
}

export type Parser<T> = (value: unknown, path?: string) => T;

function fail(path: string, detail: string): never {
    throw new OfflineParseError(path, detail);
}

function describe(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    return typeof value;
}

export const string: Parser<string> = (value, path = "") =>
    typeof value === "string" ? value : fail(path, `expected string, got ${describe(value)}`);

/** A non-blank string. Blank identifiers are a silent corruption, not a value. */
export const nonEmptyString: Parser<string> = (value, path = "") => {
    const text = string(value, path);
    return text.trim() ? text : fail(path, "expected a non-empty string");
};

export const boolean: Parser<boolean> = (value, path = "") =>
    typeof value === "boolean"
        ? value
        : fail(path, `expected boolean, got ${describe(value)}`);

export const finiteNumber: Parser<number> = (value, path = "") =>
    typeof value === "number" && Number.isFinite(value)
        ? value
        : fail(path, `expected a finite number, got ${describe(value)}`);

/**
 * A database integer id. Integers outside the safe range are rejected rather
 * than silently rounded — `docs/offline-contracts.md` §1 requires it, and a
 * rounded id would key local records to the wrong problem.
 */
export const integer: Parser<number> = (value, path = "") => {
    const n = finiteNumber(value, path);
    if (!Number.isInteger(n)) fail(path, `expected an integer, got ${n}`);
    if (!Number.isSafeInteger(n)) fail(path, `integer ${n} is outside the safe range`);
    return n;
};

export const nonNegativeInteger: Parser<number> = (value, path = "") => {
    const n = integer(value, path);
    return n >= 0 ? n : fail(path, `expected a non-negative integer, got ${n}`);
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuid: Parser<string> = (value, path = "") => {
    const text = string(value, path);
    return UUID_RE.test(text) ? text : fail(path, `expected a UUID, got ${text}`);
};

export const isoInstant: Parser<string> = (value, path = "") => {
    const text = string(value, path);
    if (Number.isNaN(Date.parse(text))) {
        fail(path, `expected an ISO instant, got ${text}`);
    }
    return text;
};

export function literal<const T extends string | number | boolean>(
    expected: T,
): Parser<T> {
    return (value, path = "") =>
        value === expected
            ? (value as T)
            : fail(path, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
}

export function enumOf<const T extends readonly string[]>(
    values: T,
): Parser<T[number]> {
    const allowed = new Set<string>(values);
    return (value, path = "") => {
        const text = string(value, path);
        return allowed.has(text)
            ? (text as T[number])
            : fail(path, `expected one of ${values.join(" | ")}, got ${text}`);
    };
}

export function nullable<T>(inner: Parser<T>): Parser<T | null> {
    return (value, path = "") => (value === null ? null : inner(value, path));
}

/** Accepts a missing/`undefined` field, defaulting it. Never accepts `null`. */
export function withDefault<T>(inner: Parser<T>, fallback: () => T): Parser<T> {
    return (value, path = "") => (value === undefined ? fallback() : inner(value, path));
}

export function optional<T>(inner: Parser<T>): Parser<T | undefined> {
    return (value, path = "") => (value === undefined ? undefined : inner(value, path));
}

export function arrayOf<T>(
    inner: Parser<T>,
    options: { max?: number } = {},
): Parser<T[]> {
    return (value, path = "") => {
        if (!Array.isArray(value)) {
            fail(path, `expected an array, got ${describe(value)}`);
        }
        if (options.max !== undefined && value.length > options.max) {
            fail(path, `expected at most ${options.max} items, got ${value.length}`);
        }
        return value.map((item, i) => inner(item, `${path}[${i}]`));
    };
}

/** A fixed-length tuple, used for the `[low, high]` ranges the trainer speaks. */
export function tupleOf<A, B>(a: Parser<A>, b: Parser<B>): Parser<[A, B]> {
    return (value, path = "") => {
        if (!Array.isArray(value) || value.length !== 2) {
            fail(path, `expected a 2-element tuple, got ${describe(value)}`);
        }
        return [a(value[0], `${path}[0]`), b(value[1], `${path}[1]`)];
    };
}

export type Shape<T> = { [K in keyof T]-?: Parser<T[K]> };

function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        fail(path, `expected an object, got ${describe(value)}`);
    }
    return value as Record<string, unknown>;
}

/**
 * Parse an object against a shape. Unknown keys are dropped rather than
 * rejected: the server may add a field before this client is redeployed, and a
 * strict reject would take the whole download down for a purely additive change.
 * What is *kept* is exactly the contract, so a new column can never leak into
 * durable local records.
 */
export function objectOf<T>(shape: Shape<T>): Parser<T> {
    const entries = Object.entries(shape) as [keyof T & string, Parser<unknown>][];
    return (value, path = "") => {
        const record = asRecord(value, path);
        const out = {} as T;
        for (const [key, parser] of entries) {
            const child = path ? `${path}.${key}` : key;
            out[key] = parser(record[key], child) as T[typeof key];
        }
        return out;
    };
}

export function recordOf<T>(
    inner: Parser<T>,
    options: { maxKeys?: number } = {},
): Parser<Record<string, T>> {
    return (value, path = "") => {
        const record = asRecord(value, path);
        const keys = Object.keys(record);
        if (options.maxKeys !== undefined && keys.length > options.maxKeys) {
            fail(path, `expected at most ${options.maxKeys} keys, got ${keys.length}`);
        }
        const out: Record<string, T> = {};
        for (const key of keys) {
            out[key] = inner(record[key], path ? `${path}.${key}` : key);
        }
        return out;
    };
}

/**
 * A discriminated union, keyed on `field`. Reported as "unknown <field>" rather
 * than as a pile of nested failures, because a value this client has never heard
 * of is the interesting fact — it means the contract moved.
 */
export function unionOn<K extends string, T extends { [P in K]: string }>(
    field: K,
    variants: { [V in T[K]]: Parser<Extract<T, Record<K, V>>> },
): Parser<T> {
    return (value, path = "") => {
        const record = asRecord(value, path);
        const tag = string(record[field], path ? `${path}.${field}` : field);
        const parser = (variants as Record<string, Parser<T>>)[tag];
        if (!parser) {
            fail(path, `unknown ${field} ${JSON.stringify(tag)}`);
        }
        return parser(value, path);
    };
}

/**
 * Run a parser and return a discriminated result instead of throwing. Use it
 * where a failure is *data* — one unparseable durable record must not take down
 * the read that found it.
 */
export function tryParse<T>(
    parser: Parser<T>,
    value: unknown,
    path = "",
): { ok: true; value: T } | { ok: false; error: OfflineParseError } {
    try {
        return { ok: true, value: parser(value, path) };
    } catch (error) {
        if (error instanceof OfflineParseError) return { ok: false, error };
        throw error;
    }
}
