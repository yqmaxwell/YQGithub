package com.example.jardiff.core;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CompareStore {
  private static final Logger log = LoggerFactory.getLogger(CompareStore.class);
  private static final int DEFAULT_MAX_SESSIONS = 4;
  private static final long DEFAULT_MAX_BYTES = 2L * 1024L * 1024L * 1024L;
  private final Map<String, StoredCompare> store = new ConcurrentHashMap<>();
  @Value("${jardiff.limits.max-compare-sessions:4}")
  private int maxSessions = DEFAULT_MAX_SESSIONS;
  @Value("${jardiff.limits.max-compare-bytes:2147483648}")
  private long maxBytes = DEFAULT_MAX_BYTES;

  /** 会话存活时长（分钟）。字段默认值供不经过 Spring 的测试构造器使用，不可去掉。 */
  @Value("${jardiff.limits.session-ttl-minutes:30}")
  private long sessionTtlMinutes = 30L;

  public CompareStore() {
  }

  CompareStore(int maxSessions, long maxBytes) {
    this.maxSessions = Math.max(1, maxSessions);
    this.maxBytes = Math.max(1L, maxBytes);
  }

  // [AGC:START] tool=Cc author=maxwell date=2026-07-27
  public synchronized String put(StoredCompare compare) {
    Objects.requireNonNull(compare, "compare");
    cleanupExpired(Instant.now());
    long incomingBytes;
    try {
      incomingBytes = compare.getResourceBytes();
    } catch (RuntimeException e) {
      compare.closeQuietly();
      throw e;
    }
    if (incomingBytes > maxBytes) {
      compare.closeQuietly();
      throw new CapacityExceededException(
          "compare exceeds byte limit: incoming=" + incomingBytes + ", bytes=" + maxBytes);
    }
    evictUntilFits(incomingBytes);
    if (store.size() >= maxSessions || incomingBytes > maxBytes - currentResourceBytes()) {
      compare.closeQuietly();
      throw new CapacityExceededException(
          "compare resource limit exceeded: sessions=" + maxSessions + ", bytes=" + maxBytes);
    }
    String id = UUID.randomUUID().toString().replace("-", "");
    store.put(id, compare);
    log.info("compare store put id={} size={}", id, store.size());
    return id;
  }

  /** 按最久未访问顺序淘汰旧会话，为新的比对腾出会话数与字节配额。 */
  private void evictUntilFits(long incomingBytes) {
    while (store.size() >= maxSessions || incomingBytes > maxBytes - currentResourceBytes()) {
      Map.Entry<String, StoredCompare> oldest = null;
      for (Map.Entry<String, StoredCompare> e : store.entrySet()) {
        if (oldest == null || e.getValue().getLastAccessAt().isBefore(oldest.getValue().getLastAccessAt())) {
          oldest = e;
        }
      }
      if (oldest == null) {
        return;
      }
      store.remove(oldest.getKey());
      oldest.getValue().closeQuietly();
      log.info("compare store evicted id={} size={}", oldest.getKey(), store.size());
    }
  }

  public synchronized Optional<StoredCompare> get(String id) {
    StoredCompare v = store.get(id);
    if (v == null) return Optional.empty();
    if (v.getCreatedAt().plus(sessionTtl()).isBefore(Instant.now())) {
      store.remove(id);
      v.closeQuietly();
      log.info("compare store expired id={}", id);
      return Optional.empty();
    }
    v.touch();
    return Optional.of(v);
  }

  /** 比对在建树阶段失败时撤销刚登记的会话，避免失败请求占用配额。 */
  public synchronized void remove(String id) {
    StoredCompare v = store.remove(id);
    if (v != null) {
      v.closeQuietly();
      log.info("compare store remove id={} size={}", id, store.size());
    }
  }

  @Scheduled(fixedDelayString = "${jardiff.limits.session-cleanup-interval-ms:60000}")
  public synchronized void cleanup() {
    cleanupExpired(Instant.now());
  }

  private Duration sessionTtl() {
    return Duration.ofMinutes(sessionTtlMinutes);
  }

  private void cleanupExpired(Instant now) {
    int removed = 0;
    for (Map.Entry<String, StoredCompare> e : store.entrySet()) {
      StoredCompare v = e.getValue();
      if (v.getCreatedAt().plus(sessionTtl()).isBefore(now)) {
        store.remove(e.getKey());
        v.closeQuietly();
        removed += 1;
      }
    }
    if (removed > 0) {
      log.info("compare store cleanup removed={} size={}", removed, store.size());
    }
  }

  private long currentResourceBytes() {
    long total = 0L;
    for (StoredCompare compare : store.values()) {
      total += compare.getResourceBytes();
    }
    return total;
  }

  public static class CapacityExceededException extends RuntimeException {
    public CapacityExceededException(String message) {
      super(message);
    }
  }
}
