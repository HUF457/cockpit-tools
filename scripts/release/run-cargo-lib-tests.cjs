#!/usr/bin/env node

// Runs `cargo test --lib` for src-tauri.
//
// On Windows this needs one extra step: Tauri embeds an application manifest
// into product binaries only, so cargo's test harness executables ship without
// a manifest. The loader then binds comctl32 v5, which lacks TaskDialogIndirect
// (a Common Controls v6 export pulled in statically via the dialog plugin), and
// every test executable dies at startup with STATUS_ENTRYPOINT_NOT_FOUND before
// a single test runs. Embedding the manifest through build.rs link args is not
// an option either: `rustc-link-arg-tests` does not cover lib unit-test targets
// and a global `/MANIFEST:EMBED` collides with the RT_MANIFEST resource Tauri
// already embeds into the product binary (CVT1100 duplicate resource).
//
// So on Windows we build the test executables first (`--no-run`), drop a
// side-by-side `<exe>.manifest` declaring the Common Controls v6 dependency
// next to each of them (the loader honours external manifests for executables
// without an embedded one), then run the executables directly.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SRC_TAURI = path.join(process.cwd(), 'src-tauri');

const COMMON_CONTROLS_V6_MANIFEST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
`;

function run(cmd, args, opts) {
  return spawnSync(cmd, args, {
    cwd: SRC_TAURI,
    shell: false,
    env: { ...process.env, RUST_TEST_THREADS: '1', ...(opts && opts.env) },
    ...(opts || {}),
  });
}

function main() {
  if (process.platform !== 'win32') {
    const direct = run('cargo', ['test', '--lib'], { stdio: 'inherit' });
    process.exit(typeof direct.status === 'number' ? direct.status : 1);
  }

  console.log('$ cargo test --lib --no-run (build test executables)');
  const build = run(
    'cargo',
    ['test', '--lib', '--no-run', '--message-format=json'],
    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  if (build.status !== 0) {
    console.error(`cargo test --no-run failed (exit=${build.status})`);
    process.exit(build.status || 1);
  }

  const executables = [];
  for (const line of build.stdout.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      message.reason === 'compiler-artifact' &&
      message.profile &&
      message.profile.test === true &&
      typeof message.executable === 'string' &&
      message.executable.length > 0
    ) {
      executables.push(message.executable);
    }
  }

  if (executables.length === 0) {
    console.error('no test executables reported by cargo');
    process.exit(1);
  }

  for (const exe of executables) {
    fs.writeFileSync(`${exe}.manifest`, COMMON_CONTROLS_V6_MANIFEST);
  }

  let failed = false;
  for (const exe of executables) {
    console.log(`$ ${exe} --test-threads 1`);
    const result = spawnSync(exe, ['--test-threads', '1'], {
      cwd: SRC_TAURI,
      stdio: 'inherit',
      env: { ...process.env, RUST_TEST_THREADS: '1' },
    });
    if (result.status !== 0) {
      console.error(`test executable failed (exit=${result.status})`);
      failed = true;
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
