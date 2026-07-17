package com.example.jardiff.core;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.FileVisitResult;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import java.util.zip.CRC32;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class JarCompareService {
  private static final Logger log = LoggerFactory.getLogger(JarCompareService.class);
  private final CompareStore compareStore;
  private final DigestService digestService;
  private final AsmDecompileService asmDecompileService;
  private final ProcyonDecompileService procyonDecompileService;
  @Value("${jardiff.deep-index.inner-jar-max-mb:8}")
  private int deepIndexInnerJarMaxMb;

  @Value("${jardiff.deep-index.inner-jar-total-max-mb:160}")
  private int deepIndexInnerJarTotalMaxMb;

  @Value("${jardiff.deep-index.inner-jar-max-count:40}")
  private int deepIndexInnerJarMaxCount;

  @Value("${jardiff.deep-compare.meta-only-jar-max-mb:64}")
  private int metaOnlyJarMaxMb = 64;

  public JarCompareService(
      CompareStore compareStore,
      DigestService digestService,
      AsmDecompileService asmDecompileService,
      ProcyonDecompileService procyonDecompileService) {
    this.compareStore = compareStore;
    this.digestService = digestService;
    this.asmDecompileService = asmDecompileService;
    this.procyonDecompileService = procyonDecompileService;
  }

  public CompareResult compare(MultipartFile leftJar, MultipartFile rightJar, CompareOptions options) {
    Objects.requireNonNull(leftJar, "leftJar");
    Objects.requireNonNull(rightJar, "rightJar");
    Objects.requireNonNull(options, "options");

    Path leftPath = null;
    Path rightPath = null;
    try {
      log.info(
          "compare start leftName={} leftSize={} rightName={} rightSize={} includeLib={} includeClasses={} includeResources={} deepCompareLib={} ignoreGlobs={}",
          safeName(leftJar),
          leftJar.getSize(),
          safeName(rightJar),
          rightJar.getSize(),
          options.isIncludeLib(),
          options.isIncludeClasses(),
          options.isIncludeResources(),
          options.isDeepCompareLib(),
          options.getIgnoreGlobs());
      leftPath = saveTemp(leftJar);
      rightPath = saveTemp(rightJar);

      FileMeta leftMeta = new FileMeta(safeName(leftJar), leftJar.getSize(), digestService.md5(leftPath));
      FileMeta rightMeta = new FileMeta(safeName(rightJar), rightJar.getSize(), digestService.md5(rightPath));

      StoredCompare stored = new StoredCompare(leftPath, rightPath, options, Instant.now());
      String id = compareStore.put(stored);

      CompareIndex leftIndex = buildIndex(leftPath, options);
      CompareIndex rightIndex = buildIndex(rightPath, options);

      CompareResultWithStats built = buildAlignedTree(leftIndex, rightIndex, options);
      CompareResult result = new CompareResult(id, leftMeta, rightMeta, built.tree, built.stats);
      stored.setLeftMeta(leftMeta);
      stored.setRightMeta(rightMeta);
      stored.setTree(built.tree);
      stored.setStats(built.stats);
      log.info(
          "compare done id={} added={} missing={} modified={} unchanged={}",
          id,
          built.stats == null ? 0 : built.stats.getAdded(),
          built.stats == null ? 0 : built.stats.getMissing(),
          built.stats == null ? 0 : built.stats.getModified(),
          built.stats == null ? 0 : built.stats.getUnchanged());
      return result;
    } catch (IOException e) {
      if (leftPath != null) safeDelete(leftPath);
      if (rightPath != null) safeDelete(rightPath);
      log.error("compare failed leftName={} rightName={}", safeName(leftJar), safeName(rightJar), e);
      throw new RuntimeException("compare failed: " + e.getMessage(), e);
    }
  }

  public CompareResult getCachedResult(String id) {
    StoredCompare stored = compareStore.get(id).orElseThrow(() -> new IllegalArgumentException("compare not found"));
    if (stored.getTree() != null && stored.getStats() != null && stored.getLeftMeta() != null && stored.getRightMeta() != null) {
      log.info("report cache hit id={}", id);
      return new CompareResult(id, stored.getLeftMeta(), stored.getRightMeta(), stored.getTree(), stored.getStats());
    }
    try {
      log.info("report cache miss id={} buildReport=true", id);
      CompareIndex leftIndex = buildIndex(stored.getLeftJarPath(), stored.getOptions());
      CompareIndex rightIndex = buildIndex(stored.getRightJarPath(), stored.getOptions());
      CompareResultWithStats built = buildAlignedTree(leftIndex, rightIndex, stored.getOptions());
      stored.setTree(built.tree);
      stored.setStats(built.stats);
      return new CompareResult(id, stored.getLeftMeta(), stored.getRightMeta(), built.tree, built.stats);
    } catch (IOException e) {
      log.error("report build failed id={}", id, e);
      throw new RuntimeException("build report failed: " + e.getMessage(), e);
    }
  }

  public DirectorySummaryResult compareDirectory(MultipartFile[] leftFiles, MultipartFile[] rightFiles) {
    log.info(
        "directory summary start leftCount={} rightCount={}",
        leftFiles == null ? 0 : leftFiles.length,
        rightFiles == null ? 0 : rightFiles.length);
    Map<String, MultipartFile> leftMap = new TreeMap<>();
    Map<String, MultipartFile> rightMap = new TreeMap<>();
    if (leftFiles != null) {
      for (MultipartFile f : leftFiles) {
        if (f == null || f.isEmpty()) continue;
        leftMap.put(safeName(f), f);
      }
    }
    if (rightFiles != null) {
      for (MultipartFile f : rightFiles) {
        if (f == null || f.isEmpty()) continue;
        rightMap.put(safeName(f), f);
      }
    }

    Set<String> names = new HashSet<>();
    names.addAll(leftMap.keySet());
    names.addAll(rightMap.keySet());

    List<DirectoryJarRow> rows = new ArrayList<>();
    for (String name : names) {
      MultipartFile l = leftMap.get(name);
      MultipartFile r = rightMap.get(name);
      FileMeta lm = null;
      FileMeta rm = null;
      String status;

      try {
        if (l == null && r != null) {
          Path rp = saveTemp(r);
          rm = new FileMeta(name, r.getSize(), digestService.md5(rp));
          safeDelete(rp);
          status = "added";
        } else if (l != null && r == null) {
          Path lp = saveTemp(l);
          lm = new FileMeta(name, l.getSize(), digestService.md5(lp));
          safeDelete(lp);
          status = "missing";
        } else if (l != null) {
          Path lp = saveTemp(l);
          Path rp = saveTemp(r);
          String lmd5 = digestService.md5(lp);
          String rmd5 = digestService.md5(rp);
          lm = new FileMeta(name, l.getSize(), lmd5);
          rm = new FileMeta(name, r.getSize(), rmd5);
          status = lmd5.equals(rmd5) ? "unchanged" : "modified";
          safeDelete(lp);
          safeDelete(rp);
        } else {
          continue;
        }
      } catch (IOException e) {
        status = "error";
      }

      rows.add(new DirectoryJarRow(name, lm, rm, status));
    }

    rows.sort(Comparator.comparing(DirectoryJarRow::getName));
    log.info("directory summary done rows={}", rows.size());
    return new DirectorySummaryResult(rows);
  }

  public CompareResult compareDirectoryFull(MultipartFile[] leftFiles, MultipartFile[] rightFiles, CompareOptions options) {
    Objects.requireNonNull(options, "options");
    ZipBuildResult leftZip = null;
    ZipBuildResult rightZip = null;
    try {
      log.info(
          "compare directory start leftCount={} rightCount={} includeLib={} includeClasses={} includeResources={} deepCompareLib={} ignoreGlobs={}",
          leftFiles == null ? 0 : leftFiles.length,
          rightFiles == null ? 0 : rightFiles.length,
          options.isIncludeLib(),
          options.isIncludeClasses(),
          options.isIncludeResources(),
          options.isDeepCompareLib(),
          options.getIgnoreGlobs());
      leftZip = buildZipFromUploads(leftFiles);
      rightZip = buildZipFromUploads(rightFiles);

      FileMeta leftMeta = new FileMeta("left-directory.zip", leftZip.size, leftZip.md5);
      FileMeta rightMeta = new FileMeta("right-directory.zip", rightZip.size, rightZip.md5);

      StoredCompare stored = new StoredCompare(leftZip.path, rightZip.path, options, Instant.now());
      String id = compareStore.put(stored);

      CompareIndex leftIndex = buildIndex(leftZip.path, options);
      CompareIndex rightIndex = buildIndex(rightZip.path, options);

      CompareResultWithStats built = buildAlignedTree(leftIndex, rightIndex, options);
      CompareResult result = new CompareResult(id, leftMeta, rightMeta, built.tree, built.stats);
      stored.setLeftMeta(leftMeta);
      stored.setRightMeta(rightMeta);
      stored.setTree(built.tree);
      stored.setStats(built.stats);
      log.info(
          "compare directory done id={} added={} missing={} modified={} unchanged={}",
          id,
          built.stats == null ? 0 : built.stats.getAdded(),
          built.stats == null ? 0 : built.stats.getMissing(),
          built.stats == null ? 0 : built.stats.getModified(),
          built.stats == null ? 0 : built.stats.getUnchanged());
      return result;
    } catch (IOException e) {
      if (leftZip != null) safeDelete(leftZip.path);
      if (rightZip != null) safeDelete(rightZip.path);
      log.error("compare directory failed", e);
      throw new RuntimeException("compare directory failed: " + e.getMessage(), e);
    }
  }

  public CompareResult compareDirectoryFullByPath(Path leftDir, Path rightDir, CompareOptions options, int maxFiles, long maxBytes) {
    Objects.requireNonNull(options, "options");
    ZipBuildResult leftZip = null;
    ZipBuildResult rightZip = null;
    try {
      log.info(
          "compare directory by path start leftDir={} rightDir={} maxFiles={} maxBytes={} includeLib={} includeClasses={} includeResources={} deepCompareLib={} ignoreGlobs={}",
          leftDir,
          rightDir,
          maxFiles,
          maxBytes,
          options.isIncludeLib(),
          options.isIncludeClasses(),
          options.isIncludeResources(),
          options.isDeepCompareLib(),
          options.getIgnoreGlobs());
      leftZip = buildZipFromDirectory(leftDir, maxFiles, maxBytes);
      rightZip = buildZipFromDirectory(rightDir, maxFiles, maxBytes);

      FileMeta leftMeta = new FileMeta(String.valueOf(leftDir), leftZip.size, leftZip.md5);
      FileMeta rightMeta = new FileMeta(String.valueOf(rightDir), rightZip.size, rightZip.md5);

      StoredCompare stored = new StoredCompare(leftZip.path, rightZip.path, options, Instant.now());
      String id = compareStore.put(stored);

      CompareIndex leftIndex = buildIndex(leftZip.path, options);
      CompareIndex rightIndex = buildIndex(rightZip.path, options);

      CompareResultWithStats built = buildAlignedTree(leftIndex, rightIndex, options);
      CompareResult result = new CompareResult(id, leftMeta, rightMeta, built.tree, built.stats);
      stored.setLeftMeta(leftMeta);
      stored.setRightMeta(rightMeta);
      stored.setTree(built.tree);
      stored.setStats(built.stats);
      log.info(
          "compare directory by path done id={} added={} missing={} modified={} unchanged={}",
          id,
          built.stats == null ? 0 : built.stats.getAdded(),
          built.stats == null ? 0 : built.stats.getMissing(),
          built.stats == null ? 0 : built.stats.getModified(),
          built.stats == null ? 0 : built.stats.getUnchanged());
      return result;
    } catch (RuntimeException e) {
      if (leftZip != null) safeDelete(leftZip.path);
      if (rightZip != null) safeDelete(rightZip.path);
      log.error("compare directory by path failed leftDir={} rightDir={}", leftDir, rightDir, e);
      throw e;
    } catch (IOException e) {
      if (leftZip != null) safeDelete(leftZip.path);
      if (rightZip != null) safeDelete(rightZip.path);
      log.error("compare directory by path failed leftDir={} rightDir={}", leftDir, rightDir, e);
      throw new RuntimeException("compare directory failed: " + e.getMessage(), e);
    }
  }

  private static class ZipBuildResult {
    final Path path;
    final long size;
    final String md5;

    private ZipBuildResult(Path path, long size, String md5) {
      this.path = path;
      this.size = size;
      this.md5 = md5;
    }
  }

  private ZipBuildResult buildZipFromUploads(MultipartFile[] files) throws IOException {
    Path tmp = Files.createTempFile("jardiff_dir_", ".zip");
    HashSet<String> added = new HashSet<>();
    MessageDigest md = null;
    try {
      md = MessageDigest.getInstance("MD5");
    } catch (Exception e) {
      md = null;
    }
    OutputStream baseOs = Files.newOutputStream(tmp);
    DigestOutputStream dos = md == null ? null : new DigestOutputStream(baseOs, md);
    try (OutputStream os = dos == null ? baseOs : dos;
        ZipOutputStream zos = new ZipOutputStream(os, StandardCharsets.UTF_8)) {
      zos.setLevel(0);
      if (files != null) {
        byte[] buf = new byte[1024 * 64];
        for (MultipartFile f : files) {
          if (f == null || f.isEmpty()) continue;
          String raw = f.getOriginalFilename();
          String entryName = sanitizeEntryName(raw);
          if (entryName.isEmpty()) continue;
          if (!added.add(entryName)) continue;
          ZipEntry e = new ZipEntry(entryName);
          zos.putNextEntry(e);
          try (InputStream in = new BufferedInputStream(f.getInputStream())) {
            int read;
            while ((read = in.read(buf)) >= 0) {
              if (read == 0) continue;
              zos.write(buf, 0, read);
            }
          }
          zos.closeEntry();
        }
      }
    } catch (IOException ex) {
      safeDelete(tmp);
      throw ex;
    }
    long size = Files.size(tmp);
    String md5Hex = md == null ? digestService.md5(tmp) : toHex(md.digest());
    log.info("build zip from uploads done files={} size={} md5={}", added.size(), size, md5Hex);
    return new ZipBuildResult(tmp, size, md5Hex);
  }

  private ZipBuildResult buildZipFromDirectory(Path dir, int maxFiles, long maxBytes) throws IOException {
    if (dir == null) throw new IllegalArgumentException("目录路径为空");
    if (!Files.exists(dir)) throw new IllegalArgumentException("目录不存在：" + dir);
    if (!Files.isDirectory(dir)) throw new IllegalArgumentException("不是目录：" + dir);

    Path tmp = Files.createTempFile("jardiff_dir_", ".zip");
    HashSet<String> added = new HashSet<>();
    MessageDigest md = null;
    try {
      md = MessageDigest.getInstance("MD5");
    } catch (Exception e) {
      md = null;
    }
    OutputStream baseOs = Files.newOutputStream(tmp);
    DigestOutputStream dos = md == null ? null : new DigestOutputStream(baseOs, md);
    long[] totalBytes = new long[] {0L};
    int[] totalFiles = new int[] {0};
    try (OutputStream os = dos == null ? baseOs : dos;
        ZipOutputStream zos = new ZipOutputStream(os, StandardCharsets.UTF_8)) {
      zos.setLevel(0);
      byte[] buf = new byte[1024 * 64];
      Files.walkFileTree(
          dir,
          new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
              if (file == null || attrs == null) return FileVisitResult.CONTINUE;
              if (!attrs.isRegularFile()) return FileVisitResult.CONTINUE;
              if (Files.isSymbolicLink(file)) return FileVisitResult.CONTINUE;
              Path rel = dir.relativize(file);
              String entryName = sanitizeEntryName(String.valueOf(rel).replace("\\", "/"));
              if (entryName.isEmpty()) return FileVisitResult.CONTINUE;
              if (!added.add(entryName)) return FileVisitResult.CONTINUE;
              long s = attrs.size();
              if (s > 0) totalBytes[0] += s;
              totalFiles[0] += 1;
              if (maxFiles > 0 && totalFiles[0] > maxFiles) {
                throw new IllegalArgumentException("目录文件过多（" + totalFiles[0] + " 个），超过上限 " + maxFiles + " 个，已禁止比对");
              }
              if (maxBytes > 0 && totalBytes[0] > maxBytes) {
                throw new IllegalArgumentException(
                    "目录总大小过大（" + formatBytes(totalBytes[0]) + "），超过上限 " + formatBytes(maxBytes) + "，已禁止比对");
              }
              ZipEntry e = new ZipEntry(entryName);
              zos.putNextEntry(e);
              try (InputStream in = new BufferedInputStream(Files.newInputStream(file))) {
                int read;
                while ((read = in.read(buf)) >= 0) {
                  if (read == 0) continue;
                  zos.write(buf, 0, read);
                }
              }
              zos.closeEntry();
              return FileVisitResult.CONTINUE;
            }
          });
    } catch (IOException | RuntimeException ex) {
      safeDelete(tmp);
      if (ex instanceof IOException) throw (IOException) ex;
      throw ex;
    }
    long size = Files.size(tmp);
    String md5Hex = md == null ? digestService.md5(tmp) : toHex(md.digest());
    log.info(
        "build zip from directory done dir={} files={} totalBytes={} zipSize={} md5={}",
        dir,
        totalFiles[0],
        totalBytes[0],
        size,
        md5Hex);
    return new ZipBuildResult(tmp, size, md5Hex);
  }

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

  private String toHex(byte[] bytes) {
    if (bytes == null) return "";
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
    return sb.toString();
  }

  private String sanitizeEntryName(String raw) {
    if (raw == null) return "";
    String s = raw.replace("\\", "/").trim();
    while (s.startsWith("/")) s = s.substring(1);
    if (s.isEmpty()) return "";
    if (s.contains(":/")) return "";
    String[] parts = s.split("/");
    StringBuilder out = new StringBuilder(s.length());
    for (String p : parts) {
      if (p == null) continue;
      String seg = p.trim();
      if (seg.isEmpty() || ".".equals(seg)) continue;
      if ("..".equals(seg)) return "";
      if (out.length() > 0) out.append('/');
      out.append(seg);
    }
    return out.toString();
  }

  private CompareIndex buildIndex(Path jarPath, CompareOptions options) throws IOException {
    Map<String, EntryMeta> files = new HashMap<>();
    try (ZipFile zipFile = new ZipFile(jarPath.toFile())) {
      final long eagerMaxBytes = 1024L * 1024L * (long) Math.max(1, deepIndexInnerJarMaxMb);
      final long eagerTotalMaxBytes = 1024L * 1024L * (long) Math.max(1, deepIndexInnerJarTotalMaxMb);
      final int eagerMaxCount = Math.max(1, deepIndexInnerJarMaxCount);
      final long[] eagerTotalBytes = new long[] {0L};
      final int[] eagerCount = new int[] {0};
      zipFile.stream()
          .filter(e -> !e.isDirectory())
          .forEach(e -> {
            String name = normalize(e.getName());
            if (!filterByOptions(name, options)) return;
            files.put(name, new EntryMeta(name, e.getSize(), e.getCrc()));
            if (options.isDeepCompareLib() && isJar(name) && shouldReadInnerJar(e.getSize())) {
              long sz = e.getSize();
              if (sz <= 0 || sz > eagerMaxBytes) return;
              if (eagerCount[0] >= eagerMaxCount) return;
              if (eagerTotalBytes[0] + sz > eagerTotalMaxBytes) return;
              Path tmp = null;
              try (InputStream in = zipFile.getInputStream(e)) {
                tmp = Files.createTempFile("jardiff_inner_", ".jar");
                Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
                indexInnerJarByZipFile(name, tmp, files, options);
                eagerTotalBytes[0] += sz;
                eagerCount[0] += 1;
              } catch (IOException ignored) {
              } finally {
                if (tmp != null) safeDelete(tmp);
              }
            }
          });
    }
    return new CompareIndex(jarPath, files);
  }

  private boolean shouldReadInnerJar(long size) {
    long max = 1024L * 1024L * 512L;
    return size < 0 || size <= max;
  }

  private boolean isJar(String path) {
    return path != null && path.toLowerCase().endsWith(".jar");
  }

  /**
   * 计算 outerJarPath 对应内嵌条目的指纹，用于识别“仅元信息变化”的依赖 jar。
   *
   * <p>指纹只依赖内嵌条目的路径、大小与 CRC，不包含时间戳/压缩方式等容易产生噪声的元信息。
   *
   * @param files 索引后的文件元数据（含 outer!/inner 的键）
   * @param outerJarPath 外层 jar 的路径（不含 "!/"）
   * @return 指纹字符串；无法计算时返回空串
   */
  private String computeInnerFingerprint(Map<String, EntryMeta> files, String outerJarPath) {
    if (files == null || files.isEmpty() || outerJarPath == null || outerJarPath.isEmpty()) return "";
    String outer = normalize(outerJarPath);
    if (outer.isEmpty()) return "";
    String prefix = outer + "!/";
    ArrayList<String> keys = new ArrayList<>();
    for (String k : files.keySet()) {
      if (k == null) continue;
      if (k.startsWith(prefix)) keys.add(k);
    }
    if (keys.isEmpty()) return "";
    keys.sort(String::compareTo);
    CRC32 crc = new CRC32();
    for (String k : keys) {
      EntryMeta m = files.get(k);
      String chunk = k + "#" + (m == null ? -1 : m.size) + "#" + (m == null ? -1 : m.crc) + ";";
      byte[] b = chunk.getBytes(StandardCharsets.UTF_8);
      crc.update(b, 0, b.length);
    }
    return keys.size() + ":" + Long.toHexString(crc.getValue());
  }

  /**
   * 判断 outerJarPath 在两侧是否属于“仅 jar 元信息变化”：
   * 依赖 jar 本体不同，但其内部条目集合（路径/大小/CRC）一致。
   *
   * @param left 左侧索引
   * @param right 右侧索引
   * @param outerJarPath 外层 jar 路径（不支持已经是内嵌路径的 "!/" 形式）
   * @return true 表示可标记为 meta；false 表示需要按 modified 处理
   */
  private boolean isMetaOnlyJarChange(CompareIndex left, CompareIndex right, String outerJarPath) {
    if (left == null || right == null) return false;
    if (outerJarPath == null || outerJarPath.isEmpty()) return false;
    if (outerJarPath.contains("!/")) return false;
    String lf = computeInnerFingerprint(left.files, outerJarPath);
    String rf = computeInnerFingerprint(right.files, outerJarPath);
    if (lf.isEmpty() || rf.isEmpty()) return false;
    return lf.equals(rf);
  }

  /**
   * 基于“外层 zip 中 jar 条目的字节流”计算内嵌条目的指纹。
   *
   * <p>用于避免 deep-index 阶段未预索引（例如超过 inner-jar-max-mb）时，将仅元信息变化误判为 modified。
   *
   * @param outerZip 外层 zip（通常是应用 jar）
   * @param outerJarEntryName 外层中的 jar 条目路径（不含 "!/"）
   * @param options 比对选项（用于过滤 ignoreGlobs 等）
   * @return 指纹字符串；无法计算时返回空串
   */
  private String computeInnerFingerprintFromOuterZip(ZipFile outerZip, String outerJarEntryName, CompareOptions options) {
    if (outerZip == null || outerJarEntryName == null || outerJarEntryName.isEmpty()) return "";
    String outer = normalize(outerJarEntryName);
    if (outer.isEmpty()) return "";
    ZipEntry outerEntry = outerZip.getEntry(outer);
    if (outerEntry == null) return "";

    long maxBytes = 1024L * 1024L * (long) Math.max(1, metaOnlyJarMaxMb);
    long outerSize = outerEntry.getSize();
    if (outerSize > 0 && outerSize > maxBytes) return "";

    HashMap<String, EntryMeta> inner = new HashMap<>();
    long totalRead = 0L;
    byte[] buf = new byte[1024 * 16];
    try (InputStream raw = outerZip.getInputStream(outerEntry);
        ZipInputStream zis = new ZipInputStream(new BufferedInputStream(raw))) {
      ZipEntry e;
      while ((e = zis.getNextEntry()) != null) {
        if (e.isDirectory()) continue;
        String innerName = normalize(e.getName());
        if (innerName.isEmpty()) continue;
        String fullName = outer + "!/" + innerName;
        boolean keep = filterByOptions(fullName, options);
        CRC32 crc32 = keep ? new CRC32() : null;
        long size = 0L;
        int read;
        while ((read = zis.read(buf)) >= 0) {
          if (read == 0) continue;
          size += read;
          totalRead += read;
          if (totalRead > maxBytes) return "";
          if (keep) crc32.update(buf, 0, read);
        }
        if (keep) inner.put(fullName, new EntryMeta(fullName, size, crc32.getValue()));
      }
    } catch (IOException ex) {
      return "";
    }

    return computeInnerFingerprint(inner, outer);
  }

  /**
   * 在 deepCompareLib 开启时，尝试将 jar 的 modified 降级为 meta：
   * 当 jar 本体不同但内部条目（路径/大小/CRC）一致时认为是“仅元信息变化”。
   *
   * @param leftReader 左侧 jar 读取器
   * @param rightReader 右侧 jar 读取器
   * @param options 比对选项
   * @param outerJarPath 外层 jar 条目路径（不含 "!/"）
   * @param leftSize 左侧 jar 条目大小（用于快速限流）
   * @param rightSize 右侧 jar 条目大小（用于快速限流）
   * @return true 表示可标记为 meta
   */
  private boolean isMetaOnlyJarChangeLazy(
      JarReader leftReader, JarReader rightReader, CompareOptions options, String outerJarPath, long leftSize, long rightSize) {
    if (leftReader == null || rightReader == null) return false;
    if (outerJarPath == null || outerJarPath.isEmpty()) return false;
    if (outerJarPath.contains("!/")) return false;

    long maxBytes = 1024L * 1024L * (long) Math.max(1, metaOnlyJarMaxMb);
    if (leftSize > 0 && leftSize > maxBytes) return false;
    if (rightSize > 0 && rightSize > maxBytes) return false;

    String lf = computeInnerFingerprintFromOuterZip(leftReader.zip, outerJarPath, options);
    String rf = computeInnerFingerprintFromOuterZip(rightReader.zip, outerJarPath, options);
    if (lf.isEmpty() || rf.isEmpty()) return false;
    return lf.equals(rf);
  }

  private CompareResultWithStats buildAlignedTree(CompareIndex left, CompareIndex right, CompareOptions options) {
    Set<String> all = new HashSet<>();
    all.addAll(left.files.keySet());
    all.addAll(right.files.keySet());

    StatsCounter counter = new StatsCounter();
    TreeNode root = new TreeNode("dir", "", "");
    int classChecked = 0;
    JarReader leftReader = null;
    JarReader rightReader = null;
    try {
      if (left.jarPath != null) leftReader = new JarReader(left.jarPath);
      if (right.jarPath != null) rightReader = new JarReader(right.jarPath);
      for (String path : all) {
        boolean leftExists = left.files.containsKey(path);
        boolean rightExists = right.files.containsKey(path);
        String status;
        if (leftExists && !rightExists) status = "missing";
        else if (!leftExists && rightExists) status = "added";
        else {
          EntryMeta l = left.files.get(path);
          EntryMeta r = right.files.get(path);
          if (Objects.equals(l, r)) {
            status = "unchanged";
          } else if (isLikelyText(path)
              && isEffectivelySameText(leftReader, rightReader, path, l == null ? -1 : l.size, r == null ? -1 : r.size)) {
            status = "unchanged";
          } else if (options != null
              && options.isIncludeClasses()
              && isClass(path)
              && classChecked < 80
              && isEffectivelySameClass(leftReader, rightReader, path, l == null ? -1 : l.size, r == null ? -1 : r.size)) {
            status = "unchanged";
            classChecked += 1;
          } else {
            boolean meta = false;
            if (options != null && options.isDeepCompareLib() && isJar(path)) {
              meta = isMetaOnlyJarChange(left, right, path);
              if (!meta && isBootLibJar(path)) {
                meta =
                    isMetaOnlyJarChangeLazy(
                        leftReader,
                        rightReader,
                        options,
                        path,
                        l == null ? -1 : l.size,
                        r == null ? -1 : r.size);
              }
            }
            status = meta ? "meta" : "modified";
          }
        }

        if (status.equals("added")) counter.added++;
        else if (status.equals("missing")) counter.missing++;
        else if (status.equals("modified") || status.equals("meta")) counter.modified++;
        else counter.unchanged++;

        addFileNode(root, path, leftExists, rightExists, status, options);
      }
    } catch (IOException e) {
      throw new RuntimeException("open jar failed: " + e.getMessage(), e);
    } finally {
      if (leftReader != null) {
        try {
          leftReader.close();
        } catch (IOException ignored) {
        }
      }
      if (rightReader != null) {
        try {
          rightReader.close();
        } catch (IOException ignored) {
        }
      }
    }

    sortChildren(root);
    return new CompareResultWithStats(root.getChildren(), counter.toStats());
  }

  private boolean isLikelyText(String path) {
    String p = normalize(path);
    int idx = p.indexOf("!/");
    if (idx >= 0 && idx + 2 < p.length()) p = p.substring(idx + 2);
    p = p.toLowerCase();
    return p.endsWith(".yml")
        || p.endsWith(".yaml")
        || p.endsWith(".xml")
        || p.endsWith(".properties")
        || p.endsWith(".mf")
        || p.endsWith(".json")
        || p.endsWith(".txt")
        || p.endsWith(".md")
        || p.endsWith(".html")
        || p.endsWith(".htm")
        || p.endsWith(".js")
        || p.endsWith(".css")
        || p.endsWith(".java")
        || p.endsWith(".kt")
        || p.endsWith(".groovy")
        || p.endsWith(".scala");
  }

  private boolean isEffectivelySameText(JarReader leftReader, JarReader rightReader, String path, long leftSize, long rightSize) {
    long max = 1024L * 1024L * 2L;
    if (leftSize > max || rightSize > max) return false;
    byte[] lb = leftReader == null ? null : leftReader.readEntryBytesMaybeNested(path);
    byte[] rb = rightReader == null ? null : rightReader.readEntryBytesMaybeNested(path);
    if (lb == null || rb == null) return false;
    String ls = normalizeText(toText(lb));
    String rs = normalizeText(toText(rb));
    return ls.equals(rs);
  }

  private String normalizeText(String text) {
    if (text == null) return "";
    String s = text.replace("\r\n", "\n").replace("\r", "\n");
    String[] lines = s.split("\n", -1);
    StringBuilder out = new StringBuilder(s.length());
    for (int i = 0; i < lines.length; i++) {
      if (i > 0) out.append('\n');
      out.append(rtrim(lines[i]));
    }
    return out.toString();
  }

  private String rtrim(String s) {
    if (s == null || s.isEmpty()) return s == null ? "" : s;
    int end = s.length();
    while (end > 0) {
      char c = s.charAt(end - 1);
      if (c == ' ' || c == '\t') end--;
      else break;
    }
    return end == s.length() ? s : s.substring(0, end);
  }

  private String toText(byte[] bytes) {
    if (bytes == null) return "";
    String utf8 = new String(bytes, StandardCharsets.UTF_8);
    if (utf8.contains("\uFFFD")) return new String(bytes, Charset.forName("ISO-8859-1"));
    return utf8;
  }

  private boolean isClass(String path) {
    String p = normalize(path);
    int idx = p.indexOf("!/");
    if (idx >= 0 && idx + 2 < p.length()) p = p.substring(idx + 2);
    return p.toLowerCase().endsWith(".class");
  }

  private boolean isEffectivelySameClass(JarReader leftReader, JarReader rightReader, String path, long leftSize, long rightSize) {
    long max = 1024L * 1024L * 2L;
    if (leftSize > max || rightSize > max) return false;
    byte[] lb = leftReader == null ? null : leftReader.readEntryBytesMaybeNested(path);
    byte[] rb = rightReader == null ? null : rightReader.readEntryBytesMaybeNested(path);
    if (lb == null || rb == null) return false;

    AsmDecompileService.SignatureSnapshot ls = asmDecompileService.extractSignature(lb);
    AsmDecompileService.SignatureSnapshot rs = asmDecompileService.extractSignature(rb);
    if (!Objects.equals(ls.getClassDecl(), rs.getClassDecl())) return false;
    if (!Objects.equals(ls.getFields(), rs.getFields())) return false;
    if (!Objects.equals(ls.getMethods(), rs.getMethods())) return false;

    NestedPath ln = parseNested(path);
    NestedPath rn = parseNested(path);
    long lf = asmDecompileService.fingerprintBytecode(lb);
    long rf = asmDecompileService.fingerprintBytecode(rb);
    if (lf != 0L && lf == rf) return true;

    byte[] leftContainer = ln == null || leftReader == null ? null : leftReader.readEntryBytes(ln.outerEntry);
    byte[] rightContainer = rn == null || rightReader == null ? null : rightReader.readEntryBytes(rn.outerEntry);
    ProcyonDecompileService.ClassBytesProvider lp = buildClassProvider(leftReader, ln, leftContainer);
    ProcyonDecompileService.ClassBytesProvider rp = buildClassProvider(rightReader, rn, rightContainer);
    String ltxt = normalizeText(procyonDecompileService.decompileToText(lb, lp));
    String rtxt = normalizeText(procyonDecompileService.decompileToText(rb, rp));
    return ltxt.equals(rtxt);
  }

  private ProcyonDecompileService.ClassBytesProvider buildClassProvider(JarReader jarReader, NestedPath nested, byte[] containerJarBytes) {
    HashMap<String, byte[]> hit = new HashMap<>();
    HashSet<String> miss = new HashSet<>();
    return (internalName) -> {
      if (internalName == null || internalName.trim().isEmpty()) return null;
      byte[] cached = hit.get(internalName);
      if (cached != null) return cached;
      if (miss.contains(internalName)) return null;
      String entry = normalize(internalName + ".class");
      byte[] out;
      if (nested != null && containerJarBytes != null) {
        out = readNestedEntryBytes(containerJarBytes, entry);
      } else {
        out = jarReader == null ? null : jarReader.readEntryBytes(entry);
      }
      if (out == null || out.length == 0) {
        miss.add(internalName);
        return null;
      }
      hit.put(internalName, out);
      return out;
    };
  }

  private static class NestedPath {
    final String outerEntry;
    final String innerEntry;

    private NestedPath(String outerEntry, String innerEntry) {
      this.outerEntry = outerEntry;
      this.innerEntry = innerEntry;
    }
  }

  private class JarReader implements AutoCloseable {
    private final ZipFile zip;
    private final HashMap<String, byte[]> cache = new HashMap<>();
    private int cacheCount = 0;

    private JarReader(Path jarPath) throws IOException {
      this.zip = new ZipFile(jarPath.toFile());
    }

    private byte[] readEntryBytes(String entryName) {
      if (entryName == null || entryName.isEmpty()) return null;
      String key = normalize(entryName);
      byte[] cached = cache.get(key);
      if (cached != null) return cached;
      ZipEntry e = zip.getEntry(key);
      if (e == null) return null;
      try (InputStream in = zip.getInputStream(e)) {
        byte[] out = readAll(in);
        if (out != null && out.length > 0 && out.length <= 1024 * 1024 * 4) {
          if (cacheCount >= 256) {
            cache.clear();
            cacheCount = 0;
          }
          cache.put(key, out);
          cacheCount += 1;
        }
        return out;
      } catch (IOException ex) {
        return null;
      }
    }

    private byte[] readEntryBytesMaybeNested(String path) {
      if (path == null || path.isEmpty()) return null;
      String p = normalize(path);
      int idx = p.indexOf("!/");
      if (idx < 0) return readEntryBytes(p);
      String outer = normalize(p.substring(0, idx));
      String inner = normalize(p.substring(idx + 2));
      byte[] outerBytes = readEntryBytes(outer);
      if (outerBytes == null) return null;
      return readNestedEntryBytes(outerBytes, inner);
    }

    @Override
    public void close() throws IOException {
      zip.close();
    }
  }

  private void indexInnerJarByZipFile(String outerJarEntryName, Path jarPath, Map<String, EntryMeta> files, CompareOptions options)
      throws IOException {
    if (outerJarEntryName == null || outerJarEntryName.isEmpty() || jarPath == null) return;
    try (ZipFile zip = new ZipFile(jarPath.toFile())) {
      zip.stream()
          .filter(e -> !e.isDirectory())
          .forEach(e -> {
            String innerName = normalize(e.getName());
            if (innerName.isEmpty()) return;
            String fullName = outerJarEntryName + "!/" + innerName;
            if (!filterByOptions(fullName, options)) return;
            files.put(fullName, new EntryMeta(fullName, e.getSize(), e.getCrc()));
          });
    }
  }

  public List<TreeNode> loadNestedJarTree(StoredCompare stored, String outerJarEntryName) {
    Objects.requireNonNull(stored, "stored");
    String outer = normalize(outerJarEntryName);
    if (outer.isEmpty()) throw new IllegalArgumentException("jar 路径为空");
    CompareOptions options = stored.getOptions();
    Path leftInner = null;
    Path rightInner = null;
    try {
      leftInner = extractEntryToTemp(stored.getLeftJarPath(), outer, ".jar");
      rightInner = extractEntryToTemp(stored.getRightJarPath(), outer, ".jar");
      CompareIndex leftIndex = leftInner == null ? new CompareIndex(null, new HashMap<>()) : buildIndex(leftInner, options);
      CompareIndex rightIndex = rightInner == null ? new CompareIndex(null, new HashMap<>()) : buildIndex(rightInner, options);
      CompareResultWithStats built = buildAlignedTree(leftIndex, rightIndex, options);
      prefixTreeValues(built.tree, outer + "!/");
      return built.tree;
    } catch (IOException e) {
      throw new RuntimeException("load nested jar failed: " + e.getMessage(), e);
    } finally {
      if (leftInner != null) safeDelete(leftInner);
      if (rightInner != null) safeDelete(rightInner);
    }
  }

  private Path extractEntryToTemp(Path container, String entryName, String suffix) throws IOException {
    if (container == null || entryName == null || entryName.isEmpty()) return null;
    String want = normalize(entryName);
    try (ZipFile zip = new ZipFile(container.toFile())) {
      ZipEntry e = zip.getEntry(want);
      if (e == null) return null;
      Path tmp = Files.createTempFile("jardiff_extract_", suffix == null ? ".bin" : suffix);
      try (InputStream in = zip.getInputStream(e)) {
        Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
      } catch (IOException ex) {
        safeDelete(tmp);
        throw ex;
      }
      return tmp;
    }
  }

  private void prefixTreeValues(List<TreeNode> nodes, String prefix) {
    if (nodes == null || nodes.isEmpty()) return;
    for (TreeNode n : nodes) {
      if (n == null) continue;
      String v = n.getValue() == null ? "" : n.getValue();
      n.setValue(prefix + v);
      if (n.getChildren() != null && !n.getChildren().isEmpty()) {
        prefixTreeValues(n.getChildren(), prefix);
      }
    }
  }

  private NestedPath parseNested(String path) {
    if (path == null) return null;
    String p = normalize(path);
    int idx = p.indexOf("!/");
    if (idx < 0) return null;
    String outer = normalize(p.substring(0, idx));
    String inner = normalize(p.substring(idx + 2));
    if (outer.isEmpty() || inner.isEmpty()) return null;
    return new NestedPath(outer, inner);
  }

  private byte[] readEntryBytesMaybeNested(Path jarPath, String path) {
    if (jarPath == null || path == null) return null;
    String p = normalize(path);
    int idx = p.indexOf("!/");
    if (idx < 0) return readEntryBytes(jarPath, p);
    String outer = normalize(p.substring(0, idx));
    String inner = normalize(p.substring(idx + 2));
    byte[] outerBytes = readEntryBytes(jarPath, outer);
    if (outerBytes == null) return null;
    return readNestedEntryBytes(outerBytes, inner);
  }

  private byte[] readEntryBytes(Path jarPath, String entryName) {
    if (jarPath == null || entryName == null) return null;
    try (ZipFile zip = new ZipFile(jarPath.toFile())) {
      ZipEntry e = zip.getEntry(entryName);
      if (e == null) return null;
      try (InputStream in = zip.getInputStream(e)) {
        return readAll(in);
      }
    } catch (IOException ex) {
      return null;
    }
  }

  private byte[] readNestedEntryBytes(byte[] jarBytes, String innerEntryName) {
    if (jarBytes == null || jarBytes.length == 0) return null;
    String want = normalize(innerEntryName);
    if (want.isEmpty()) return null;
    try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(jarBytes))) {
      ZipEntry e;
      while ((e = zis.getNextEntry()) != null) {
        if (e.isDirectory()) continue;
        String n = normalize(e.getName());
        if (!want.equals(n)) continue;
        return readAll(zis);
      }
      return null;
    } catch (IOException ex) {
      return null;
    }
  }

  private void addFileNode(TreeNode root, String path, boolean leftExists, boolean rightExists, String rightStatus, CompareOptions options) {
    NestedPath nested = parseNested(path);
    if (nested != null && options != null && options.isDeepCompareLib()) {
      addNestedFileNode(root, nested.outerEntry, nested.innerEntry, leftExists, rightExists, rightStatus);
      return;
    }

    boolean jarAsContainer = options != null && options.isDeepCompareLib() && isJar(path);
    String[] parts = path.split("/");
    TreeNode cur = root;
    StringBuilder built = new StringBuilder();
    for (int i = 0; i < parts.length; i++) {
      String p = parts[i];
      if (built.length() > 0) built.append("/");
      built.append(p);
      String v = built.toString();
      boolean last = i == parts.length - 1;
      TreeNode next = findChild(cur, v);
      if (next == null) {
        String type = last ? (jarAsContainer ? "jar" : "file") : "dir";
        next = new TreeNode(type, p, v);
        cur.getChildren().add(next);
      } else if (last && jarAsContainer && "file".equals(next.getType())) {
        next.setType("jar");
      }
      if (last) {
        next.setLeftExists(leftExists);
        next.setRightExists(rightExists);
        next.setRightStatus(rightStatus);
      } else {
        next.setLeftExists(next.isLeftExists() || leftExists);
        next.setRightExists(next.isRightExists() || rightExists);
      }
      cur = next;
    }
  }

  private void addNestedFileNode(
      TreeNode root, String outerEntry, String innerEntry, boolean leftExists, boolean rightExists, String rightStatus) {
    String outer = normalize(outerEntry);
    String inner = normalize(innerEntry);
    if (outer.isEmpty() || inner.isEmpty()) return;

    String[] outerParts = outer.split("/");
    TreeNode cur = root;
    StringBuilder outerBuilt = new StringBuilder();
    for (int i = 0; i < outerParts.length; i++) {
      String seg = outerParts[i];
      if (outerBuilt.length() > 0) outerBuilt.append("/");
      outerBuilt.append(seg);
      String v = outerBuilt.toString();
      boolean last = i == outerParts.length - 1;
      TreeNode next = findChild(cur, v);
      if (next == null) {
        next = new TreeNode(last ? "jar" : "dir", seg, v);
        cur.getChildren().add(next);
      } else if (last && "file".equals(next.getType())) {
        next.setType("jar");
      }
      next.setLeftExists(next.isLeftExists() || leftExists);
      next.setRightExists(next.isRightExists() || rightExists);
      cur = next;
    }

    String[] innerParts = inner.split("/");
    StringBuilder innerBuilt = new StringBuilder();
    for (int i = 0; i < innerParts.length; i++) {
      String seg = innerParts[i];
      if (innerBuilt.length() > 0) innerBuilt.append("/");
      innerBuilt.append(seg);
      String v = outer + "!/" + innerBuilt;
      boolean last = i == innerParts.length - 1;
      TreeNode next = findChild(cur, v);
      if (next == null) {
        next = new TreeNode(last ? "file" : "dir", seg, v);
        cur.getChildren().add(next);
      }
      if (last) {
        next.setLeftExists(leftExists);
        next.setRightExists(rightExists);
        next.setRightStatus(rightStatus);
      } else {
        next.setLeftExists(next.isLeftExists() || leftExists);
        next.setRightExists(next.isRightExists() || rightExists);
      }
      cur = next;
    }
  }

  private void indexInnerJar(String outerJarEntryName, byte[] jarBytes, Map<String, EntryMeta> files, CompareOptions options) throws IOException {
    if (jarBytes == null || jarBytes.length == 0) return;
    try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(jarBytes))) {
      ZipEntry e;
      byte[] buf = new byte[1024 * 16];
      while ((e = zis.getNextEntry()) != null) {
        if (e.isDirectory()) continue;
        String innerName = normalize(e.getName());
        if (innerName.isEmpty()) continue;
        String fullName = outerJarEntryName + "!/" + innerName;
        CRC32 crc32 = new CRC32();
        long size = 0;
        int read;
        while ((read = zis.read(buf)) >= 0) {
          if (read == 0) continue;
          size += read;
          crc32.update(buf, 0, read);
        }
        if (!filterByOptions(fullName, options)) continue;
        files.put(fullName, new EntryMeta(fullName, size, crc32.getValue()));
      }
    }
  }

  private byte[] readAll(InputStream in) throws IOException {
    byte[] buf = new byte[1024 * 64];
    int read;
    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    while ((read = in.read(buf)) >= 0) {
      if (read > 0) out.write(buf, 0, read);
    }
    return out.toByteArray();
  }

  private void sortChildren(TreeNode node) {
    if (node.getChildren() == null) return;
    node.getChildren().sort(Comparator
        .comparing((TreeNode n) -> !("dir".equals(n.getType()) || "jar".equals(n.getType())))
        .thenComparing(TreeNode::getLabel, String::compareToIgnoreCase));
    for (TreeNode c : node.getChildren()) sortChildren(c);
  }

  private TreeNode findChild(TreeNode parent, String value) {
    for (TreeNode c : parent.getChildren()) {
      if (value.equals(c.getValue())) return c;
    }
    return null;
  }

  private boolean isBootLibJar(String path) {
    return path != null && path.startsWith("BOOT-INF/lib/") && path.toLowerCase().endsWith(".jar");
  }

  private boolean filterByOptions(String path, CompareOptions options) {
    if (path == null) return false;
    if (isIgnored(path, options)) return false;
    if (path.startsWith("BOOT-INF/lib/")) return options.isIncludeLib();
    if (path.startsWith("BOOT-INF/classes/")) return options.isIncludeClasses() || options.isIncludeResources();
    return true;
  }

  private boolean isIgnored(String path, CompareOptions options) {
    if (options == null) return false;
    String[] globs = options.getIgnoreGlobs();
    if (globs == null || globs.length == 0) return false;
    String p = normalize(path);
    String inner = null;
    int idx = p.indexOf("!/");
    if (idx >= 0 && idx + 2 < p.length()) inner = p.substring(idx + 2);
    for (String g : globs) {
      if (g == null) continue;
      String gg = g.trim();
      if (gg.isEmpty()) continue;
      if (matchesGlob(gg, p)) return true;
      if (inner != null && matchesGlob(gg, inner)) return true;
    }
    return false;
  }

  private boolean matchesGlob(String glob, String text) {
    if (glob == null) return false;
    if (text == null) return false;
    String g = glob.replace("\\", "/").trim();
    String t = text.replace("\\", "/");
    int gi = 0;
    int ti = 0;
    int star = -1;
    int mark = -1;
    while (ti < t.length()) {
      if (gi < g.length()) {
        char gc = g.charAt(gi);
        if (gc == '?') {
          gi++;
          ti++;
          continue;
        }
        if (gc == '*') {
          while (gi + 1 < g.length() && g.charAt(gi + 1) == '*') gi++;
          star = gi++;
          mark = ti;
          continue;
        }
        if (gc == t.charAt(ti)) {
          gi++;
          ti++;
          continue;
        }
      }
      if (star != -1) {
        gi = star + 1;
        ti = ++mark;
        continue;
      }
      return false;
    }
    while (gi < g.length() && g.charAt(gi) == '*') gi++;
    return gi == g.length();
  }

  private String normalize(String name) {
    if (name == null) return "";
    if (name.startsWith("/")) return name.substring(1);
    return name;
  }

  private Path saveTemp(MultipartFile file) throws IOException {
    String suffix = ".jar";
    Path tmp = Files.createTempFile("jardiff_", suffix);
    try (InputStream in = new BufferedInputStream(file.getInputStream())) {
      Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
    }
    return tmp;
  }

  private void safeDelete(Path p) {
    try {
      Files.deleteIfExists(p);
    } catch (IOException ignored) {
    }
  }

  private String safeName(MultipartFile f) {
    String name = f.getOriginalFilename();
    if (name == null || name.trim().isEmpty()) return "unknown.jar";
    int idx = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
    return idx >= 0 ? name.substring(idx + 1) : name;
  }

  private static class CompareIndex {
    private final Path jarPath;
    private final Map<String, EntryMeta> files;

    private CompareIndex(Path jarPath, Map<String, EntryMeta> files) {
      this.jarPath = jarPath;
      this.files = files;
    }
  }

  private static class EntryMeta {
    private final String name;
    private final long size;
    private final long crc;

    private EntryMeta(String name, long size, long crc) {
      this.name = name;
      this.size = size;
      this.crc = crc;
    }

    @Override
    public boolean equals(Object o) {
      if (this == o) return true;
      if (!(o instanceof EntryMeta)) return false;
      EntryMeta that = (EntryMeta) o;
      return size == that.size && crc == that.crc && Objects.equals(name, that.name);
    }

    @Override
    public int hashCode() {
      return Objects.hash(name, size, crc);
    }
  }

  private static class StatsCounter {
    int added;
    int missing;
    int modified;
    int unchanged;

    Stats toStats() {
      return new Stats(added, missing, modified, unchanged);
    }
  }

  private static class CompareResultWithStats {
    final List<TreeNode> tree;
    final Stats stats;

    private CompareResultWithStats(List<TreeNode> tree, Stats stats) {
      this.tree = tree;
      this.stats = stats;
    }
  }
}
