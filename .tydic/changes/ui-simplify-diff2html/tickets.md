# Tickets：页面简化与 diff2html 差异展示优化

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
| T001 | 在 JarDiffService.java 新增 generateUnifiedDiff(String compareId, String path) 方法，利用已有 DiffUtils.diff() 生成 Patch 后用 DiffUtils.generateUnifiedDiff() 输出 unified diff 文本。在 CompareController.java 新增 GET /api/compare/diff/unified（返回 Content-Type: text/plain）、POST /api/compare/files（接收两个 MultipartFile，.class 文件通过 Procyon 反编译后比对）、POST /api/compare/files/unified 三个端点。 | mvn test 现有测试全部通过<br>mvn compile 编译成功<br>curl GET /api/compare/diff/unified 返回以 '--- a/' 开头包含 '@@' 行号范围标记的 unified diff 文本<br>curl POST /api/compare/files 返回正确 JSON 含 id/left/right/type/decompiled 字段 | 无 |
| T002 | 下载 diff2html 和 highlight.js dist 文件到 vendor/ 目录。重写 index.html 中 <style> 块为暗色主题：OLED 深黑底 #0d1117、暗色面板 #161b22、GitHub Dark diff 配色、Neubrutalism 组件 CSS。在 <script src> 中新增 diff2html 和 highlight.js 引用，移除 ui-diff.js 引用。在 api.js 新增 loadUnifiedDiff(id,path)、compareFiles(fd,onProgress)、loadFilesUnifiedDiff(left,right) 三个API函数。 | mvn spring-boot:run 启动后页面背景为深黑色 #0d1117，无浅色残留<br>浏览器 Console 中无 JS 加载错误<br>JarDiff.api.loadUnifiedDiff 函数存在且可调用<br>页面不出现 ui-diff.js 404 错误 | 无 |
| T003 | 完整重写 app.js：顶部工具栏（三种模式Tab切换、文件选择器、忽略规则输入框、高级设置抽屉齿轮图标、开始比对按钮）。左侧面板双Tab（结构比对Tab含左右双栏目录树+全宽模式、差异比对Tab含递归目录树+搜索+状态筛选+内嵌JAR展开+底部统计）。右侧 diff2html 视图（unified diff渲染、并排/统一切换、上一处/下一处导航）。文件比对模式。localStorage 持久化。删除 ui-diff.js。 | 上传两个不同 Spring Boot fat JAR → 左侧差异文件树正确显示，颜色标记正确<br>点击 .class 文件 → 右侧 diff2html 渲染 Java 源码差异，语法高亮正常<br>展开内嵌 JAR → 显示 jar名 [X 变更]，点击展开显示内部文件列表<br>切换到结构比对 Tab → 双栏结构树对比 → 全宽模式撑满页面 → 退出全宽恢复<br>并排/统一视图切换正常<br>搜索框和状态筛选过滤文件树<br>文件比对模式：上传 .java → diff2html 差异；上传 .class → 反编译后差异<br>修改忽略规则后重新比对 → 被忽略文件不再出现 | T001、T002 |
| T004 | 按 spec Section 6 的 5 组验收用例逐条验证：Jar 比对全链路、目录比对、文件比对（含 .class 反编译）、忽略规则有效性、结构比对全宽模式。确保 mvn test 全部通过，三种模式下所有交互路径无 JS 错误。 | Jar 比对全链路：上传→比对→浏览文件树→查看 diff→展开内嵌 JAR→结构比对→全宽模式→并排/统一切换 全部正常<br>目录比对：选择目录→比对→文件树→diff 全部正常<br>文件比对：上传 .java→diff；上传 .class→反编译 diff 全部正常<br>异常路径：并发超限显示 429 提示；二进制文件正确提示<br>mvn test 零失败，页面无控制台 JS 错误 | T003 |

## 状态说明

任务状态以 `state.json` 为准。本文件只展示摘要，不手写状态结论。

| 状态 | 含义 |
|------|------|
| PENDING | 初始状态 |
| CLAIMED | 已领取 |
| DONE | 局部任务完成 |
| BLOCKED | 被依赖、证据或决策阻塞 |
