# Spec：页面简化与 diff2html 差异展示优化

> 本文件记录已经调查并经用户确认的需求事实。不要为了填模板增加无关内容。

## 1. 问题与范围

- 当前行为：比对结果页面包含结构/内容/摘要/依赖四个Tab，辅以密集过滤器（搜索/状态/来源/风险/分组方式）、分组/平铺切换、预热进度显示。自定义diff视图采用双栏逐行渲染，缺少语法高亮，视觉效果不专业。页面信息密度过高，用户难以聚焦核心比对流程。
- 目标行为：页面简化为统一的"文件列表 + diff2html代码对比"两栏布局。左侧面板包含"结构比对"和"差异比对"两个Tab。diff视图使用diff2html渲染，具备语法高亮、word diff、并排/统一切换。支持Jar比对、目录比对、普通文件比对三种模式。内嵌JAR采用层级展开式展示。文件支持.class反编译后比对。整体采用暗色主题（Dark Mode + Swiss Grid + Neubrutalism点缀）视觉风格。
- 范围：`src/main/resources/static/` 下前端文件完全重写（app.js、index.html、api.js），新增 vendor/diff2html/ 和 vendor/highlight.js/ 依赖。后端 `CompareController.java`、`JarDiffService.java` 新增3个端点。移除 `ui-diff.js`。
- 非目标：不改变后端Jar比对核心逻辑、不改变Procyon反编译逻辑、不引入新后端语言或框架、不新增用户登录/权限系统。

## 2. 项目证据

- 证据：`src/main/resources/static/app/app.js` 共5610行，含四Tab（结构/内容/摘要/依赖）、密集过滤器、预热进度面板、分组切换逻辑。`src/main/resources/static/app/ui-diff.js` 87行，自建diff行渲染，无语法高亮。`src/main/resources/static/app/core.js` 252行，含 `buildDiffRows` 等diff工具函数。`src/main/java/com/example/jardiff/controller/CompareController.java` 含13个API端点。
- 结论：前端重写范围明确（app.js + index.html + api.js），后端仅新增端点不破坏现有接口，ui-diff.js移除后 core.js 中 buildDiffRows 函数可保留作为辅助或清理。

## 3. 需求与场景

- 需求：见功能需求清单（F1-F27，详见3.1-3.6节）。
- 场景：
  - 场景一（Jar包比对）：用户选择"Jar比对"Tab → 选择旧版和新版Jar文件 → 可选填写忽略规则 → 点击"开始比对" → 左侧显示差异文件树（按目录结构组织，颜色标记状态） → 点击文件 → 右侧显示diff2html渲染的代码差异 → 支持内嵌JAR展开：含内部差异的JAR条目显示"▶ 内部 X 处变更" → 可在结构比对Tab中查看左右双栏结构树对比，支持全宽模式。
  - 场景二（目录比对）：用户选择"目录比对"Tab → 通过文件选择器或填写路径选择目录 → 点击"开始比对" → 后续交互同场景一。
  - 场景三（普通文件比对）：用户选择"文件比对"Tab → 选择旧版和新版文件 → 点击"开始比对" → 右侧直接显示diff2html渲染的差异+语法高亮 → .class文件后端自动反编译后比对。
- 异常与恢复：Jar上传超限→提示大小限制。并发比对超限→HTTP 429拒绝。文件类型不匹配→显示二进制提示。内嵌JAR展开失败→显示错误状态，不影响其他文件浏览。

## 4. 存量参考与复用

- 参考对象：GitHub PR Files Changed页面（文件树侧栏+diff主区布局）、git-diff-view组件（diff2html渲染效果）、VS Code Diff Editor（变更导航按钮）、DiffChecker（极简上传区）、Awwwards精工极简暗色风格。
- 复用内容：现有 `JarCompareService` 比对逻辑、`JarDiffService` 差异计算、`ProcyonDecompileService` 反编译、`core.js` 中的 glob 匹配和状态映射工具、`storage.js` localStorage持久化。Vue 3 + Element Plus 前端框架保留。
- 参考差异：GitHub使用完整文件树+单文件diff，我们增加结构对比Tab和三种模式切换。VS Code支持行内编辑，我们不支持。采用Awwwards暗色主题替代GitHub浅色方案。

## 5. 已确认决策

- 用户决策：
  - 三种模式（Jar/目录/文件）全部保留（用户决策：A）。文件比对支持.class反编译（用户决策：B）。
  - 页面两栏布局，左侧双Tab（结构比对+差异比对），右侧diff2html渲染（用户决策）。
  - 左侧面板两个Tab，结构比对支持全宽模式（用户决策）。
  - diff比对引入diff2html依赖（用户决策：A）。并排/统一切换、语法高亮、word diff、变更导航保留；minimap、hunk折叠、sync scroll、"仅差异"开关移除（用户决策）。
  - 内嵌JAR展开式设计（用户决策：B）。
  - 忽略规则保留在主界面，includeLib/Classes/Resources折叠为高级设置抽屉，warmupLimit/limitJarMb等移除为后端配置（用户决策）。
  - 采用"精工极简暗色主义"视觉风格（Dark Mode + Swiss Grid + Neubrutalism 点缀）（用户决策）。
- Agent 决策：移除摘要视图、依赖视图、风险评级、分组/平铺切换、预热显示、专注模式、minimap、hunk折叠、sync scroll、"仅差异"开关共11项；保留搜索、状态筛选、统计数字。diff2html暗色主题通过CSS变量覆盖实现。

## 6. 验收与质量

- 验收标准：
  - Jar比对：上传两个Spring Boot fat JAR → 左侧树正确显示差异文件，颜色标记正确 → 点击.class文件 → diff2html渲染的Java源码差异，语法高亮正常 → 展开内嵌JAR → 显示内部变更列表 → 切换并排/统一视图正常。
  - 目录比对：填写目录路径 → 开始比对 → 结果正确展示 → 文件选择器选择目录 → 功能正常。
  - 文件比对：上传两个.java文件 → 显示diff2html差异 → 上传两个.class文件 → 显示反编译后的Java源码差异。
  - 忽略规则：修改忽略规则 → 重新比对 → 被忽略的文件不出现在列表中。
  - 结构比对：切换到结构比对Tab → 双栏结构树对比 → 全宽模式撑满页面 → 退出全宽恢复。
- 验证方式：浏览器手动验证三种模式各场景 + 后端 `mvn test` 确保现有测试通过 + 新API端点curl验证返回格式正确。
- 适用的安全、性能、兼容、迁移或回滚要求：diff2html + highlight.js 合计约150KB(gzip后约50KB)，加载性能可接受。兼容Chrome 90+/Firefox 90+/Safari 15+/Edge 90+。后端兼容Java 8+和Spring Boot 2.7.18。无迁移或回滚要求（仅前端+少量后端Api新增）。

## 7. 用户确认

- [x] 用户已确认完整需求、范围、方案方向和验收。
