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
  private static final Duration TTL = Duration.ofMinutes(30);
  private static final int DEFAULT_MAX_SESSIONS = 4;
  private static final long DEFAULT_MAX_BYTES = 2L * 1024L * 1024L * 1024L;
  private final Map<String, StoredCompare> store = new ConcurrentHashMap<>();
  @Value("${jardiff.limits.max-compare-sessions:4}")
  private int maxSessions = DEFAULT_MAX_SESSIONS;
  @Value("${jardiff.limits.max-compare-bytes:2147483648}")
  private long maxBytes = DEFAULT_MAX_BYTES;

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
    long currentBytes = currentResourceBytes();
    if (store.size() >= maxSessions || incomingBytes > maxBytes - currentBytes) {
      compare.closeQuietly();
      throw new CapacityExceededException(
          "compare resource limit exceeded: sessions=" + maxSessions + ", bytes=" + maxBytes);
    }
    String id = UUID.randomUUID().toString().replace("-", "");
    store.put(id, compare);
    log.info("compare store put id={} size={}", id, store.size());
    return id;
  }

  public synchronized Optional<StoredCompare> get(String id) {
    StoredCompare v = store.get(id);
    if (v == null) return Optional.empty();
    if (v.getCreatedAt().plus(TTL).isBefore(Instant.now())) {
      store.remove(id);
      v.closeQuietly();
      log.info("compare store expired id={}", id);
      return Optional.empty();
    }
    return Optional.of(v);
  }

  @Scheduled(fixedDelay = 60_000L)
  public synchronized void cleanup() {
    cleanupExpired(Instant.now());
  }

  private void cleanupExpired(Instant now) {
    int removed = 0;
    for (Map.Entry<String, StoredCompare> e : store.entrySet()) {
      StoredCompare v = e.getValue();
      if (v.getCreatedAt().plus(TTL).isBefore(now)) {
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
