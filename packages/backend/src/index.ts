import express from 'express';
import cors from 'cors';
import { analysisRouter } from './routes/analysis';
import { repoRouter } from './routes/repo';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes — prefixed (e.g. /api/analysis/tabs for internal use)
app.use('/api/analysis', analysisRouter);
app.use('/api/repo', repoRouter);

// Routes — flat under /api (what the frontend calls: /api/upload_excel, /api/load_tabs, etc.)
app.use('/api', analysisRouter);
app.use('/api', repoRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.listen(PORT, () => {
  console.log(`RHWBlazeMapper API running on http://localhost:${PORT}`);
});

export default app;
