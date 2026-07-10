declare module "bun:test" {
    export function describe(name: string, callback: () => void): void;
    export function test(name: string, callback: () => unknown): void;
    export function expect(value?: unknown): any;
}
