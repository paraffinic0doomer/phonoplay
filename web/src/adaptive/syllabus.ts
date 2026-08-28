import type { LearningMode, NewSyllabusItem, Phoneme, PhonemeProfile, SkillType } from '../db/index.ts'
import { createSyllabus, getActivePlan, getLearningMode, getProfilesByNeed, getSettings, setStage } from '../db/index.ts'
import { ladderIndex, policyFor } from '../db/policy.ts'
import { STAGE_LABEL } from '../practice/material.ts'
import { LanguageKnowledgeService } from '../language/index.ts'

export type AdaptationAction = 'initial' | 'advance' | 'reinforce' | 'simplify' | 'continue'

export interface Adaptation {
  action: AdaptationAction
  phoneme: Phoneme
  stage: SkillType
  reason: string
}

function activity(stage: SkillType): NewSyllabusItem['exerciseType'] {
  return stage === 'minimal_pair' ? 'contrast' : stage === 'sound' || stage === 'syllable' ? 'repetition' : 'production'
}

function item(day: number, phoneme: Phoneme, stage: SkillType, title?: string): NewSyllabusItem {
  return {
    day,
    phoneme,
    skillType: stage,
    exerciseType: activity(stage),
    difficulty: Math.min(5, ladderIndex(stage, ['sound', 'syllable', 'minimal_pair', 'word', 'phrase', 'sentence']) + 1),
    prompt: title ?? `${STAGE_LABEL[stage]} practice for /${phoneme.toUpperCase()}/`,
    learningObjective: `Practise /${phoneme.toUpperCase()}/ at the ${STAGE_LABEL[stage].toLowerCase()} level.`,
    masteryRequirement: 0.75,
  }
}

/** The first plan follows the lowest measured sound, with no inferred scores. */
export async function createInitialSyllabus(): Promise<Adaptation> {
  const [profiles, mode, settings] = await Promise.all([getProfilesByNeed(), getLearningMode(), getSettings()])
  const focus = profiles[0]
  const stages = policyFor(mode).stages
  const focusStage = stages[ladderIndex(focus.currentStage, stages)]
  const items = [
    item(1, focus.phoneme, focusStage),
    item(2, focus.phoneme, focusStage),
    item(3, profiles[1]?.phoneme ?? focus.phoneme, stages[0]),
    item(4, focus.phoneme, focusStage),
    item(5, profiles[2]?.phoneme ?? focus.phoneme, stages[0]),
    item(6, focus.phoneme, focusStage),
    item(7, profiles[3]?.phoneme ?? focus.phoneme, stages[0]),
  ]
  await createSyllabus({
    title: 'Your first practice plan',
    // This is a display label. The target is selectable only when its
    // LanguageProfile carries a real inventory and assessment prompt bank.
    targetLanguage: LanguageKnowledgeService.getLanguage(settings.targetLanguage)?.name ?? settings.targetLanguage,
    adaptationReason: 'Built from the sounds measured in your assessment.',
    items,
  })
  return { action: 'initial', phoneme: focus.phoneme, stage: focusStage, reason: 'Built from your assessment.' }
}

export function decideAdaptation(profile: PhonemeProfile, mode: LearningMode): Adaptation {
  const stages = policyFor(mode).stages
  const index = ladderIndex(profile.currentStage, stages)
  const current = stages[index]
  if (profile.trend === 'inconsistent' && index > 0) {
    const stage = stages[index - 1]
    return { action: 'simplify', phoneme: profile.phoneme, stage, reason: `The recent recordings varied, so the next lesson returns to a shorter ${STAGE_LABEL[stage].toLowerCase()} step.` }
  }
  const enoughStrongEvidence = profile.repetitionCount >= policyFor(mode).repetitionsToAdvance && profile.masteryScore >= .75 && profile.confidence >= policyFor(mode).minConfidence && profile.consistency >= policyFor(mode).minConsistency && profile.trend !== 'declining'
  if (enoughStrongEvidence && index < stages.length - 1) {
    const stage = stages[index + 1]
    return { action: 'advance', phoneme: profile.phoneme, stage, reason: `Recent recordings support moving from ${STAGE_LABEL[current].toLowerCase()} to ${STAGE_LABEL[stage].toLowerCase()} practice.` }
  }
  if (profile.repetitionCount >= 2 && profile.masteryScore < .5) {
    return { action: 'reinforce', phoneme: profile.phoneme, stage: current, reason: `This sound still needs repetition, so the next lesson keeps the ${STAGE_LABEL[current].toLowerCase()} step with new content.` }
  }
  return { action: 'continue', phoneme: profile.phoneme, stage: current, reason: `The next lesson stays at the ${STAGE_LABEL[current].toLowerCase()} step while the model gathers more evidence.` }
}

/**
 * Version the plan only when practice actually changes its direction.
 * The returned decision is always shown, even when the existing plan remains right.
 */
export async function adaptSyllabus(profile: PhonemeProfile): Promise<Adaptation> {
  const [mode, active] = await Promise.all([getLearningMode(), getActivePlan()])
  const decision = decideAdaptation(profile, mode)
  if (!active) {
    await createInitialSyllabus()
    return decision
  }
  if (decision.action === 'continue') return decision

  // A changed syllabus and a different practice rung must agree. This is an
  // instructional adjustment, not a judgement: progress remains in the
  // profile and an easier step is simply the next useful context.
  if (decision.action === 'advance' || decision.action === 'simplify') {
    await setStage(profile.phoneme, decision.stage)
  }

  const other = (await getProfilesByNeed()).filter((candidate) => candidate.phoneme !== profile.phoneme)
  await createSyllabus({
    title: `${STAGE_LABEL[decision.stage]} focus for /${decision.phoneme.toUpperCase()}/`,
    targetLanguage: active.syllabus.targetLanguage,
    adaptationReason: `Your plan adapted based on your practice. ${decision.reason}`,
    items: [
      item(1, decision.phoneme, decision.stage),
      item(2, decision.phoneme, decision.stage),
      item(3, other[0]?.phoneme ?? decision.phoneme, other[0]?.currentStage ?? decision.stage),
      item(4, decision.phoneme, decision.stage),
      item(5, other[1]?.phoneme ?? decision.phoneme, other[1]?.currentStage ?? decision.stage),
      item(6, decision.phoneme, decision.stage),
      item(7, other[2]?.phoneme ?? decision.phoneme, other[2]?.currentStage ?? decision.stage),
    ],
  })
  return decision
}
