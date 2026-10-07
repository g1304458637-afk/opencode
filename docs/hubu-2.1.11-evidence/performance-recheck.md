# HUBU 2.1.11 生产性能串行复核

本次为独立复核，保留首轮 performance-before.jsonl / performance-after.jsonl，未覆盖原始证据，未修改运行时代码。

## 条件与方法

- 记录时间：2026-10-07T13:24:09.602Z。
- 基线：work/opencode，HEAD d4536c941ab79dbcef13e03184c5324810bb4a7b；该提交与迁移基准 34e49bc77 的 Git 文件树完全一致（git diff 为空），基线 app/session-ui/ui/brand 工作树干净。迁移版：work/hubu-features 当前待交付工作树。
- 在主代理明确确认构建、后端测试、桌面 E2E 已停止后开始；先完整运行基线，再完整运行迁移版。没有同时运行两侧或额外测试。
- 两侧均通过原 e2e/performance/playwright.config.ts 完成 vite production build + preview；端口 4597；Chromium；workers=1；repeat-each=3；retries=0。
- 原测试文件 e2e/performance/timeline/home-tab-navigation-benchmark.spec.ts 未修改，三个场景各执行三次。
- 环境：BRAND=hubu、OPENCODE_CHANNEL=hubu、OPENCODE_PERFORMANCE=1、PLAYWRIGHT_PORT=4597、PLAYWRIGHT_SERVER_PORT=4597。
- 指标为原测试以观察帧采样得到的 summary.all.firstObservedMs / stableObservedMs，单位毫秒；不是纯 CPU 执行耗时。

## 结果

| 场景及指标                              | 基线三次              | 基线中位数 [范围]   | 迁移版三次            | 迁移版中位数 [范围] | 中位数差值 |
| --------------------------------------- | --------------------- | ------------------- | --------------------- | ------------------- | ---------- |
| 打开会话 · 首个全部就绪观察             | 141.4 / 143.1 / 160.7 | 143.1 [141.4–160.7] | 149.4 / 149.6 / 148.5 | 149.4 [148.5–149.6] | +6.3       |
| 打开会话 · 全部稳定观察                 | 225.3 / 194.7 / 223.0 | 223.0 [194.7–225.3] | 193.8 / 193.5 / 184.2 | 193.5 [184.2–193.8] | -29.5      |
| 关闭唯一会话返回首页 · 首个全部就绪观察 | 59.8 / 60.2 / 61.4    | 60.2 [59.8–61.4]    | 59.8 / 60.6 / 60.1    | 60.1 [59.8–60.6]    | -0.1       |
| 关闭唯一会话返回首页 · 全部稳定观察     | 125.1 / 122.2 / 122.7 | 122.7 [122.2–125.1] | 125.6 / 124.7 / 127.8 | 125.6 [124.7–127.8] | +2.9       |

基线和迁移版均为 **6 通过、3 失败**。失败均来自原测试的同一断言：等待 `[data-component="session-review"]` 出现超时。两侧三次的 `contentBeforeReview` 全部为 true，因此冷启动内容先就绪的断言通过，但审查面板可见性验证没有通过；不将这一项标为验收通过。

每个指标仅三次样本，保留全部值和离群值，不据此宣称统计等价或排除所有性能回归。与首轮一起供评估；本复核没有为改善数字更改代码、测试断言或剔除样本。

## 原始证据

- [复核基线 JSONL](./performance-before-recheck.jsonl)：9 条完整 BENCHMARK 记录，含失败场景。
- [复核迁移版 JSONL](./performance-after-recheck.jsonl)：9 条完整 BENCHMARK 记录，含失败场景。
- 本地完整日志：work/hubu-211-baseline-perf-recheck.log、work/hubu-211-after-perf-recheck.log。

复现命令（在各自 packages/app 目录、配置上面环境变量后运行）：

```powershell
bun x playwright test --config e2e/performance/playwright.config.ts timeline/home-tab-navigation-benchmark.spec.ts --workers=1 --repeat-each=3 --retries=0
```
