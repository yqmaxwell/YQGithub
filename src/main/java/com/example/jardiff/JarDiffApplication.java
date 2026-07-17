package com.example.jardiff;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class JarDiffApplication {
  public static void main(String[] args) {
    SpringApplication.run(JarDiffApplication.class, args);
  }
}
