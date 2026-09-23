import { expect, test } from "bun:test"
import { canPublishMucRelease } from "./muc-release-policy"

test("allows the first stable MUC release", () => {
  expect(canPublishMucRelease(undefined, "2.0.0")).toBe(true)
})

test("allows a newer release over the current stable feed", () => {
  expect(canPublishMucRelease("2.0.7", "2.0.8")).toBe(true)
})

test("rejects re-publishing the same version or downgrading", () => {
  expect(canPublishMucRelease("2.0.8", "2.0.8")).toBe(false)
  expect(canPublishMucRelease("2.0.9", "2.0.8")).toBe(false)
})

test("rejects invalid versions", () => {
  expect(canPublishMucRelease("2.0.7", "2.0")).toBe(false)
  expect(canPublishMucRelease("bad", "2.0.8")).toBe(false)
})
