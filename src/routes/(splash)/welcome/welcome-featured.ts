export type FeaturedContest = { name: string; changesSinceMathcounts: number };

const isMathcounts = (name: string) => /mathcounts/i.test(name);

export function initialFeaturedContest(names: string[]): FeaturedContest {
    return {
        name: names.find(isMathcounts) ?? names[0] ?? "MATHCOUNTS",
        changesSinceMathcounts: 0,
    };
}

/** Weights apply to contest families, so a large catalog cannot drown out
 * the featured contests. Exclude the current name before drawing. */
export function nextFeaturedContest(
    names: string[],
    current: FeaturedContest,
    random: () => number = Math.random,
): FeaturedContest {
    const candidates = [...new Set(names)].filter((name) => name !== current.name);
    const mathcounts = candidates.filter(isMathcounts);
    if (current.changesSinceMathcounts >= 2 && mathcounts.length) {
        return { name: mathcounts[0]!, changesSinceMathcounts: 0 };
    }
    const groups = [
        { weight: 40, names: mathcounts },
        { weight: 15, names: candidates.filter((name) => /purple\s*comet/i.test(name)) },
        { weight: 15, names: candidates.filter((name) => /mandelbrot/i.test(name)) },
        { weight: 30, names: candidates.filter((name) => !/mathcounts|purple\s*comet|mandelbrot/i.test(name)) },
    ].filter((entry) => entry.names.length);
    if (!groups.length) return current;
    let draw = random() * groups.reduce((sum, entry) => sum + entry.weight, 0);
    let chosen = groups[groups.length - 1]!;
    for (const entry of groups) {
        draw -= entry.weight;
        if (draw < 0) {
            chosen = entry;
            break;
        }
    }
    const name = chosen.names[Math.floor(random() * chosen.names.length)]!;
    return {
        name,
        changesSinceMathcounts: isMathcounts(name) ? 0 : current.changesSinceMathcounts + 1,
    };
}
