package com.example.jardiff.api;

// [AGC:FILE] tool=Cc author=maxwell date=2026-07-24

import com.example.jardiff.core.CompareOptions;
import com.example.jardiff.core.CompareResult;
import com.example.jardiff.core.CompareStore;
import com.example.jardiff.core.DiffResult;
import com.example.jardiff.core.DigestService;
import com.example.jardiff.core.DirectorySummaryResult;
import com.example.jardiff.core.JarCompareService;
import com.example.jardiff.core.JarDiffService;
import com.example.jardiff.core.ProcyonDecompileService;
import com.example.jardiff.core.Stats;
import com.example.jardiff.core.StoredCompare;
import com.example.jardiff.core.TreeNode;
import java.net.URLDecoder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.multipart.MultipartFile;
// [AGC:START] tool=Cc date=2026-07-29 author=maxwell
import org.springframework.web.server.ResponseStatusException;
// [AGC:END]

@RestController
@RequestMapping("/api")
public class CompareController {
  private static final Logger log = LoggerFactory.getLogger(CompareController.class);
  private static final Pattern PERCENT_ENCODED = Pattern.compile("%[0-9a-fA-F]{2}");
  private final JarCompareService jarCompareService;
  private final JarDiffService jarDiffService;
  private final CompareStore compareStore;
  private final ProcyonDecompileService procyonDecompileService;
  private final DigestService digestService;
  private final int maxJarMb;
  private final int maxDirFilesPerSide;
  private final int maxDirMbPerSide;
  private final int maxWarmupDiffs;
  private final int defaultWarmupDiffs;
  private final String defaultIgnoreGlobs;
  // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
  private final boolean directoryCompareEnabled;
  // [AGC:END]

  public CompareController(
      JarCompareService jarCompareService,
      JarDiffService jarDiffService,
      CompareStore compareStore,
      ProcyonDecompileService procyonDecompileService,
      DigestService digestService,
      @Value("${jardiff.limits.max-jar-mb:512}") int maxJarMb,
      @Value("${jardiff.limits.max-dir-files-per-side:20000}") int maxDirFilesPerSide,
      @Value("${jardiff.limits.max-dir-mb-per-side:800}") int maxDirMbPerSide,
      @Value("${jardiff.limits.max-warmup-diffs:1200}") int maxWarmupDiffs,
      @Value("${jardiff.limits.default-warmup-diffs:400}") int defaultWarmupDiffs,
      @Value("${jardiff.ignore.default-globs:}") String defaultIgnoreGlobs,
      // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
      @Value("${jardiff.deployment-mode:local}") String deploymentMode) {
    // [AGC:END]
    this.jarCompareService = jarCompareService;
    this.jarDiffService = jarDiffService;
    this.compareStore = compareStore;
    this.procyonDecompileService = procyonDecompileService;
    this.digestService = digestService;
    this.maxJarMb = Math.max(1, maxJarMb);
    this.maxDirFilesPerSide = Math.max(1, maxDirFilesPerSide);
    this.maxDirMbPerSide = Math.max(1, maxDirMbPerSide);
    this.maxWarmupDiffs = Math.max(1, maxWarmupDiffs);
    this.defaultWarmupDiffs = Math.max(1, defaultWarmupDiffs);
    this.defaultIgnoreGlobs = defaultIgnoreGlobs == null ? "" : defaultIgnoreGlobs;
    // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
    if (!"local".equals(deploymentMode) && !"server".equals(deploymentMode)) {
      throw new IllegalArgumentException(
          "jardiff.deployment-mode 仅支持 local 或 server，当前值：" + deploymentMode);
    }
    this.directoryCompareEnabled = "local".equals(deploymentMode);
    // [AGC:END]
  }

  @GetMapping("/ping")
  public String ping() {
    return "ok";
  }

  // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
  /**
   * 返回当前部署允许前台使用的比对能力。
   * @return 只包含目录比对开关的能力响应
   */
  @GetMapping(value = "/compare/capabilities", produces = MediaType.APPLICATION_JSON_VALUE)
  public Map<String, Boolean> capabilities() {
    Map<String, Boolean> capabilities = new HashMap<>();
    capabilities.put("directoryCompareEnabled", directoryCompareEnabled);
    return capabilities;
  }
  // [AGC:END]

  /**
   * 将常见的“compare not found”从 500 降级为 404，避免日志刷屏。
   * @param ex 异常
   * @return 友好的 HTTP 响应
   */
  @ExceptionHandler(IllegalArgumentException.class)
  public ResponseEntity<String> handleIllegalArgument(IllegalArgumentException ex) {
    String msg = ex == null || ex.getMessage() == null ? "" : ex.getMessage();
    log.warn("request rejected: {}", msg);
    if ("compare not found".equalsIgnoreCase(msg.trim())) {
      return ResponseEntity.status(HttpStatus.NOT_FOUND).contentType(MediaType.TEXT_PLAIN).body("compare not found");
    }
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).contentType(MediaType.TEXT_PLAIN).body(msg.isEmpty() ? "bad request" : msg);
  }

  @ExceptionHandler(CompareStore.CapacityExceededException.class)
  public ResponseEntity<String> handleCompareCapacityExceeded(CompareStore.CapacityExceededException ex) {
    String msg = ex == null || ex.getMessage() == null ? "compare resource limit exceeded" : ex.getMessage();
    log.warn("compare rejected by resource limit: {}", msg);
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).contentType(MediaType.TEXT_PLAIN).body(msg);
  }

  // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
  /**
   * 将部署模式拒绝转换为稳定的纯文本 HTTP 错误响应。
   * @param ex 带 HTTP 状态和调用方提示的异常
   * @return 对应状态及明确错误正文
   */
  @ExceptionHandler(ResponseStatusException.class)
  public ResponseEntity<String> handleResponseStatus(ResponseStatusException ex) {
    return ResponseEntity.status(ex.getStatus())
        .contentType(new MediaType("text", "plain", StandardCharsets.UTF_8))
        .body(ex.getReason());
  }
  // [AGC:END]

  @PostMapping(value = "/compare/jars", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public CompareResult compareJars(
      @RequestParam("leftJar") MultipartFile leftJar,
      @RequestParam("rightJar") MultipartFile rightJar,
      @RequestParam(value = "includeLib", defaultValue = "true") boolean includeLib,
      @RequestParam(value = "includeClasses", defaultValue = "true") boolean includeClasses,
      @RequestParam(value = "includeResources", defaultValue = "true") boolean includeResources,
      @RequestParam(value = "deepCompareLib", defaultValue = "false") boolean deepCompareLib,
      @RequestParam(value = "ignoreGlobs", required = false) String ignoreGlobs,
      @RequestParam(value = "limitJarMb", required = false) Integer limitJarMb,
      HttpServletRequest request) {
    Objects.requireNonNull(leftJar, "leftJar");
    Objects.requireNonNull(rightJar, "rightJar");
    String effectiveIgnoreGlobs = ignoreGlobs;
    if (effectiveIgnoreGlobs == null || effectiveIgnoreGlobs.trim().isEmpty()) {
      StringBuilder indexedIgnoreGlobs = new StringBuilder();
      for (Map.Entry<String, String[]> entry : request.getParameterMap().entrySet()) {
        if (!entry.getKey().startsWith("ignoreGlobs[")) continue;
        String[] values = entry.getValue();
        for (String value : values) {
          if (value == null || value.trim().isEmpty()) continue;
          if (indexedIgnoreGlobs.length() > 0) indexedIgnoreGlobs.append('\n');
          indexedIgnoreGlobs.append(value);
        }
      }
      if (indexedIgnoreGlobs.length() > 0) effectiveIgnoreGlobs = indexedIgnoreGlobs.toString();
    }
    log.info(
        "compareJars start leftName={} leftSize={} rightName={} rightSize={} includeLib={} includeClasses={} includeResources={} deepCompareLib={} ignoreGlobs={} limitJarMb={}",
        leftJar.getOriginalFilename(),
        leftJar.getSize(),
        rightJar.getOriginalFilename(),
        rightJar.getSize(),
        includeLib,
        includeClasses,
        includeResources,
        deepCompareLib,
        effectiveIgnoreGlobs,
        limitJarMb);
    validateJarSize(leftJar, "左侧 jar", limitJarMb);
    validateJarSize(rightJar, "右侧 jar", limitJarMb);
    CompareOptions options = new CompareOptions(includeLib, includeClasses, includeResources, deepCompareLib, splitIgnore(effectiveIgnoreGlobs));
    CompareResult result = jarCompareService.compare(leftJar, rightJar, options);
    Stats stats = result == null ? null : result.getStats();
    log.info(
        "compareJars done id={} added={} missing={} modified={} unchanged={}",
        result == null ? "" : result.getId(),
        stats == null ? 0 : stats.getAdded(),
        stats == null ? 0 : stats.getMissing(),
        stats == null ? 0 : stats.getModified(),
        stats == null ? 0 : stats.getUnchanged());
    return result;
  }

  @GetMapping("/compare/diff")
  public DiffResult diff(@RequestParam("id") String id, @RequestParam("path") String path) {
    log.info("diff start id={} path={}", id, path);
    DiffResult result = jarDiffService.diff(id, path);
    log.info(
        "diff done id={} path={} kind={} fileType={} nested={} missingLeft={} missingRight={}",
        id,
        path,
        result == null ? "" : result.getKind(),
        result == null ? "" : result.getFileType(),
        result != null && result.isNested(),
        result != null && result.isMissingLeft(),
        result != null && result.isMissingRight());
    return result;
  }

  // [AGC:START] tool=Cc author=maxwell date=2026-07-24
  @GetMapping(value = "/compare/diff/unified", produces = MediaType.TEXT_PLAIN_VALUE)
  public ResponseEntity<String> unifiedDiff(@RequestParam("id") String id, @RequestParam("path") String path) {
    log.info("[jarDiff][start] FuncName=CompareController.unifiedDiff, id={}, path={}", id, path);
    String unified = jarDiffService.generateUnifiedDiff(id, path);
    if (unified == null) {
      log.info("[jarDiff][end] FuncName=CompareController.unifiedDiff, id={}, path={}, result=EMPTY_NON_TEXT", id, path);
      return ResponseEntity.ok("");
    }
    log.info("[jarDiff][end] FuncName=CompareController.unifiedDiff, id={}, path={}, resultLength={}", id, path, unified.length());
    return ResponseEntity.ok(unified);
  }

  @PostMapping("/compare/diff/warm")
  public StoredCompare.WarmupStatus warmDiffs(
      @RequestParam("id") String id,
      @RequestParam(value = "limit", defaultValue = "300") int limit) {
    int lim = limit <= 0 ? defaultWarmupDiffs : limit;
    lim = Math.min(lim, maxWarmupDiffs);
    log.info("warmDiffs start id={} limit={} effectiveLimit={}", id, limit, lim);
    return jarDiffService.warmDiffs(id, lim);
  }

  @GetMapping("/compare/diff/warm/status")
  public StoredCompare.WarmupStatus warmDiffStatus(@RequestParam("id") String id) {
    log.info("warmDiffStatus id={}", id);
    return jarDiffService.warmStatus(id);
  }

  @GetMapping(value = "/compare/limits", produces = MediaType.APPLICATION_JSON_VALUE)
  public Map<String, Object> limits() {
    Map<String, Object> m = new HashMap<>();
    m.put("maxJarMb", maxJarMb);
    m.put("maxDirFiles", maxDirFilesPerSide);
    m.put("maxDirMb", maxDirMbPerSide);
    m.put("maxWarmupDiffs", maxWarmupDiffs);
    m.put("defaultWarmupDiffs", defaultWarmupDiffs);
    m.put("defaultIgnoreGlobs", defaultIgnoreGlobs);
    return m;
  }

  @PostMapping(value = "/compare/directory", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public CompareResult compareDirectory(
      @RequestParam("leftFiles") MultipartFile[] leftFiles,
      @RequestParam("rightFiles") MultipartFile[] rightFiles,
      @RequestParam(value = "includeLib", defaultValue = "true") boolean includeLib,
      @RequestParam(value = "includeClasses", defaultValue = "true") boolean includeClasses,
      @RequestParam(value = "includeResources", defaultValue = "true") boolean includeResources,
      @RequestParam(value = "deepCompareLib", defaultValue = "false") boolean deepCompareLib,
      @RequestParam(value = "ignoreGlobs", required = false) String ignoreGlobs,
      @RequestParam(value = "limitDirFiles", required = false) Integer limitDirFiles,
      @RequestParam(value = "limitDirMb", required = false) Integer limitDirMb) {
    // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
    ensureDirectoryCompareEnabled();
    // [AGC:END]
    log.info(
        "compareDirectory start leftCount={} rightCount={} includeLib={} includeClasses={} includeResources={} deepCompareLib={} ignoreGlobs={} limitDirFiles={} limitDirMb={}",
        leftFiles == null ? 0 : leftFiles.length,
        rightFiles == null ? 0 : rightFiles.length,
        includeLib,
        includeClasses,
        includeResources,
        deepCompareLib,
        ignoreGlobs,
        limitDirFiles,
        limitDirMb);
    validateDirectoryUpload(leftFiles, "左侧目录", limitDirFiles, limitDirMb);
    validateDirectoryUpload(rightFiles, "右侧目录", limitDirFiles, limitDirMb);
    CompareOptions options = new CompareOptions(includeLib, includeClasses, includeResources, deepCompareLib, splitIgnore(ignoreGlobs));
    CompareResult result = jarCompareService.compareDirectoryFull(leftFiles, rightFiles, options);
    Stats stats = result == null ? null : result.getStats();
    log.info(
        "compareDirectory done id={} added={} missing={} modified={} unchanged={}",
        result == null ? "" : result.getId(),
        stats == null ? 0 : stats.getAdded(),
        stats == null ? 0 : stats.getMissing(),
        stats == null ? 0 : stats.getModified(),
        stats == null ? 0 : stats.getUnchanged());
    return result;
  }

  @PostMapping(value = "/compare/directory/path", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public CompareResult compareDirectoryByPath(
      @RequestParam("leftPath") String leftPath,
      @RequestParam("rightPath") String rightPath,
      @RequestParam(value = "includeLib", defaultValue = "true") boolean includeLib,
      @RequestParam(value = "includeClasses", defaultValue = "true") boolean includeClasses,
      @RequestParam(value = "includeResources", defaultValue = "true") boolean includeResources,
      @RequestParam(value = "deepCompareLib", defaultValue = "false") boolean deepCompareLib,
      @RequestParam(value = "ignoreGlobs", required = false) String ignoreGlobs,
      @RequestParam(value = "limitDirFiles", required = false) Integer limitDirFiles,
      @RequestParam(value = "limitDirMb", required = false) Integer limitDirMb) {
    // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
    ensureDirectoryCompareEnabled();
    // [AGC:END]
    Path leftDir = normalizeDirectoryPath(leftPath, "左侧目录");
    Path rightDir = normalizeDirectoryPath(rightPath, "右侧目录");
    log.info(
        "compareDirectoryByPath start leftDir={} rightDir={} includeLib={} includeClasses={} includeResources={} deepCompareLib={} ignoreGlobs={} limitDirFiles={} limitDirMb={}",
        leftDir,
        rightDir,
        includeLib,
        includeClasses,
        includeResources,
        deepCompareLib,
        ignoreGlobs,
        limitDirFiles,
        limitDirMb);
    int maxCount = maxDirFilesPerSide;
    if (limitDirFiles != null && limitDirFiles > 0) maxCount = Math.min(maxCount, limitDirFiles);
    long maxBytes = 1024L * 1024L * (long) maxDirMbPerSide;
    if (limitDirMb != null && limitDirMb > 0) maxBytes = Math.min(maxBytes, 1024L * 1024L * (long) limitDirMb);
    CompareOptions options = new CompareOptions(includeLib, includeClasses, includeResources, deepCompareLib, splitIgnore(ignoreGlobs));
    CompareResult result = jarCompareService.compareDirectoryFullByPath(leftDir, rightDir, options, maxCount, maxBytes);
    Stats stats = result == null ? null : result.getStats();
    log.info(
        "compareDirectoryByPath done id={} added={} missing={} modified={} unchanged={}",
        result == null ? "" : result.getId(),
        stats == null ? 0 : stats.getAdded(),
        stats == null ? 0 : stats.getMissing(),
        stats == null ? 0 : stats.getModified(),
        stats == null ? 0 : stats.getUnchanged());
    return result;
  }

  @PostMapping(value = "/compare/jars/path", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public CompareResult compareJarsByPath(
      @RequestParam("leftPath") String leftPath,
      @RequestParam("rightPath") String rightPath,
      @RequestParam(value = "includeLib", defaultValue = "true") boolean includeLib,
      @RequestParam(value = "includeClasses", defaultValue = "true") boolean includeClasses,
      @RequestParam(value = "includeResources", defaultValue = "true") boolean includeResources,
      @RequestParam(value = "deepCompareLib", defaultValue = "false") boolean deepCompareLib,
      @RequestParam(value = "ignoreGlobs", required = false) String ignoreGlobs) {
    ensureDirectoryCompareEnabled();
    Path leftJar = normalizeJarPath(leftPath, "旧版 Jar");
    Path rightJar = normalizeJarPath(rightPath, "新版 Jar");
    log.info(
        "compareJarsByPath start leftJar={} rightJar={} includeLib={} includeClasses={} includeResources={} deepCompareLib={} ignoreGlobs={}",
        leftJar,
        rightJar,
        includeLib,
        includeClasses,
        includeResources,
        deepCompareLib,
        ignoreGlobs);
    CompareOptions options = new CompareOptions(includeLib, includeClasses, includeResources, deepCompareLib, splitIgnore(ignoreGlobs));
    CompareResult result = jarCompareService.compareJarsByPath(leftJar, rightJar, options);
    Stats stats = result == null ? null : result.getStats();
    log.info(
        "compareJarsByPath done id={} added={} missing={} modified={} unchanged={}",
        result == null ? "" : result.getId(),
        stats == null ? 0 : stats.getAdded(),
        stats == null ? 0 : stats.getMissing(),
        stats == null ? 0 : stats.getModified(),
        stats == null ? 0 : stats.getUnchanged());
    return result;
  }

  @GetMapping(value = "/compare/nested/tree", produces = MediaType.APPLICATION_JSON_VALUE)
  public List<TreeNode> nestedJarTree(@RequestParam("id") String id, @RequestParam("outer") String outer) {
    log.info("nestedJarTree id={} outer={}", id, outer);
    StoredCompare stored = compareStore.get(id).orElseThrow(() -> new IllegalArgumentException("compare not found"));
    return jarCompareService.loadNestedJarTree(stored, outer);
  }

  /**
   * 校验单个 jar 上传大小，超出上限则抛出异常并拒绝比对。
   * @param jar 上传文件
   * @param label 用于错误提示的名称
   * @param limitJarMb 用户期望上限（MB）
   */
  private void validateJarSize(MultipartFile jar, String label, Integer limitJarMb) {
    if (jar == null) return;
    long max = 1024L * 1024L * (long) maxJarMb;
    if (limitJarMb != null && limitJarMb > 0) {
      long userMax = 1024L * 1024L * (long) limitJarMb;
      max = Math.min(max, userMax);
    }
    long size = jar.getSize();
    if (size > max) {
      throw new IllegalArgumentException(label + "过大（" + formatBytes(size) + "），超过上限 " + formatBytes(max) + "，已禁止比对");
    }
  }

  // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
  /**
   * 在任何目录或文件访问前执行服务器端目录能力校验。
   * @throws ResponseStatusException 当前部署禁止目录比对时返回 HTTP 403
   */
  private void ensureDirectoryCompareEnabled() {
    if (directoryCompareEnabled) return;
    log.warn("[directoryCompare][skip] FuncName=ensureDirectoryCompareEnabled, result=forbidden");
    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "服务器模式禁止目录比对");
  }
  // [AGC:END]

  /**
   * 校验目录上传：文件数量与总大小，超出上限则抛出异常并拒绝比对。
   * @param files 上传文件数组
   * @param label 用于错误提示的名称
   * @param limitDirFiles 用户期望文件数上限（每侧）
   * @param limitDirMb 用户期望总大小上限（MB，每侧）
   */
  private void validateDirectoryUpload(MultipartFile[] files, String label, Integer limitDirFiles, Integer limitDirMb) {
    int maxCount = maxDirFilesPerSide;
    if (limitDirFiles != null && limitDirFiles > 0) maxCount = Math.min(maxCount, limitDirFiles);
    long maxBytes = 1024L * 1024L * (long) maxDirMbPerSide;
    if (limitDirMb != null && limitDirMb > 0) maxBytes = Math.min(maxBytes, 1024L * 1024L * (long) limitDirMb);

    int count = files == null ? 0 : files.length;
    if (count > maxCount) {
      throw new IllegalArgumentException(label + "文件过多（" + count + " 个），超过上限 " + maxCount + " 个，已禁止比对");
    }
    long total = 0;
    if (files != null) {
      for (MultipartFile f : files) {
        if (f == null) continue;
        long s = f.getSize();
        if (s > 0) total += s;
        if (total > maxBytes) break;
      }
    }
    if (total > maxBytes) {
      throw new IllegalArgumentException(label + "总大小过大（" + formatBytes(total) + "），超过上限 " + formatBytes(maxBytes) + "，已禁止比对");
    }
  }

  private Path normalizeDirectoryPath(String raw, String label) {
    String s = sanitizeDirectoryPathInput(raw);
    if (s.isEmpty()) throw new IllegalArgumentException(label + "路径为空");
    Path p = Paths.get(s).toAbsolutePath().normalize();
    if (Files.notExists(p)) throw new IllegalArgumentException(label + "不存在：" + p);
    if (!Files.exists(p)) throw new IllegalArgumentException(label + "无法访问或不存在：" + p);
    if (!Files.isDirectory(p)) throw new IllegalArgumentException(label + "不是目录：" + p);
    try (DirectoryStream<Path> ignored = Files.newDirectoryStream(p)) {
    } catch (AccessDeniedException e) {
      throw new IllegalArgumentException(label + "无权限访问：" + p);
    } catch (IOException ignored) {
    }
    return p;
  }

  private Path normalizeFilePath(String raw, String label) {
    String s = sanitizeDirectoryPathInput(raw);
    if (s.isEmpty()) throw new IllegalArgumentException(label + "路径为空");
    Path p = Paths.get(s).toAbsolutePath().normalize();
    if (Files.notExists(p)) throw new IllegalArgumentException(label + "不存在：" + p);
    if (!Files.isRegularFile(p)) throw new IllegalArgumentException(label + "不是文件：" + p);
    if (!Files.isReadable(p)) throw new IllegalArgumentException(label + "无权限读取：" + p);
    return p;
  }

  private Path normalizeJarPath(String raw, String label) {
    Path p = normalizeFilePath(raw, label);
    String name = p.getFileName() != null ? p.getFileName().toString() : "";
    String lower = name.toLowerCase();
    if (!lower.endsWith(".jar") && !lower.endsWith(".zip") && !lower.endsWith(".war")) {
      throw new IllegalArgumentException(label + "不是 jar/zip/war 文件：" + p);
    }
    return p;
  }

  private String sanitizeDirectoryPathInput(String raw) {
    String s = raw == null ? "" : raw;
    String trimmed = trimPathEnds(s);
    if (trimmed.length() >= 2) {
      char first = trimmed.charAt(0);
      char last = trimmed.charAt(trimmed.length() - 1);
      if ((first == '"' && last == '"') || (first == '\'' && last == '\'')) {
        trimmed = trimPathEnds(trimmed.substring(1, trimmed.length() - 1));
      }
    }
    String decoded = tryDecodePercent(trimmed);
    return trimPathEnds(decoded);
  }

  private String tryDecodePercent(String s) {
    if (s == null || s.isEmpty()) return "";
    if (!PERCENT_ENCODED.matcher(s).find()) return s;
    try {
      String safe = s.replace("+", "%2B");
      return URLDecoder.decode(safe, StandardCharsets.UTF_8.name());
    } catch (Exception ignored) {
      return s;
    }
  }

  private String trimPathEnds(String s) {
    if (s == null || s.isEmpty()) return "";
    int start = 0;
    int end = s.length();
    while (start < end && isTrimChar(s.charAt(start))) start += 1;
    while (end > start && isTrimChar(s.charAt(end - 1))) end -= 1;
    return start == 0 && end == s.length() ? s : s.substring(start, end);
  }

  private boolean isTrimChar(char c) {
    return Character.isWhitespace(c)
        || Character.isSpaceChar(c)
        || c == '\u200B'
        || c == '\u200C'
        || c == '\u200D'
        || c == '\uFEFF';
  }

  @PostMapping(value = "/compare/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public Map<String, Object> compareFiles(
      @RequestParam("left") MultipartFile left,
      @RequestParam("right") MultipartFile right) {
    log.info("[jarDiff][start] FuncName=CompareController.compareFiles, left={}, right={}",
        left.getOriginalFilename(), right.getOriginalFilename());
    Map<String, Object> res = new HashMap<>();
    try {
      byte[] leftBytes = left.getBytes();
      byte[] rightBytes = right.getBytes();
      String leftText = getFileText(leftBytes, left.getOriginalFilename());
      String rightText = getFileText(rightBytes, right.getOriginalFilename());
      boolean decompiled = isClassFile(leftBytes) || isClassFile(rightBytes);

      String id = java.util.UUID.randomUUID().toString().replace("-", "");
      String leftName = left.getOriginalFilename() != null ? left.getOriginalFilename() : "left";
      String rightName = right.getOriginalFilename() != null ? right.getOriginalFilename() : "right";
      String leftMd5 = digestService.md5(leftBytes);
      String rightMd5 = digestService.md5(rightBytes);

      res.put("id", id);
      Map<String, String> leftMeta = new HashMap<>();
      leftMeta.put("name", leftName);
      leftMeta.put("md5", leftMd5);
      res.put("left", leftMeta);
      Map<String, String> rightMeta = new HashMap<>();
      rightMeta.put("name", rightName);
      rightMeta.put("md5", rightMd5);
      res.put("right", rightMeta);
      res.put("type", "text");
      res.put("decompiled", decompiled);

      log.info("[jarDiff][end] FuncName=CompareController.compareFiles, id={}, decompiled={}, leftLen={}, rightLen={}",
          id, decompiled, leftText != null ? leftText.length() : 0, rightText != null ? rightText.length() : 0);
    } catch (IOException e) {
      log.error("[jarDiff][fail] FuncName=CompareController.compareFiles, errorCode=FILE_COMPARE_IO_ERR, reason={}",
          e.getMessage(), e);
      res.put("error", e.getMessage());
    }
    return res;
  }

  @PostMapping(value = "/compare/files/unified", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<String> filesUnifiedDiff(
      @RequestParam("left") MultipartFile left,
      @RequestParam("right") MultipartFile right) {
    log.info("[jarDiff][start] FuncName=CompareController.filesUnifiedDiff, left={}, right={}",
        left.getOriginalFilename(), right.getOriginalFilename());
    try {
      byte[] leftBytes = left.getBytes();
      byte[] rightBytes = right.getBytes();
      String leftText = getFileText(leftBytes, left.getOriginalFilename());
      String rightText = getFileText(rightBytes, right.getOriginalFilename());

      if (leftText == null || rightText == null) {
        log.info("[jarDiff][end] FuncName=CompareController.filesUnifiedDiff, result=EMPTY_NON_TEXT");
        return ResponseEntity.ok("");
      }
      String diff = jarDiffService.unifiedDiff(leftText, rightText);
      log.info("[jarDiff][end] FuncName=CompareController.filesUnifiedDiff, resultLength={}", diff != null ? diff.length() : 0);
      return ResponseEntity.ok(diff);
    } catch (IOException e) {
      log.error("[jarDiff][fail] FuncName=CompareController.filesUnifiedDiff, errorCode=FILE_UNIFIED_IO_ERR, reason={}",
          e.getMessage(), e);
      return ResponseEntity.ok("");
    }
  }

  @PostMapping(value = "/compare/files/path", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public Map<String, Object> compareFilesByPath(
      @RequestParam("leftPath") String leftPath,
      @RequestParam("rightPath") String rightPath) {
    ensureDirectoryCompareEnabled();
    Path leftFile = normalizeFilePath(leftPath, "左侧文件");
    Path rightFile = normalizeFilePath(rightPath, "右侧文件");
    log.info("[jarDiff][start] FuncName=CompareController.compareFilesByPath, left={}, right={}", leftFile, rightFile);
    Map<String, Object> res = new HashMap<>();
    try {
      byte[] leftBytes = Files.readAllBytes(leftFile);
      byte[] rightBytes = Files.readAllBytes(rightFile);
      String leftName = leftFile.getFileName() != null ? leftFile.getFileName().toString() : "left";
      String rightName = rightFile.getFileName() != null ? rightFile.getFileName().toString() : "right";
      String leftText = getFileText(leftBytes, leftName);
      String rightText = getFileText(rightBytes, rightName);
      boolean decompiled = isClassFile(leftBytes) || isClassFile(rightBytes);

      String id = java.util.UUID.randomUUID().toString().replace("-", "");
      String leftMd5 = digestService.md5(leftBytes);
      String rightMd5 = digestService.md5(rightBytes);

      res.put("id", id);
      Map<String, String> leftMeta = new HashMap<>();
      leftMeta.put("name", leftName);
      leftMeta.put("md5", leftMd5);
      res.put("left", leftMeta);
      Map<String, String> rightMeta = new HashMap<>();
      rightMeta.put("name", rightName);
      rightMeta.put("md5", rightMd5);
      res.put("right", rightMeta);
      res.put("type", "text");
      res.put("decompiled", decompiled);

      log.info("[jarDiff][end] FuncName=CompareController.compareFilesByPath, id={}, decompiled={}, leftLen={}, rightLen={}",
          id, decompiled, leftText != null ? leftText.length() : 0, rightText != null ? rightText.length() : 0);
    } catch (IOException e) {
      log.error("[jarDiff][fail] FuncName=CompareController.compareFilesByPath, errorCode=FILE_COMPARE_IO_ERR, reason={}", e.getMessage(), e);
      res.put("error", e.getMessage());
    }
    return res;
  }

  @PostMapping(value = "/compare/files/unified/path", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<String> filesUnifiedDiffByPath(
      @RequestParam("leftPath") String leftPath,
      @RequestParam("rightPath") String rightPath) {
    ensureDirectoryCompareEnabled();
    Path leftFile = normalizeFilePath(leftPath, "左侧文件");
    Path rightFile = normalizeFilePath(rightPath, "右侧文件");
    log.info("[jarDiff][start] FuncName=CompareController.filesUnifiedDiffByPath, left={}, right={}", leftFile, rightFile);
    try {
      byte[] leftBytes = Files.readAllBytes(leftFile);
      byte[] rightBytes = Files.readAllBytes(rightFile);
      String leftText = getFileText(leftBytes, leftFile.getFileName() != null ? leftFile.getFileName().toString() : "left");
      String rightText = getFileText(rightBytes, rightFile.getFileName() != null ? rightFile.getFileName().toString() : "right");

      if (leftText == null || rightText == null) {
        log.info("[jarDiff][end] FuncName=CompareController.filesUnifiedDiffByPath, result=EMPTY_NON_TEXT");
        return ResponseEntity.ok("");
      }
      String diff = jarDiffService.unifiedDiff(leftText, rightText);
      log.info("[jarDiff][end] FuncName=CompareController.filesUnifiedDiffByPath, resultLength={}", diff != null ? diff.length() : 0);
      return ResponseEntity.ok(diff);
    } catch (IOException e) {
      log.error("[jarDiff][fail] FuncName=CompareController.filesUnifiedDiffByPath, errorCode=FILE_UNIFIED_IO_ERR, reason={}", e.getMessage(), e);
      return ResponseEntity.ok("");
    }
  }

  // [AGC:START] tool=Cc author=maxwell date=2026-07-24
  private String getFileText(byte[] bytes, String name) {
    if (bytes == null) return null;
    if (isClassFile(bytes)) {
      return procyonDecompileService.decompileToText(bytes);
    }
    if (isLikelyTextFile(name)) {
      String utf8 = new String(bytes, StandardCharsets.UTF_8);
      // 与 JarCompareService、JarDiffService 的 toText 保持一致：非 UTF-8 内容回退到 ISO-8859-1
      if (utf8.contains("\uFFFD")) return new String(bytes, Charset.forName("ISO-8859-1"));
      return utf8;
    }
    return null;
  }

  private boolean isClassFile(byte[] bytes) {
    return bytes != null && bytes.length >= 4
        && (bytes[0] & 0xFF) == 0xCA
        && (bytes[1] & 0xFF) == 0xFE
        && (bytes[2] & 0xFF) == 0xBA
        && (bytes[3] & 0xFF) == 0xBE;
  }

  private boolean isLikelyTextFile(String name) {
    if (name == null) return false;
    String lower = name.toLowerCase();
    return lower.endsWith(".java") || lower.endsWith(".xml") || lower.endsWith(".properties")
        || lower.endsWith(".yml") || lower.endsWith(".yaml") || lower.endsWith(".json")
        || lower.endsWith(".html") || lower.endsWith(".js") || lower.endsWith(".css")
        || lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".sql")
        || lower.endsWith(".kt") || lower.endsWith(".scala") || lower.endsWith(".groovy")
        || lower.endsWith(".gradle") || lower.endsWith(".mf") || lower.endsWith(".jsp")
        || lower.endsWith(".vm") || lower.endsWith(".ftl") || lower.endsWith(".sh")
        || lower.endsWith(".bat") || lower.endsWith(".py") || lower.endsWith(".rb");
  }
  // [AGC:END]

  /**
   * 将字节数格式化为可读字符串（B/KB/MB/GB）。
   * @param bytes 字节数
   * @return 可读字符串
   */
  private String formatBytes(long bytes) {
    if (bytes <= 0) return "0 B";
    String[] units = new String[] {"B", "KB", "MB", "GB", "TB"};
    double v = bytes;
    int i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v = v / 1024.0;
      i += 1;
    }
    String s = v >= 100 || i == 0 ? String.format("%.0f", v) : v >= 10 ? String.format("%.1f", v) : String.format("%.2f", v);
    return s + " " + units[i];
  }

  @PostMapping(value = "/compare/directory/summary", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public DirectorySummaryResult directorySummary(
      @RequestParam("leftFiles") MultipartFile[] leftFiles,
      @RequestParam("rightFiles") MultipartFile[] rightFiles) {
    // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
    ensureDirectoryCompareEnabled();
    // [AGC:END]
    log.info(
        "directorySummary start leftCount={} rightCount={}",
        leftFiles == null ? 0 : leftFiles.length,
        rightFiles == null ? 0 : rightFiles.length);
    return jarCompareService.compareDirectory(leftFiles, rightFiles);
  }

  @GetMapping(value = "/compare/report.json", produces = MediaType.APPLICATION_JSON_VALUE)
  public CompareResult reportJson(@RequestParam("id") String id) {
    log.info("reportJson id={}", id);
    return jarCompareService.getCachedResult(id);
  }

  @GetMapping(value = "/compare/report.v2.json", produces = MediaType.APPLICATION_JSON_VALUE)
  public ReportV2 reportJsonV2(@RequestParam("id") String id) {
    log.info("reportJsonV2 id={}", id);
    CompareResult r = jarCompareService.getCachedResult(id);
    StoredCompare stored = compareStore.get(id).orElse(null);
    CompareOptions options = stored == null ? null : stored.getOptions();

    List<ChangedRow> changed = collectChanged(r == null ? null : r.getTree());
    ReportGroups groups = buildGroups(changed);
    List<DependencyRow> deps = buildDependencyRows(changed);
    List<RiskFinding> risks = buildRisks(changed);
    return new ReportV2(r, options, groups, deps, risks);
  }

  @GetMapping(value = "/compare/report.html", produces = MediaType.TEXT_HTML_VALUE)
  public ResponseEntity<byte[]> reportHtml(@RequestParam("id") String id) {
    log.info("reportHtml id={}", id);
    CompareResult r = jarCompareService.getCachedResult(id);
    String html = buildHtmlReport(r);
    byte[] bytes = html.getBytes(StandardCharsets.UTF_8);
    return ResponseEntity.ok()
        .contentType(MediaType.TEXT_HTML)
        .header("Content-Disposition", "attachment; filename=\"jardiff-report-" + id + ".html\"")
        .body(bytes);
  }

  /**
   * 解析忽略规则。请求未指定（null/空白）时回退到配置文件预置的
   * {@code jardiff.ignore.default-globs}；请求已指定则以请求值为准。
   */
  private String[] splitIgnore(String raw) {
    String s = raw == null ? "" : raw.trim();
    if (s.isEmpty()) s = defaultIgnoreGlobs.trim();
    if (s.isEmpty()) return null;
    String[] parts = s.replace("\r\n", "\n").replace("\r", "\n").split("[\n,;]+");
    List<String> out = new ArrayList<>();
    for (String p : parts) {
      if (p == null) continue;
      String v = p.trim();
      if (!v.isEmpty()) out.add(v);
    }
    return out.isEmpty() ? null : out.toArray(new String[0]);
  }

  private String buildHtmlReport(CompareResult r) {
    String id = r == null ? "" : (r.getId() == null ? "" : r.getId());
    StoredCompare stored = id.isEmpty() ? null : compareStore.get(id).orElse(null);
    CompareOptions options = stored == null ? null : stored.getOptions();
    String leftName = r != null && r.getLeft() != null ? r.getLeft().getName() : "";
    String rightName = r != null && r.getRight() != null ? r.getRight().getName() : "";
    String leftMd5 = r != null && r.getLeft() != null ? r.getLeft().getMd5() : "";
    String rightMd5 = r != null && r.getRight() != null ? r.getRight().getMd5() : "";
    int added = r != null && r.getStats() != null ? r.getStats().getAdded() : 0;
    int missing = r != null && r.getStats() != null ? r.getStats().getMissing() : 0;
    int modified = r != null && r.getStats() != null ? r.getStats().getModified() : 0;
    int unchanged = r != null && r.getStats() != null ? r.getStats().getUnchanged() : 0;

    StringBuilder sb = new StringBuilder();
    sb.append("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"/>")
        .append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"/>")
        .append("<title>Jar 差异报告</title>")
        .append("<style>")
        .append("body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial;max-width:1080px;margin:24px auto;padding:0 16px;color:#111827}")
        .append("h1{font-size:20px;margin:0 0 12px} .card{border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin:12px 0}")
        .append("table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #f3f4f6;padding:8px 6px;font-size:13px;text-align:left}")
        .append(".mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace;font-size:12px}")
        .append(".tag{display:inline-block;border-radius:999px;padding:2px 8px;font-size:12px;border:1px solid #e5e7eb;margin-right:6px}")
        .append("</style></head><body>");

    sb.append("<h1>Jar 版本差异报告</h1>");
    sb.append("<div class=\"card\">");
    sb.append("<div><span class=\"tag\">ID</span><span class=\"mono\">").append(escape(id)).append("</span></div>");
    sb.append("<div style=\"margin-top:8px\"><span class=\"tag\">左</span>").append(escape(leftName)).append(" <span class=\"mono\">").append(escape(leftMd5)).append("</span></div>");
    sb.append("<div style=\"margin-top:6px\"><span class=\"tag\">右</span>").append(escape(rightName)).append(" <span class=\"mono\">").append(escape(rightMd5)).append("</span></div>");
    sb.append("</div>");

    sb.append("<div class=\"card\">");
    sb.append("<div><span class=\"tag\">修改</span>").append(modified).append(" <span class=\"tag\">新增</span>").append(added)
        .append(" <span class=\"tag\">缺失</span>").append(missing).append(" <span class=\"tag\">相同</span>").append(unchanged).append("</div>");
    sb.append("</div>");

    sb.append("<div class=\"card\"><h2 style=\"font-size:15px;margin:0 0 8px\">变化文件</h2>");
    sb.append("<div style=\"font-size:12px;color:#6b7280;margin:6px 0 10px\">按应用/依赖分段展示；内嵌依赖文件以容器 jar 聚合</div></div>");
    List<ChangedRow> changed = collectChanged(r == null ? null : r.getTree());
    ReportGroups groups = buildGroups(changed);
    List<DependencyRow> deps = buildDependencyRows(changed);
    List<RiskFinding> risks = buildRisks(changed);

    sb.append("<div class=\"card\"><h2 style=\"font-size:15px;margin:0 0 8px\">参数</h2>");
    sb.append("<table><tbody>");
    sb.append("<tr><th style=\"width:160px\">includeClasses</th><td>").append(options == null ? "" : String.valueOf(options.isIncludeClasses())).append("</td></tr>");
    sb.append("<tr><th>includeResources</th><td>").append(options == null ? "" : String.valueOf(options.isIncludeResources())).append("</td></tr>");
    sb.append("<tr><th>includeLib</th><td>").append(options == null ? "" : String.valueOf(options.isIncludeLib())).append("</td></tr>");
    sb.append("<tr><th>deepCompareLib</th><td>").append(options == null ? "" : String.valueOf(options.isDeepCompareLib())).append("</td></tr>");
    sb.append("<tr><th>ignoreGlobs</th><td class=\"mono\">");
    if (options != null && options.getIgnoreGlobs() != null) {
      for (String g : options.getIgnoreGlobs()) {
        if (g == null) continue;
        String v = g.trim();
        if (v.isEmpty()) continue;
        sb.append(escape(v)).append("<br/>");
      }
    }
    sb.append("</td></tr>");
    sb.append("</tbody></table></div>");

    sb.append("<div class=\"card\"><h2 style=\"font-size:15px;margin:0 0 8px\">摘要</h2>");
    sb.append("<div><span class=\"tag\">应用</span>修改 ").append(groups.app.modified).append(" 新增 ").append(groups.app.added).append(" 缺失 ").append(groups.app.missing).append("</div>");
    sb.append("<div style=\"margin-top:6px\"><span class=\"tag\">依赖</span>修改 ").append(groups.deps.modified).append(" 新增 ").append(groups.deps.added).append(" 缺失 ").append(groups.deps.missing).append("</div>");
    sb.append("</div>");

    if (!risks.isEmpty()) {
      sb.append("<div class=\"card\"><h2 style=\"font-size:15px;margin:0 0 8px\">风险提示</h2>");
      sb.append("<ul style=\"margin:0;padding-left:18px\">");
      for (RiskFinding rf : risks) {
        sb.append("<li><strong>").append(escape(rf.title)).append("</strong> <span style=\"color:#6b7280\">").append(escape(rf.desc)).append("</span></li>");
      }
      sb.append("</ul></div>");
    }

    sb.append("<div class=\"card\"><h2 style=\"font-size:15px;margin:0 0 8px\">依赖变化（lib jar 级）</h2>");
    sb.append("<table><thead><tr><th>依赖</th><th>状态</th><th>内部差异</th></tr></thead><tbody>");
    for (DependencyRow d : deps) {
      sb.append("<tr><td class=\"mono\">").append(escape(d.jarPath)).append("</td><td>")
          .append(escape(d.status)).append("</td><td>").append(d.innerChanged).append("</td></tr>");
    }
    sb.append("</tbody></table></div>");

    sb.append("<div class=\"card\"><h2 style=\"font-size:15px;margin:0 0 8px\">应用变化文件</h2>");
    sb.append("<table><thead><tr><th>路径</th><th>状态</th></tr></thead><tbody>");
    appendChangedRows(sb, changed, "app");
    sb.append("</tbody></table></div>");

    sb.append("<div class=\"card\"><h2 style=\"font-size:15px;margin:0 0 8px\">依赖变化文件</h2>");
    sb.append("<table><thead><tr><th>路径</th><th>状态</th></tr></thead><tbody>");
    appendChangedRows(sb, changed, "deps");
    sb.append("</tbody></table></div>");

    sb.append("</body></html>");
    return sb.toString();
  }

  private void appendChangedRows(StringBuilder sb, List<ChangedRow> rows, String group) {
    if (sb == null || rows == null) return;
    for (ChangedRow r : rows) {
      if (r == null) continue;
      if (group != null && !group.equals(r.group)) continue;
      sb.append("<tr><td class=\"mono\">").append(escape(r.path)).append("</td><td>").append(escape(r.status)).append("</td></tr>");
    }
  }

  private List<ChangedRow> collectChanged(List<TreeNode> nodes) {
    List<ChangedRow> out = new ArrayList<>();
    walkChanged(nodes, out);
    return out;
  }

  private void walkChanged(List<TreeNode> nodes, List<ChangedRow> out) {
    if (nodes == null || out == null) return;
    for (TreeNode n : nodes) {
      if (n == null) continue;
      if ("file".equals(n.getType())) {
        String s = n.getRightStatus();
        if (s != null && !"unchanged".equals(s)) {
          String p = n.getValue() == null ? "" : n.getValue();
          out.add(new ChangedRow(p, s, classifyGroup(p)));
        }
      }
      if (n.getChildren() != null && !n.getChildren().isEmpty()) walkChanged(n.getChildren(), out);
    }
  }

  private String classifyGroup(String path) {
    if (path == null) return "other";
    if (path.startsWith("BOOT-INF/lib/")) return "deps";
    if (path.startsWith("BOOT-INF/classes/")) return "app";
    return "other";
  }

  private ReportGroups buildGroups(List<ChangedRow> rows) {
    ReportGroups g = new ReportGroups();
    if (rows == null) return g;
    for (ChangedRow r : rows) {
      if (r == null) continue;
      GroupStats t = "deps".equals(r.group) ? g.deps : "app".equals(r.group) ? g.app : g.other;
      if ("added".equals(r.status)) t.added++;
      else if ("missing".equals(r.status)) t.missing++;
      else if ("modified".equals(r.status)) t.modified++;
    }
    return g;
  }

  private List<DependencyRow> buildDependencyRows(List<ChangedRow> rows) {
    Map<String, DependencyRow> m = new HashMap<>();
    if (rows == null) return new ArrayList<>();
    for (ChangedRow r : rows) {
      if (r == null || r.path == null) continue;
      if (!r.path.startsWith("BOOT-INF/lib/")) continue;
      String p = r.path;
      int idx = p.indexOf("!/");
      String jarPath = idx > 0 ? p.substring(0, idx) : p;
      boolean inner = idx > 0;
      DependencyRow d = m.get(jarPath);
      if (d == null) {
        d = new DependencyRow(jarPath, "", 0);
        m.put(jarPath, d);
      }
      if (inner) d.innerChanged++;
      if (!inner) d.status = r.status;
      if (d.status == null || d.status.isEmpty()) d.status = r.status;
    }
    return new ArrayList<>(m.values());
  }

  private List<RiskFinding> buildRisks(List<ChangedRow> rows) {
    List<RiskFinding> risks = new ArrayList<>();
    if (rows == null) return risks;
    boolean depsChanged = false;
    boolean configChanged = false;
    boolean signChanged = false;
    for (ChangedRow r : rows) {
      if (r == null || r.path == null) continue;
      String p = r.path;
      if (!depsChanged && p.startsWith("BOOT-INF/lib/")) depsChanged = true;
      if (!configChanged && p.startsWith("BOOT-INF/classes/") && (p.contains("application.") || p.contains("bootstrap."))) configChanged = true;
      String up = p.toUpperCase();
      if (!signChanged && up.startsWith("META-INF/") && (up.endsWith(".SF") || up.endsWith(".RSA") || up.endsWith(".DSA"))) signChanged = true;
    }
    if (depsChanged) risks.add(new RiskFinding("依赖发生变化", "建议在依赖视图确认新增/删除/版本漂移，并评估回归范围。"));
    if (configChanged) risks.add(new RiskFinding("关键配置变更", "检测到 application*/bootstrap* 相关配置变化，建议核对环境差异与默认值。"));
    if (signChanged) risks.add(new RiskFinding("签名/证书文件变化", "若非预期变更，可通过忽略规则减少噪音，但发布审计仍需保留记录。"));
    return risks;
  }

  public static class ReportV2 {
    private CompareResult result;
    private CompareOptions options;
    private ReportGroups groups;
    private List<DependencyRow> dependencies;
    private List<RiskFinding> risks;

    public ReportV2() {
    }

    public ReportV2(CompareResult result, CompareOptions options, ReportGroups groups, List<DependencyRow> dependencies, List<RiskFinding> risks) {
      this.result = result;
      this.options = options;
      this.groups = groups;
      this.dependencies = dependencies;
      this.risks = risks;
    }

    public CompareResult getResult() {
      return result;
    }

    public void setResult(CompareResult result) {
      this.result = result;
    }

    public CompareOptions getOptions() {
      return options;
    }

    public void setOptions(CompareOptions options) {
      this.options = options;
    }

    public ReportGroups getGroups() {
      return groups;
    }

    public void setGroups(ReportGroups groups) {
      this.groups = groups;
    }

    public List<DependencyRow> getDependencies() {
      return dependencies;
    }

    public void setDependencies(List<DependencyRow> dependencies) {
      this.dependencies = dependencies;
    }

    public List<RiskFinding> getRisks() {
      return risks;
    }

    public void setRisks(List<RiskFinding> risks) {
      this.risks = risks;
    }
  }

  public static class ChangedRow {
    private String path;
    private String status;
    private String group;

    public ChangedRow() {
    }

    public ChangedRow(String path, String status, String group) {
      this.path = path;
      this.status = status;
      this.group = group;
    }

    public String getPath() {
      return path;
    }

    public void setPath(String path) {
      this.path = path;
    }

    public String getStatus() {
      return status;
    }

    public void setStatus(String status) {
      this.status = status;
    }

    public String getGroup() {
      return group;
    }

    public void setGroup(String group) {
      this.group = group;
    }
  }

  public static class GroupStats {
    public int added;
    public int missing;
    public int modified;

    public int getAdded() {
      return added;
    }

    public int getMissing() {
      return missing;
    }

    public int getModified() {
      return modified;
    }
  }

  public static class ReportGroups {
    public GroupStats app = new GroupStats();
    public GroupStats deps = new GroupStats();
    public GroupStats other = new GroupStats();

    public GroupStats getApp() {
      return app;
    }

    public GroupStats getDeps() {
      return deps;
    }

    public GroupStats getOther() {
      return other;
    }
  }

  public static class DependencyRow {
    private String jarPath;
    private String status;
    private int innerChanged;

    public DependencyRow() {
    }

    public DependencyRow(String jarPath, String status, int innerChanged) {
      this.jarPath = jarPath;
      this.status = status;
      this.innerChanged = innerChanged;
    }

    public String getJarPath() {
      return jarPath;
    }

    public void setJarPath(String jarPath) {
      this.jarPath = jarPath;
    }

    public String getStatus() {
      return status;
    }

    public void setStatus(String status) {
      this.status = status;
    }

    public int getInnerChanged() {
      return innerChanged;
    }

    public void setInnerChanged(int innerChanged) {
      this.innerChanged = innerChanged;
    }
  }

  public static class RiskFinding {
    private String title;
    private String desc;

    public RiskFinding() {
    }

    public RiskFinding(String title, String desc) {
      this.title = title;
      this.desc = desc;
    }

    public String getTitle() {
      return title;
    }

    public void setTitle(String title) {
      this.title = title;
    }

    public String getDesc() {
      return desc;
    }

    public void setDesc(String desc) {
      this.desc = desc;
    }
  }

  private String escape(String s) {
    if (s == null) return "";
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
  }
}

@Component
class CompareConcurrencyLimiter {
  private final int maxConcurrentCompares;
  private final Semaphore permits;

  /**
   * 初始化比对任务的并发额度控制器。
   * @param maxConcurrentCompares 最大并发比对数（至少为 1）
   */
  public CompareConcurrencyLimiter(@Value("${jardiff.concurrency.max-compares:2}") int maxConcurrentCompares) {
    this.maxConcurrentCompares = Math.max(1, maxConcurrentCompares);
    this.permits = new Semaphore(this.maxConcurrentCompares, true);
  }

  /**
   * 尝试获取一个并发额度，获取失败表示当前系统繁忙应当拒绝请求。
   * @return 是否获取成功
   */
  public boolean tryAcquire() {
    return permits.tryAcquire();
  }

  /**
   * 释放一个并发额度。
   */
  public void release() {
    try {
      permits.release();
    } catch (Exception ignored) {
    }
  }

  /**
   * 获取最大并发比对数。
   * @return 最大并发数
   */
  public int maxConcurrentCompares() {
    return maxConcurrentCompares;
  }
}

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class CompareConcurrencyFilter extends OncePerRequestFilter {
  private static final Logger log = LoggerFactory.getLogger(CompareConcurrencyFilter.class);
  private final CompareConcurrencyLimiter limiter;

  /**
   * 创建一个在文件上传解析之前拦截的并发控制过滤器，用于尽早拒绝超限请求。
   * @param limiter 并发额度控制器
   */
  public CompareConcurrencyFilter(CompareConcurrencyLimiter limiter) {
    this.limiter = limiter;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    if (!shouldLimit(request)) {
      filterChain.doFilter(request, response);
      return;
    }

    boolean ok = limiter.tryAcquire();
    if (!ok) {
      String msg = "比对任务已达上限（" + limiter.maxConcurrentCompares() + "），请稍后再试";
      log.warn("compare rejected: {}", msg);
      response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
      response.setContentType(MediaType.TEXT_PLAIN_VALUE);
      response.setCharacterEncoding(StandardCharsets.UTF_8.name());
      response.getWriter().write(msg);
      return;
    }

    try {
      filterChain.doFilter(request, response);
    } finally {
      limiter.release();
    }
  }

  /**
   * 判断当前请求是否需要占用“比对任务并发额度”。
   * @param request HTTP 请求
   * @return 是否需要限制
   */
  private boolean shouldLimit(HttpServletRequest request) {
    if (request == null) return false;
    String method = request.getMethod();
    if (method == null || !"POST".equalsIgnoreCase(method)) return false;
    String uri = request.getRequestURI();
    if (uri == null) return false;
    if (!uri.startsWith("/api/compare/")) return false;
    return "/api/compare/jars".equals(uri)
        || "/api/compare/jars/path".equals(uri)
        || "/api/compare/directory".equals(uri)
        || "/api/compare/directory/path".equals(uri)
        || "/api/compare/directory/summary".equals(uri)
        || "/api/compare/files".equals(uri)
        || "/api/compare/files/path".equals(uri);
  }
}
