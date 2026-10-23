package com.example.jardiff.core;

// [AGC:FILE] tool=Cc author=maxwell date=2026-10-20

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 覆盖会话回收不得删除用户磁盘上的原始 jar，以及会话数达到上限时淘汰旧会话。 */
public class CompareStoreOwnershipTest {
  private static final CompareOptions OPTIONS = new CompareOptions(true, true, true, false);

  @Test
  public void closeQuietlyKeepsUserJarWhenNotOwned(@TempDir Path dir) throws Exception {
    Path left = writeJar(dir.resolve("left.jar"), "a.txt", "left\n");
    Path right = writeJar(dir.resolve("right.jar"), "a.txt", "right\n");

    StoredCompare stored = new StoredCompare(left, right, OPTIONS, Instant.now(), false);
    stored.closeQuietly();

    assertTrue(Files.exists(left), "用户选定的左侧 jar 不得被删除");
    assertTrue(Files.exists(right), "用户选定的右侧 jar 不得被删除");
  }

  @Test
  public void closeQuietlyRemovesOwnedJar(@TempDir Path dir) throws Exception {
    Path left = writeJar(dir.resolve("left.jar"), "a.txt", "left\n");
    Path right = writeJar(dir.resolve("right.jar"), "a.txt", "right\n");

    StoredCompare stored = new StoredCompare(left, right, OPTIONS, Instant.now(), true);
    stored.closeQuietly();

    assertFalse(Files.exists(left), "应用创建的临时 jar 应当被回收");
    assertFalse(Files.exists(right), "应用创建的临时 jar 应当被回收");
  }

  @Test
  public void capacityRejectionKeepsUserJarOnByPathCompare(@TempDir Path dir) throws Exception {
    Path left = writeJar(dir.resolve("left.jar"), "a.txt", "left\n");
    Path right = writeJar(dir.resolve("right.jar"), "a.txt", "right\n");

    CompareStore store = new CompareStore(1, 1L);
    StoredCompare rejected = new StoredCompare(left, right, OPTIONS, Instant.now(), false);
    try {
      store.put(rejected);
    } catch (CompareStore.CapacityExceededException expected) {
      assertNotNull(expected.getMessage());
    }

    assertTrue(Files.exists(left), "超出配额被拒绝时不得删除用户左侧 jar");
    assertTrue(Files.exists(right), "超出配额被拒绝时不得删除用户右侧 jar");
  }

  @Test
  public void putEvictsOldestSessionInsteadOfFailing(@TempDir Path dir) throws Exception {
    CompareStore store = new CompareStore(1, 1024L * 1024L);
    Instant now = Instant.now();

    Path firstLeft = writeJar(dir.resolve("first-left.jar"), "a.txt", "first\n");
    Path firstRight = writeJar(dir.resolve("first-right.jar"), "a.txt", "first\n");
    Path secondLeft = writeJar(dir.resolve("second-left.jar"), "a.txt", "second\n");
    Path secondRight = writeJar(dir.resolve("second-right.jar"), "a.txt", "second\n");

    String firstId = store.put(new StoredCompare(firstLeft, firstRight, OPTIONS, now.minusSeconds(60), false));
    String secondId = store.put(new StoredCompare(secondLeft, secondRight, OPTIONS, now, false));

    Optional<StoredCompare> first = store.get(firstId);
    assertFalse(first.isPresent(), "会话数达到上限时应淘汰最久未访问的会话");
    assertTrue(store.get(secondId).isPresent(), "最新的会话应当保留");
    assertTrue(Files.exists(firstLeft), "淘汰会话不得删除用户 jar");
    assertTrue(Files.exists(firstRight), "淘汰会话不得删除用户 jar");
    assertTrue(Files.exists(secondLeft), "淘汰会话不得删除用户 jar");
    assertTrue(Files.exists(secondRight), "淘汰会话不得删除用户 jar");
  }

  @Test
  public void touchKeepsActiveSession(@TempDir Path dir) throws Exception {
    CompareStore store = new CompareStore(2, 1024L * 1024L);
    Instant now = Instant.now();

    Path a = writeJar(dir.resolve("a-left.jar"), "a.txt", "a\n");
    Path b = writeJar(dir.resolve("a-right.jar"), "a.txt", "a\n");
    Path c = writeJar(dir.resolve("b-left.jar"), "b.txt", "b\n");
    Path d = writeJar(dir.resolve("b-right.jar"), "b.txt", "b\n");
    Path e = writeJar(dir.resolve("c-left.jar"), "c.txt", "c\n");
    Path f = writeJar(dir.resolve("c-right.jar"), "c.txt", "c\n");

    String firstId = store.put(new StoredCompare(a, b, OPTIONS, now.minusSeconds(120), false));
    String secondId = store.put(new StoredCompare(c, d, OPTIONS, now.minusSeconds(60), false));
    assertTrue(store.get(firstId).isPresent(), "访问后应当刷新最后访问时间");
    store.put(new StoredCompare(e, f, OPTIONS, now, false));

    assertTrue(store.get(firstId).isPresent(), "最近访问过的会话不应被优先淘汰");
    assertFalse(store.get(secondId).isPresent(), "应当淘汰最久未访问的会话");
  }

  private Path writeJar(Path target, String entryName, String text) throws Exception {
    try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(target), StandardCharsets.UTF_8)) {
      zos.putNextEntry(new ZipEntry(entryName));
      zos.write(text.getBytes(StandardCharsets.UTF_8));
      zos.closeEntry();
    }
    return target;
  }
}
