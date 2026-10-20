import { expect, test } from "@playwright/test";

/** Runs against an explicitly supplied server; playwright.config.ts never starts one by default. */
test.beforeEach(async ({ context, page, baseURL }) => {
    await context.addCookies([{ name: "pc_guest_app_shell", value: "1", url: baseURL! }]);
    // The navigation contract is independent of live catalog contents and credentials.
    await page.route("**/rest/v1/**", async (route) => {
        const url = new URL(route.request().url());
        const body = url.pathname.endsWith("/problems") && url.searchParams.get("select")?.startsWith("n,")
            ? [{ n: 9 }]
            : url.pathname.endsWith("/series")
            ? [{ id: 7, name: "Example Series", is_official: true, aops_id: null }]
            : url.pathname.endsWith("/tests")
                ? [{ id: 91, name: "Example Test", series_id: 7, year: 2024, type: null, division: null, format: null, is_computational: true, aops_category_id: null, series: { name: "Example Series" } }]
                : [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
});

test("direct links restore controls, remain stable on opening Filters, and survive refresh", async ({ page }) => {
    await page.goto("/library?topic=A&topic=G&rating=1200..1800&verified=false");
    await expect(page.getByRole("tab", { name: "Problems", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Topics: Algebra, Geometry", { exact: true })).toBeVisible();
    const initialUrl = page.url();
    await page.getByRole("button", { name: "Filters (3)", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Difficulty (problem rating) minimum" })).toHaveAttribute("aria-valuenow", "1200");
    await expect(page.getByRole("slider", { name: "Difficulty (problem rating) maximum" })).toHaveAttribute("aria-valuenow", "1800");
    await expect(page).toHaveURL(initialUrl);
    await page.getByRole("slider", { name: "Difficulty (problem rating) minimum" }).press("ArrowRight");
    await expect(page).toHaveURL(/rating=1250\.\.1800/);
    await page.reload();
    await expect(page.getByText("Rating: 1250–1800", { exact: true })).toBeVisible();
});

test("loading series bounds never rewrites the requested filters", async ({ page }) => {
    await page.goto("/library?series=7&year=2020..2025&problemNumbers=15..25");
    const initialUrl = page.url();
    await page.getByRole("button", { name: "Filters (2)", exact: true }).click();
    // Mock data supplies a shorter number line and narrower year span than the URL.
    await expect(page.getByRole("slider", { name: "Problem numbers maximum" })).toHaveAttribute("aria-valuemax", "10");
    await expect(page.getByRole("slider", { name: "Years maximum" })).toHaveAttribute("aria-valuemax", "2024");
    await expect(page).toHaveURL(initialUrl);
    await expect(page.getByText("Problems #15–25", { exact: true })).toBeVisible();
});

test("tabs push history, edits replace it, and Back/Forward update open filters", async ({ page }) => {
    await page.goto("/library?topic=G");
    await page.getByRole("tab", { name: "Series", exact: true }).click();
    await expect(page).toHaveURL(/tab=series/);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("checkbox").click();
    await expect(page).toHaveURL(/official=true/);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("tab", { name: "Tests", exact: true }).click();
    await expect(page).toHaveURL(/tab=tests/);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Series", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    await page.goBack();
    await expect(page.getByText("Topics: Geometry", { exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
});

test("drill-down URLs restore scope labels, and clearing optional filters retains scope", async ({ page }) => {
    await page.goto("/library?tab=series");
    await page.getByRole("button", { name: /Example Series.*Series 7/ }).click();
    await expect(page).toHaveURL(/tab=tests&series=7/);
    await page.getByRole("button", { name: /Example Test/ }).click();
    await expect(page).toHaveURL(/series=7&test=91/);
    await page.reload();
    await expect(page.getByRole("button", { name: "Remove Example Test scope" })).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByRole("slider", { name: "Quality minimum" }).press("ArrowRight");
    await expect(page).toHaveURL(/quality=1\.\.100/);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page).toHaveURL(/series=7&test=91$/);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Remove Example Series scope" }).click();
    await expect(page).toHaveURL(/\/library$/);
});
