# AGENTS.md

本文件为 Codex (Codex.ai/code) 在本代码仓库中工作时提供指导。

## 项目概述

**Jar Diff Tool** (代码差异比对及分析) — 一个基于 Spring Boot 的 Web 应用，用于对比 JAR 文件并可视化差异。支持 Spring Boot fat JAR、BOOT-INF/lib 内嵌 JAR、类文件反编译及详细的文本diff。

## 技术栈

- Java 8, Spring Boot 2.7.18
- ASM 9.6（字节码分析）、Procyon 0.5.36（反编译器）、java-diff-utils 4.12
- Maven 构建
- Vue 3 + Element Plus 前端（作为静态资源提供服务）

## 构建与运行命令

```bash
# 构建
mvn clean package

# 运行测试
mvn test

# 运行单个测试类
mvn test -Dtest=JarCompareServiceTest

# 运行应用
mvn spring-boot:run

# 跳过测试打包
mvn package -DskipTests
```

## 架构

### 两阶段比对

1. **JarCompareService**（`core/JarCompareService.java`）— 对两个 JAR 进行快速结构比对。构建 `TreeNode` 层级树，显示每个文件的状态：`added`（新增）、`missing`（缺失）、`modified`（MD5 不同）、`unchanged`（未变化）。不进行反编译。

2. **JarDiffService**（`core/JarDiffService.java`）— 按需计算指定文件路径的详细差异。支持：
   - 文本文件（`.java`、`.xml`、`.properties` 等）— 逐行diff
   - `.class` 文件 — 通过 Procyon 反编译后再diff
   - 内嵌 JAR，路径格式如 `BOOT-INF/lib/a.jar!/inner/path`
   - 按会话缓存已计算的差异

### 核心服务

| 服务 | 职责 |
|------|------|
| `JarCompareService` | JAR 结构比对、树结构构建、MD5 比对 |
| `JarDiffService` | 单文件差异计算、内嵌 JAR 提取、预热缓存 |
| `AsmDecompileService` | 通过 ASM 字节码分析提取类签名（字段/方法名） |
| `ProcyonDecompileService` | 将 `.class` 文件完整反编译为 Java 源代码 |
| `DigestService` | MD5 哈希计算 |
| `CompareStore` | 内存存储活跃比对会话及缓存的差异结果 |
| `CompareOptions` | 选项：`includeLib`、`includeClasses`、`includeResources`、`deepCompareLib`、`ignoreGlobs` |

### API 端点（CompareController）

- `POST /api/compare/jars` — 对比两个上传的 JAR 文件
- `GET /api/compare/diff?id=&path=` — 获取某次比对中指定文件路径的差异
- `POST /api/compare/diff/warm` — 预计算已变化文件的差异（异步）
- `POST /api/compare/directory` — 对比上传的目录内容
- `POST /api/compare/directory/path` — 对比服务器文件系统上的两个路径
- `GET /api/compare/report.html` — 生成独立 HTML 报告
- `GET /api/compare/report.v2.json` — 带风险分析的结构化 JSON 报告

### 数据模型

- **CompareResult** — 包含 `id`、`left`/`right`（FileMeta）、`tree`（List<TreeNode>）、`stats`
- **DiffResult** — 包含 `kind`（"text"/"binary"）、`left`/`right` 行内容、`rows`、`highlights`、`hunks`、`classSummary`
- **TreeNode** — 递归树结构：`value`、`type`（"dir"/"file"/"jar"）、`rightStatus`（"added"/"missing"/"modified"/"unchanged"/"meta"）、`children`
- **StoredCompare** — 保存两次上传 JAR 的路径、选项、缓存的差异、预热状态

### 并发控制

`CompareConcurrencyLimiter` + `CompareConcurrencyFilter` 将并发比对操作限制为 2 个（可通过 `jardiff.concurrency.max-compares` 配置）。若已达上限，POST 到比对端点的请求会被 HTTP 429 拒绝。

### 文件类型检测

根据扩展名和文件魔数判断类型：
- `.class` → "class"（Java 字节码，通过 Procyon 反编译）
- `.jar`/`.zip`/PK 头 → "jar"/"zip"
- 文本扩展名（`.java`、`.xml`、`.properties`、`.yml`、`.json`、`.html`、`.js` 等）→ "text"
- 其他 → "binary"

### 内嵌 JAR 处理

路径如 `BOOT-INF/lib/a.jar!/p/MyClass.class` 表示位于内嵌 JAR 中的类。JarDiffService 处理流程：
1. 将外层 JAR 提取到临时文件（LRU 缓存，最多 4 个）
2. 将内嵌 JAR 作为 ZipFile 打开
3. 读取内部条目字节进行反编译/diff

### 前端

位于 `src/main/resources/static/` 的 Vue 3 单页应用：
- `app.js` — 根组件
- `api.js` — REST API 调用
- `core.js` / `ui-diff.js` — diff UI 组件
- `storage.js` — localStorage 存储比对 ID

## 配置

`src/main/resources/application.properties`：
- `server.port=8080`
- `spring.servlet.multipart.max-file-size=1024MB`
- `jardiff.concurrency.max-compares=2`
- `jardiff.limits.max-warmup-diffs=400`
