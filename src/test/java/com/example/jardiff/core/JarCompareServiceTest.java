package com.example.jardiff.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

public class JarCompareServiceTest {
  @Test
  public void compare_deepCompareLib_marksMetaWhenLibJarContentSameButJarBytesDiffer() throws Exception {
    byte[] payload = new byte[1024 * 1024 * 2];
    for (int i = 0; i < payload.length; i++) payload[i] = (byte) 'a';

    byte[] leftInnerJar = buildJarWithSingleBytesAndTime("a.txt", payload, 1_600_000_000_000L);
    byte[] rightInnerJar = buildJarWithSingleBytesAndTime("a.txt", payload, 1_700_000_000_000L);

    byte[] leftJar = buildJarWithSingleBytes("BOOT-INF/lib/a.jar", leftInnerJar);
    byte[] rightJar = buildJarWithSingleBytes("BOOT-INF/lib/a.jar", rightInnerJar);

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService svc = new JarCompareService(store, digest, asm, procyon);
    CompareOptions opts = new CompareOptions(true, false, false, true);

    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = svc.compare(left, right, opts);

    TreeNode jarNode = findByValue(result.getTree(), "BOOT-INF/lib/a.jar");
    assertEquals("meta", jarNode == null ? "" : jarNode.getRightStatus());
    assertEquals(1, result.getStats().getModified());

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void compare_treatsCrLfAndLfAsUnchangedForText() throws Exception {
    byte[] leftJar = buildJarWithSingleText("BOOT-INF/classes/a.txt", "hello\nworld\n");
    byte[] rightJar = buildJarWithSingleText("BOOT-INF/classes/a.txt", "hello\r\nworld\r\n");

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService svc = new JarCompareService(store, digest, asm, procyon);
    CompareOptions opts = new CompareOptions(false, true, true, false);

    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = svc.compare(left, right, opts);

    assertEquals(0, result.getStats().getModified());
    assertEquals(0, result.getStats().getAdded());
    assertEquals(0, result.getStats().getMissing());
    assertEquals(1, result.getStats().getUnchanged());

    TreeNode file = findByValue(result.getTree(), "BOOT-INF/classes/a.txt");
    assertEquals("unchanged", file == null ? "" : file.getRightStatus());

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void compare_treatsCrLfAndLfAsUnchangedForHtml() throws Exception {
    byte[] leftJar = buildJarWithSingleText("BOOT-INF/classes/a.html", "<div>\nhello\n</div>\n");
    byte[] rightJar = buildJarWithSingleText("BOOT-INF/classes/a.html", "<div>\r\nhello\r\n</div>\r\n");

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService svc = new JarCompareService(store, digest, asm, procyon);
    CompareOptions opts = new CompareOptions(false, true, true, false);

    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = svc.compare(left, right, opts);

    assertEquals(0, result.getStats().getModified());
    assertEquals(1, result.getStats().getUnchanged());

    TreeNode file = findByValue(result.getTree(), "BOOT-INF/classes/a.html");
    assertEquals("unchanged", file == null ? "" : file.getRightStatus());

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void compareDirectoryFull_preservesRelativePaths() throws Exception {
    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService svc = new JarCompareService(store, digest, asm, procyon);
    CompareOptions opts = new CompareOptions(true, true, true, false);

    MockMultipartFile left1 = new MockMultipartFile("leftFiles", "a/b/c.txt", "text/plain", "x\n".getBytes(StandardCharsets.UTF_8));
    MockMultipartFile right1 = new MockMultipartFile("rightFiles", "a/b/c.txt", "text/plain", "x\r\n".getBytes(StandardCharsets.UTF_8));

    CompareResult result = svc.compareDirectoryFull(new MockMultipartFile[] { left1 }, new MockMultipartFile[] { right1 }, opts);

    assertEquals(0, result.getStats().getModified());
    assertEquals(1, result.getStats().getUnchanged());
    TreeNode file = findByValue(result.getTree(), "a/b/c.txt");
    assertEquals("unchanged", file == null ? "" : file.getRightStatus());

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void compareDirectoryFull_deepCompareJar_buildsJarContainerNode() throws Exception {
    byte[] leftInnerJar = buildJarWithSingleText("a.txt", "a\n");
    byte[] rightInnerJar = buildJarWithSingleText("a.txt", "b\n");

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService svc = new JarCompareService(store, digest, asm, procyon);
    CompareOptions opts = new CompareOptions(true, true, true, true);

    MockMultipartFile leftJarInDir = new MockMultipartFile("leftFiles", "lib/a.jar", "application/java-archive", leftInnerJar);
    MockMultipartFile rightJarInDir = new MockMultipartFile("rightFiles", "lib/a.jar", "application/java-archive", rightInnerJar);

    CompareResult result = svc.compareDirectoryFull(new MockMultipartFile[] { leftJarInDir }, new MockMultipartFile[] { rightJarInDir }, opts);

    TreeNode jarNode = findByValue(result.getTree(), "lib/a.jar");
    assertEquals("jar", jarNode == null ? "" : jarNode.getType());
    TreeNode inner = findByValue(result.getTree(), "lib/a.jar!/a.txt");
    assertEquals("modified", inner == null ? "" : inner.getRightStatus());
    assertTrue(result.getStats().getModified() >= 1);

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void compare_deepCompareLib_setsInnerChangesOnJarNode() throws Exception {
    byte[] leftInnerJar = buildJarWithSingleText("pkg/a.txt", "hello\n");
    byte[] rightInnerJar = buildJarWithSingleText("pkg/a.txt", "world\n");

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService svc = new JarCompareService(store, digest, asm, procyon);
    CompareOptions opts = new CompareOptions(true, true, true, true);

    MockMultipartFile left = new MockMultipartFile("leftFiles", "lib/a.jar", "application/java-archive", leftInnerJar);
    MockMultipartFile right = new MockMultipartFile("rightFiles", "lib/a.jar", "application/java-archive", rightInnerJar);

    CompareResult result = svc.compareDirectoryFull(new MockMultipartFile[] { left }, new MockMultipartFile[] { right }, opts);

    TreeNode jarNode = findByValue(result.getTree(), "lib/a.jar");
    assertEquals("jar", jarNode == null ? "" : jarNode.getType());
    assertEquals(1, jarNode == null ? 0 : jarNode.getInnerChanges());
    TreeNode innerDir = jarNode == null ? null : findByValue(jarNode.getChildren(), "lib/a.jar!/pkg");
    assertEquals("dir", innerDir == null ? "" : innerDir.getType());
    TreeNode innerFile = findByValue(result.getTree(), "lib/a.jar!/pkg/a.txt");
    assertEquals("modified", innerFile == null ? "" : innerFile.getRightStatus());

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void diff_returnsTextForJavaSource() throws Exception {
    byte[] leftJar = buildJarWithSingleText("BOOT-INF/classes/A.java", "class A {\n  int x = 1;\n}\n");
    byte[] rightJar = buildJarWithSingleText("BOOT-INF/classes/A.java", "class A {\n  int x = 2;\n}\n");

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService compare = new JarCompareService(store, digest, asm, procyon);
    JarDiffService diff = new JarDiffService(store, asm, procyon, digest);
    CompareOptions opts = new CompareOptions(false, true, true, false);

    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = compare.compare(left, right, opts);

    DiffResult out = diff.diff(result.getId(), "BOOT-INF/classes/A.java");
    assertEquals("text", out.getKind());
    assertTrue(out.getLeft() != null && !out.getLeft().isEmpty());
    assertTrue(out.getRight() != null && !out.getRight().isEmpty());

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void diff_nestedClass_returnsTextAndDoesNotUseClosedZip() throws Exception {
    byte[] leftClass = buildSimpleClassBytes("p/A", 1);
    byte[] rightClass = buildSimpleClassBytes("p/A", 2);
    byte[] leftInnerJar = buildJarWithSingleBytes("p/A.class", leftClass);
    byte[] rightInnerJar = buildJarWithSingleBytes("p/A.class", rightClass);
    byte[] leftJar = buildJarWithSingleBytes("BOOT-INF/lib/a.jar", leftInnerJar);
    byte[] rightJar = buildJarWithSingleBytes("BOOT-INF/lib/a.jar", rightInnerJar);

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService compare = new JarCompareService(store, digest, asm, procyon);
    JarDiffService diff = new JarDiffService(store, asm, procyon, digest);
    CompareOptions opts = new CompareOptions(true, false, false, true);

    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = compare.compare(left, right, opts);

    TreeNode inner = findByValue(result.getTree(), "BOOT-INF/lib/a.jar!/p/A.class");
    assertEquals("modified", inner == null ? "" : inner.getRightStatus());

    DiffResult out = diff.diff(result.getId(), "BOOT-INF/lib/a.jar!/p/A.class");
    assertEquals("text", out.getKind());
    assertTrue(out.getLeft() != null && !out.getLeft().isEmpty());
    assertTrue(out.getRight() != null && !out.getRight().isEmpty());

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  private TreeNode findByValue(List<TreeNode> nodes, String value) {
    if (nodes == null || value == null) return null;
    for (TreeNode n : nodes) {
      if (n == null) continue;
      if (value.equals(n.getValue())) return n;
      if (n.getChildren() != null && !n.getChildren().isEmpty()) {
        TreeNode hit = findByValue(n.getChildren(), value);
        if (hit != null) return hit;
      }
    }
    return null;
  }

  private byte[] buildJarWithSingleText(String entryName, String content) throws IOException {
    return buildJarWithSingleBytes(entryName, content.getBytes(StandardCharsets.UTF_8));
  }

  /**
   * 构造仅包含一个条目的 jar，并为该条目设置固定时间戳。
   *
   * @param entryName 条目名称
   * @param content 条目内容
   * @param timeMillis ZipEntry 时间戳
   * @return jar 字节数组
   */
  private byte[] buildJarWithSingleBytesAndTime(String entryName, byte[] content, long timeMillis) throws IOException {
    Path tmp = Files.createTempFile("jardiff_test_", ".jar");
    try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(tmp), StandardCharsets.UTF_8)) {
      ZipEntry e = new ZipEntry(entryName);
      e.setTime(timeMillis);
      zos.putNextEntry(e);
      zos.write(content);
      zos.closeEntry();
    }
    byte[] out = Files.readAllBytes(tmp);
    Files.deleteIfExists(tmp);
    return out;
  }

  private byte[] buildJarWithSingleBytes(String entryName, byte[] content) throws IOException {
    Path tmp = Files.createTempFile("jardiff_test_", ".jar");
    try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(tmp), StandardCharsets.UTF_8)) {
      ZipEntry e = new ZipEntry(entryName);
      zos.putNextEntry(e);
      zos.write(content);
      zos.closeEntry();
    }
    byte[] out = Files.readAllBytes(tmp);
    Files.deleteIfExists(tmp);
    return out;
  }

  private byte[] buildSimpleClassBytes(String internalName, int value) {
    ClassWriter cw = new ClassWriter(0);
    cw.visit(Opcodes.V1_8, Opcodes.ACC_PUBLIC, internalName, null, "java/lang/Object", null);

    MethodVisitor init = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
    init.visitCode();
    init.visitVarInsn(Opcodes.ALOAD, 0);
    init.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
    init.visitInsn(Opcodes.RETURN);
    init.visitMaxs(1, 1);
    init.visitEnd();

    MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC, "value", "()I", null, null);
    mv.visitCode();
    mv.visitLdcInsn(value);
    mv.visitInsn(Opcodes.IRETURN);
    mv.visitMaxs(1, 1);
    mv.visitEnd();

    cw.visitEnd();
    return cw.toByteArray();
  }
}
