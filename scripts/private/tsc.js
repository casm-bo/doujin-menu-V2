import Chalk from "chalk";
import ChildProcess from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const tscPath = require.resolve("typescript/bin/tsc");

export function compile(directory) {
  return new Promise((resolve, reject) => {
    const tscProcess = ChildProcess.execFile(process.execPath, [tscPath], {
      cwd: directory,
    });

    tscProcess.stdout.on("data", (data) =>
      process.stdout.write(
        Chalk.yellowBright(`[tsc] `) + Chalk.white(data.toString()),
      ),
    );
    tscProcess.stderr.on("data", (data) =>
      process.stderr.write(
        Chalk.redBright(`[tsc] `) + Chalk.white(data.toString()),
      ),
    );

    tscProcess.on("exit", (exitCode) => {
      if (exitCode > 0) {
        reject(exitCode);
      } else {
        resolve();
      }
    });
  });
}

export default compile;
