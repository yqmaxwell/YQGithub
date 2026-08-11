# Final Code Review Evidence

```yaml
gate: semantic-review
changeId: "server-directory-access-control"
statePath: "state.json"
stateRevision: 13
diffHash: "df858676132151182b4b4bc3dd3a6bf6614723a1c3c17ea79df6662c01cf3ff2"
createdAt: "2026-07-29T16:49:00+08:00"
producerType: coordinator
verdict: BLOCKED
returnTo: code
blockers:
  - "[P2][code] src/main/java/com/example/jardiff/api/CompareController.java:120,389 新增 capabilities 对外接口没有结构化 start/end 与 Cost，服务器拒绝路径只有无法区分接口的通用 skip 日志，不满足 rules/logging.md 的对外接口必打门禁。"
  - "[P3][code] src/main/java/com/example/jardiff/api/CompareController.java:87-90 构造器签名上一参数结束符由右括号改为逗号，但该重写行位于 AGC START 之前，不满足 rules/agc.md 对新增或重写代码块完整标记的硬约束。"
evidence:
  - path: "evidence/code/T001-001.md"
  - path: "evidence/code/T002-001.md"
```

## 规格正确性

- 结论：通过。
- 默认 `local`、显式 `server`、非法模式启动失败、能力接口单字段、三个目录接口后端拒绝、页面入口控制、保存模式回退和中性文案均与 revision 2 的 `spec.md`、`design.md` 一致。
- 未发现需求遗漏或范围蔓延。前端只使用能力结果改善交互，服务器端仍在三个目录业务入口执行强制校验。

## 验证真实性

- 结论：通过。
- T001 机器证据绑定 10 项 Spring 集成测试，覆盖默认能力、server 能力、三个 403、非法配置以及 Jar/文件主流程；T002 机器证据绑定两个前端脚本的 Node 语法检查。
- 本轮真实浏览器验收覆盖 local 四入口与实际目录比对、server 三入口、持久化 `dir` 回退并写回 Jar、能力接口 404 时隐藏目录并回退 Jar。`state.json` 对 manual 验收按协议保留 `UNVERIFIED`，人工结果由本审查记录承接，不伪造机器 PASS。

## 工程质量

- 结论：阻断。
- `rules/scope-control.md` 通过：实际文件操作与 T001/T002 授权一致；独立文本比对变更不计入本审查对象。
- `rules/code-style.md` 通过：复用 Spring `@Value`、现有 `fetchJson`、`switchMode` 和 storage，没有新增依赖或重复抽象。
- `rules/java-style.md` 通过：改动保持现有控制器职责和命名方式；未新增 DTO/VO 或分层。
- `rules/exception.md` 通过：403 使用现有 Spring HTTP 异常边界转换，错误正文不含堆栈或内部实现。
- `rules/security.md` 通过：目录权限由后端二次校验，前端隐藏不作为授权依据；配置不包含敏感值。
- `rules/transaction-sql.md` 不适用：本变更没有 SQL、事务或数据源改动。
- `rules/logging.md` 不通过：新增对外能力接口及拒绝执行路径缺少规定的结构化入口日志和耗时，见 blocker 1。
- `rules/agc.md` 不通过：构造器签名存在一行重写未被新增代码块标记包裹，见 blocker 2。
- `rules/generation-self-check.md` 不通过：存在上述两项硬规则遗漏，不能形成无遗留项的最终 PASS。

## 必须修复

- 在不改变接口响应的前提下，为新增能力接口补齐符合项目格式的 `start/end` 与 `Cost`；目录拒绝日志需能区分实际调用接口，然后重跑既有测试。
- 调整构造器新增参数周围的 AGC 边界，使本次实际重写行完整落在标记内，不改变构造行为。
- 唯一回流阶段：Code。
