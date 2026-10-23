package com.example.jardiff.core;

// [AGC:FILE] tool=Cc author=maxwell date=2026-07-27

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

public class CompareStoreTest {
  @Test
  public void putRejectsSingleCompareLargerThanByteLimit() throws Exception {
    CompareStore store = new CompareStore(4, 8);
    Path left = Files.createTempFile("compare-store-left", ".jar");
    Path right = Files.createTempFile("compare-store-right", ".jar");
    Files.write(left, new byte[] {1, 2, 3, 4, 5, 6});
    Files.write(right, new byte[] {1, 2, 3, 4, 5, 6});

    StoredCompare oversized = new StoredCompare(left, right, new CompareOptions(false, false, false, false),
        java.time.Instant.now(), false);
    try {
      CompareStore.CapacityExceededException thrown =
          assertThrows(CompareStore.CapacityExceededException.class, () -> store.put(oversized));
      assertTrue(thrown.getMessage().contains("byte limit"));
      assertTrue(Files.exists(left), "拒绝时不得删除用户 jar");
      assertTrue(Files.exists(right), "拒绝时不得删除用户 jar");
    } finally {
      Files.deleteIfExists(left);
      Files.deleteIfExists(right);
    }
  }
}
