package com.example.jardiff.core;

// [AGC:FILE] tool=Cc author=maxwell date=2026-07-24

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

public class JarDiffServiceTest {

  @Test
  public void generateUnifiedDiff_returnsValidFormatForTextFile() throws Exception {
    String leftText = "package com.example;\n\npublic class A {\n  public void foo() {\n    doWork();\n  }\n}\n";
    String rightText = "package com.example;\n\npublic class A {\n  public void foo() {\n    log(\"start\");\n    doWork();\n  }\n}\n";

    byte[] leftJar = buildJarWithText("com/example/A.java", leftText);
    byte[] rightJar = buildJarWithText("com/example/A.java", rightText);

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService jarCompare = new JarCompareService(store, digest, asm, procyon);
    JarDiffService jarDiff = new JarDiffService(store, asm, procyon, digest);

    CompareOptions opts = new CompareOptions(true, true, true, false);
    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = jarCompare.compare(left, right, opts);

    String unified = jarDiff.generateUnifiedDiff(result.getId(), "com/example/A.java");

    assertNotNull(unified, "unified diff should not be null");
    assertTrue(unified.startsWith("--- a/com/example/A.java"), "should start with original header, got: " + firstLine(unified));
    assertTrue(unified.contains("+++ b/com/example/A.java"), "should contain revised header");
    assertTrue(unified.contains("@@"), "should contain hunk header with @@");
    assertTrue(unified.contains("+    log("), "should contain added line");
    assertTrue(unified.contains(" doWork();"), "should contain unchanged line");

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void generateUnifiedDiff_handlesDeleteAndInsert() throws Exception {
    String leftText = "line1\nline2\nline3\nline4\n";
    String rightText = "line1\nline3\nline4\nline5\n";

    byte[] leftJar = buildJarWithText("sample.txt", leftText);
    byte[] rightJar = buildJarWithText("sample.txt", rightText);

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService jarCompare = new JarCompareService(store, digest, asm, procyon);
    JarDiffService jarDiff = new JarDiffService(store, asm, procyon, digest);

    CompareOptions opts = new CompareOptions(true, true, true, false);
    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = jarCompare.compare(left, right, opts);

    String unified = jarDiff.generateUnifiedDiff(result.getId(), "sample.txt");

    assertNotNull(unified, "unified diff should not be null");
    assertTrue(unified.contains("-line2"), "should contain deleted line2");
    assertTrue(unified.contains("+line5"), "should contain added line5");

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void generateUnifiedDiff_includesCompleteFileContext() throws Exception {
    String leftText = "line1\nline2\nline3\nline4\nline5\nline6\nold-line\nline8\nline9\nline10\nline11\nline12\n";
    String rightText = "line1\nline2\nline3\nline4\nline5\nline6\nnew-line\nline8\nline9\nline10\nline11\nline12\n";

    byte[] leftJar = buildJarWithText("sample.txt", leftText);
    byte[] rightJar = buildJarWithText("sample.txt", rightText);

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService jarCompare = new JarCompareService(store, digest, asm, procyon);
    JarDiffService jarDiff = new JarDiffService(store, asm, procyon, digest);

    CompareOptions opts = new CompareOptions(true, true, true, false);
    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = jarCompare.compare(left, right, opts);

    String unified = jarDiff.generateUnifiedDiff(result.getId(), "sample.txt");

    assertNotNull(unified, "unified diff should not be null");
    assertTrue(unified.contains(" line1"), "should include unchanged content before the diff context");
    assertTrue(unified.contains(" line12"), "should include unchanged content after the diff context");

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  @Test
  public void generateUnifiedDiff_returnsNullForBinaryFile() throws Exception {
    byte[] leftJar = buildJarWithText("image.png", new byte[]{(byte)0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0});
    byte[] rightJar = buildJarWithText("image.png", new byte[]{(byte)0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3});

    CompareStore store = new CompareStore();
    DigestService digest = new DigestService();
    AsmDecompileService asm = new AsmDecompileService();
    ProcyonDecompileService procyon = new ProcyonDecompileService();
    JarCompareService jarCompare = new JarCompareService(store, digest, asm, procyon);
    JarDiffService jarDiff = new JarDiffService(store, asm, procyon, digest);

    CompareOptions opts = new CompareOptions(true, true, true, false);
    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);
    CompareResult result = jarCompare.compare(left, right, opts);

    String unified = jarDiff.generateUnifiedDiff(result.getId(), "image.png");
    assertEquals(null, unified, "binary files should return null unified diff");

    StoredCompare stored = store.get(result.getId()).orElse(null);
    if (stored != null) stored.closeQuietly();
  }

  private byte[] buildJarWithText(String entryName, String content) throws IOException {
    return buildJarWithText(entryName, content.getBytes(StandardCharsets.UTF_8));
  }

  private byte[] buildJarWithText(String entryName, byte[] content) throws IOException {
    Path tmp = Files.createTempFile("jardiff_test_", ".jar");
    try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(tmp), StandardCharsets.UTF_8)) {
      zos.putNextEntry(new ZipEntry(entryName));
      zos.write(content);
      zos.closeEntry();
    }
    byte[] out = Files.readAllBytes(tmp);
    Files.deleteIfExists(tmp);
    return out;
  }

  private String firstLine(String s) {
    if (s == null) return "";
    int idx = s.indexOf('\n');
    return idx < 0 ? s : s.substring(0, idx);
  }
}
