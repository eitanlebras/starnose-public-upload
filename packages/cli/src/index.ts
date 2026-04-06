#!/usr/bin/env node

const command = process.argv[2] ?? 'status';

async function main() {
  switch (command) {
    case 'on': {
      const { commandOn } = await import('./commands/on.js');
      await commandOn();
      break;
    }
    case 'off': {
      const { commandOff } = await import('./commands/off.js');
      await commandOff();
      break;
    }
    case 'status': {
      const { commandStatus } = await import('./commands/status.js');
      await commandStatus();
      break;
    }
    case 'sense': {
      const { commandSense } = await import('./commands/sense.js');
      await commandSense();
      break;
    }
    case 'dig': {
      const { commandDig } = await import('./commands/dig/index.js');
      const sessionId = process.argv[3];
      await commandDig(sessionId);
      break;
    }
    default: {
      console.log(`starnose — see what claude code is doing\n`);
      console.log('commands:');
      console.log('  snose on       start daemon');
      console.log('  snose off      stop daemon');
      console.log('  snose status   health check');
      console.log('  snose sense    live activity monitor');
      console.log('  snose dig      full interactive inspector');
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
