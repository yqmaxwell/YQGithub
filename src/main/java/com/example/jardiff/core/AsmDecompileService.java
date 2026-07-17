package com.example.jardiff.core;

import java.util.ArrayList;
import java.util.List;
import java.util.zip.CRC32;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.FieldVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.Handle;
import org.springframework.stereotype.Service;

@Service
public class AsmDecompileService {
  public SignatureSnapshot extractSignature(byte[] classBytes) {
    if (classBytes == null || classBytes.length == 0) return new SignatureSnapshot("", "", new ArrayList<>(), new ArrayList<>());

    List<String> fields = new ArrayList<>();
    List<String> methods = new ArrayList<>();
    final String[] classInternal = new String[1];
    final int[] classAccess = new int[1];
    final String[] superName = new String[1];
    final List<String> interfaces = new ArrayList<>();

    ClassVisitor v = new ClassVisitor(Opcodes.ASM9) {
      @Override
      public void visit(int version, int access, String name, String signature, String superNameArg, String[] interfacesArg) {
        classInternal[0] = name;
        classAccess[0] = access;
        superName[0] = superNameArg;
        if (interfacesArg != null) interfaces.addAll(java.util.Arrays.asList(interfacesArg));
      }

      @Override
      public FieldVisitor visitField(int access, String name, String descriptor, String signature, Object value) {
        String decl = (accessStr(access) + Type.getType(descriptor).getClassName() + " " + name).trim();
        fields.add(decl);
        return null;
      }

      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        if ("<clinit>".equals(name)) return null;
        Type mt = Type.getMethodType(descriptor);
        boolean isCtor = "<init>".equals(name);
        String simple = classInternal[0] == null ? "Unknown" : classInternal[0].substring(classInternal[0].lastIndexOf('/') + 1);
        StringBuilder sb = new StringBuilder();
        sb.append(accessStr(access));
        if (isCtor) sb.append(simple);
        else sb.append(mt.getReturnType().getClassName()).append(" ").append(name);
        sb.append("(");
        Type[] args = mt.getArgumentTypes();
        for (int i = 0; i < args.length; i++) {
          if (i > 0) sb.append(", ");
          sb.append(args[i].getClassName());
        }
        sb.append(")");
        methods.add(sb.toString().trim());
        return null;
      }
    };

    new ClassReader(classBytes).accept(v, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);

    String fqcn = classInternal[0] == null ? "Unknown" : classInternal[0].replace('/', '.');
    String pkg = "";
    int lastDot = fqcn.lastIndexOf('.');
    if (lastDot > 0) pkg = fqcn.substring(0, lastDot);

    String classDecl = buildClassDecl(classAccess[0], classInternal[0], superName[0], interfaces);
    fields.sort(String::compareTo);
    methods.sort(String::compareTo);
    return new SignatureSnapshot(pkg, classDecl, fields, methods);
  }

  public String decompileToText(byte[] classBytes) {
    SignatureSnapshot s = extractSignature(classBytes);
    List<String> out = new ArrayList<>();
    if (s.pkg != null && !s.pkg.isEmpty()) {
      out.add("package " + s.pkg + ";");
      out.add("");
    }

    out.add((s.classDecl == null ? "" : s.classDecl) + " {");
    for (String f : s.fields) out.add("  " + f + ";");
    if (!s.fields.isEmpty() && !s.methods.isEmpty()) out.add("");
    for (String m : s.methods) out.add("  " + m + ";");
    out.add("}");
    return String.join("\n", out);
  }

  public long fingerprintBytecode(byte[] classBytes) {
    if (classBytes == null || classBytes.length == 0) return 0L;
    CRC32 crc = new CRC32();
    ClassVisitor v = new ClassVisitor(Opcodes.ASM9) {
      @Override
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        updateStr(crc, name);
        updateStr(crc, descriptor);
        if (exceptions != null) {
          for (String ex : exceptions) updateStr(crc, ex);
        }
        return new MethodVisitor(Opcodes.ASM9) {
          @Override
          public void visitInsn(int opcode) {
            updateInt(crc, opcode);
          }

          @Override
          public void visitIntInsn(int opcode, int operand) {
            updateInt(crc, opcode);
            updateInt(crc, operand);
          }

          @Override
          public void visitVarInsn(int opcode, int var) {
            updateInt(crc, opcode);
            updateInt(crc, var);
          }

          @Override
          public void visitTypeInsn(int opcode, String type) {
            updateInt(crc, opcode);
            updateStr(crc, type);
          }

          @Override
          public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
            updateInt(crc, opcode);
            updateStr(crc, owner);
            updateStr(crc, name);
            updateStr(crc, descriptor);
          }

          @Override
          public void visitMethodInsn(int opcode, String owner, String name, String descriptor, boolean isInterface) {
            updateInt(crc, opcode);
            updateStr(crc, owner);
            updateStr(crc, name);
            updateStr(crc, descriptor);
            updateInt(crc, isInterface ? 1 : 0);
          }

          @Override
          public void visitInvokeDynamicInsn(String name, String descriptor, Handle bootstrapMethodHandle, Object... bootstrapMethodArguments) {
            updateStr(crc, name);
            updateStr(crc, descriptor);
            if (bootstrapMethodHandle != null) {
              updateStr(crc, bootstrapMethodHandle.getOwner());
              updateStr(crc, bootstrapMethodHandle.getName());
              updateStr(crc, bootstrapMethodHandle.getDesc());
              updateInt(crc, bootstrapMethodHandle.getTag());
              updateInt(crc, bootstrapMethodHandle.isInterface() ? 1 : 0);
            }
            if (bootstrapMethodArguments != null) {
              updateInt(crc, bootstrapMethodArguments.length);
              for (Object arg : bootstrapMethodArguments) updateStr(crc, String.valueOf(arg));
            } else {
              updateInt(crc, 0);
            }
          }

          @Override
          public void visitJumpInsn(int opcode, org.objectweb.asm.Label label) {
            updateInt(crc, opcode);
          }

          @Override
          public void visitLdcInsn(Object value) {
            updateStr(crc, String.valueOf(value));
          }

          @Override
          public void visitIincInsn(int var, int increment) {
            updateInt(crc, var);
            updateInt(crc, increment);
          }

          @Override
          public void visitTableSwitchInsn(int min, int max, org.objectweb.asm.Label dflt, org.objectweb.asm.Label... labels) {
            updateInt(crc, min);
            updateInt(crc, max);
            updateInt(crc, labels == null ? 0 : labels.length);
          }

          @Override
          public void visitLookupSwitchInsn(org.objectweb.asm.Label dflt, int[] keys, org.objectweb.asm.Label[] labels) {
            updateInt(crc, keys == null ? 0 : keys.length);
            if (keys != null) {
              for (int k : keys) updateInt(crc, k);
            }
          }

          @Override
          public void visitMultiANewArrayInsn(String descriptor, int numDimensions) {
            updateStr(crc, descriptor);
            updateInt(crc, numDimensions);
          }

          @Override
          public void visitTryCatchBlock(org.objectweb.asm.Label start, org.objectweb.asm.Label end, org.objectweb.asm.Label handler, String type) {
            updateStr(crc, type);
          }
        };
      }
    };
    new ClassReader(classBytes).accept(v, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
    return crc.getValue();
  }

  public static class SignatureSnapshot {
    private final String pkg;
    private final String classDecl;
    private final List<String> fields;
    private final List<String> methods;

    public SignatureSnapshot(String pkg, String classDecl, List<String> fields, List<String> methods) {
      this.pkg = pkg;
      this.classDecl = classDecl;
      this.fields = fields == null ? new ArrayList<>() : fields;
      this.methods = methods == null ? new ArrayList<>() : methods;
    }

    public String getPkg() {
      return pkg;
    }

    public String getClassDecl() {
      return classDecl;
    }

    public List<String> getFields() {
      return fields;
    }

    public List<String> getMethods() {
      return methods;
    }
  }

  private String buildClassDecl(int access, String internalName, String superInternal, List<String> interfaces) {
    StringBuilder sb = new StringBuilder();
    sb.append(accessStr(access));
    if ((access & Opcodes.ACC_INTERFACE) != 0) sb.append("interface ");
    else if ((access & Opcodes.ACC_ENUM) != 0) sb.append("enum ");
    else sb.append("class ");
    String simple = internalName == null ? "Unknown" : internalName.substring(internalName.lastIndexOf('/') + 1);
    sb.append(simple);

    if (superInternal != null && !"java/lang/Object".equals(superInternal) && (access & Opcodes.ACC_INTERFACE) == 0) {
      sb.append(" extends ").append(toType(superInternal));
    }

    if (interfaces != null && !interfaces.isEmpty()) {
      String kw = (access & Opcodes.ACC_INTERFACE) != 0 ? " extends " : " implements ";
      sb.append(kw);
      List<String> mapped = new ArrayList<>();
      for (String itf : interfaces) mapped.add(toType(itf));
      sb.append(String.join(", ", mapped));
    }

    return sb.toString().trim();
  }

  private String accessStr(int access) {
    StringBuilder sb = new StringBuilder();
    if ((access & Opcodes.ACC_PUBLIC) != 0) sb.append("public ");
    else if ((access & Opcodes.ACC_PROTECTED) != 0) sb.append("protected ");
    else if ((access & Opcodes.ACC_PRIVATE) != 0) sb.append("private ");

    if ((access & Opcodes.ACC_STATIC) != 0) sb.append("static ");
    if ((access & Opcodes.ACC_FINAL) != 0) sb.append("final ");
    if ((access & Opcodes.ACC_ABSTRACT) != 0) sb.append("abstract ");
    return sb.toString();
  }

  private String toType(String internalName) {
    if (internalName == null) return "Unknown";
    return internalName.replace('/', '.');
  }

  private void updateInt(CRC32 crc, int v) {
    if (crc == null) return;
    crc.update((v >>> 24) & 0xff);
    crc.update((v >>> 16) & 0xff);
    crc.update((v >>> 8) & 0xff);
    crc.update(v & 0xff);
  }

  private void updateStr(CRC32 crc, String s) {
    if (crc == null) return;
    if (s == null) {
      crc.update(0);
      return;
    }
    byte[] b = s.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    updateInt(crc, b.length);
    crc.update(b, 0, b.length);
  }
}
