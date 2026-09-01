import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const srcDir = 'src';
const outDir = 'dist';

function copyStatic() {
  for (const file of ['manifest.json', 'options.html', 'offscreen.html', 'offscreen-onnx.html', 'offscreen-text.html', 'popup.html', 'styles.css', 'test.html']) {
    const from = path.join(srcDir, file);
    const to = path.join(outDir, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }
  if (fs.existsSync('config')) {
    fs.cpSync('config', path.join(outDir, 'config'), { recursive: true, force: true });
  }

  // Bundle ONNX Runtime Web for the optional ONNX backend.
  const ortDir = 'node_modules/onnxruntime-web/dist';
  if (fs.existsSync(ortDir)) {
    fs.mkdirSync(path.join(outDir, 'ort'), { recursive: true });
    // Main wasm-only IIFE bundle (~50 kB); it dynamically loads the Emscripten .mjs wrapper and .wasm binary.
    fs.copyFileSync(path.join(ortDir, 'ort.wasm.min.js'), path.join(outDir, 'ort.js'));
    // Copy the matching threaded .mjs wrappers and .wasm binaries so the runtime can locate them.
    for (const file of fs.readdirSync(ortDir)) {
      if (file.startsWith('ort-wasm-simd-threaded') && (file.endsWith('.mjs') || file.endsWith('.wasm'))) {
        fs.copyFileSync(path.join(ortDir, file), path.join(outDir, 'ort', file));
      }
    }
  }
}

async function build() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [
      path.join(srcDir, 'background.js'),
      path.join(srcDir, 'content.js'),
      path.join(srcDir, 'offscreen.js'),
      path.join(srcDir, 'offscreen-onnx.js'),
      path.join(srcDir, 'offscreen-text.js'),
      path.join(srcDir, 'options.js')
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
