import { describe, expect, test } from "bun:test";
import {
    offlineCauseMessage,
    offlineErrorResponse,
    parseErrorOperationId,
} from "./http";

describe("offline HTTP errors", () => {
    test("maps a plain PostgREST error object instead of hiding it as a 503", async () => {
        const response = offlineErrorResponse({
            code: "P0001",
            details: null,
            hint: null,
            message: "OFFLINE_BATCH_TOO_LARGE:package has 30755 canonicals",
        });

        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({
            status: "error",
            code: "batch_too_large",
            retryable: false,
        });
    });

    test("extracts markers and operation ids from Error and plain-object causes", () => {
        const operationId = "11111111-1111-4111-8111-111111111111";
        expect(offlineCauseMessage(new Error("OFFLINE_AUTH_REQUIRED"))).toBe(
            "OFFLINE_AUTH_REQUIRED",
        );
        expect(
            parseErrorOperationId({
                message: `OFFLINE_OPERATION_INVALID:${operationId}:sequence`,
            }),
        ).toBe(operationId);
    });
});
