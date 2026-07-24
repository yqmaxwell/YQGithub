# Design：页面简化与 diff2html 差异展示优化

> 本文件描述已确认需求的技术实现方案。简单变更保持简短，复杂变更按实际影响展开。

## 1. 设计上下文

- 需求来源：`spec.md`
- 设计目标：将前端页面从多Tab复杂布局简化为两栏统一布局，引入diff2html替代自建diff渲染，采用暗色主题提升专业性和可读性。后端新增unified diff端点和文件比对端点。
- 项目依据：现有Vue 3 + Element Plus + Spring Boot 2.7.18技术栈，前端作为静态资源提供服务。

## 2. 技术方案

- 总体方案：
  - 前端：引入diff2html (^3.4.x) + highlight.js (^11.x)。文件结构：vendor/diff2html/、vendor/highlight.js/ 新增；app.js 重写（新页面布局）；index.html 更新（暗色CSS变量+依赖引入）；api.js 更新（新增unified diff/文件比对API）；ui-diff.js 移除；core.js 保留；storage.js 保留。
  - 后端：`JarDiffService.java` 新增 `generateUnifiedDiff()` 方法；`CompareController.java` 新增 `GET /api/compare/diff/unified`、`POST /api/compare/files`、`POST /api/compare/files/unified` 三个端点。其余服务无改动。
- 复用与改动：
  - 复用：`JarCompareService` 比对逻辑、`ProcyonDecompileService` 反编译、`core.js` 中 `mapStatusBadge`/`splitIgnoreGlobs`/`isIgnoredByGlobs`/`flattenChanged` 等工具函数、`storage.js` 持久化机制。
  - 改动：app.js 从5610行四Tab布局重写为约1200行两Tab布局。index.html CSS从约900行替换为暗色配色+Neubrutalism组件样式。api.js 新增3个API函数。
  - 新增：vendor/diff2html/、vendor/highlight.js/ 两个依赖目录。后端3个新端点。
  - 删除：ui-diff.js 完全移除。app.js 中摘要/依赖/风险评级/分组/预热/专注/minimap/hunk折叠/sync scroll/"仅差异"相关代码移除。
- 关键取舍：
  - 引入diff2html带来约50KB gzip依赖，换取语法高亮+word diff+专业渲染+成熟稳定。
  - 后端数据流向从"结构化rows→前端自绘"变为"unified diff文本→diff2html渲染"，简化前端diff逻辑。
  - 暗色主题替代浅色方案，牺牲部分"文档感"换取专业工具感和长时间使用舒适度。

## 3. 流程与边界

- 正常流程：
  1. 用户选择比对模式 → 选择文件 → 填写忽略规则(可选) → 点击开始比对
  2. 后端 `POST /api/compare/jars` → 返回 `CompareResult`（含treeData + compareId）
  3. 前端渲染左侧文件树（按目录结构组织，颜色标记状态）
  4. 用户点击文件 → 前端请求 `GET /api/compare/diff/unified?id=abc123&path=com/example/A.java`
  5. 后端 `JarDiffService.generateUnifiedDiff()` → java-diff-utils `DiffUtils.generateUnifiedDiff()` → 返回unified diff文本
  6. 前端 `diff2html.html(unifiedText, {outputFormat, highlight: true})` → 渲染GitHub风格diff
  7. 用户可切换并排/统一视图，使用上一处/下一处导航
- 异常与恢复：
  - 文件类型为非文本 → 后端返回null，前端显示"二进制/非文本文件"提示
  - 并发比对超限 → `CompareConcurrencyFilter` 返回HTTP 429，前端显示"服务器繁忙"提示
  - diff2html渲染失败 → 降级显示纯文本diff
  - 内嵌JAR展开失败 → 显示错误状态，收起该条目
- 接口、数据、页面或架构边界：
  - API边界：新增3个端点，不改动现有13个端点
  - 数据边界：unified diff文本格式（Content-Type: text/plain）
  - 页面边界：三模式共用同一两栏布局，结构比对Tab可切换全宽模式
  - 依赖边界：diff2html和highlight.js作为vendor静态资源（CDN或本地dist）

## 4. 测试与验证

- 测试接缝：
  - 后端：`JarDiffService.generateUnifiedDiff()` 可通过Mock CompareStore直接调用
  - 后端：新增Controller端点可通过 `MockMvc` 测试
  - 前端：通过Playwright或手动浏览器验证三种模式各场景
- 关键验证：
  - `mvn test` 确保现有测试全部通过
  - 新端点curl验证：`curl "http://localhost:8080/api/compare/diff/unified?id=abc123&path=com/example/A.java"` 返回合法unified diff格式
  - 浏览器验证：三种模式上传→比对→渲染流程完整
  - diff2html渲染验证：语法高亮、word diff、并排/统一切换正常
- 静态检查或类型检查：
  - 前端：无（纯JavaScript，无TypeScript）
  - 后端：`mvn compile` 确保编译通过，IDE静态分析

## 5. 迁移与回滚

- 迁移：前端由CDN引入的Vue 3和Element Plus保持，新增diff2html/highlight.js本地vendor文件。后端仅新增端点，现有端点行为不变。无需数据库迁移。
- 回滚：恢复原有前端文件（app.js、index.html、api.js、ui-diff.js）即可。后端新端点不影响现有功能，可保留不移除。

## 6. 设计确认

- [x] 用户已确认技术方案和关键取舍。
