import type { Reference } from "@opencode-ai/schema/skill-library"
import { type ContextItem, type Prompt, type usePrompt } from "@/context/prompt"

type PromptTarget = ReturnType<ReturnType<typeof usePrompt>["capture"]>

export function createPromptSubmissionState(input: {
  target: PromptTarget
  prompt: Prompt
  context: (ContextItem & { key: string })[]
}) {
  const origin = input.target.skills.origin()
  const skills = input.target.skills.current().map((skill) => ({ ...skill }))
  const initial = input.target
  let target = input.target
  let cleared: Prompt | undefined

  return {
    prompt: input.prompt,
    context: input.context,
    target: () => target,
    clear() {
      if (initial !== target) {
        initial.reset()
        initial.skills.set([])
      }
      target.reset()
      cleared = target.current()
    },
    pin(references: readonly Reference[], owner: string) {
      const unchanged =
        JSON.stringify(target.skills.current()) === JSON.stringify(skills) && target.skills.origin() === origin
      if (!unchanged) return
      const pinned = skills.map((skill) => {
        const reference = references.find((item) => item.skillId === skill.id)
        return reference ? { ...skill, revision: reference.revision, contentHash: reference.contentHash } : skill
      })
      target.skills.restore(pinned, owner)
    },
    retarget(next: PromptTarget) {
      input.context.forEach(next.context.add)
      next.skills.restore(skills, origin)
      target = next
    },
    current: (value: PromptTarget) => target === value,
    restore() {
      if (cleared !== undefined && target.current() !== cleared) return
      return {
        target,
        prompt: input.prompt,
        context: input.context,
        skills: target.skills.current().map((skill) => ({ ...skill })),
        origin: target.skills.origin(),
      }
    },
  }
}
