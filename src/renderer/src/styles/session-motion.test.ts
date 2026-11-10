import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The reduce-motion block must also cover the open-state rules, which carry more specificity
// than the closed ones it sits beside; otherwise the open step still fades and unfolds. A rule
// only wins over an earlier one when its specificity is at least as high, so the check compares
// specificities, not just the selectors' text.
type Specificity = [number, number, number]

interface Rule {
  selectors: string[]
  body: string
  index: number
}

// Specificity of one complex selector: ids, then classes, attributes and pseudo-classes, then
// elements and pseudo-elements. A :is(...) list counts as its most specific member.
function specificity(selector: string): Specificity {
  let rest = selector
  let ids = 0
  let classes = 0
  let elements = 0
  rest = rest.replace(/:is\(([^()]*)\)/g, (_, list: string) => {
    const [i, c, e] = list
      .split(',')
      .map((part) => specificity(part.trim()))
      .reduce<Specificity>((max, s) => (compare(s, max) > 0 ? s : max), [0, 0, 0])
    ids += i
    classes += c
    elements += e
    return ' '
  })
  ids += (rest.match(/#[\w-]+/g) ?? []).length
  rest = rest.replace(/#[\w-]+/g, ' ')
  elements += (rest.match(/::[\w-]+/g) ?? []).length
  rest = rest.replace(/::[\w-]+/g, ' ')
  classes += (rest.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length
  rest = rest.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, ' ')
  elements += (rest.match(/\b[a-zA-Z][\w-]*/g) ?? []).length
  return [ids, classes, elements]
}

function compare(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

describe('session reduced motion', () => {
  const css = readFileSync(resolve(__dirname, 'session.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  )
  const shine = css.indexOf('@keyframes ks-step-shine')
  const start = css.indexOf('@media (prefers-reduced-motion: reduce) {', shine)
  const end = css.indexOf(":root[data-reduce-motion='always']", start)

  const rules: Rule[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({
      selectors: match[1]
        .trim()
        // Split on the commas outside :is(...), which the selectors also use.
        .split(/,(?![^(]*\))/)
        .map((s) => s.trim()),
      body: match[2],
      index: match.index ?? 0,
    })
  }
  const reduced = rules.filter(
    (rule) => rule.index > start && rule.index < end && /transition:\s*none\s*;/.test(rule.body),
  )

  // Open-state selectors that set a transition before the reduce-motion block and are not
  // overridden there by the same selector at least as specific. The same selector wins over the
  // open rule only when it is later, which the block is, and no less specific, which it cannot be.
  const uncovered = () => {
    expect(shine).toBeGreaterThan(-1)
    expect(start).toBeGreaterThan(shine)
    expect(end).toBeGreaterThan(start)
    const found: string[] = []
    for (const rule of rules) {
      if (rule.index >= start || !/transition\s*:/.test(rule.body)) continue
      if (/transition:\s*none\s*;/.test(rule.body)) continue
      for (const selector of rule.selectors) {
        if (!selector.includes('[data-open]')) continue
        const need = specificity(selector)
        const covered = reduced.some((r) =>
          r.selectors.some((t) => t === selector && compare(specificity(t), need) >= 0),
        )
        if (!covered) found.push(selector)
      }
    }
    return found
  }

  it('disables the open-state transitions of a step and a run', () => {
    expect(uncovered()).toEqual([])
  })

  it('ranks the overriding selectors at least as specific as the open-state rules', () => {
    expect(specificity('.ks-thread .ui-tcc[data-open]::after')).toEqual([0, 3, 1])
    expect(
      specificity('.ks-thread :is(.ui-tcc, .ui-tcc-group)[data-open] > .ui-tcc__body'),
    ).toEqual([0, 4, 0])
    expect(specificity('.ks-thread .ui-tcc::after')).toEqual([0, 2, 1])
  })
})
