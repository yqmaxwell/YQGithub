package com.example.jardiff.api;

// [AGC:FILE] tool=Cc author=maxwell date=2026-07-29

import static org.assertj.core.api.Assertions.assertThat;

import com.example.jardiff.JarDiffApplication;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;

public class InvalidDeploymentModeIntegrationTest {

  @Test
  public void invalidDeploymentMode_failsApplicationContextStartup() {
    new WebApplicationContextRunner()
        .withUserConfiguration(JarDiffApplication.class)
        .withPropertyValues("jardiff.deployment-mode=invalid")
        .run(context -> {
          assertThat(context).hasFailed();
          assertThat(context.getStartupFailure()).hasStackTraceContaining("jardiff.deployment-mode");
        });
  }
}
