import { dbState } from '../config/db.js';

// Always 200: this doubles as the host's liveness check, and a database blip should not restart the process.
export function getHealth(_req, res) {
  res.json({
    status: 'ok',
    database: dbState(),
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}
