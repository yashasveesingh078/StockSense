require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('./middleware');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api', requireAuth, require('./routes/master'));
app.use('/api', requireAuth, require('./routes/operations'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built React app from the same server.
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Central error handler: business errors -> 4xx with a readable message.
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'That value already exists' });
  if (String(err.message).includes('FOREIGN KEY')) return res.status(400).json({ error: 'This record is in use or refers to something missing' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`StockSense API running on http://localhost:${PORT}`));