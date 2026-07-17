package com.example.jardiff.core;

public class FileMeta {
  private String name;
  private long size;
  private String md5;

  public FileMeta() {
  }

  public FileMeta(String name, long size, String md5) {
    this.name = name;
    this.size = size;
    this.md5 = md5;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public long getSize() {
    return size;
  }

  public void setSize(long size) {
    this.size = size;
  }

  public String getMd5() {
    return md5;
  }

  public void setMd5(String md5) {
    this.md5 = md5;
  }
}
