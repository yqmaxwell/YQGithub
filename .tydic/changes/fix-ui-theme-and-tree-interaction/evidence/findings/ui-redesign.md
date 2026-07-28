# UI 重设计回流证据

当前实现审查表明，原设计只修补浅色主题和局部树交互，无法满足用户已确认的新信息架构与验收要求，因此必须回流 Think 重新发布规格与设计。

```yaml
verdict: BLOCKED
returnTo: think
changeId: fix-ui-theme-and-tree-interaction
blockers:
  - 原结构比对左右两栏渲染同一份完整 treeData，未按 leftExists 和 rightExists 表达真实左右版本结构
  - 用户已确认改为单一左侧导航并在变更树和左右结构之间切换，右侧始终保留 Diff 主区
  - 用户已确认左右结构模式自动扩展至约 55%，单侧不存在节点使用同一行空占位对齐
  - 用户已确认上传区使用比对前工作区和比对后紧凑工具栏两阶段布局
  - 用户已确认整体采用 GitHub 克制浅色风格，移除现有硬阴影和位移式 Neubrutalism 表现
  - 新验收还需覆盖 Jar 加载失败恢复、真实 hunk 导航和异步 Diff 请求竞态，原规格与设计未定义
```
