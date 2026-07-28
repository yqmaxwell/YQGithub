package com.example.jardiff.core;

// [AGC:FILE] tool=Cc author=maxwell date=2026-07-27

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

public class CompareStoreTest {
  @Test
  public void putRejectsSessionLimitAndClosesRejectedResources() throws Exception {
    CompareStore store = new CompareStore(1, 1024);
    Path firstLeft = Files.createTempFile("compare-store-first-left", ".jar");
    Path firstRight = Files.createTempFile("compare-store-first-right", ".jar");
    Path rejectedLeft = Files.createTempFile("compare-store-rejected-left", ".jar");
    Path rejectedRight = Files.createTempFile("compare-store-rejected-right", ".jar");
    Files.write(firstLeft, new byte[] {1});
    Files.write(firstRight, new byte[] {1});
    Files.write(rejectedLeft, new byte[] {2});
    Files.write(rejectedRight, new byte[] {2});

    StoredCompare first = new StoredCompare(firstLeft, firstRight, new CompareOptions(false, false, false, false),
        java.time.Instant.now());
    StoredCompare rejected = new StoredCompare(rejectedLeft, rejectedRight,
        new CompareOptions(false, false, false, false), java.time.Instant.now());
    try {
      String id = store.put(first);
      assertTrue(store.get(id).isPresent());

      assertThrows(CompareStore.CapacityExceededException.class, () -> store.put(rejected));
      assertTrue(store.get(id).isPresent());
      assertFalse(Files.exists(rejectedLeft));
      assertFalse(Files.exists(rejectedRight));
    } finally {
      first.closeQuietly();
      Files.deleteIfExists(rejectedLeft);
      Files.deleteIfExists(rejectedRight);
    }
  }
}
