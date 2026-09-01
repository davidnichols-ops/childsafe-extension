import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const srcDir = 'src';
const outDir = 'dist';

function copyStatic() {
  // offscreen.html (nsfwjs) is intentionally excluded — ONNX is the default and only shipped backend.
  // test.html is a dev-only page and must not ship in the store package.
  for (const file of ['manifest.json', 'options.html', 'offscreen-onnx.html', 'offscreen-text.html', 'popup.html', 'styles.css']) {
    const from = path.join(srcDir, file);
    const to = path.join(outDir, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }
  if (fs.existsSync('config')) {
    fs.cpSync('config', path.join(outDir, 'config'), { recursive: true, force: true });
  }

  // Bundle ONNX Runtime Web for the image classification backend.
  const ortDir = 'node_modules/onnxruntime-web/dist';
  if (fs.existsSync(ortDir)) {
    fs.mkdirSync(path.join(outDir, 'ort'), { recursive: true });
    // Main wasm-only IIFE bundle (~50 kB); it dynamically loads the Emscripten .mjs wrapper and .wasm binary.
    fs.copyFileSync(path.join(ortDir, 'ort.wasm.min.js'), path.join(outDir, 'ort.js'));
    // Only copy the base SIMD-threaded variant. The asyncify/jsep/jspi variants (~55 MB) are
    // not needed with numThreads=1 and the wasm execution provider.
    for (const ext of ['.mjs', '.wasm']) {
      const file = `ort-wasm-simd-threaded${ext}`;
      const src = path.join(ortDir, file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, 'ort', file));
    }
  }

  // Copy extension icons.
  if (fs.existsSync('icons')) {
    fs.cpSync('icons', path.join(outDir, 'icons'), { recursive: true, force: true });
  }
}

async function build() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [
      path.join(srcDir, 'background.js'),
      path.join(srcDir, 'content.js'),
      path.join(srcDir, 'offscreen-onnx.js'),
      path.join(srcDir, 'offscreen-text.js'),
      path.join(srcDir, 'options.js'),
      path.join(srcDir, 'popup.js')
    ],
    bundle: true,
    outdir: outDir,
    format: 'iife',
    platform: 'browser',
    target: 'chrome116',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
    define: { global: 'globalThis' }
  });

  copyStatic();
  console.log(`Built to ${outDir}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
