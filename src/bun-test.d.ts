declare module "bun:test" {
    export function describe(name: string, callback: () => void): void;
    export function test(name: string, callback: () => unknown): void;
    export function expect(value?: unknown): any;
    export function beforeEach(callback: () => unknown): void;
    export function afterEach(callback: () => unknown): void;

    interface MockFunction<T extends (...args: any[]) => any> {
        (...args: Parameters<T>): ReturnType<T>;
        mock: { calls: Parameters<T>[]; results: unknown[] };
    }

    export function mock<T extends (...args: any[]) => any>(fn: T): MockFunction<T>;
    export namespace mock {
        /** Replaces a module for the rest of the test file, including unresolvable specifiers. */
        function module(specifier: string, factory: () => unknown): void;
    }
}
