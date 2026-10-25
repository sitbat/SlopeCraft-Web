import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const emsdk = process.env.EMSDK;
if (!emsdk) throw new Error('Set EMSDK to an activated Emscripten SDK (tested: 4.0.23). See web/README.md.');
const cmake = process.env.CMAKE || 'cmake';
const build = path.resolve(root, process.env.SC_BUILD_DIR || 'build/web');
const toolchain = path.join(emsdk, 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake');
if (!existsSync(toolchain)) throw new Error(`Emscripten toolchain not found: ${toolchain}`);
const temporary=path.join(build,'tmp');
await mkdir(temporary,{recursive:true});
const env = {...process.env, TEMP:temporary, TMP:temporary,
  PATH: `${path.join(emsdk, 'upstream/emscripten')}${path.delimiter}${process.env.PATH}`};
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: root, env, stdio: 'inherit', windowsHide: true});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
const args = ['-S', 'web', '-B', build, '-G', 'Ninja', `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`, '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_POLICY_VERSION_MINIMUM=3.5'];
if (process.env.NINJA) args.push(`-DCMAKE_MAKE_PROGRAM=${process.env.NINJA}`);
await run(cmake, args);
await run(cmake, ['--build', build, '--parallel', process.env.SC_BUILD_JOBS || '8']);
