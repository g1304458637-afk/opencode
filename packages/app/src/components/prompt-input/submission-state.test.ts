import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptState } from "@/context/prompt-state"
import { createPromptSubmissionState } from "./submission-state"

const skill = {
  id: "sk_" + "a".repeat(64),
  name: "Research",
  description: "",
  sourceType: "local" as const,
  repository: "",
  path: "",
  managed: true,
  revision: "b".repeat(64),
  contentHash: "c".repeat(64),
}

test("draft promotion and failed submission preserve selected skill versions and restore provenance", () =>
  createRoot((dispose) => {
    const draft = createPromptState({ prompt: "Task" })
    draft.skills.restore([skill], "msg-original")
    const submission = createPromptSubmissionState({ target: draft.capture(), prompt: draft.current(), context: [] })
    const session = createPromptState()
    submission.retarget(session.capture())
    expect(session.skills.current()).toEqual([skill])
    submission.clear()
    expect(session.skills.current()).toEqual([skill])
    const restored = submission.restore()!
    restored.target.set(restored.prompt)
    restored.target.skills.restore(restored.skills, restored.origin)
    expect(session.current()[0]).toMatchObject({ content: "Task" })
    expect(session.skills.current()).toEqual([skill])
    expect(session.skills.origin()).toBe("msg-original")
    expect(draft.skills.current()).toEqual([])
    dispose()
  }))

test("failure recovery never overwrites a later task draft", () =>
  createRoot((dispose) => {
    const draft = createPromptState({ prompt: "First" })
    draft.skills.add(skill)
    const submission = createPromptSubmissionState({ target: draft.capture(), prompt: draft.current(), context: [] })
    submission.clear()
    draft.set([{ type: "text", content: "New work", start: 0, end: 8 }])
    expect(submission.restore()).toBeUndefined()
    expect(draft.current()[0]).toMatchObject({ content: "New work" })
    dispose()
  }))

test("submitted task pins immutable versions and origin while only clearing composer text", () =>
  createRoot((dispose) => {
    const task = createPromptState({ prompt: "Task" })
    task.skills.add({ ...skill, revision: undefined })
    const submission = createPromptSubmissionState({ target: task.capture(), prompt: task.current(), context: [] })
    submission.pin([{ skillId: skill.id, revision: skill.revision, contentHash: skill.contentHash }], "msg-submitted")
    submission.clear()
    expect(task.current()[0]).toMatchObject({ content: "" })
    expect(task.skills.current()).toEqual([skill])
    expect(task.skills.origin()).toBe("msg-submitted")
    dispose()
  }))

test("failure retry never restores a skill the user explicitly removed after sending", () =>
  createRoot((dispose) => {
    const task = createPromptState({ prompt: "Task" })
    task.skills.add(skill)
    const submission = createPromptSubmissionState({ target: task.capture(), prompt: task.current(), context: [] })
    submission.pin([{ skillId: skill.id, revision: skill.revision, contentHash: skill.contentHash }], "msg-submitted")
    submission.clear()
    task.skills.remove(skill.id)
    const restored = submission.restore()!
    restored.target.set(restored.prompt)
    restored.target.skills.restore(restored.skills, restored.origin)
    expect(task.current()[0]).toMatchObject({ content: "Task" })
    expect(task.skills.current()).toEqual([])
    expect(task.skills.origin()).toBeUndefined()
    dispose()
  }))
