package com.example.jardiff.core;

import com.strobel.assembler.metadata.Buffer;
import com.strobel.assembler.metadata.ClasspathTypeLoader;
import com.strobel.assembler.metadata.CompositeTypeLoader;
import com.strobel.assembler.metadata.ITypeLoader;
import com.strobel.decompiler.Decompiler;
import com.strobel.decompiler.DecompilerSettings;
import com.strobel.decompiler.PlainTextOutput;
import java.io.StringWriter;
import org.objectweb.asm.ClassReader;
import org.springframework.stereotype.Service;

@Service
public class ProcyonDecompileService {

  @FunctionalInterface
  public interface ClassBytesProvider {
    byte[] loadClassBytes(String internalName);
  }

  public String decompileToText(byte[] classBytes) {
    return decompileToText(classBytes, null);
  }

  public String decompileToText(byte[] classBytes, ClassBytesProvider provider) {
    if (classBytes == null || classBytes.length == 0) return "";

    String internalName = new ClassReader(classBytes).getClassName();
    if (internalName == null || internalName.trim().isEmpty()) return "";

    DecompilerSettings settings = DecompilerSettings.javaDefaults();
    settings.setForceExplicitImports(true);
    settings.setShowSyntheticMembers(false);

    ITypeLoader loader = buildTypeLoader(internalName, classBytes, provider);
    settings.setTypeLoader(loader);

    StringWriter sw = new StringWriter();
    PlainTextOutput output = new PlainTextOutput(sw);
    Decompiler.decompile(internalName, output, settings);
    return sw.toString();
  }

  private ITypeLoader buildTypeLoader(String internalName, byte[] bytes, ClassBytesProvider provider) {
    ITypeLoader main = new SingleClassTypeLoader(internalName, bytes);
    ITypeLoader cp = new ClasspathTypeLoader();
    if (provider == null) return new CompositeTypeLoader(main, cp);
    return new CompositeTypeLoader(main, new ProviderTypeLoader(provider), cp);
  }

  private static class SingleClassTypeLoader implements ITypeLoader {
    private final String internalName;
    private final byte[] bytes;

    private SingleClassTypeLoader(String internalName, byte[] bytes) {
      this.internalName = internalName;
      this.bytes = bytes;
    }

    @Override
    public boolean tryLoadType(String name, Buffer buffer) {
      if (name == null || buffer == null) return false;
      if (!name.equals(internalName)) return false;
      buffer.reset(bytes.length);
      buffer.putByteArray(bytes, 0, bytes.length);
      buffer.position(0);
      return true;
    }
  }

  private static class ProviderTypeLoader implements ITypeLoader {
    private final ClassBytesProvider provider;

    private ProviderTypeLoader(ClassBytesProvider provider) {
      this.provider = provider;
    }

    @Override
    public boolean tryLoadType(String name, Buffer buffer) {
      if (name == null || buffer == null || provider == null) return false;
      byte[] bytes = provider.loadClassBytes(name);
      if (bytes == null || bytes.length == 0) return false;
      buffer.reset(bytes.length);
      buffer.putByteArray(bytes, 0, bytes.length);
      buffer.position(0);
      return true;
    }
  }
}
