package com.example.jardiff.core;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import org.springframework.stereotype.Service;

@Service
public class DigestService {
  public String md5(Path file) throws IOException {
    MessageDigest md = newDigest("MD5");
    try (InputStream in = Files.newInputStream(file)) {
      byte[] buf = new byte[1024 * 64];
      int read;
      while ((read = in.read(buf)) >= 0) {
        if (read > 0) md.update(buf, 0, read);
      }
    }
    return toHex(md.digest());
  }

  public String md5(byte[] bytes) {
    if (bytes == null) return "";
    MessageDigest md = newDigest("MD5");
    md.update(bytes);
    return toHex(md.digest());
  }

  private MessageDigest newDigest(String alg) {
    try {
      return MessageDigest.getInstance(alg);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("digest not supported: " + alg, e);
    }
  }

  private String toHex(byte[] bytes) {
    StringBuilder sb = new StringBuilder(bytes.length * 2);
    for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
    return sb.toString();
  }
}
