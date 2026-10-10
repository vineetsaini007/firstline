import { createApp } from './app.js';

const app = createApp();
const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log(`Firstline is running at http://localhost:${server.address().port}`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
