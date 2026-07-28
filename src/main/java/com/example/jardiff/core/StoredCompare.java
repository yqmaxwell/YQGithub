package com.example.jardiff.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

public class StoredCompare {
  private final Path leftJarPath;
  private final Path rightJarPath;
  private final CompareOptions options;
  private final Instant createdAt;
  private volatile FileMeta leftMeta;
  private volatile FileMeta rightMeta;
  private volatile List<TreeNode> tree;
  private volatile Stats stats;
  private final ConcurrentHashMap<String, DiffResult> diffCache = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<String, Path> extractedCache = new ConcurrentHashMap<>();
  private final WarmupStatus warmupStatus = new WarmupStatus();

  public StoredCompare(Path leftJarPath, Path rightJarPath, CompareOptions options, Instant createdAt) {
    this.leftJarPath = leftJarPath;
    this.rightJarPath = rightJarPath;
    this.options = options;
    this.createdAt = createdAt;
  }

  public Path getLeftJarPath() {
    return leftJarPath;
  }

  public Path getRightJarPath() {
    return rightJarPath;
  }

  public CompareOptions getOptions() {
    return options;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public FileMeta getLeftMeta() {
    return leftMeta;
  }

  public void setLeftMeta(FileMeta leftMeta) {
    this.leftMeta = leftMeta;
  }

  public FileMeta getRightMeta() {
    return rightMeta;
  }

  public void setRightMeta(FileMeta rightMeta) {
    this.rightMeta = rightMeta;
  }

  public List<TreeNode> getTree() {
    return tree;
  }

  public void setTree(List<TreeNode> tree) {
    this.tree = tree;
  }

  public Stats getStats() {
    return stats;
  }

  public void setStats(Stats stats) {
    this.stats = stats;
  }

  public DiffResult getCachedDiff(String key) {
    if (key == null) return null;
    return diffCache.get(key);
  }

  public void putCachedDiff(String key, DiffResult diff) {
    if (key == null || diff == null) return;
    diffCache.put(key, diff);
  }

  public void clearDiffCache() {
    diffCache.clear();
  }

  public WarmupStatus getWarmupStatus() {
    return warmupStatus;
  }

  public Path getExtracted(String key) {
    if (key == null) return null;
    return extractedCache.get(key);
  }

  public void putExtracted(String key, Path path) {
    if (key == null || path == null) return;
    extractedCache.put(key, path);
  }

  public int extractedCount() {
    return extractedCache.size();
  }

  // [AGC:START] tool=Cc author=maxwell date=2026-07-27
  public long getResourceBytes() {
    long total = resourceBytes(leftJarPath) + resourceBytes(rightJarPath);
    for (Path path : extractedCache.values()) {
      total += resourceBytes(path);
    }
    return total;
  }

  private long resourceBytes(Path path) {
    if (path == null) return 0L;
    try {
      if (!Files.exists(path)) {
        throw new IllegalStateException("compare resource missing: " + path);
      }
      return Files.size(path);
    } catch (IOException e) {
      throw new IllegalStateException("compare resource size unavailable: " + path, e);
    }
  }
  // [AGC:END]

  public Path removeAnyExtracted() {
    for (Map.Entry<String, Path> e : extractedCache.entrySet()) {
      if (e == null) continue;
      Path p = extractedCache.remove(e.getKey());
      if (p != null) return p;
    }
    return null;
  }

  public void closeQuietly() {
    try {
      if (leftJarPath != null) Files.deleteIfExists(leftJarPath);
    } catch (IOException ignored) {
    }
    try {
      if (rightJarPath != null) Files.deleteIfExists(rightJarPath);
    } catch (IOException ignored) {
    }
    for (Path p : extractedCache.values()) {
      try {
        if (p != null) Files.deleteIfExists(p);
      } catch (IOException ignored) {
      }
    }
  }

  public static class WarmupStatus {
    private volatile boolean running;
    private volatile int total;
    private volatile int done;
    private volatile int skipped;
    private volatile int failed;
    private volatile String message;
    private volatile long startedAtMs;
    private volatile long finishedAtMs;

    public boolean isRunning() {
      return running;
    }

    public void setRunning(boolean running) {
      this.running = running;
    }

    public int getTotal() {
      return total;
    }

    public void setTotal(int total) {
      this.total = total;
    }

    public int getDone() {
      return done;
    }

    public void setDone(int done) {
      this.done = done;
    }

    public int getSkipped() {
      return skipped;
    }

    public void setSkipped(int skipped) {
      this.skipped = skipped;
    }

    public int getFailed() {
      return failed;
    }

    public void setFailed(int failed) {
      this.failed = failed;
    }

    public String getMessage() {
      return message;
    }

    public void setMessage(String message) {
      this.message = message;
    }

    public long getStartedAtMs() {
      return startedAtMs;
    }

    public void setStartedAtMs(long startedAtMs) {
      this.startedAtMs = startedAtMs;
    }

    public long getFinishedAtMs() {
      return finishedAtMs;
    }

    public void setFinishedAtMs(long finishedAtMs) {
      this.finishedAtMs = finishedAtMs;
    }
  }
}
