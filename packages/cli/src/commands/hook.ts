import { execSync } from 'child_process';

function findClaudePath(): string {
  try {
    const out = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (out) return out;
  } catch { /* ignore */ }
  return '/opt/homebrew/bin/claude';
}

export async function commandHook(): Promise<void> {
  const claudePath = findClaudePath();
  console.log(`# starnose: print a session summary after every claude run`);
  console.log(`claude() {`);
  console.log(`  ${claudePath} "$@"`);
  console.log(`  local exit_code=$?`);
  console.log(`  snose summary`);
  console.log(`  return $exit_code`);
  console.log(`}`);
}
