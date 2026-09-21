import { resolveBrand } from "@opencode-ai/brand"

// MUC Harness: 产品级开关 —— mucode 面向校园分发，平台只提供学校自有网关
// （sub2api 中转站）的模型；其他提供商的"连接/自定义"入口全部隐藏。
// 核心层已在 provider 加载侧过滤（provider.ts isProviderAllowed），
// 此开关负责 UI 层，两层配合做到"其他提供商默认不可见、不可配"。
// 如需恢复完整多提供商能力，将此常量改为 false 即可。
export const MUC_HIDE_OTHER_PROVIDERS = resolveBrand().campus
