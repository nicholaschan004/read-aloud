import express from 'express';
import 'dotenv/config';
import analyzeHandler from './api/analyze.js';
import speakHandler from './api/speak.js';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.post('/api/analyze', (req, res) => analyzeHandler(req, res));
app.post('/api/speak',   (req, res) => speakHandler(req, res));

app.listen(3001, () => console.log('API dev server on :3001'));
