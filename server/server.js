import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { pool } from './src/db/pool.js';
import { migrate } from './src/db/migrate.js';
import { createItemsRepository } from './src/repositories/itemsRepository.js';
import { createIdempotencyStore } from './src/services/idempotencyStore.js';
import { createItemsService } from './src/services/itemsService.js';
import { createBroadcaster } from './src/realtime/broadcaster.js';
import { createItemsRouter } from './src/routes/itemsRoutes.js';
import { createBarcodeRepository } from './src/repositories/barcodeRepository.js';
import { createBarcodeService } from './src/services/barcodeService.js';
import { createBarcodeRouter } from './src/routes/barcodeRoutes.js';
import { lookupProduct } from './src/integrations/openFoodFacts.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

const defaultHouseholdId = await migrate();

const itemsRepository = createItemsRepository(pool);
const idempotencyStore = createIdempotencyStore();
const itemsService = createItemsService(itemsRepository, idempotencyStore);
const broadcaster = createBroadcaster();
const barcodeRepository = createBarcodeRepository(pool);
const barcodeService = createBarcodeService(barcodeRepository, lookupProduct);

const app = express();
app.use(morgan('dev'));
app.use(express.json());
if (NODE_ENV !== 'production' && CORS_ORIGIN) {
  app.use(cors({ origin: CORS_ORIGIN }));
}

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.use(createItemsRouter({ itemsService, broadcaster, defaultHouseholdId, barcodeRepository }));
app.use(createBarcodeRouter({ barcodeService, defaultHouseholdId }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  broadcaster.subscribe(defaultHouseholdId, socket);
  socket.on('close', () => broadcaster.unsubscribe(defaultHouseholdId, socket));
});

server.listen(PORT, () => {
  console.log(`Shopping List server listening on http://localhost:${PORT}`);
});
