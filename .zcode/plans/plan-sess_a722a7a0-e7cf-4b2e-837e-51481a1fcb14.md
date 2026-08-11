# 优化项 2/3：原生文件选择器（覆盖 jar / 目录 / 单文件三个场景）

## 目标与验收标准

**目标**：用 JavaFX 原生 FileChooser/DirectoryChooser 替代 WebView 里选不了文件的 `<el-upload>`，覆盖 jar 比对、目录比对、单文件比对三个场景。text 模式（粘贴文本）不动。

**背景前提**：JavaFX WebView（JDK 8）默认不处理 `<input type="file">`，桌面应用里现有上传按钮选不了文件——所以 jar/file 模式是**必需修复**，dir 模式是体验优化（手填路径→选目录）。

**验收标准**：
1. jar 模式：点"选择旧版 Jar"→ 弹原生 FileChooser（过滤 .jar/.zip/.war）→ 选文件 → 路径回填显示 → 比对出结构树
2. 目录模式：点"浏览"→ 弹 DirectoryChooser → 选目录 → 路径填入输入框 → 比对正常
3. 单文件模式：选两个 .class → 反编译比对 + 行级 diff 正常
4. text 模式不受影响
5. `mvn test` 仍全绿；`mvn package` 成功

## 改动清单（跨 Java / 前端 / 后端）

### 一、Java 侧：JS↔Java Bridge（新建 1 类 + 改 Launcher）

**新建 `src/main/java/com/example/jardiff/FileBridge.java`**（约 50 行）：
持有 JavaFX `Stage` 引用，提供 3 个方法供 JS 调用，均**同步返回绝对路径字符串**（取消返回 `null`）：
```java
public class FileBridge {
  private final Stage stage;
  public FileBridge(Stage stage) { this.stage = stage; }

  public String chooseJar(String title) {
    FileChooser fc = new FileChooser();
    fc.setTitle(title);
    fc.getExtensionFilters().add(new ExtensionFilter("Jar/Zip", "*.jar","*.zip","*.war"));
    File f = fc.showOpenDialog(stage);
    return f != null ? f.getAbsolutePath() : null;
  }
  public String chooseDirectory(String title) {
    DirectoryChooser dc = new DirectoryChooser();
    dc.setTitle(title);
    File f = dc.showDialog(stage);
    return f != null ? f.getAbsolutePath() : null;
  }
  public String chooseFile(String title) {
    FileChooser fc = new FileChooser();
    fc.setTitle(title);
    File f = fc.showOpenDialog(stage);
    return f != null ? f.getAbsolutePath() : null;
  }
}
```
> JS→Java 调用恰在 JavaFX Application Thread，与 FileChooser/DirectoryChooser 要求的线程一致，可直接同步弹窗返回。

**改 `JarDiffLauncher.start()`**：WebView engine load 之前注入 bridge，并用 load worker 的 `SUCCEEDED` 监听保证页面（重新）加载后 bridge 仍在：
```java
WebEngine engine = webView.getEngine();
JSObject win = (JSObject) engine.executeScript("window");
win.setMember("jardiffBridge", new FileBridge(stage));
engine.locationProperty().addListener(...) // 或 getLoadWorker().stateProperty() SUCCEEDED 时重新 setMember
engine.load("http://localhost:" + actualPort + "/");
```

### 二、前端 `app/api.js`：加 bridge 调用 + 3 个路径型 API

```js
// bridge 调用（bridge 不存在时返回 null，保证 web 模式仍可降级）
function chooseJar(title) { return window.jardiffBridge && window.jardiffBridge.chooseJar(title) }
function chooseDirectory(title) { return window.jardiffBridge && window.jardiffBridge.chooseDirectory(title) }
function chooseFile(title) { return window.jardiffBridge && window.jardiffBridge.chooseFile(title) }
// 路径型 API（仿现有 compareDirectoryByPath）
function compareJarsByPath(fd) { return fetchJson('/api/compare/jars/path', { method:'POST', body: fd }) }
function compareFilesByPath(fd) { return fetchJson('/api/compare/files/path', { method:'POST', body: fd }) }
function loadFilesUnifiedDiffByPath(leftPath, rightPath) { /* POST /api/compare/files/unified/path，FormData 字段 leftPath/rightPath，返回 text */ }
```
全部挂到 `window.JarDiff.api`。

### 三、前端 `app/app.js`：三模式控件 + startCompare 三分支

**变量**：`jarLeftFile`/`jarRightFile`（File）→ `jarLeftPath`/`jarRightPath`（String）；`fileLeftFile`/`fileRightFile`（File）→ `fileLeftPath`/`fileRightPath`（String）。

- **jar 模式**（模板行 100/114）：`<el-upload>` 换成"选择旧版 Jar/新版 Jar"按钮，点击 `chooseJar('选择旧版 Jar')` 拿路径存 `jarLeftPath`，显示路径。`startCompare` jar 分支（579-589）：FormData 用 `leftJarPath`/`rightJarPath` 字符串，调 `compareJarsByPath`。
- **dir 模式**（模板行 102/116）：`<el-input>` 旁加"浏览"按钮，点击 `chooseDirectory()` 填 `dirLeft`/`dirRight`。`startCompare` dir 分支（590-602）**不变**（已路径型）。
- **file 模式**（模板 el-upload + `startCompare` 603-608 + `loadFileDiff` 638）：el-upload 换按钮 + `chooseFile()`；`startCompare` file 分支用 `compareFilesByPath`；`loadFileDiff` 改用 `loadFilesUnifiedDiffByPath(fileLeftPath, fileRightPath)`。
- **text 模式**：不动。

### 四、后端 `CompareController`：新增 3 个端点

- `POST /compare/jars/path`：参数 `leftPath`/`rightPath` + 4 开关 + `ignoreGlobs` → `normalizeJarPath`（新增，仿 `normalizeDirectoryPath` 但校验是 `.jar` 普通文件）→ `jarCompareService.compareJarsByPath(left, right, options)`。骨架照抄 `compareDirectoryByPath`（行 314-356）。
- `POST /compare/files/path`：参数 `leftPath`/`rightPath` → `Files.readAllBytes` 读字节 → 复用现有 `getFileText`/`isClassFile`/`digestService.md5` → 返回与 `compareFiles`（行 485-527）完全相同的 Map 结构 + 填 `fileTextCache`。
- `POST /compare/files/unified/path`：参数 `leftPath`/`rightPath` → 读字节 → `getFileText` → `jarDiffService.unifiedDiff` → 返回 text（仿 `filesUnifiedDiff` 行 529-553）。
- `CompareConcurrencyFilter.shouldLimit` 白名单：按现有 `compareJars`/`compareDirectoryByPath` 的限流策略，把 `/compare/jars/path` 加入（单文件端点 `compareFiles` 现状若不限流，新增的 files/path 同样不限）。

### 五、后端 `JarCompareService`：新增 `compareJarsByPath`

抽取现有 `compare`（行 69-120）里 `saveTemp` 之后那段（行 91-113，基于 Path 的 FileMeta/StoredCompare/buildIndex/buildAlignedTree）为私有方法 `compareByJarPath(Path, Path, name, name, size, size, options)`：
- 老 `compare(MultipartFile...)`：`saveTemp` 两边 → 取 name/size → 调 `compareByJarPath`（失败仍 `safeDelete` 临时文件）。
- 新 `compareJarsByPath(Path, Path, options)`：从 Path 算 `getFileName()`/`Files.size()` → 调 `compareByJarPath`，**不 saveTemp、不删用户文件**。
- `buildIndex`/`buildAlignedTree` 零改动直接复用（它们对 Path 来源无感）。

## 实施顺序

1. **后端先行**（可独立 curl 验证）：`compareJarsByPath` → `jars/path` → `files/path` → `files/unified/path` → filter 白名单
2. **Java bridge**：`FileBridge` + Launcher 注入
3. **前端**：`api.js` 加函数 → `app.js` 改三模式
4. **联调验证**

## 验证步骤

1. `mvn package -DskipTests` + `mvn test` 全绿
2. 启动应用，curl 验证三个新端点（用测试 jar/文件路径）
3. GUI 冒烟：jar/dir/file 三模式分别用 FileChooser 选文件 → 比对 + diff 正常；text 模式正常
4. **第 0 步保险验证**：实施前先启动应用点一次现有 `<el-upload>`，确认它在 WebView 里确实选不了文件（验证"必需修复"前提；若意外能用，方案仍成立，只是性质变回纯优化）

## 不改动 / 范围外

- `text` 模式（粘贴文本，无文件选择）
- `core/` 的 `buildIndex`/`buildAlignedTree`/反编译逻辑（仅复用，不改）
- 现有 web 端点（`compareJars`/`compareFiles` 等 MultipartFile 版保留，web 调试仍可用）
- 前端 bridge 降级：`window.jardiffBridge` 不存在时（纯 web 模式）`chooseXxx` 返回 null，不影响 web 端原有上传（保留 el-upload 兜底或按需）