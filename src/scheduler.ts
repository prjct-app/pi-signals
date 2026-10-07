import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { command, must } from './commands.ts';
import { config, stateDir } from './config.ts';

const label = 'app.prjct.pi-signals';
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function launchAgent(entry: string) {
  if (!isAbsolute(entry)) throw new Error('Scheduler requires the absolute installed CLI path.');
  const settings = config();
  const variables = { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', PI_CODING_AGENT_DIR: getAgentDir(),
    ...(process.env.PRJCT_HOME ? { PRJCT_HOME: process.env.PRJCT_HOME } : {}) };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${[process.execPath, entry, 'once', '--scheduled'].map(value => `<string>${xml(value)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict>${Object.entries(variables).map(([key, value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/>
<key>StartCalendarInterval</key><dict><key>Minute</key><integer>${settings.minute}</integer></dict>
<key>StandardOutPath</key><string>${xml(join(stateDir(), 'worker.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(stateDir(), 'worker-error.log'))}</string>
<key>ProcessType</key><string>Background</string>
</dict></plist>\n`;
}
export async function installSchedule(entry: string) {
  if (process.platform !== 'darwin') throw new Error('Use an OS scheduler to run pi-signals once --scheduled hourly on this platform.');
  const directory = join(homedir(), 'Library', 'LaunchAgents'), file = join(directory, `${label}.plist`);
  await mkdir(directory, { recursive: true }); await mkdir(stateDir(), { recursive: true, mode: 0o700 });
  await writeFile(file, launchAgent(entry), { mode: 0o600 });
  const domain = `gui/${process.getuid!()}`;
  const loaded = await command(stateDir(), ['launchctl', 'print', `${domain}/${label}`]);
  if (loaded.code !== 0) await must(stateDir(), ['launchctl', 'bootstrap', domain, file]);
  return { installed: true, file, schedule: config().timezone, existingProcessesStopped: false };
}
