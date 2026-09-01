import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const srcDir = 'src';
const outDir = 'dist';

function copyStatic() {
  for (const file of ['manifest.json', 'options.html', 'offscreen.html', 'popup.html', 'styles.css']) {
    const from = path.join(srcDir, file);
    const to = path.join(outDir, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }
  if (fs.existsSync('config')) {
    fs.cpSync('config', path.join(outDir, 'config'), { recursive: true, force: true });
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
