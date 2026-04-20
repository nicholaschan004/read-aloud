import express from 'express';
import 'dotenv/config';
import handler from './api/analyze.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.post('/api/analyze', (req, res) => handler(req, res));

app.listen(3001, () => console.log('API dev server on :3001'));
