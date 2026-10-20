// Local-only signaling fixture for the Flutter credential lifecycle regression.
import { createSignalingServer } from '../../server/index.mjs';

const server = createSignalingServer();
server.http.listen(0, '127.0.0.1', () => {
  console.log(server.http.address().port);
});
process.stdin.resume();
process.stdin.on('end', async () => {
  await server.close();
  process.exit(0);
});
