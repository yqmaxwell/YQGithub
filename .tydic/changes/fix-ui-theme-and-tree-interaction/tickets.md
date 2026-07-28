# Tickets：UI 主题、结构比对交互与依赖 Jar 深度比对修复

> ticketView：本文件由 Kernel 根据已确认任务生成，只做人类任务视图。事实来源引用 `spec.md` 和 `design.md`，机器状态与结构化约束写入 `state.json`。

## 全局执行规则

- 前置任务未完成不得领取。
- 所有代码写入任务由协调者串行领取和执行；只读分析、规格审查和质量审查可并行。
- 每个 ticket 必须是可独立验证的纵向行为切片，不得按纯前端、后端、数据库等横向层次拆分。
- 前置列只记录真实阻塞边；无前置任务才可进入 next-available 评估。
- 用户只确认行为闭环、验收标准和阻塞边；授权范围与验证命令由 Plan 根据已确认设计生成到 `state.json`，不要求用户理解机器字段。
- 最终 review verdict 只写入变更级 review evidence。
- 无当前轮次 evidence，不得在 `state.json` 中进入 `DONE` 或 `VERIFIED`。

## 任务列表

| Ticket | 行为闭环 | 验收标准 | 阻塞边 |
| --- | --- | --- | --- |
| T001 | 完成后端 Jar 深度索引数据：TreeNode 返回 innerChanges，JarCompareService 统计内部非 unchanged 文件数量，并通过服务测试验证。 | TreeNode JSON 序列化包含 innerChanges 字段默认值 0<br>深度索引的 jar 节点 innerChanges 等于内部非 unchanged 文件数<br>mvn test 全部测试通过 | 无 |
| T002 | 完成前端 GitHub 浅色工作台与 VS Code 式导航交互：两阶段上传、变更树与左右结构切换、左右对齐同步、Jar 展开恢复、hunk 导航、请求竞态保护和全宽返回。 | 比对前后两阶段布局切换正确，结果态上传区收起为紧凑工具栏<br>页面渲染为 GitHub 浅色白底主题，并将 Swiss Grid 细节限制在对齐和排版层<br>变更树与左右结构切换不影响当前文件和右侧 Diff，结构模式导航区扩展至约 55%<br>左右结构按 leftExists/rightExists 显示真实节点或等高占位，展开、行高和滚动同步<br>文件和目录状态同时使用颜色与 M/A/D/T 标记，目录展示聚合变更数<br>包含依赖 Jar 设置正确恢复，请求携带 deepCompareLib=true，Jar 展开失败显示原因并支持重试<br>结构模式点击文件只更新右侧 Diff，全宽模式选择文件后关闭浮层回到常规布局<br>Diff 按 hunk 导航并显示当前位置，快速连续选择文件时仅最后一次请求更新界面 | T001 |

## 状态说明

任务状态以 `state.json` 为准。本文件只展示摘要，不手写状态结论。

| 状态 | 含义 |
|------|------|
| PENDING | 初始状态 |
| CLAIMED | 已领取 |
| DONE | 局部任务完成 |
| BLOCKED | 被依赖、证据或决策阻塞 |
