# Design：按部署模式控制目录比对

> 本文件描述已确认需求的技术实现方案。

## 1. 设计上下文

- 需求来源：`spec.md`
- 设计目标：以一个显式部署模式同时约束后端目录 API 和前台目录入口，服务器模式默认拒绝目录能力。
- 项目依据：Spring Boot 构造注入配置、`CompareController` 集中提供比对接口、静态 Vue 应用通过 `api.js` 调用同源 REST。

## 2. 技术方案

- 总体方案：新增 `jardiff.deployment-mode=local` 配置。`CompareController` 构造时只接受 `local` 或 `server`，保存是否允许目录比对的布尔结果；非法值抛出异常并阻止启动。
- 后端能力接口：在 `CompareController` 增加 `GET /api/compare/capabilities`，返回 `{ "directoryCompareEnabled": true|false }`。
- 后端强制校验：增加控制器内私有方法 `ensureDirectoryCompareEnabled()`，由 `/compare/directory`、`/compare/directory/path`、`/compare/directory/summary` 在读取文件或调用服务前执行。禁止时抛出 Spring `ResponseStatusException(HttpStatus.FORBIDDEN, "服务器模式禁止目录比对")`。
- 前端能力读取：`api.js` 复用 `fetchJson` 增加能力查询；`app.js` 增加 `directoryCompareEnabled`，初始为 `false`，能力加载成功后按响应更新。
- 前端入口：`modes` 保持完整常量，模板只渲染允许的模式；能力为 false 且当前持久化模式为 `dir` 时切换为 `jar` 并同步现有 storage；首页固定状态文案直接改为“版本比对”。
- 复用与改动：不新增类、过滤器或依赖；访问判断只在现有控制器内复用一次私有方法，避免为三个调用建立新抽象层。
- 关键取舍：不自动识别 localhost；不只隐藏前端；不把目录权限塞入并发过滤器；不扩展成通用权限框架。

## 3. 流程与边界

- local 正常流程：应用读取 `local` -> 能力接口返回 true -> 页面展示目录 -> 三个目录 API 沿用现有处理。
- server 正常流程：应用读取 `server` -> 能力接口返回 false -> 页面隐藏目录；直接调用任一目录 API -> 在文件访问前返回 403。
- 异常与恢复：能力请求失败时前台隐藏目录入口；非法部署模式阻止应用启动；修正配置或恢复接口后通过重启、刷新恢复。
- 前端恢复流程：能力请求失败或返回 false -> 目录入口保持隐藏；若当前模式为 `dir`，回退到 `jar`。
- 配置异常：构造 `CompareController` 时发现非 `local/server` 值 -> 抛出配置错误 -> Spring 上下文启动失败，日志保留配置项名称但不包含敏感信息。
- 接口契约：能力接口为无参数 GET，响应仅包含布尔字段 `directoryCompareEnabled`；目录接口在 server 模式新增 403 响应，local 模式响应契约不变。
- 数据与缓存：不新增数据库、会话或缓存；部署模式只在应用启动时读取，变更后通过重启生效。
- 页面边界：改变目录 Tab 是否存在、保存模式回退和首页状态文案，不改变首页布局、目录表单、结果页或其他模式；能力接口仍只返回 `directoryCompareEnabled`。

## 4. 测试与验证

- 测试接缝 1：`CompareControllerIntegrationTest` 使用默认配置调用能力接口，覆盖 A1；沿用现有 Spring MVC 公共接口测试方式。
- 测试接缝 2：新增 server 模式集成测试上下文，逐个调用三个目录 API 并断言 HTTP 403、错误正文，覆盖 A2、A3 和“业务执行前拒绝”。
- 测试接缝 3：新增非法配置上下文启动测试，断言应用上下文失败且错误指向 `jardiff.deployment-mode`，覆盖 A6。
- 测试接缝 4：现有 Maven 测试覆盖 Jar、文件、文本主流程不回归，覆盖 A5 的后端部分。
- 无法自动验证的验收：A2 的页面隐藏、A4 的持久化模式回退、A5 的页面入口不变和 A7 的中性状态文案，当前项目没有前端测试框架；使用 local/server 两次浏览器运行验证，不新增第三方测试依赖。
- 关键验证：按 TDD 每次只增加一个失败行为测试，再做最小实现；最终运行 `mvn test`、`node --check src/main/resources/static/app/app.js`、`node --check src/main/resources/static/app/api.js`、`git diff --check`。
- 静态检查或类型检查：项目没有独立 Java 静态检查和前端类型检查配置，以上述 Maven 编译测试与 Node 语法检查为准。

## 5. 迁移与回滚

- 迁移：本地无需修改；服务器启动参数或环境配置显式设置 `jardiff.deployment-mode=server`，重启后生效。
- 回滚：移除服务器模式覆盖并回退代码；默认 local 可恢复原目录入口和接口行为。

## 6. 设计确认

- [x] 用户已确认技术方案和关键取舍。
