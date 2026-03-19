import express from 'express';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

const convex = new ConvexHttpClient(process.env.CONVEX_URL!)

app.use(express.json());

// GHL OAuth Callback
app.get('/ghl/oauth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // TODO: Exchange code for access token
  // TODO: Fetch GHL location details
  // TODO: Create/update user in Convex

  res.send('GHL account connected successfully!');
});

// GHL Webhook Receiver
app.post('/ghl/webhooks', async (req, res) => {
  // TODO: Validate webhook signature
  const event = req.body;

  // TODO: Route event to the appropriate agent

  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`Orchestration server listening on port ${port}`);
});
