import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ context, page, baseURL }) => {
    await context.addCookies([{ name: "pc_guest_app_shell", value: "1", url: baseURL! }]);
    await page.route("**/rest/v1/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
});

async function delayedCompatibilityTap(page: Page, option: Locator) {
    await option.scrollIntoViewIfNeeded();
    await option.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true });
    await option.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true });
    await option.evaluate(async (element) => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        // Touch compatibility mouse events have no second pointer pair. Suppress
        // only that pair from Playwright's mouse, preserving real mousedown focus
        // transfer and click defaults (dispatchEvent("click") cannot test these).
        for (const type of ["pointerdown", "pointerup"]) {
            element.addEventListener(type, (event) => event.stopImmediatePropagation(), { capture: true, once: true });
        }
    });
    const bounds = await option.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
}

test("delayed touch compatibility click commits a combobox option before blur can close it", async ({ page }) => {
    await page.goto("/library");
    await expect(page.locator('[data-slot="sidebar-root"]')).toHaveAttribute("data-ready", "true");
    await page.getByRole("button", { name: /Filters/ }).tap();
    await page.getByPlaceholder("Any topic…").tap();
    await delayedCompatibilityTap(page, page.getByRole("option", { name: "Algebra", exact: true }));
    await expect(page).toHaveURL(/topic=A/);
    await expect(page.getByPlaceholder("Add topic…")).toBeFocused();
});

test("mobile taps select multiple combobox options and keep the input focused", async ({ page }) => {
    await page.goto("/library");
    await expect(page.locator('[data-slot="sidebar-root"]')).toHaveAttribute("data-ready", "true");
    await page.getByRole("button", { name: /Filters/ }).tap();
    const input = page.getByPlaceholder("Any topic…");
    await input.tap();
    await page.getByRole("option", { name: "Algebra", exact: true }).tap();
    await expect(page).toHaveURL(/topic=A/);
    const selectedInput = page.getByPlaceholder("Add topic…");
    await expect(selectedInput).toBeFocused();
    await expect(selectedInput).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("option", { name: "Geometry", exact: true }).tap();
    await expect(page).toHaveURL(/topic=A&topic=G/);
    await expect(page.getByRole("button", { name: "Remove Algebra", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Geometry", exact: true })).toBeVisible();
    await page.getByRole("heading", { name: "Browse", exact: true }).tap();
    await expect(selectedInput).toHaveAttribute("aria-expanded", "false");
    await selectedInput.focus();
    await selectedInput.press("Home");
    await selectedInput.press("Enter");
    await expect(page).toHaveURL(/topic=C/);
});

test("mobile taps select a theme and close the select dropdown", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator('[data-slot="sidebar-root"]')).toHaveAttribute("data-ready", "true");
    const select = page.getByRole("combobox").filter({ hasText: "Light Theme" });
    await select.tap();
    await page.getByRole("option", { name: "Dark Theme", exact: true }).tap();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const selected = page.getByRole("combobox").filter({ hasText: "Dark Theme" });
    await expect(selected).toHaveAttribute("aria-expanded", "false");
    await expect(selected).toBeFocused();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await selected.tap();
    await page.getByRole("heading", { name: "Appearance", exact: true }).tap();
    await expect(selected).toHaveAttribute("aria-expanded", "false");
    await selected.press("ArrowUp");
    await selected.press("ArrowUp");
    await selected.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("delayed touch compatibility click commits a select option before blur can close it", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator('[data-slot="sidebar-root"]')).toHaveAttribute("data-ready", "true");
    const select = page.getByRole("combobox").filter({ hasText: "Light Theme" });
    await select.tap();
    // Some mobile engines do not focus buttons on touch; exercise the focused
    // trigger path too, as happens after keyboard navigation or a previous choice.
    await select.focus();
    await delayedCompatibilityTap(page, page.getByRole("option", { name: "Dark Theme", exact: true }));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("combobox").filter({ hasText: "Dark Theme" })).toHaveAttribute("aria-expanded", "false");
});

test("cancelling a touch gesture commits nothing and releases the combobox focus guard", async ({ page }) => {
    await page.goto("/library");
    await expect(page.locator('[data-slot="sidebar-root"]')).toHaveAttribute("data-ready", "true");
    await page.getByRole("button", { name: /Filters/ }).tap();
    const input = page.getByPlaceholder("Any topic…");
    await input.tap();
    const option = page.getByRole("option", { name: "Algebra", exact: true });
    await option.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true });
    await option.dispatchEvent("pointermove", { pointerId: 1, pointerType: "touch", isPrimary: true, clientY: 100 });
    await option.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "touch", isPrimary: true });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page).toHaveURL(/\/library$/);
    await page.getByPlaceholder("Any tags…").focus();
    await expect(input).toHaveAttribute("aria-expanded", "false");
});
