package com.example.jardiff.core;

public class DirectoryJarRow {
  private String name;
  private FileMeta left;
  private FileMeta right;
  private String status;

  public DirectoryJarRow() {
  }

  public DirectoryJarRow(String name, FileMeta left, FileMeta right, String status) {
    this.name = name;
    this.left = left;
    this.right = right;
    this.status = status;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public FileMeta getLeft() {
    return left;
  }

  public void setLeft(FileMeta left) {
    this.left = left;
  }

  public FileMeta getRight() {
    return right;
  }

  public void setRight(FileMeta right) {
    this.right = right;
  }

  public String getStatus() {
    return status;
  }

  public void setStatus(String status) {
    this.status = status;
  }
}
