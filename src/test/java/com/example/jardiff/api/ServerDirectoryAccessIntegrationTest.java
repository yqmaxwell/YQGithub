package com.example.jardiff.api;

// [AGC:FILE] tool=Cc author=maxwell date=2026-07-29

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "jardiff.deployment-mode=server")
@AutoConfigureMockMvc
public class ServerDirectoryAccessIntegrationTest {

  @Autowired
  private MockMvc mockMvc;

  @Test
  public void serverMode_disablesCapabilityAndRejectsDirectoryPathBeforeValidation() throws Exception {
    mockMvc.perform(get("/api/compare/capabilities"))
        .andExpect(status().isOk())
        .andExpect(content().json("{\"directoryCompareEnabled\":false}"));

    mockMvc.perform(multipart("/api/compare/directory/path")
            .param("leftPath", "/directory-that-does-not-exist-left")
            .param("rightPath", "/directory-that-does-not-exist-right"))
        .andExpect(status().isForbidden())
        .andExpect(content().string("服务器模式禁止目录比对"));
  }

  @Test
  public void serverMode_rejectsDirectoryUpload() throws Exception {
    MockMultipartFile left = new MockMultipartFile("leftFiles", "left.txt", "text/plain", new byte[0]);
    MockMultipartFile right = new MockMultipartFile("rightFiles", "right.txt", "text/plain", new byte[0]);

    mockMvc.perform(multipart("/api/compare/directory").file(left).file(right))
        .andExpect(status().isForbidden())
        .andExpect(content().string("服务器模式禁止目录比对"));
  }

  @Test
  public void serverMode_rejectsDirectorySummary() throws Exception {
    MockMultipartFile left = new MockMultipartFile("leftFiles", "left.txt", "text/plain", new byte[0]);
    MockMultipartFile right = new MockMultipartFile("rightFiles", "right.txt", "text/plain", new byte[0]);

    mockMvc.perform(multipart("/api/compare/directory/summary").file(left).file(right))
        .andExpect(status().isForbidden())
        .andExpect(content().string("服务器模式禁止目录比对"));
  }
}
