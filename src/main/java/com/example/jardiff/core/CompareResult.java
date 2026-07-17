package com.example.jardiff.core;

import java.util.List;

public class CompareResult {
  private String id;
  private FileMeta left;
  private FileMeta right;
  private List<TreeNode> tree;
  private Stats stats;

  public CompareResult() {
  }

  public CompareResult(String id, FileMeta left, FileMeta right, List<TreeNode> tree, Stats stats) {
    this.id = id;
    this.left = left;
    this.right = right;
    this.tree = tree;
    this.stats = stats;
  }

  public String getId() {
    return id;
  }

  public void setId(String id) {
    this.id = id;
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

  public List<TreeNode> getTree() {
    return tree;
  }

  public void setTree(List<TreeNode> tree) {
    this.tree = tree;
  }

  public Stats getStats() {
    return stats;
  }

  public void setStats(Stats stats) {
    this.stats = stats;
  }
}
