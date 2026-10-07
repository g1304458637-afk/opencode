import { describe, expect, test } from "bun:test"
import { campusProjectFor } from "./campus-project-groups"

describe("HUBU project membership", () => {
  const projects = [
    { directory: "/work/app", name: "App" },
    { directory: "/work/app/docs", name: "Docs" },
    { directory: "C:/work/app", name: "Windows" },
  ]
  test("selects the closest project without confusing sibling prefixes", () => {
    expect(campusProjectFor({ id: "a", directory: "/work/app/docs/research" }, projects, {})).toBe("/work/app/docs")
    expect(campusProjectFor({ id: "a", directory: "/work/application" }, projects, {})).toBeUndefined()
    expect(campusProjectFor({ id: "a", directory: "C:\\work\\app\\docs" }, projects, {})).toBe("C:/work/app")
  })
  test("explicit organization wins without mutating the execution directory", () => {
    const session = { id: "a", directory: "/work/app" }
    expect(campusProjectFor(session, projects, { a: null })).toBeUndefined()
    expect(campusProjectFor(session, projects, { a: "/work/app/docs" })).toBe("/work/app/docs")
    expect(session.directory).toBe("/work/app")
  })
})
