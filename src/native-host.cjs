// Chrome launches this small relay through the installed Svara executable.
// No account credentials or page data are written to disk or diagnostic output.
const net = require('node:net');
const [socketPath, extensionId, origin] = process.argv.slice(2);
if (!/^[a-p]{32}$/.test(extensionId || '') || origin !== `chrome-extension://${extensionId}/`) process.exit(1);
const socket = net.connect(socketPath);
socket.once('connect', () => {
  const hello = Buffer.from(JSON.stringify({ type: 'hello', extensionId }));
  const size = Buffer.alloc(4); size.writeUInt32LE(hello.length);
  socket.write(Buffer.concat([size, hello]));
  process.stdin.pipe(socket); socket.pipe(process.stdout);
});
socket.on('error', () => process.exit(1));
socket.on('close', () => process.exit(0));
process.stdin.on('end', () => socket.end());
process.stdout.on('error', () => socket.destroy());
