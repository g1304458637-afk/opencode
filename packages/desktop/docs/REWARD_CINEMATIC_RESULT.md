# Cinematic Reward V2 — 本地交付与验收

> 2026-09-29 用户截图确认：默认改为 **MAX / 0.5×**，粒子160、溢光1.9、冲击波1.6、画面冲击4；音效默认关闭。实际主动画时长为全额重置5.2秒、重置卡4.6秒。下方 High / 1× 的数值和验证为此前版本记录，时间轴内部关键帧单位保持不变。

2026-09-29。工作目录 `opencode-hubu-logo-20260928`，分支 `feat/reward-motion-system`，基线 HUBU 2.1.0 / `fork/hubu-main` `1cbfa6bfc63893165194c43779bc1e8300d02f75`。这是完整 Electron 客户端的新构建；4486 的旧测试壳与系统安装的 2.0.9 不是本次交付。本轮遵照用户最新要求保留本地操作，不录屏，不发布或替换系统安装版。

本次配置调整后已重新通过 Desktop typecheck、本地构建、两种预览完整播放/结束与关闭重开检查；完整客户端刷新后确认默认 MAX / 0.5×。下方18组回归为上一提交结果，本次未重跑全部回归。

## 本地入口

右下角 **动效预览**：**全额重置** / **获得重置卡**。默认 High；可切换 MAX、0.5×、0.25×。展开“更多 FX 参数”调整粒子、溢光、冲击波和镜头冲击；音效默认关闭，可以勾选“奖励音效”。可收起并重新打开。

这些按钮使用独立的合成演示状态：20→100% 或 0→1 卡，复用实际动效和 DOM 目标。不会发奖、消耗重置卡或改变真实账户。预览额度有明确标记，结束后恢复真实数据。真实奖励优先中止预览。普通 production build 无此入口，需显式开启 `CAMPUS_LOCAL_BUILD=1 CAMPUS_REWARD_PREVIEW=1`。

启动和 QA 命令见 [README](../e2e/reward-motion/README.md)。研究与取舍见 [源码审计](REWARD_CINEMATIC_RESEARCH.md)。

## 新视觉实现

- FULL RESET：S+，2.6秒。全窗暗化/边缘光、128粒子汇聚（MAX160）、真实 orb 四环点燃、650–1150ms 数值和额度条回充、1150ms 全窗爆发/三层冲击波/短促镜头冲击、最大190px真实百分比、余波、composer扫光和RESTORED、最后确认。
- RESET CARD：S，2.3秒。纵向裂隙、0.2→1.16→1的3D冲出、70°→-8°→0°翻转、金属边/箔光/细噪点、大卡展示、1100ms庆祝爆发（High96/MAX120粒子）、弧线缩小与尾迹飞入真实库存（关闭面板时落到真实额度球）、落地光/数量更新、最后确认。
- 复用现有 Motion；Canvas 缓存光斑与冲击波纹理，有限粒子池；单一事件时钟驱动 Motion 和 Canvas。独立 Reduced Motion，不以无障碍简版降低普通模式强度。
- 合成本地音效：低频蓄能、上升扫频、短促低频冲击和晶体尾音；可关闭，完成/取消均释放 AudioContext。未使用下载音频或新音效依赖。
- 保留已有 receipts、去重、优先级、服务端最终值、真实 DOM 落点、输入和业务交互。没有改动奖励概率、资格、计费或服务端逻辑。

## 验证结果

- Desktop `bun typecheck`：通过。
- 奖励状态、receipt、额度状态：22 tests / 51 assertions，通过。
- 定向 oxlint：0 warnings / 0 errors；`git diff --check` 通过。
- HUBU renderer/preload/main production-mode 本地构建通过。后端 dist 复用此前验证过的未变更工件；没有声称重新构建整个后端。已有 eval、重复 sourcemap、动态/静态导入混用等构建警告仍存在。
- 完整 Electron 隔离账户 `CAMPUS_E2E_SCOPE=quota`：18组通过。包含真实额度回充、库存几何落点、队列/同批三卡、持久去重/reload、Reduced Motion、实际 composer 草稿/焦点、最小化返回、卡片消耗/丢响应重试、断连重连。此轮未重跑未变更的 updater 测试。
- 无录屏浏览器 QA：High/MAX × 两种奖励、0.5×/0.25×、Reduced Motion、音频完成与取消释放、1024px窗口，通过。preview 和扩展 matrix 通过；完成后装饰层/Canvas清除，真实额度与库存保持原值。
- 当前 DPR2 Chromium 样本：High reset/card 帧间隔中位数均约8.4ms，P95约25.1/33.3ms；MAX约8.4/8.7ms，P95约25.2/33.3ms。采样包含诊断截图，属于本机工程样本，**不能据此认定稳定60fps达标**。Canvas已限制DPR/raster宽度并缓存纹理，持续慢帧减半粒子。Windows和独立低配硬件性能未验证。

机器证据保存在 gitignored `e2e/artifacts/reward-cinematic/{results.json,*.png}`、`reward-cinematic-electron/result.json` 及 `reward-motion/matrix.json`。本轮没有录制视频。原 V1 视频是历史材料，不作为新视觉验收。

## 人工体验待确认

实现与自动检查已完成，以下感受不能由自动测试代替：FULL RESET 是否明确传达稀有大事件、能量灌入和100%高潮；卡牌冲出是否有重量、展示是否有资产价值、×1是否有庆祝高潮、飞入是否有归属感。请在完整客户端点 High 与 MAX 实际体验。目标的9/10震撼/兴奋/稀有度未经用户打分；音效也未经过人工听感验收。
