package com.example.jardiff.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.hamcrest.Matchers.containsString;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;

import org.hamcrest.Matchers;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public class CompareControllerIntegrationTest {

  @Autowired
  private MockMvc mockMvc;

  @Autowired
  private ObjectMapper objectMapper;

  // [AGC:START] tool=Cc date=2026-07-29 author=maxwell
  @Test
  public void capabilities_defaultLocalModeEnablesDirectoryCompare() throws Exception {
    mockMvc.perform(get("/api/compare/capabilities"))
        .andExpect(status().isOk())
        .andExpect(content().json("{\"directoryCompareEnabled\":true}"));
  }
  // [AGC:END]

  @Test
  public void jarCompareAndUnifiedDiff_returnsValidFormat() throws Exception {
    // Build two JARs with a differing text file
    String leftText = "package com.example;\n\npublic class A {\n  public void foo() {\n    doWork();\n  }\n}\n";
    String rightText = "package com.example;\n\npublic class A {\n  public void foo() {\n    log(\"start\");\n    doWork();\n  }\n}\n";
    byte[] leftJar = buildJarWithText("com/example/A.java", leftText);
    byte[] rightJar = buildJarWithText("com/example/A.java", rightText);

    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);

    // Step 1: compare JARs
    String response = mockMvc.perform(multipart("/api/compare/jars")
            .file(left).file(right)
            .param("includeLib", "true")
            .param("includeClasses", "true")
            .param("includeResources", "true"))
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();

    String id = objectMapper.readTree(response).get("id").asText();

    // Step 2: get unified diff for the changed file
    mockMvc.perform(get("/api/compare/diff/unified")
            .param("id", id)
            .param("path", "com/example/A.java"))
        .andExpect(status().isOk())
        .andExpect(content().string(containsString("--- a/com/example/A.java")))
        .andExpect(content().string(containsString("+++ b/com/example/A.java")))
        .andExpect(content().string(containsString("@@")))
        .andExpect(content().string(containsString("+    log(")));
  }

  @Test
  public void jarCompare_ignoresIndexedIgnoreGlobsFromMultipartForm() throws Exception {
    byte[] leftJar = buildJarWithText("BOOT-INF/classes/ignored.txt", "left\n");
    byte[] rightJar = buildJarWithText("BOOT-INF/classes/ignored.txt", "right\n");

    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", leftJar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", rightJar);

    String response = mockMvc.perform(multipart("/api/compare/jars")
            .file(left).file(right)
            .param("includeLib", "true")
            .param("includeClasses", "true")
            .param("includeResources", "true")
            .param("ignoreGlobs[0]", "BOOT-INF/classes/ignored.txt"))
        .andExpect(status().isOk())
        .andReturn().getResponse().getContentAsString();

    JsonNode tree = objectMapper.readTree(response).get("tree");
    if (containsPath(tree, "BOOT-INF/classes/ignored.txt")) {
      throw new AssertionError("expected ignored path to be absent from compare tree");
    }
  }

  @Test
  public void compareFiles_returnsMetawithDecompiledFlag() throws Exception {
    MockMultipartFile leftFile = new MockMultipartFile("left", "Hello.java",
        "text/plain", "public class Hello { }".getBytes(StandardCharsets.UTF_8));
    MockMultipartFile rightFile = new MockMultipartFile("right", "Hello.java",
        "text/plain", "public class Hello {\n  public void greet() {}\n}".getBytes(StandardCharsets.UTF_8));

    String response = mockMvc.perform(multipart("/api/compare/files")
            .file(leftFile).file(rightFile))
        .andExpect(status().isOk())
        .andExpect(content().string(containsString("\"decompiled\"")))
        .andExpect(content().string(containsString("\"type\":\"text\"")))
        .andExpect(content().string(containsString("\"name\":\"Hello.java\"")))
        .andReturn().getResponse().getContentAsString();

    // verify decompiled is false for .java files
    boolean decompiled = objectMapper.readTree(response).get("decompiled").asBoolean();
    if (decompiled) {
      throw new AssertionError("expected decompiled=false for .java files");
    }
  }

  @Test
  public void filesUnifiedDiff_returnsDiffForTextFiles() throws Exception {
    MockMultipartFile leftFile = new MockMultipartFile("left", "test.java",
        "text/plain", "line1\nline2\nline3\n".getBytes(StandardCharsets.UTF_8));
    MockMultipartFile rightFile = new MockMultipartFile("right", "test.java",
        "text/plain", "line1\nline3\nline4\n".getBytes(StandardCharsets.UTF_8));

    mockMvc.perform(multipart("/api/compare/files/unified")
            .file(leftFile).file(rightFile))
        .andExpect(status().isOk())
        .andExpect(content().string(containsString("--- a/file")))
        .andExpect(content().string(containsString("+++ b/file")))
        .andExpect(content().string(containsString("-line2")))
        .andExpect(content().string(containsString("+line4")));
  }

  @Test
  public void compareFiles_decompilesClassFiles() throws Exception {
    // Compile two real .class files from Java source
    byte[] classA = compileSource("public class AppA { public int getVersion() { return 1; } }", "AppA");
    byte[] classB = compileSource("public class AppB { public int getVersion() { return 2; } }", "AppB");

    MockMultipartFile leftFile = new MockMultipartFile("left", "App.class",
        "application/octet-stream", classA);
    MockMultipartFile rightFile = new MockMultipartFile("right", "App.class",
        "application/octet-stream", classB);

    String response = mockMvc.perform(multipart("/api/compare/files")
            .file(leftFile).file(rightFile))
        .andExpect(status().isOk())
        .andExpect(content().string(containsString("\"decompiled\":true")))
        .andExpect(content().string(containsString("\"type\":\"text\"")))
        .andReturn().getResponse().getContentAsString();

    boolean decompiled = objectMapper.readTree(response).get("decompiled").asBoolean();
    if (!decompiled) {
      throw new AssertionError("expected decompiled=true for .class files");
    }
  }

  private byte[] compileSource(String source, String className) throws Exception {
    javax.tools.JavaCompiler compiler = javax.tools.ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      return buildMinimalClass(52, 0); // fallback for JDK without compiler
    }
    Path tmpDir = Files.createTempDirectory("jd_test_compile_");
    Path srcFile = tmpDir.resolve(className + ".java");
    Files.write(srcFile, source.getBytes(StandardCharsets.UTF_8));
    compiler.run(null, null, null, srcFile.toString());
    byte[] out = Files.readAllBytes(tmpDir.resolve(className + ".class"));
    deleteRecursive(tmpDir.toFile());
    return out;
  }

  static void deleteRecursive(java.io.File f) {
    if (f.isDirectory()) {
      for (java.io.File c : f.listFiles()) deleteRecursive(c);
    }
    f.delete();
  }

  /** Builds a minimal valid .class file header (CAFEBABE magic + version). Fallback when compiler unavailable. */
  private byte[] buildMinimalClass(int major, int minor) {
    byte[] buf = new byte[8];
    buf[0] = (byte) 0xCA; buf[1] = (byte) 0xFE; buf[2] = (byte) 0xBA; buf[3] = (byte) 0xBE;
    buf[4] = (byte) minor; buf[5] = 0;
    buf[6] = (byte) major; buf[7] = 0;
    return buf;
  }

  private byte[] buildJarWithText(String entryName, String text) throws Exception {
    Path tmp = Files.createTempFile("int_test_", ".jar");
    try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(tmp), StandardCharsets.UTF_8)) {
      zos.putNextEntry(new ZipEntry(entryName));
      zos.write(text.getBytes(StandardCharsets.UTF_8));
      zos.closeEntry();
    }
    byte[] out = Files.readAllBytes(tmp);
    Files.deleteIfExists(tmp);
    return out;
  }

  private boolean containsPath(JsonNode node, String path) {
    if (node == null || node.isNull()) return false;
    if (node.isArray()) {
      for (JsonNode child : node) {
        if (containsPath(child, path)) return true;
      }
      return false;
    }
    if (path.equals(node.path("value").asText())) return true;
    return containsPath(node.get("children"), path);
  }
}
