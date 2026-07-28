package com.example.jardiff.api;

// [AGC:FILE] tool=Cc author=maxwell date=2026-07-27

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "jardiff.limits.max-compare-sessions=1",
    "jardiff.limits.max-compare-bytes=1024"
})
public class CompareStoreLimitIntegrationTest {
  @Autowired
  private MockMvc mockMvc;

  @Test
  public void compareLimitReturnsServiceUnavailable() throws Exception {
    byte[] jar = buildJar("a.txt", "content\n");
    MockMultipartFile left = new MockMultipartFile("leftJar", "left.jar", "application/java-archive", jar);
    MockMultipartFile right = new MockMultipartFile("rightJar", "right.jar", "application/java-archive", jar);

    mockMvc.perform(multipart("/api/compare/jars").file(left).file(right))
        .andExpect(status().isOk());

    mockMvc.perform(multipart("/api/compare/jars").file(left).file(right))
        .andExpect(status().isServiceUnavailable())
        .andExpect(content().string(containsString("compare resource limit exceeded")));
  }

  private byte[] buildJar(String entryName, String text) throws Exception {
    Path tmp = Files.createTempFile("compare-store-limit", ".jar");
    try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(tmp), StandardCharsets.UTF_8)) {
      zos.putNextEntry(new ZipEntry(entryName));
      zos.write(text.getBytes(StandardCharsets.UTF_8));
      zos.closeEntry();
    }
    byte[] output = Files.readAllBytes(tmp);
    Files.deleteIfExists(tmp);
    return output;
  }
}
