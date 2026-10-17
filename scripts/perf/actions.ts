/**
 * Pass 2: in-app gestures. Each action brings the app to a known state in
 * `setup` (untimed), then runs the gesture and waits for a named completion
 * signal (timed). The clock is Node-side wall time, so a number here includes
 * the Playwright→CDP round trip — good for comparing runs, not a claim about
 * absolute tap latency.
 */
import type { Browser, Page } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { newContext, sidebarLink } from "./browser";
import { BASE_URL, REPEATS } from "./config";
import { describeError, printActionSample } from "./format";
import { median } from "./metrics";
import type { Action, ActionRun, ActionSample } from "./types";

// ---------------------------------------------------------------------------
// page helpers
// ---------------------------------------------------------------------------

/** Mount the authenticated shell and wait for the sidebar to prove it hydrated. */
const loadShell = async (page: Page) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
    await sidebarLink(page, "Library").first().waitFor({ timeout: 20000 });
};

/** The footer's primary control: `Submit` while answering, `Next` once graded. */
const submitButton = (page: Page) => page.getByRole("button", { name: /^Submit$/ });
const nextButton = (page: Page) => page.getByRole("button", { name: /^Next/ });
const freeAnswer = (page: Page) => page.getByRole("textbox", { name: "Answer" });
const proofAnswer = (page: Page) => page.getByRole("textbox", { name: "Proof response" });
/**
 * A free-response answer collapses to a view-mode button once entered and
 * unfocused, so a retry has to reopen the editor before it can type again.
 */
const answerEditButton = (page: Page) => page.getByTitle("Click or focus to edit answer math");
/** MB: the choice buttons are the only aria-pressed buttons with no aria-label. */
const choiceButtons = (page: Page) => page.locator("button[aria-pressed]:not([aria-label])");

async function hasAnswerControl(page: Page): Promise<boolean> {
    return (
        (await freeAnswer(page).count()) > 0 ||
        (await proofAnswer(page).count()) > 0 ||
        (await answerEditButton(page).count()) > 0 ||
        (await choiceButtons(page).count()) > 0
    );
}

/** Advance past a problem the harness cannot drive (unsupported response kind). */
async function skipProblem(page: Page) {
    await page.getByRole("button", { name: "Skip Problem" }).first().click();
    await page.getByRole("button", { name: /^Skip$/ }).click();
    await page.waitForTimeout(300);
}

/**
 * Land on a problem that is actually answerable. A resumed session can open on
 * an already-concluded problem (footer offers Next), and the trainer also serves
 * response kinds with no drivable control — step past both.
 */
async function landOnAnswerableProblem(page: Page) {
    for (let i = 0; i < 10; i += 1) {
        await page
            .waitForFunction(
                () => {
                    const names = [...document.querySelectorAll("button")].map((b) =>
                        (b.getAttribute("aria-label") || b.textContent || "").trim(),
                    );
                    return names.some(
                        (n) => n === "Submit" || n.startsWith("Next") || n === "Skip Problem",
                    );
                },
                undefined,
                { timeout: 30000 },
            )
            .catch(() => {});

        const hasSubmit = (await submitButton(page).count()) > 0;
        const hasNext = (await nextButton(page).count()) > 0;
        if (hasSubmit && (await hasAnswerControl(page))) return;
        if (hasSubmit && (await page.getByRole("button", { name: "Skip Problem" }).count()) > 0) {
            await skipProblem(page);
            continue;
        }
        if (hasNext) {
            await nextButton(page).first().click();
            await page.waitForTimeout(250);
            continue;
        }
        await page.waitForTimeout(300);
    }
    throw new Error("could not reach an answerable problem");
}

const startSession = async (page: Page) => {
    await page.goto(`${BASE_URL}/practice?session=root`, { waitUntil: "load" });
    await landOnAnswerableProblem(page);
};

/**
 * Answer whatever kind of problem is on screen. The trainer serves a mix, so a
 * harness that only knew the free-response box would fail on every MCQ.
 * `index` varies the choice on retries, since re-clicking an armed choice can
 * disarm it.
 */
async function answerProblem(page: Page, index = 0) {
    if ((await answerEditButton(page).count()) > 0) {
        await answerEditButton(page).first().click();
        await page.waitForTimeout(150);
    }
    if ((await freeAnswer(page).count()) > 0) {
        // Vary the value per try: resubmitting an unchanged answer is a no-op
        // that never consumes a try, so a fixed value would loop forever.
        await freeAnswer(page).first().fill(String(index + 1));
        return;
    }
    if ((await proofAnswer(page).count()) > 0) {
        await proofAnswer(page).first().fill(`Attempt ${index + 1}: by direct computation.`);
        return;
    }
    const choices = choiceButtons(page);
    const count = await choices.count();
    if (count === 0) throw new Error("no answer control found");
    await choices.nth(index % count).click();
}

/**
 * Wait for a submission to visibly grade. The trainer may allow several tries,
 * so this resolves on *either* conclusion (the Next button) or a changed
 * "N tries left" counter — the counter only renders once `triesUsed > 0`, so it
 * cannot fire before the first submission.
 */
async function awaitGrade(page: Page, previousTries: string): Promise<"concluded" | "retry"> {
    const verdict = await page.waitForFunction(
        (prev) => {
            const names = [...document.querySelectorAll("button")].map((b) =>
                (b.textContent || "").trim(),
            );
            if (names.some((n) => n.startsWith("Next"))) return "concluded";
            const match = (document.body.innerText || "").match(/\d+\s+tr(?:y|ies) left/);
            if (match && match[0] !== prev) return "retry";
            return false;
        },
        previousTries,
        { timeout: 20000, polling: 50 },
    );
    return (await verdict.jsonValue()) as "concluded" | "retry";
}

/** Submit until the footer advances, reporting how many tries the problem took. */
async function submitUntilConcluded(page: Page, maxTries = 5): Promise<{ tries: number }> {
    for (let attempt = 0; attempt < maxTries; attempt += 1) {
        const counter = page.getByText(/tr(?:y|ies) left/);
        const previous =
            (await counter.count()) > 0 ? ((await counter.first().textContent()) ?? "") : "";
        await answerProblem(page, attempt);
        await submitButton(page).click({ timeout: 10000 });
        if ((await awaitGrade(page, previous)) === "concluded") return { tries: attempt + 1 };
    }
    throw new Error(`problem did not conclude after ${maxTries} submissions`);
}

// ---------------------------------------------------------------------------
// the gestures
// ---------------------------------------------------------------------------

export const ACTIONS: Action[] = [
    {
        group: "nav",
        name: "sidebar → Library",
        setup: loadShell,
        run: async (page) => {
            await sidebarLink(page, "Library").first().click();
            await page.getByRole("heading", { name: /^Library$/ }).waitFor();
        },
    },
    {
        group: "nav",
        name: "sidebar → Practice",
        setup: loadShell,
        run: async (page) => {
            await sidebarLink(page, "Practice").first().click();
            await page.getByRole("heading", { name: /^Practice$/ }).waitFor();
        },
    },
    {
        group: "nav",
        name: "sidebar → Home",
        setup: loadShell,
        run: async (page) => {
            await sidebarLink(page, "Home").first().click();
            await page.getByRole("heading", { name: /Welcome back|Practice as a guest/ }).waitFor();
        },
    },
    {
        group: "library",
        name: "search: type a query",
        setup: async (page) => {
            await page.goto(`${BASE_URL}/library`, { waitUntil: "load" });
            await page.getByRole("list", { name: "problems results" }).waitFor({ timeout: 20000 });
        },
        run: async (page) => {
            const box = page.getByRole("textbox", { name: "Search Library" });
            await box.fill("12");
            // the count region flips Searching… → "N results"
            await page.getByText(/\d+\+? results?/).first().waitFor({ timeout: 20000 });
        },
    },
    {
        group: "library",
        name: "open filters panel",
        setup: async (page) => {
            await page.goto(`${BASE_URL}/library`, { waitUntil: "load" });
            await page.getByRole("list", { name: "problems results" }).waitFor({ timeout: 20000 });
        },
        run: async (page) => {
            await page.getByRole("button", { name: /Filters/ }).first().click();
            await page.getByRole("dialog", { name: "Filters" }).waitFor({ timeout: 10000 });
        },
    },
    {
        group: "practice",
        name: "start session (→ ready problem)",
        run: async (page) => {
            await page.goto(`${BASE_URL}/practice?session=root`, { waitUntil: "load" });
            await landOnAnswerableProblem(page);
        },
    },
    {
        group: "practice",
        name: "submit an answer (→ graded)",
        setup: startSession,
        run: async (page) => {
            await answerProblem(page, 0);
            await submitButton(page).click({ timeout: 10000 });
            const verdict = await awaitGrade(page, "");
            return { extra: { concluded: verdict === "concluded" ? 1 : 0 } };
        },
    },
    {
        group: "practice",
        name: "next problem",
        setup: async (page) => {
            await startSession(page);
            await submitUntilConcluded(page);
        },
        run: async (page) => {
            await nextButton(page).first().click();
            await landOnAnswerableProblem(page);
        },
    },
    {
        group: "coach",
        name: "send message (TTFT → complete)",
        run: async (page) => {
            await page.goto(`${BASE_URL}/coach`, { waitUntil: "load" });
            await page.getByRole("heading", { name: /^Coach$/ }).waitFor({ timeout: 20000 });
            const composer = page.getByRole("textbox", { name: "Message Coach" });
            await composer.fill("What is 2+2?");
            const sent = performance.now();
            await page.getByRole("button", { name: "Send message" }).click();
            // TTFT boundary: the placeholder row is replaced once content arrives.
            let ttftMs: number | undefined;
            try {
                const thinking = page.getByLabel("Thinking");
                await thinking.waitFor({ state: "visible", timeout: 3000 });
                await thinking.waitFor({ state: "detached", timeout: 60000 });
                ttftMs = Math.round(performance.now() - sent);
            } catch {
                ttftMs = undefined; // mock replied instantly; Thinking never showed
            }
            // completion: the send button returns from "Stop response"
            await page.getByRole("button", { name: "Send message" }).waitFor({ timeout: 60000 });
            return ttftMs === undefined ? undefined : { extra: { ttftMs } };
        },
    },
];

export async function measureActions(browser: Browser, state: object): Promise<ActionSample[]> {
    const samples: ActionSample[] = [];
    for (const action of ACTIONS) {
        const runs: ActionRun[] = [];
        for (let i = 0; i < REPEATS; i += 1) {
            const context = await newContext(browser, state);
            const page = await context.newPage();
            const pageErrors: string[] = [];
            page.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));
            let ok = true;
            let error: string | undefined;
            let extra: Record<string, number> | undefined;
            let started = 0;
            try {
                if (action.setup) {
                    await action.setup(page);
                } else {
                    // Even an action that navigates itself needs the app to have a
                    // document; contexts otherwise start at about:blank.
                    await loadShell(page);
                }
                started = performance.now();
                const result = await action.run(page);
                if (result?.extra) extra = result.extra;
            } catch (e) {
                ok = false;
                error = describeError(e);
                if (pageErrors.length) error += ` (pageerror: ${pageErrors[0]})`;
            }
            const wallMs = started ? Math.round(performance.now() - started) : 0;
            await context.close();
            runs.push({ ok, wallMs, error, extra });
        }
        const good = runs.filter((r) => r.ok);
        const extraKeys = new Set(good.flatMap((r) => Object.keys(r.extra ?? {})));
        const extra: Record<string, number> = {};
        for (const key of extraKeys) {
            const med = median(
                good.map((r) => r.extra?.[key]).filter((v): v is number => typeof v === "number"),
            );
            if (med !== null) extra[key] = med;
        }
        const sample: ActionSample = {
            group: action.group,
            name: action.name,
            runs,
            medianMs: median(good.map((r) => r.wallMs)),
            ok: good.length > 0,
            error: good.length > 0 ? undefined : runs[0]?.error,
            extra: Object.keys(extra).length > 0 ? extra : undefined,
        };
        samples.push(sample);
        printActionSample(sample);
    }
    return samples;
}
