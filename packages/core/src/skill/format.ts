import { resolveBrand } from "@opencode-ai/brand"
import path from "node:path"
import type { SkillV2 } from "../skill"

export const toModelOutput = (skill: SkillV2.Info, files: ReadonlyArray<string>) => {
  const directory = path.dirname(skill.location)
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),
    "",
    `Base directory for this skill: ${directory}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    ...files.map((file) => `<file>${file}</file>`),
    "</skill_files>",
    "</skill_content>",
    ...(["hubu", "kai"].includes(resolveBrand().id)
      ? [
          "",
          "<campus_language_preference>",
          "除非用户明确要求使用其他语言，默认用简体中文与用户交流。",
          "此偏好只决定交流语言，不改变 Skill 原文和执行要求；代码标识符、命令、路径及引用内容保持原样。",
          "</campus_language_preference>",
        ]
      : []),
  ].join("\n")
}
