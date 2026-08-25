import type { SkillType } from '../db'
import { STAGE_LABEL } from '../practice/material'

/**
 * The rungs of the current mode's ladder, and where the learner is on it.
 *
 * Rungs already climbed stay filled in. Nothing here ever empties: progress
 * is not something this product takes back, and a ladder that could visibly
 * un-fill would be showing a punishment the model cannot deliver.
 */
export function StageLadder({
  stages,
  current,
}: {
  stages: SkillType[]
  current: SkillType
}) {
  const position = Math.max(0, stages.indexOf(current))

  return (
    <ol
      className="flex flex-wrap items-center gap-x-2 gap-y-2"
      aria-label={`Practice ladder: ${STAGE_LABEL[current]}, step ${position + 1} of ${stages.length}`}
    >
      {stages.map((stage, index) => {
        const done = index < position
        const here = index === position
        return (
          <li key={stage} className="flex items-center gap-2">
            <span
              aria-current={here ? 'step' : undefined}
              className={`label-mono rounded-full px-3 py-1.5 transition-colors ${
                here
                  ? 'bg-[var(--sound)] text-white'
                  : done
                    ? 'bg-ink/10 text-ink'
                    : 'bg-paper-2 text-ink-faint'
              }`}
            >
              {STAGE_LABEL[stage]}
            </span>
            {index < stages.length - 1 && (
              <span aria-hidden="true" className="text-ink-faint">
                ›
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
