import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function configureAVD(text, cores, memoryMB) {
  if (cores < 4 || memoryMB < 6144) throw new Error('emulator_capacity_unsupported');
  const values = { 'hw.lcd.width': '1280', 'hw.lcd.height': '800', 'hw.lcd.density': '160', 'hw.ramSize': '4096', 'hw.cpu.ncore': '4' };
  const lines = text.split('\n').filter(line => !Object.keys(values).some(key => line.startsWith(key + '=')));
  return lines.join('\n').trimEnd() + '\n' + Object.entries(values).map(([k,v]) => `${k}=${v}`).join('\n') + '\n';
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android/avd');
  const config = path.join(root, 'test.avd/config.ini');
  try { fs.writeFileSync(config, configureAVD(fs.readFileSync(config,'utf8'), os.availableParallelism(), Math.floor(os.totalmem()/1048576))); }
  catch (e) { console.log('QA_JSON ' + JSON.stringify({event:'suite_result',platform:'android',result:'fail',reason:e.message === 'emulator_capacity_unsupported' ? e.message : 'emulator_configuration_failed'})); process.exitCode=1; }
}
