import app from './app.js';
import { cfg } from './config.js';

app.listen(cfg.port, () => {
  console.log(`AgentDesk API → http://localhost:${cfg.port}`);
});
