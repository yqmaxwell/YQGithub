# Design：粘贴文本比对

> 本文件描述 `spec.md` 已确认需求的最小技术实现方案。

## 1. 设计上下文

- 需求来源：`spec.md`。
- 设计目标：让用户无需创建临时文件，直接粘贴两段文本并使用现有完整 Diff 工作区查看结果。
- 项目依据：当前文件直比已经具备文本解码、统一 Diff 生成和 diff2html 渲染能力；新功能只需增加输入形式和模式分支。

## 2. 技术方案

- 总体方案：文本作为第四种比对模式，前端将左右粘贴内容构造为 UTF-8 `File`，然后复用现有文件比对接口和结果页。
- 复用与改动：修改 `app.js` 与 `index.html`；复用 `api.js`、`/api/compare/files`、`/api/compare/files/unified` 和现有 Diff 工作区。
- 关键取舍：不新增后端端点、前端组件抽象、第三方编辑器或文本持久化。

### 2.1 前端状态与页面

- 在 `modes` 增加 `{ value: 'text', label: '文本' }`。
- 在 Vue `setup` 中新增 `textLeft` 和 `textRight` 两个仅存于页面内存的响应式字符串，不读写 `JarDiff.storage`。
- 文本模式在现有左右来源区中渲染两个 `<textarea>`，保留左右对称布局，使用等宽字体、稳定高度和独立滚动。
- 比对范围与忽略规则只在 Jar 或目录模式显示；文本模式不改变这些设置的内存和存储值。
- “开始比对”在文本模式下以 `textLeft !== '' || textRight !== ''` 为可用条件，不对用户输入执行 `trim`，保留空格和空行的比对语义。

### 2.2 提交与结果流程

1. 用户在文本模式点击“开始比对”。
2. 前端通过 `new File([text], 'pasted-text.txt', { type: 'text/plain;charset=utf-8' })` 生成左右文件。
3. 复用 `JarDiff.api.compareFiles` 获得比对 ID 和文件元数据。
4. 将 `selectedPath` 设为 `pasted-text.txt`，并复用 `loadFileDiff(leftFile, rightFile)` 调用 `/api/compare/files/unified` 生成差异。
5. 结果页继续使用现有 diff2html 渲染、hunk 导航、字号和专注模式。

文本模式与文件模式共用同一直比结果分支。重试差异加载时，两种模式都使用本次保留在内存中的左右 `File`，不从服务端缓存反向构造。

### 2.3 错误与数据边界

- 两侧都为空时在前端拦截，不调用 API。
- 单侧为空时仍创建有效的零字节 `.txt` 文件，后端按文本解码，生成全新增或全删除 Diff。
- API 或 Diff 加载失败时继续使用现有显式错误提示和重试逻辑，不清空 `textLeft`、`textRight` 或本次构造的文件。
- 文本只在当前页面内存与现有后端请求处理链路中存在；前端不新增持久化。
- 不增加新的文本长度限制或分块策略，保持与文件比对相同的上传边界。

### 2.4 改动边界

| 文件 | 变更性质 | 说明 |
|------|----------|------|
| `src/main/resources/static/app/app.js` | 修改 | 新增文本模式、内存状态、粘贴区、可用性判断和文件直比复用分支 |
| `src/main/resources/static/index.html` | 修改 | 增加文本粘贴区的等宽、稳定高度、焦点和响应式样式 |
| `src/main/resources/static/app/api.js` | 复用 | 不修改，继续使用 `compareFiles` 和 `loadFilesUnifiedDiff` |
| 后端 Java 文件 | 复用 | 不修改 `/api/compare/files` 及 `/api/compare/files/unified` |

不拆分新组件或工具函数；文本模式只在现有模式选择、提交和文件直比分支中增加必要条件。

## 3. 流程与边界

- 正常流程：用户选择文本模式并粘贴内容，前端构造两个 `pasted-text.txt`，调用文件比对后进入结果页，自动选中该文件并加载统一 Diff。
- 异常与恢复：两侧都为空时前端拦截；API 失败时结束进行态、显示错误并保留输入；Diff 加载失败时保留选中路径和本次内存文件，允许重试。
- 接口、数据、页面或架构边界：API 和 Java 数据模型不变；新增数据只有 Vue 页面内存中的左右文本与临时 `File`；结果页不增加第二套布局。

## 4. 测试与验证

- 测试接缝：复用现有 `CompareControllerIntegrationTest` 的 `/api/compare/files` 和 `/api/compare/files/unified` 测试，覆盖 UTF-8 文本接收、统一 Diff 输出与旧文件比对链路回归。本功能不修改后端，不为已有接口重复新增 Java 测试。
- 无法自动验证的验收：以下验收依赖真实 Vue 页面、DOM 交互和 diff2html 渲染，项目没有前端自动化测试工具链，且本变更已确认不引入新依赖，因此在 Plan 中标记为 `manual`。启动项目后在真实浏览器执行：
  - 双侧多行文本包含新增、删除和修改时，完整文件与变更块正确。
  - 左空、右空两种场景分别显示全新增和全删除。
  - 两侧相同时显示“无文本差异”。
  - 中文、空格、空行和不同换行位置不被前端裁剪。
  - 结果页并排/统一、字号、变更导航、专注模式和重试仍可用。
  - 返回首页后文本保留，刷新页面后文本清空。
- 关键验证：执行上述页面场景，并运行 `mvn test` 确认现有 Jar、目录和文件比对测试不受影响。静态检查和 Maven 回归不作为上述页面验收的 PASS 证据；未完成浏览器步骤时必须显式标记为“未验证”。
- 静态检查或类型检查：`node --check src/main/resources/static/app/app.js`、`git diff --check`；项目无前端类型检查命令。

## 5. 迁移与回滚

- 迁移：无数据、配置或 API 迁移。
- 回滚：恢复 `app.js` 与 `index.html` 的文本模式相关改动即可，后端无需处理。

## 6. 设计确认

- [x] 用户已确认技术方案和关键取舍。
