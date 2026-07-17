package com.example.jardiff.core;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CompareStore {
  private static final Logger log = LoggerFactory.getLogger(CompareStore.class);
  private static final Duration TTL = Duration.ofMinutes(30);
  private final Map<String, StoredCompare> store = new ConcurrentHashMap<>();

  public String put(StoredCompare compare) {
    String id = UUID.randomUUID().toString().replace("-", "");
    store.put(id, compare);
    log.info("compare store put id={} size={}", id, store.size());
    return id;
  }

  public Optional<StoredCompare> get(String id) {
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
  public void cleanup() {
    Instant now = Instant.now();
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
}
