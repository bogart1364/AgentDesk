/**
 * Vercel serverless entry — imports the shared Express app.
 * vercel.json rewrites /api/* → this function.
 */
import app from '../server/src/app.js';

export default app;
