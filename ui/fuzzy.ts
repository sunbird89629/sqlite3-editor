/** Fuzzy matching for column names: a subsequence match that rewards runs, word starts and prefixes. */

export type FuzzyMatch = { score: number, hits: number[] }

/**
 * `query` must appear in `name` in order, but not necessarily contiguously. Returns the matched
 * character indices so the caller can highlight them, or `null` when the name does not match.
 */
export const fuzzyMatch = (name: string, query: string): FuzzyMatch | null => {
    if (query === "") { return { score: 0, hits: [] } }
    const lower = name.toLowerCase()
    const needle = query.toLowerCase()
    if (lower.startsWith(needle)) {
        return { score: 1000 - name.length, hits: [...needle].map((_, index) => index) }
    }
    let score = 0
    let from = 0
    let run = 0
    const hits: number[] = []
    for (const character of needle) {
        const at = lower.indexOf(character, from)
        if (at === -1) { return null }
        hits.push(at)
        run = at === from ? run + 1 : 0
        score += 10 + run * 6 + (at === 0 || /[_-]/.test(name[at - 1] ?? "") ? 8 : 0) - Math.min(6, at - from)
        from = at + 1
    }
    return { score: score - name.length * 0.1, hits }
}

export type Named = { name: string }

/**
 * Filters and ranks by score. With an empty query the input order is kept, so the picker shows
 * columns in table order until the user starts typing.
 */
export const fuzzyFilter = <T extends Named>(items: readonly T[], query: string): (T & { hits: number[] })[] => {
    if (query.trim() === "") { return items.map((item) => ({ ...item, hits: [] as number[] })) }
    const needle = query.trim()
    const matched: { item: T, score: number, hits: number[], index: number }[] = []
    items.forEach((item, index) => {
        const match = fuzzyMatch(item.name, needle)
        if (match !== null) { matched.push({ item, score: match.score, hits: match.hits, index }) }
    })
    matched.sort((a, b) => b.score - a.score || a.index - b.index)
    return matched.map(({ item, hits }) => ({ ...item, hits }))
}
