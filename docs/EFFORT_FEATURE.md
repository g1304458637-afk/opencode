# 思考强度档位功能说明（muc-effort-zh）

## 功能概览

在输入框的模型选择器旁新增「思考强度」档位下拉框，可按会话切换推理力度：

- **思考强度**（默认）：使用上游默认行为，不附加参数
- **低 / 中 / 高**：请求体携带 `reasoning_effort`（low / medium / high），经网关透传给上游

### 生效范围（按模型 ID 匹配）

| 模型系列 | 档位 |
|---|---|
| `gpt-5*` / `o3*` / `o4*`（含 gpt-5.6-luna、o3-mini 等变体） | 低/中/高 |
| 新一代 GLM：`glm-4.5*` / `glm-4.6*` / `glm-4.7*` / `glm-5*` | 低/中/高 |
| 其他模型（老 glm-4、cog 系等） | 不显示档位（上游不支持，避免参数报错） |

实现要点：`packages/opencode/src/provider/provider.ts` 的 `gatewayModelVariants()`；
界面文案统一走 `packages/app/src/utils/variant-label.ts`（v1/v2 输入框共用）。
参数链路：档位 → `variants[id].reasoningEffort` → `@ai-sdk/openai-compatible` 序列化为
请求体 `reasoning_effort` 字段（SDK 源码 `index.mjs:515`）→ 网关透传 → 上游生效。

实测（GLM 上游，同一问题）：高档 6.1s / 低档 2.3s，思考 token 随档位变化。

## Windows 构建步骤

```bash
# 1) 安装依赖（--ignore-scripts 跳过原生编译，无需 VS Build Tools）
bun install --ignore-scripts

cd packages/desktop

# 2) prebuild：必须用官方 npm 源（国内镜像缺 canary 版 CLI 包）
#    OPENCODE_CHANNEL=muc BUN_CONFIG_REGISTRY=https://registry.npmjs.org bun run prebuild

# 3) 构建与打包（OPENCODE_CHANNEL 决定品牌皮肤）
OPENCODE_CHANNEL=muc bun run build
OPENCODE_CHANNEL=muc ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  bun run package:win -- --dir

# 产物：packages/desktop/dist/win-unpacked/mucode.exe
```

注意：打包前先关闭正在运行的客户端，否则产物文件被占用会报 EPERM。

构建 HUBU 品牌版：将上述命令中 `OPENCODE_CHANNEL=muc` 换为 `OPENCODE_CHANNEL=hubu`（需在含
hubu 分支代码的仓库中执行）。
