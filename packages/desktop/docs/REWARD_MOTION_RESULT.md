# Reward Motion V1 历史交付与验收记录

> 本文记录上一轮克制版，视觉方案已被 [Cinematic V2](REWARD_CINEMATIC_RESULT.md) 替代。当前入口、时长、粒子、Motion 和声音以 V2 为准。

日期：2026-09-29。代码基线为实时核对的 `fork/hubu-main`：`1cbfa6bfc63893165194c43779bc1e8300d02f75`，HUBU 2.1.0；工作分支 `feat/reward-motion-system`。

原浏览器 4486 是历史 quota 测试壳，写死的 2.0.7 不能代表当前 HUBU 源码；已改用新构建的完整 Electron 客户端验收。系统已安装的 HUBU AI 2.0.9 没有被替换。MUC 是此 HUBU 基线的跨品牌编译验收，沿用基线 MUC release 元数据 2.0.7，不代表已合并或验证最新 `muc-main`。

REFERENCE_RESEARCH=见 [完整研究与源码审计](REWARD_MOTION_RESEARCH.md)。覆盖 Motion、Motion Primitives、Magic UI、tsParticles、Rive、Fluent、Apple；区分直接读到的源码与仅返回网页壳的文档。采用状态机、数值插值、有限生命周期、真实几何和克制层级，没有引入 React 动画库。

CURRENT_MOTION_STACK=SolidJS + CSS keyframes + 单一有限 RAF；无新增生产依赖。粒子无需独立 RAF。既有手动额度恢复状态机保留。

CURRENT_REWARD_FLOW=服务端提交奖励后生成 receipt → `/v1/usage` → main parser 与持久去重 → preload IPC → MucStatus 成功快照 → RewardEvent → 编排 → 实际额度/库存呈现 → 最终 Toast。未修改任何概率、资格、额度、奖励、计费或服务端算法。

REWARD_EVENT_ARCHITECTURE=统一 id、原始 ids、type、createdAt、source、payload(before/after/receipt)。最终值只取成功服务端快照；receipt quantity 不推算余额。缺少有效额度或卡数时不虚构成功。新快照覆盖过时插值。

QUEUE_AND_DEDUPE=FULL_RESET 优先级100，RESET_CARD_GRANTED 80；200ms 呼吸间隔；同类待执行事件合并；卡片进行中提前到达的 grants 合并且不重启动画。main 持久 receipt 去重、renderer 有界 seen 集合；刷新、重复、同批重复、reload 均有验证。

FULL_RESET_CHOREOGRAPHY=1650ms；环境轻暗 → 真实 orb 启动 → 路径 → 260–720ms 真实额度恢复 → 双窗口数值和条形同步 → 波纹与24个微粒 → 独立主标题/数值 → composer 轮廓 → 收束 → Toast。首页 hero 测量在条件子节点挂载后进行，位于真实首页标题上方，已用几何断言和截图检查。

RESET_CARD_CHOREOGRAPHY=1450ms；光点 → 石墨金属卡片形成 → 单次 Y 翻转 → foil → 独立资产名称与数量 → 弧线缩小飞行 → 实际库存落点反馈 → 实际持有数更新 → Toast。与全额重置的系统事件明显区分。

REAL_UI_TARGETING=每个 scene 批量读取一次 DOMRect；目标为打开面板的真实库存，否则真实 quota orb；源为卡片实际位置，composer 为实际组件。没有固定屏幕落点。动画内冻结坐标，下一个事件重新测量。几何测量采用 microtask，避免 Solid 条件子节点尚未插入造成默认位置回退。

PARTICLE_IMPLEMENTATION=24/16个有限 CSS transform/opacity 微粒，无烟花、彩纸、全屏 confetti、无限循环或独立粒子 store。持续慢帧降级为最多8个且关闭 foil；Reduced Motion 不创建微粒。

NUMBER_ANIMATION=由 before→after 插值，未知旧值不造数；卡数使用整数；额度 clamp 0–100、精确收束到服务端值；100→100 仍有事件反馈；局部83%不伪装100%。

QUOTA_ANIMATION=真实 orb、两条 quota bars、hero 共用时间轴；bar 使用 scaleX，避免逐帧 width 布局。普通刷新不创建奖励；原有手动重置调用顺序保留。

TOAST_INTEGRATION=动效结束后才出现确认；title、receipt数量、当前快照持有数、详情与关闭。Toast 的关闭只控制通知，不改变数据或队列。

REDUCED_MOTION=尊重操作系统且支持实时变化；去除翻转、位移、波纹、微粒，使用淡入与确定性数字切换。QA 单独提供开关。最终确认和真实资产变化保留。

ACCESSIBILITY=Toast `role=status`、`aria-live=polite`、`aria-atomic=true`；装饰 scene 和英文 eyebrow 不重复朗读。遮罩 pointer-transparent；不改变聊天布局、滚动或焦点。英文/中文走现有 typed i18n，其他语言沿用现有回退。新文案复用仓库现有“重置卡/额度/获得/持有”术语；没有新增语言翻译。

PERFORMANCE=浏览器 DPR2 的有限帧采样详见 `e2e/artifacts/reward-motion/matrix.json`；只代表当前 macOS Chromium 样本，不代表低配普通机器或 Windows。无新增依赖、视频背景或动画引擎；全部 CSS 动效有限。未做独立低端硬件压测。

MEMORY_CLEANUP=RAF、toast timer、visibility/media listener 在 dispose 时清理；隐藏窗口结束当前 scene，返回不重播；完成后删除全部 reward layer/motes，Toast 到时删除。重复矩阵无 pageerror、无残余 reward DOM；这不是长时间 heap snapshot 的完整泄漏证明。

MULTI_EVENT_RESULT=同时 reset+card 先 reset 后 card；三张同批与三次进行中到达均合并数量；重复 id 不加数量；失败刷新取消动画，恢复后不伪造成功。所有上述自动化通过。

FULL_RESET_TESTS=20→100、95→100、100→100、双窗口同时恢复、短窗20→83且周窗41不变；确认先动画后Toast；实际输入框轮廓位置；后台恢复不重播；刷新去重。通过。

RESET_CARD_TESTS=0→1、1→2、5→6；打开库存/关闭面板 orb 两种落点；实际 DOMRect 一致；三卡合并；快速重复；真实持有数；reduced motion；resize。通过。

REGRESSION_TESTS=44项单元测试通过、desktop typecheck通过、目标生产文件 lint 0 warnings/0 errors、diff check通过、HUBU/MUC Electron build通过。两个品牌各21组完整 Electron 回归涵盖连接、凭证隔离、模型目录/推理档位、余额与订阅呈现、重置卡取消/实际使用/重试/双击防重、失效快照、奖励、账户入口、更新可用/无更新/坏feed、退出重连。实际 composer 草稿与焦点通过；没有发起付费模型生成，因此端到端生成回复仍未验证。Full reset backend 仅审计既有 committed-receipt 路径，并通过本地 HTTP fixture 走真实客户端接收链路；未触发生产全额重置。

MACOS_RESULT=本机完整 Electron 双品牌功能检查通过；真实 UI 截图在 `e2e/artifacts/reward-motion-electron` 与 `reward-motion-muc`。renderer/preload/main 从当前源码构建；服务器可执行文件复用已存在产物，其对应 server/core/protocol/schema/opencode 源码与当前基线无差异，并非重新编译服务器。

WINDOWS_RESULT=UNVERIFIED。没有 Windows 执行环境；不声称 Windows 性能或原生回归通过。可使用相同 Electron E2E 在 Windows 补验。

QA_VIDEO_PATHS=以下为实际浏览器录屏，使用合成账户状态与生产奖励组件；周边是标明用途的 QA 壳，不冒充生产账户或完整 Electron 录屏：

- `packages/desktop/e2e/artifacts/reward-motion/full-reset-1x.webm`
- `packages/desktop/e2e/artifacts/reward-motion/reset-card-1x.webm`
- `packages/desktop/e2e/artifacts/reward-motion/full-reset-half.webm`
- `packages/desktop/e2e/artifacts/reward-motion/reset-card-half.webm`
- `packages/desktop/e2e/artifacts/reward-motion/reduced-motion.webm`

同目录同时提供五个同名 `.mp4`，已完整解码验证，便于直接预览。

可复现入口和完整客户端命令见 [QA README](../e2e/reward-motion/README.md)。本地预览为 http://127.0.0.1:4198。大体积视频/截图位于 gitignored artifacts，本机交付保留；复刻仓库后运行脚本重新生成。

KNOWN_LIMITATIONS=Windows、低端硬件、长时间 heap profiling、付费聊天生成、生产后端 grant 未实测；跨品牌编译不代表已合并 MUC 主线；动画内 resize 不连续重算飞行轨迹，下一个事件重测；没有奖励专用声音偏好，所以保持静音；持久 receipt 先认领的既有 at-most-once 设计可能在 renderer 崩溃后少播一次庆祝，不影响真实奖励；未替换安装版、推送、部署或发布。

COMMIT_SHA=本报告随实现提交；最终回复列出实际提交 SHA。可在仓库执行 `git log -1 --format=%H -- packages/desktop/src/renderer/reward-motion.tsx` 核对实现提交。

## 14项明确回答

1. **YES** — 全额重置已超出 Toast，包含真实 orb、额度与 composer 的完整 scene。
2. **YES** — 用户能看到真实快照额度的恢复过程；开面板可看到双窗口，关闭时仍有 hero/orb。
3. **YES** — 最终额度来自成功服务端状态；自动化使用本地 HTTP fixture 验证真实数据链路。
4. **YES** — 重置卡有独立数字资产 reveal。
5. **YES** — 飞行目标来自实际库存或 orb DOMRect，已断言匹配。
6. **YES** — 卡数来自服务端快照，未按动画 receipt 推算。
7. **YES** — 持久及 renderer event dedupe 均存在。
8. **YES** — 同时奖励有优先队列。
9. **YES** — 无 confetti 或 fireworks。
10. **YES** — Reduced Motion 有独立降级并已测试。
11. **YES** — 无硬编码固定屏幕落点；源/目标/composer 按真实 DOM 测量。
12. **YES（已测范围）** — overlay 不截断点击；真实输入焦点与草稿保留；未验证付费聊天生成。
13. **YES（有限运行观察）** — 未见残余 scene/particle、持续 reward RAF 或未清理 listener；不是长期 heap 泄漏认证。
14. **YES** — 五组实际 QA 视频和可重复 QA 环境均提供。
