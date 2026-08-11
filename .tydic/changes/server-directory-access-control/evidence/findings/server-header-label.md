# 服务器模式首页文案缺口

计划阶段检查真实页面发现，首页右上角固定显示“本地版本比对”。服务器模式若只隐藏目录入口，该文案将与实际部署模式冲突。用户已确认采用中性文案“版本比对”，不扩展能力接口字段。

```yaml
verdict: BLOCKED
returnTo: think
changeId: server-directory-access-control
blockers:
  - 当前 spec.md 和 design.md 未定义服务器模式下首页固定“本地版本比对”文案的处理方式
  - 用户已确认本地和服务器模式统一显示中性文案“版本比对”，能力接口仍只返回 directoryCompareEnabled
```
