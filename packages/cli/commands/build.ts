import generateFiles from './utils/generate';

async function runBuildCommand() {
  console.log('Starting Monorise build...');
  await generateFiles();
}

export default runBuildCommand;
