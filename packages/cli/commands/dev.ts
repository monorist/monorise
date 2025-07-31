import path from 'node:path';
import chokidar from 'chokidar';
import generateFiles from './utils/generate';

async function runDevCommand() {
  const configDir = await generateFiles();

  console.log(`Watching for changes in ${configDir}...`);
  const watcher = chokidar.watch(configDir, {
    ignored: (watchedPath: string) => {
      const fileName = path.basename(watchedPath);
      return (
        fileName === 'index.ts' || // Old name, still ignore in case it exists
        fileName.startsWith('.') ||
        watchedPath.endsWith('.js') ||
        watchedPath.endsWith('.jsx') ||
        watchedPath.endsWith('.d.ts')
      );
    },
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('add', async (filePath) => {
    console.log(`File ${filePath} has been added. Regenerating...`);
    try {
      await generateFiles();
    } catch (err) {
      console.error('Regeneration failed:', err);
    }
  });

  watcher.on('change', async (filePath) => {
    console.log(`File ${filePath} has been changed. Regenerating...`);
    try {
      await generateFiles();
    } catch (err) {
      console.error('Regeneration failed:', err);
    }
  });

  watcher.on('unlink', async (filePath) => {
    console.log(`File ${filePath} has been removed. Regenerating...`);
    try {
      await generateFiles();
    } catch (err) {
      console.error('Regeneration failed:', err);
    }
  });

  process.on('SIGINT', () => {
    console.log('Monorise dev terminated. Closing watcher and sst dev...');
    watcher.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('Monorise dev terminated. Closing watcher and sst dev...');
    watcher.close();
    process.exit(0);
  });
}

export default runDevCommand;
