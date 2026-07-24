package com.example.jardiff.core;

// [AGC:FILE] tool=Cc author=maxwell date=2026-07-24

import com.github.difflib.DiffUtils;
import com.github.difflib.UnifiedDiffUtils;
import com.github.difflib.patch.AbstractDelta;
import com.github.difflib.patch.Patch;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.ZipInputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.HashMap;
import java.util.List;
import java.util.Set;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.io.ByteArrayInputStream;
import java.util.zip.CRC32;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class JarDiffService {
  private static final Logger log = LoggerFactory.getLogger(JarDiffService.class);
  private final CompareStore compareStore;
  private final AsmDecompileService asmDecompileService;
  private final ProcyonDecompileService procyonDecompileService;
  private final DigestService digestService;
  private final ExecutorService warmupPool =
      Executors.newSingleThreadExecutor(
          new ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
              Thread t = new Thread(r);
              t.setName("jardiff-warmup");
              t.setDaemon(true);
              t.setPriority(Thread.MIN_PRIORITY);
              return t;
            }
          });
  private static final long MAX_TEXT_DIFF_BYTES = 1024L * 1024L * 2L;
  private static final long MAX_CLASS_DIFF_BYTES = 1024L * 1024L * 2L;
  private static final long MAX_NESTED_CONTAINER_BYTES = 1024L * 1024L * 50L;
  private static final long MAX_NESTED_CLASS_INDEX_BYTES = 1024L * 1024L * 16L;
  private static final long MAX_NESTED_EXTRACT_BYTES = 1024L * 1024L * 300L;

  public JarDiffService(
      CompareStore compareStore,
      AsmDecompileService asmDecompileService,
      ProcyonDecompileService procyonDecompileService,
      DigestService digestService) {
    this.compareStore = compareStore;
    this.asmDecompileService = asmDecompileService;
    this.procyonDecompileService = procyonDecompileService;
    this.digestService = digestService;
  }

  /**
   * 生成指定文件路径的差异结果，支持内嵌 jar 路径（形如：BOOT-INF/lib/a.jar!/path/in/jar）。
   */
  public DiffResult diff(String id, String path) {
    StoredCompare stored = compareStore.get(id).orElseThrow(() -> new IllegalArgumentException("compare not found"));
    String p = normalize(path);
    DiffResult cached = stored.getCachedDiff(p);
    if (cached != null) {
      log.info("diff cache hit id={} path={}", id, p);
      return cached;
    }
    log.info("diff cache miss id={} path={}", id, p);
    DiffResult computed;
    try (ZipFile leftZip = new ZipFile(stored.getLeftJarPath().toFile());
        ZipFile rightZip = new ZipFile(stored.getRightJarPath().toFile())) {
      computed = computeDiff(stored, p, leftZip, rightZip);
    } catch (IOException e) {
      computed = computeDiff(stored, p, null, null);
    }
    stored.putCachedDiff(p, computed);
    log.info(
        "diff computed id={} path={} kind={} fileType={} missingLeft={} missingRight={}",
        id,
        p,
        computed == null ? "" : computed.getKind(),
        computed == null ? "" : computed.getFileType(),
        computed != null && computed.isMissingLeft(),
        computed != null && computed.isMissingRight());
    return computed;
  }

  // [AGC:START] tool=Cc author=maxwell date=2026-07-24
  /**
   * 从已有比对会话中取出 diff 结果，用 java-diff-utils 生成 unified diff 文本。
   * 非文本文件（kind != "text"）或无结果时返回 null。
   */
  public String generateUnifiedDiff(String id, String path) {
    DiffResult result = diff(id, path);
    if (result == null || !"text".equals(result.getKind())) {
      return null;
    }
    List<String> leftLines = result.getLeft() != null ? result.getLeft() : Collections.emptyList();
    List<String> rightLines = result.getRight() != null ? result.getRight() : Collections.emptyList();
    Patch<String> patch = DiffUtils.diff(leftLines, rightLines);
    List<String> unified = UnifiedDiffUtils.generateUnifiedDiff(
        "a/" + path, "b/" + path, leftLines, patch, 3);
    return unified.isEmpty() ? null : String.join("\n", unified);
  }

  /**
   * 直接从两段文本生成 unified diff，不需要比对会话。
   */
  public String unifiedDiff(String leftText, String rightText) {
    if (leftText == null) leftText = "";
    if (rightText == null) rightText = "";
    List<String> leftLines = Arrays.asList(leftText.split("\n", -1));
    List<String> rightLines = Arrays.asList(rightText.split("\n", -1));
    Patch<String> patch = DiffUtils.diff(leftLines, rightLines);
    List<String> unified = UnifiedDiffUtils.generateUnifiedDiff("a/file", "b/file", leftLines, patch, 3);
    return unified.isEmpty() ? null : String.join("\n", unified);
  }
  // [AGC:END]

  public StoredCompare.WarmupStatus warmDiffs(String id, int limit) {
    StoredCompare stored = compareStore.get(id).orElseThrow(() -> new IllegalArgumentException("compare not found"));
    StoredCompare.WarmupStatus s = stored.getWarmupStatus();
    if (s.isRunning()) return s;

    int lim = limit <= 0 ? 300 : Math.min(limit, 1200);
    List<String> all = collectChangedPaths(stored.getTree(), lim);
    log.info("warmDiffs start id={} requestLimit={} paths={}", id, limit, all.size());
    s.setRunning(true);
    s.setTotal(all.size());
    s.setDone(0);
    s.setSkipped(0);
    s.setFailed(0);
    s.setMessage("");
    s.setStartedAtMs(System.currentTimeMillis());
    s.setFinishedAtMs(0);

    warmupPool.submit(() -> {
      int done = 0;
      int skipped = 0;
      int failed = 0;
      try (ZipFile leftZip = new ZipFile(stored.getLeftJarPath().toFile());
          ZipFile rightZip = new ZipFile(stored.getRightJarPath().toFile())) {
        for (String p : all) {
          if (p == null || p.isEmpty()) {
            skipped += 1;
            continue;
          }
          try {
            String key = normalize(p);
            if (stored.getCachedDiff(key) != null) {
              done += 1;
              s.setDone(done);
              continue;
            }
            DiffResult d = computeDiff(stored, key, leftZip, rightZip);
            stored.putCachedDiff(key, d);
            done += 1;
            s.setDone(done);
            if ((done & 15) == 0) {
              try {
                Thread.sleep(3L);
              } catch (InterruptedException ignored) {
              }
            }
          } catch (Exception ex) {
            failed += 1;
            s.setFailed(failed);
          }
        }
      } catch (Exception ex) {
        for (String p : all) {
          if (p == null || p.isEmpty()) {
            skipped += 1;
            continue;
          }
          try {
            String key = normalize(p);
            if (stored.getCachedDiff(key) != null) {
              done += 1;
              s.setDone(done);
              continue;
            }
            DiffResult d = computeDiff(stored, key, null, null);
            stored.putCachedDiff(key, d);
            done += 1;
            s.setDone(done);
          } catch (Exception e) {
            failed += 1;
            s.setFailed(failed);
          }
        }
      }
      s.setSkipped(skipped);
      s.setRunning(false);
      s.setFinishedAtMs(System.currentTimeMillis());
      log.info("warmDiffs done id={} total={} done={} skipped={} failed={}", id, s.getTotal(), done, skipped, failed);
    });
    return s;
  }

  public StoredCompare.WarmupStatus warmStatus(String id) {
    StoredCompare stored = compareStore.get(id).orElseThrow(() -> new IllegalArgumentException("compare not found"));
    return stored.getWarmupStatus();
  }

  private DiffResult computeDiff(StoredCompare stored, String p, ZipFile leftZip, ZipFile rightZip) {
    NestedPath nested = parseNested(p);
    byte[] leftBytes;
    byte[] rightBytes;
    String kindPath;
    ZipFile leftNestedZip = null;
    ZipFile rightNestedZip = null;
    if (nested != null) {
      try {
        leftNestedZip = openNestedZip(stored, true, leftZip, stored.getLeftJarPath(), nested.outerEntry);
        rightNestedZip = openNestedZip(stored, false, rightZip, stored.getRightJarPath(), nested.outerEntry);
        leftBytes = readEntryBytesFromZip(leftNestedZip, nested.innerEntry);
        rightBytes = readEntryBytesFromZip(rightNestedZip, nested.innerEntry);
        kindPath = nested.innerEntry;
      } finally {
        if (leftNestedZip != null) {
          try {
            leftNestedZip.close();
          } catch (IOException ignored) {
          }
        }
        if (rightNestedZip != null) {
          try {
            rightNestedZip.close();
          } catch (IOException ignored) {
          }
        }
      }
    } else {
      leftBytes = readEntryBytes(leftZip, stored.getLeftJarPath(), p).orElse(null);
      rightBytes = readEntryBytes(rightZip, stored.getRightJarPath(), p).orElse(null);
      kindPath = p;
    }

    boolean leftExists = leftBytes != null;
    boolean rightExists = rightBytes != null;

    DiffResult out = new DiffResult();
    out.setLeftName("左侧基准");
    out.setRightName(rightExists ? "右侧目标" : "右侧目标（缺失）");
    out.setMissingLeft(!leftExists);
    out.setMissingRight(!rightExists);
    out.setNested(nested != null);
    if (nested != null) {
      out.setContainerEntry(nested.outerEntry);
      out.setInnerPath(nested.innerEntry);
    }
    out.setFileType(detectFileType(nested != null ? (nested.outerEntry + "!/" + nested.innerEntry) : p, leftBytes != null ? leftBytes : rightBytes));
    out.setLeftMeta(buildMeta(leftBytes));
    out.setRightMeta(buildMeta(rightBytes));

    if (isClass(kindPath)) {
      long lb = leftBytes == null ? 0 : leftBytes.length;
      long rb = rightBytes == null ? 0 : rightBytes.length;
      if (lb > MAX_CLASS_DIFF_BYTES || rb > MAX_CLASS_DIFF_BYTES) {
        out.setKind("binary");
        out.setMessage("class 文件过大，已跳过反编译差异（仅展示摘要）。");
        return out;
      }
      try {
        out.setKind("text");
        AsmDecompileService.SignatureSnapshot leftSig = leftExists ? asmDecompileService.extractSignature(leftBytes) : null;
        AsmDecompileService.SignatureSnapshot rightSig = rightExists ? asmDecompileService.extractSignature(rightBytes) : null;
        List<String> left;
        List<String> right;
        if (nested == null) {
          left = leftExists ? decompileWithZip(leftZip, stored.getLeftJarPath(), leftBytes) : Collections.emptyList();
          right = rightExists ? decompileWithZip(rightZip, stored.getRightJarPath(), rightBytes) : Collections.emptyList();
        } else {
          ZipFile lz = null;
          ZipFile rz = null;
          try {
            lz = openNestedZip(stored, true, leftZip, stored.getLeftJarPath(), nested.outerEntry);
            rz = openNestedZip(stored, false, rightZip, stored.getRightJarPath(), nested.outerEntry);
            ProcyonDecompileService.ClassBytesProvider leftProvider = lz == null ? null : buildProviderFromZip(lz);
            ProcyonDecompileService.ClassBytesProvider rightProvider = rz == null ? null : buildProviderFromZip(rz);
            left = leftExists ? splitLines(procyonDecompileService.decompileToText(leftBytes, leftProvider)) : Collections.emptyList();
            right = rightExists ? splitLines(procyonDecompileService.decompileToText(rightBytes, rightProvider)) : Collections.emptyList();
          } finally {
            if (lz != null) {
              try {
                lz.close();
              } catch (IOException ignored) {
              }
            }
            if (rz != null) {
              try {
                rz.close();
              } catch (IOException ignored) {
              }
            }
          }
        }
        out.setLeft(left);
        out.setRight(right);
        Patch<String> patch = DiffUtils.diff(left, right);
        out.setHighlights(buildHighlights(patch));
        AlignedRowsWithHunks aligned = buildAlignedRowsAndHunks(left, right, patch, 3);
        out.setRows(aligned.rows);
        out.setHunks(aligned.hunks);
        out.setClassSummary(buildClassSummary(leftSig, rightSig));
        return out;
      } catch (Exception ex) {
        out.setKind("binary");
        out.setMessage("class 解析失败，无法生成文本差异：" + safeMessage(ex));
        return out;
      }
    }

    if (looksText(kindPath)) {
      long lb = leftBytes == null ? 0 : leftBytes.length;
      long rb = rightBytes == null ? 0 : rightBytes.length;
      if (lb > MAX_TEXT_DIFF_BYTES || rb > MAX_TEXT_DIFF_BYTES) {
        out.setKind("binary");
        out.setMessage("文本文件过大，已跳过逐行差异（仅展示摘要）。");
        return out;
      }
      out.setKind("text");
      List<String> left = leftExists ? splitLines(toText(leftBytes)) : Collections.emptyList();
      List<String> right = rightExists ? splitLines(toText(rightBytes)) : Collections.emptyList();
      out.setLeft(left);
      out.setRight(right);
      Patch<String> patch = DiffUtils.diff(left, right);
      out.setHighlights(buildHighlights(patch));
      AlignedRowsWithHunks aligned = buildAlignedRowsAndHunks(left, right, patch, 3);
      out.setRows(aligned.rows);
      out.setHunks(aligned.hunks);
      return out;
    }

    out.setKind("binary");
    String msg;
    if (!rightExists) msg = "右侧缺失：仅左侧基准存在。";
    else if (!leftExists) msg = "左侧缺失：仅右侧目标存在。";
    else if ("jar".equals(out.getFileType()) || "zip".equals(out.getFileType())) {
      boolean deep = stored != null && stored.getOptions() != null && stored.getOptions().isDeepCompareLib();
      boolean isNestedPath = nested != null;
      if (!deep && !isNestedPath && kindPath != null && kindPath.startsWith("BOOT-INF/lib/") && kindPath.toLowerCase().endsWith(".jar")) {
        msg = "依赖 jar 文件：当前比对未开启“依赖 jar 深度比对”，因此无法展开查看内部文件差异。请在设置中勾选“依赖 jar 深度比对”后重新比对。";
      } else {
        msg = "压缩包文件：本体不反编译。请在结构中展开并点击内部 .class/.xml/.js/.html 等文件查看文本差异。";
      }
    }
    else msg = "二进制文件差异：建议展示 MD5/大小/文件头摘要；如需深入可做结构或反编译对比。";
    out.setMessage(msg);
    return out;
  }

  /**
   * 提取异常信息用于前端展示，避免出现 null。
   */
  private String safeMessage(Exception ex) {
    if (ex == null) return "未知错误";
    String m = ex.getMessage();
    String t = ex.getClass().getSimpleName();
    if (m == null || m.trim().isEmpty()) return t;
    return t + ": " + m;
  }

  private DiffResult.ClassSignatureSummary buildClassSummary(AsmDecompileService.SignatureSnapshot left, AsmDecompileService.SignatureSnapshot right) {
    Set<String> lf = left == null ? new HashSet<>() : new HashSet<>(left.getFields());
    Set<String> rf = right == null ? new HashSet<>() : new HashSet<>(right.getFields());
    Set<String> lm = left == null ? new HashSet<>() : new HashSet<>(left.getMethods());
    Set<String> rm = right == null ? new HashSet<>() : new HashSet<>(right.getMethods());

    Set<String> addedF = new HashSet<>(rf);
    addedF.removeAll(lf);
    Set<String> removedF = new HashSet<>(lf);
    removedF.removeAll(rf);
    Set<String> addedM = new HashSet<>(rm);
    addedM.removeAll(lm);
    Set<String> removedM = new HashSet<>(lm);
    removedM.removeAll(rm);

    DiffResult.ClassSignatureSummary s = new DiffResult.ClassSignatureSummary();
    s.setAddedFields(addedF.size());
    s.setRemovedFields(removedF.size());
    s.setAddedMethods(addedM.size());
    s.setRemovedMethods(removedM.size());
    s.setSampleAdded(sampleFirst(addedF, 8));
    s.setSampleRemoved(sampleFirst(removedF, 8));
    List<String> methodAdds = sampleFirst(addedM, 8);
    if (!methodAdds.isEmpty()) {
      List<String> all = new ArrayList<>();
      all.addAll(s.getSampleAdded());
      all.addAll(methodAdds);
      s.setSampleAdded(all);
    }
    List<String> methodRem = sampleFirst(removedM, 8);
    if (!methodRem.isEmpty()) {
      List<String> all = new ArrayList<>();
      all.addAll(s.getSampleRemoved());
      all.addAll(methodRem);
      s.setSampleRemoved(all);
    }
    return s;
  }

  private ProcyonDecompileService.ClassBytesProvider buildProvider(
      StoredCompare stored, NestedPath nested, boolean isLeft, byte[] containerJarBytes) {
    HashMap<String, byte[]> hit = new HashMap<>();
    HashSet<String> miss = new HashSet<>();
    return (internalName) -> {
      if (internalName == null || internalName.trim().isEmpty()) return null;
      String key = internalName;
      byte[] cached = hit.get(key);
      if (cached != null) return cached;
      if (miss.contains(key)) return null;

      String entryName = normalize(key + ".class");
      Optional<byte[]> bytes;
      if (nested != null && containerJarBytes != null) {
        bytes = readNestedEntryBytes(containerJarBytes, entryName);
      } else {
        Path jarPath = isLeft ? stored.getLeftJarPath() : stored.getRightJarPath();
        bytes = readEntryBytes(null, jarPath, entryName);
      }

      byte[] out = bytes.orElse(null);
      if (out == null || out.length == 0) {
        miss.add(key);
        return null;
      }
      hit.put(key, out);
      return out;
    };
  }

  private ProcyonDecompileService.ClassBytesProvider buildProviderFromNestedIndex(HashMap<String, byte[]> index) {
    if (index == null) return (internalName) -> null;
    HashMap<String, byte[]> hit = new HashMap<>();
    HashSet<String> miss = new HashSet<>();
    return (internalName) -> {
      if (internalName == null || internalName.trim().isEmpty()) return null;
      String key = internalName;
      byte[] cached = hit.get(key);
      if (cached != null) return cached;
      if (miss.contains(key)) return null;
      String entryName = normalize(key + ".class");
      byte[] out = index.get(entryName);
      if (out == null || out.length == 0) {
        miss.add(key);
        return null;
      }
      hit.put(key, out);
      return out;
    };
  }

  private List<String> decompileWithZip(ZipFile zip, Path jarPath, byte[] classBytes) throws IOException {
    if (jarPath == null || classBytes == null) return Collections.emptyList();
    ZipFile use = zip;
    boolean needClose = false;
    if (use == null) {
      use = new ZipFile(jarPath.toFile());
      needClose = true;
    }
    try {
      ProcyonDecompileService.ClassBytesProvider provider = buildProviderFromZip(use);
      String txt = procyonDecompileService.decompileToText(classBytes, provider);
      return splitLines(txt);
    } finally {
      if (needClose) {
        try {
          use.close();
        } catch (IOException ignored) {
        }
      }
    }
  }

  private ProcyonDecompileService.ClassBytesProvider buildProviderFromZip(ZipFile zip) {
    HashMap<String, byte[]> hit = new HashMap<>();
    HashSet<String> miss = new HashSet<>();
    return (internalName) -> {
      if (internalName == null || internalName.trim().isEmpty()) return null;
      String key = internalName;
      byte[] cached = hit.get(key);
      if (cached != null) return cached;
      if (miss.contains(key)) return null;
      String entryName = normalize(key + ".class");
      ZipEntry e = zip.getEntry(entryName);
      if (e == null) {
        miss.add(key);
        return null;
      }
      try (InputStream in = zip.getInputStream(e)) {
        byte[] out = readAll(in);
        if (out == null || out.length == 0) {
          miss.add(key);
          return null;
        }
        hit.put(key, out);
        return out;
      } catch (IOException ex) {
        miss.add(key);
        return null;
      }
    };
  }

  private static class NestedJarScan {
    final byte[] targetBytes;
    final HashMap<String, byte[]> classEntries;

    private NestedJarScan(byte[] targetBytes, HashMap<String, byte[]> classEntries) {
      this.targetBytes = targetBytes;
      this.classEntries = classEntries;
    }
  }

  private NestedJarScan scanNestedJar(byte[] jarBytes, String wantEntry, boolean indexClasses) {
    if (jarBytes == null || jarBytes.length == 0) return new NestedJarScan(null, null);
    String want = normalize(wantEntry);
    byte[] target = null;
    HashMap<String, byte[]> classes = indexClasses ? new HashMap<>() : null;
    long indexedBytes = 0;
    try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(jarBytes))) {
      ZipEntry e;
      while ((e = zis.getNextEntry()) != null) {
        if (e.isDirectory()) continue;
        String n = normalize(e.getName());
        boolean isTarget = want.equals(n);
        boolean isClass = indexClasses && n.toLowerCase().endsWith(".class");
        if (!isTarget && !isClass) continue;
        byte[] bytes = readAll(zis);
        if (isTarget) target = bytes;
        if (isClass && classes != null && bytes != null && bytes.length > 0) {
          if (indexedBytes + bytes.length <= MAX_NESTED_CLASS_INDEX_BYTES) {
            classes.put(n, bytes);
            indexedBytes += bytes.length;
          }
        }
      }
    } catch (IOException ignored) {
    }
    return new NestedJarScan(target, classes);
  }

  private List<String> collectChangedPaths(List<TreeNode> nodes, int limit) {
    List<String> out = new ArrayList<>();
    walkChanged(nodes, out, limit);
    return out;
  }

  private void walkChanged(List<TreeNode> nodes, List<String> out, int limit) {
    if (nodes == null || out == null) return;
    for (TreeNode n : nodes) {
      if (n == null) continue;
      if (out.size() >= limit) return;
      if ("file".equals(n.getType())) {
        String s = n.getRightStatus();
        if (s != null && !"unchanged".equals(s)) {
          String p = n.getValue() == null ? "" : n.getValue();
          if (!p.isEmpty()) out.add(p);
        }
      }
      if (n.getChildren() != null && !n.getChildren().isEmpty()) {
        walkChanged(n.getChildren(), out, limit);
        if (out.size() >= limit) return;
      }
    }
  }

  private List<String> sampleFirst(Set<String> set, int limit) {
    if (set == null || set.isEmpty() || limit <= 0) return new ArrayList<>();
    List<String> all = new ArrayList<>(set);
    all.sort(String::compareTo);
    if (all.size() <= limit) return all;
    return new ArrayList<>(all.subList(0, limit));
  }

  private static class NestedPath {
    final String outerEntry;
    final String innerEntry;

    private NestedPath(String outerEntry, String innerEntry) {
      this.outerEntry = outerEntry;
      this.innerEntry = innerEntry;
    }
  }

  private NestedPath parseNested(String path) {
    if (path == null) return null;
    int idx = path.indexOf("!/");
    if (idx < 0) return null;
    String outer = path.substring(0, idx);
    String inner = path.substring(idx + 2);
    outer = normalize(outer);
    inner = normalize(inner);
    if (outer.isEmpty() || inner.isEmpty()) return null;
    return new NestedPath(outer, inner);
  }

  private Optional<byte[]> readNestedEntryBytes(byte[] jarBytes, String innerEntryName) {
    if (jarBytes == null || jarBytes.length == 0) return Optional.empty();
    String want = normalize(innerEntryName);
    if (want.isEmpty()) return Optional.empty();
    try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(jarBytes))) {
      ZipEntry e;
      while ((e = zis.getNextEntry()) != null) {
        if (e.isDirectory()) continue;
        String n = normalize(e.getName());
        if (!want.equals(n)) continue;
        return Optional.of(readAll(zis));
      }
      return Optional.empty();
    } catch (IOException ex) {
      return Optional.empty();
    }
  }

  private Optional<byte[]> readEntryBytes(ZipFile zip, Path jarPath, String entryName) {
    if (jarPath == null || entryName == null) return Optional.empty();
    ZipFile use = zip;
    boolean needClose = false;
    try {
      if (use == null) {
        use = new ZipFile(jarPath.toFile());
        needClose = true;
      }
      ZipEntry e = use.getEntry(entryName);
      if (e == null) return Optional.empty();
      try (InputStream in = use.getInputStream(e)) {
        return Optional.of(readAll(in));
      }
    } catch (IOException ex) {
      return Optional.empty();
    } finally {
      if (needClose && use != null) {
        try {
          use.close();
        } catch (IOException ignored) {
        }
      }
    }
  }

  private byte[] readEntryBytesFromZip(ZipFile zip, String entryName) {
    if (zip == null || entryName == null) return null;
    ZipEntry e = zip.getEntry(normalize(entryName));
    if (e == null || e.isDirectory()) return null;
    try (InputStream in = zip.getInputStream(e)) {
      return readAll(in);
    } catch (IOException ex) {
      return null;
    }
  }

  private ZipFile openNestedZip(StoredCompare stored, boolean isLeft, ZipFile outerZip, Path outerPath, String outerEntry) {
    if (stored == null || outerPath == null || outerEntry == null) return null;
    String outer = normalize(outerEntry);
    if (outer.isEmpty()) return null;
    String cacheKey = (isLeft ? "L:" : "R:") + outer;
    Path extracted = stored.getExtracted(cacheKey);
    if (extracted != null && Files.exists(extracted)) {
      try {
        return new ZipFile(extracted.toFile());
      } catch (IOException ignored) {
      }
    }
    try {
      Path created = extractNestedJarToTemp(stored, cacheKey, outerZip, outerPath, outer);
      if (created == null) return null;
      return new ZipFile(created.toFile());
    } catch (IOException ignored) {
      return null;
    }
  }

  private Path extractNestedJarToTemp(StoredCompare stored, String cacheKey, ZipFile outerZip, Path outerPath, String outerEntry)
      throws IOException {
    if (stored == null || cacheKey == null || outerPath == null || outerEntry == null) return null;
    synchronized (stored) {
      Path cached = stored.getExtracted(cacheKey);
      if (cached != null && Files.exists(cached)) return cached;
      if (stored.extractedCount() >= 4) {
        Path evicted = stored.removeAnyExtracted();
        if (evicted != null) {
          try {
            Files.deleteIfExists(evicted);
          } catch (IOException ignored) {
          }
        }
      }
      ZipFile use = outerZip;
      boolean needClose = false;
      try {
        if (use == null) {
          use = new ZipFile(outerPath.toFile());
          needClose = true;
        }
        ZipEntry e = use.getEntry(normalize(outerEntry));
        if (e == null || e.isDirectory()) return null;
        long sz = e.getSize();
        if (sz > 0 && sz > MAX_NESTED_EXTRACT_BYTES) return null;
        Path tmp = Files.createTempFile("jardiff_nested_", ".jar");
        try (InputStream in = use.getInputStream(e)) {
          Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException ex) {
          try {
            Files.deleteIfExists(tmp);
          } catch (IOException ignored) {
          }
          throw ex;
        }
        stored.putExtracted(cacheKey, tmp);
        return tmp;
      } finally {
        if (needClose && use != null) {
          try {
            use.close();
          } catch (IOException ignored) {
          }
        }
      }
    }
  }

  private DiffResult.FileSideMeta buildMeta(byte[] bytes) {
    if (bytes == null) return null;
    CRC32 crc32 = new CRC32();
    crc32.update(bytes);
    return new DiffResult.FileSideMeta((long) bytes.length, digestService.md5(bytes), crc32.getValue());
  }

  private String detectFileType(String path, byte[] bytes) {
    String p = path == null ? "" : path.toLowerCase();
    if (p.endsWith(".class")) return "class";
    if (p.endsWith(".jar")) return "jar";
    if (p.endsWith(".zip")) return "zip";
    if (p.endsWith(".png")) return "png";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "jpg";
    if (p.endsWith(".gif")) return "gif";
    if (p.endsWith(".yml") || p.endsWith(".yaml") || p.endsWith(".xml") || p.endsWith(".properties") || p.endsWith(".json") || p.endsWith(".txt")
        || p.endsWith(".md") || p.endsWith(".html") || p.endsWith(".htm") || p.endsWith(".js") || p.endsWith(".css")) return "text";
    if (bytes != null && bytes.length >= 4) {
      if ((bytes[0] & 0xff) == 0x50 && (bytes[1] & 0xff) == 0x4b) return "zip";
      if ((bytes[0] & 0xff) == 0xca && (bytes[1] & 0xff) == 0xfe && (bytes[2] & 0xff) == 0xba && (bytes[3] & 0xff) == 0xbe) return "class";
    }
    return "binary";
  }

  private byte[] readAll(InputStream in) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[1024 * 64];
    int read;
    while ((read = in.read(buf)) >= 0) {
      if (read > 0) out.write(buf, 0, read);
    }
    return out.toByteArray();
  }

  private List<String> splitLines(String text) {
    if (text == null || text.isEmpty()) return new ArrayList<>();
    String[] arr = text.replace("\r\n", "\n").replace("\r", "\n").split("\n", -1);
    List<String> out = new ArrayList<>(arr.length);
    Collections.addAll(out, arr);
    return out;
  }

  private String toText(byte[] bytes) {
    if (bytes == null) return "";
    String utf8 = new String(bytes, StandardCharsets.UTF_8);
    if (utf8.contains("\uFFFD")) {
      return new String(bytes, Charset.forName("ISO-8859-1"));
    }
    return utf8;
  }

  private List<DiffResult.Highlight> buildHighlights(Patch<String> patch) {
    List<DiffResult.Highlight> hs = new ArrayList<>();
    if (patch == null) return hs;
    for (AbstractDelta<String> delta : patch.getDeltas()) {
      String type = delta.getType().name();
      int srcPos = delta.getSource().getPosition();
      int tgtPos = delta.getTarget().getPosition();
      int srcSize = delta.getSource().getLines() == null ? 0 : delta.getSource().getLines().size();
      int tgtSize = delta.getTarget().getLines() == null ? 0 : delta.getTarget().getLines().size();

      if ("INSERT".equals(type)) {
        for (int i = 1; i <= Math.max(1, tgtSize); i++) {
          hs.add(new DiffResult.Highlight("right", tgtPos + i, "add"));
        }
      } else if ("DELETE".equals(type)) {
        for (int i = 1; i <= Math.max(1, srcSize); i++) {
          hs.add(new DiffResult.Highlight("left", srcPos + i, "del"));
        }
      } else {
        int max = Math.max(Math.max(1, srcSize), Math.max(1, tgtSize));
        for (int i = 1; i <= max; i++) {
          if (srcSize > 0) hs.add(new DiffResult.Highlight("left", srcPos + i, "mod"));
          if (tgtSize > 0) hs.add(new DiffResult.Highlight("right", tgtPos + i, "mod"));
        }
      }
    }
    return hs;
  }

  private static class AlignedRowsWithHunks {
    private final List<DiffResult.Row> rows;
    private final List<DiffResult.Hunk> hunks;

    private AlignedRowsWithHunks(List<DiffResult.Row> rows, List<DiffResult.Hunk> hunks) {
      this.rows = rows;
      this.hunks = hunks;
    }
  }

  private static class ChangeRange {
    private final int startRow;
    private final int endRow;
    private final int leftStart;
    private final int leftEnd;
    private final int rightStart;
    private final int rightEnd;

    private ChangeRange(int startRow, int endRow, int leftStart, int leftEnd, int rightStart, int rightEnd) {
      this.startRow = startRow;
      this.endRow = endRow;
      this.leftStart = leftStart;
      this.leftEnd = leftEnd;
      this.rightStart = rightStart;
      this.rightEnd = rightEnd;
    }
  }

  private AlignedRowsWithHunks buildAlignedRowsAndHunks(List<String> left, List<String> right, Patch<String> patch, int contextLines) {
    List<DiffResult.Row> out = new ArrayList<>();
    List<ChangeRange> ranges = new ArrayList<>();
    if (patch == null) return new AlignedRowsWithHunks(out, Collections.emptyList());

    int srcPos = 0;
    int tgtPos = 0;
    int srcNo = 1;
    int tgtNo = 1;

    for (AbstractDelta<String> delta : patch.getDeltas()) {
      int sPos = delta.getSource().getPosition();
      int tPos = delta.getTarget().getPosition();

      while (srcPos < sPos || tgtPos < tPos) {
        boolean hasL = srcPos < sPos;
        boolean hasR = tgtPos < tPos;
        String l = hasL ? left.get(srcPos) : "";
        String r = hasR ? right.get(tgtPos) : "";
        Integer lno = hasL ? srcNo : null;
        Integer rno = hasR ? tgtNo : null;
        out.add(new DiffResult.Row(lno, rno, l, r));
        if (hasL) {
          srcPos += 1;
          srcNo += 1;
        }
        if (hasR) {
          tgtPos += 1;
          tgtNo += 1;
        }
      }

      int changeStart = out.size();

      String type = delta.getType().name();
      List<String> sLines = delta.getSource().getLines() == null ? Collections.emptyList() : delta.getSource().getLines();
      List<String> tLines = delta.getTarget().getLines() == null ? Collections.emptyList() : delta.getTarget().getLines();

      if ("INSERT".equals(type)) {
        int count = Math.max(1, tLines.size());
        for (int i = 0; i < count; i++) {
          String t = i < tLines.size() ? tLines.get(i) : "";
          out.add(new DiffResult.Row(null, tgtNo, "", t));
          if (i < tLines.size()) {
            tgtPos += 1;
            tgtNo += 1;
          }
        }
      } else if ("DELETE".equals(type)) {
        int count = Math.max(1, sLines.size());
        for (int i = 0; i < count; i++) {
          String s = i < sLines.size() ? sLines.get(i) : "";
          out.add(new DiffResult.Row(srcNo, null, s, ""));
          if (i < sLines.size()) {
            srcPos += 1;
            srcNo += 1;
          }
        }
      } else {
        int max = Math.max(1, Math.max(sLines.size(), tLines.size()));
        for (int i = 0; i < max; i++) {
          boolean hasL = i < sLines.size();
          boolean hasR = i < tLines.size();
          String l = hasL ? sLines.get(i) : "";
          String r = hasR ? tLines.get(i) : "";
          Integer lno = hasL ? srcNo : null;
          Integer rno = hasR ? tgtNo : null;
          out.add(new DiffResult.Row(lno, rno, l, r));
          if (hasL) {
            srcPos += 1;
            srcNo += 1;
          }
          if (hasR) {
            tgtPos += 1;
            tgtNo += 1;
          }
        }
      }

      int changeEnd = out.isEmpty() ? changeStart : out.size() - 1;
      int srcPos0 = delta.getSource().getPosition();
      int tgtPos0 = delta.getTarget().getPosition();
      int srcSize = delta.getSource().getLines() == null ? 0 : delta.getSource().getLines().size();
      int tgtSize = delta.getTarget().getLines() == null ? 0 : delta.getTarget().getLines().size();
      int leftStart = srcPos0 + 1;
      int leftEnd = srcPos0 + Math.max(1, srcSize);
      int rightStart = tgtPos0 + 1;
      int rightEnd = tgtPos0 + Math.max(1, tgtSize);
      ranges.add(new ChangeRange(changeStart, changeEnd, leftStart, leftEnd, rightStart, rightEnd));
    }

    while (srcPos < left.size() && tgtPos < right.size()) {
      out.add(new DiffResult.Row(srcNo, tgtNo, left.get(srcPos), right.get(tgtPos)));
      srcPos += 1;
      tgtPos += 1;
      srcNo += 1;
      tgtNo += 1;
    }

    while (srcPos < left.size()) {
      out.add(new DiffResult.Row(srcNo, null, left.get(srcPos), ""));
      srcPos += 1;
      srcNo += 1;
    }

    while (tgtPos < right.size()) {
      out.add(new DiffResult.Row(null, tgtNo, "", right.get(tgtPos)));
      tgtPos += 1;
      tgtNo += 1;
    }

    List<DiffResult.Hunk> hunks = buildHunksFromRanges(ranges, out.size(), contextLines);
    return new AlignedRowsWithHunks(out, hunks);
  }

  private List<DiffResult.Hunk> buildHunksFromRanges(List<ChangeRange> ranges, int rowCount, int contextLines) {
    if (ranges == null || ranges.isEmpty() || rowCount <= 0) return Collections.emptyList();
    int ctx = Math.max(0, contextLines);
    List<DiffResult.Hunk> out = new ArrayList<>();

    DiffResult.Hunk cur = null;
    for (ChangeRange r : ranges) {
      int start = Math.max(0, r.startRow - ctx);
      int end = Math.min(rowCount - 1, r.endRow + ctx);
      if (cur == null) {
        cur = new DiffResult.Hunk();
        cur.setStartRow(start);
        cur.setEndRow(end);
        cur.setChangeStartRow(r.startRow);
        cur.setChangeEndRow(r.endRow);
        cur.setLeftStart(r.leftStart);
        cur.setLeftEnd(r.leftEnd);
        cur.setRightStart(r.rightStart);
        cur.setRightEnd(r.rightEnd);
        continue;
      }

      if (start <= cur.getEndRow() + 1) {
        cur.setEndRow(Math.max(cur.getEndRow(), end));
        cur.setChangeStartRow(Math.min(cur.getChangeStartRow(), r.startRow));
        cur.setChangeEndRow(Math.max(cur.getChangeEndRow(), r.endRow));
        cur.setLeftStart(Math.min(cur.getLeftStart(), r.leftStart));
        cur.setLeftEnd(Math.max(cur.getLeftEnd(), r.leftEnd));
        cur.setRightStart(Math.min(cur.getRightStart(), r.rightStart));
        cur.setRightEnd(Math.max(cur.getRightEnd(), r.rightEnd));
      } else {
        out.add(cur);
        cur = new DiffResult.Hunk();
        cur.setStartRow(start);
        cur.setEndRow(end);
        cur.setChangeStartRow(r.startRow);
        cur.setChangeEndRow(r.endRow);
        cur.setLeftStart(r.leftStart);
        cur.setLeftEnd(r.leftEnd);
        cur.setRightStart(r.rightStart);
        cur.setRightEnd(r.rightEnd);
      }
    }

    if (cur != null) out.add(cur);
    for (int i = 0; i < out.size(); i++) out.get(i).setIndex(i);
    return out;
  }

  private boolean looksText(String path) {
    String p = path.toLowerCase();
    return p.endsWith(".yml") || p.endsWith(".yaml") || p.endsWith(".xml") || p.endsWith(".properties")
        || p.endsWith(".mf") || p.endsWith(".json") || p.endsWith(".txt") || p.endsWith(".md")
        || p.endsWith(".html") || p.endsWith(".htm") || p.endsWith(".js") || p.endsWith(".css")
        || p.endsWith(".java") || p.endsWith(".kt") || p.endsWith(".groovy") || p.endsWith(".scala");
  }

  private boolean isClass(String path) {
    return path != null && path.toLowerCase().endsWith(".class");
  }

  private String normalize(String name) {
    if (name == null) return "";
    if (name.startsWith("/")) return name.substring(1);
    return name;
  }
}
