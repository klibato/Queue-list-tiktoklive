import express from 'express';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import pkg from 'tiktok-live-connector';
import path from 'path';
import { fileURLToPath } from 'url';
const { WebcastPushConnection } = pkg;

const app = express();
const port = 3000;

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from the "public" folder
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route for the home page (root URL)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

const defaultData = {
  queue: [],
  selected: null,
  settings: {
    username: "YourTikTokUsername", // Replace with your TikTok username
    joinCommand: "!join",
    queueLimit: 10
  }
};

const adapter = new JSONFile('db.json');
const db = new Low(adapter, defaultData);

// Load the database at startup
(async () => {
  await db.read();
  db.data ||= defaultData;
  await db.write();
  console.log("Database initialized:", db.data);
})();

let tiktokLive = null;
let tiktokConnected = false;
let connectionTimestamp = null; // Stores the connection time

/* ===== ENDPOINTS FOR QUEUE & SETTINGS MANAGEMENT ===== */

// Add a user to the queue via POST /api/join
app.post('/api/join', async (req, res) => {
  const { username } = req.body;
  console.log(`[JOIN] Attempting to add ${username}`);
  // Check if the user is already in the queue or currently selected
  if (!db.data.queue.find(u => u.username === username) &&
      (!db.data.selected || db.data.selected.username !== username)) {
    if (db.data.queue.length < db.data.settings.queueLimit) {
      db.data.queue.push({ username, joinedAt: Date.now() });
      await db.write();
      console.log(`[JOIN] ${username} added to the queue.`);
      return res.json({ success: true });
    } else {
      console.log(`[JOIN] Queue full, cannot add ${username}.`);
      return res.status(400).json({ success: false, message: "Queue full" });
    }
  }
  console.log(`[JOIN] ${username} is already in the queue or selected.`);
  res.json({ success: false, message: "Already in queue or selected" });
});

// Select the next player via POST /api/select
app.post('/api/select', async (req, res) => {
  console.log("[SELECT] Attempting to select the next player.");
  if (db.data.queue.length > 0) {
    const nextUser = db.data.queue.shift();
    db.data.selected = nextUser;
    await db.write();
    console.log(`[SELECT] ${nextUser.username} selected.`);
    return res.json({ success: true, selected: nextUser });
  }
  console.log("[SELECT] The queue is empty.");
  res.json({ success: false, message: 'Queue is empty' });
});

// Retrieve the queue and selected player via GET /api/queue
app.get('/api/queue', (req, res) => {
  console.log("[QUEUE] Retrieving the queue.");
  res.json({ queue: db.data.queue, selected: db.data.selected });
});

// Reset the queue and selected player via POST /api/queue/reset
app.post('/api/queue/reset', async (req, res) => {
  console.log("[RESET] Reset queue requested.");
  db.data.queue = [];
  db.data.selected = null;
  await db.write();
  return res.json({ success: true, message: "Queue has been reset." });
});

// Get and update settings via GET and POST /api/settings
app.get('/api/settings', (req, res) => {
  console.log("[SETTINGS] Retrieving settings.");
  res.json({ settings: db.data.settings });
});
app.post('/api/settings', async (req, res) => {
  console.log("[SETTINGS] Updating settings:", req.body);
  db.data.settings = { ...db.data.settings, ...req.body };
  await db.write();
  console.log("[SETTINGS] New settings:", db.data.settings);
  res.json({ success: true, settings: db.data.settings });
});

/* ===== ENDPOINTS FOR TIKTOK LIVE CONNECTION ===== */

// Connect to TikTok Live via POST /api/tiktok/connect
app.post('/api/tiktok/connect', async (req, res) => {
  console.log("[TIKTOK CONNECT] TikTok Live connection request received.");
  await db.read();
  const tiktokUsername = db.data.settings.username;
  console.log("[TIKTOK CONNECT] Username used:", tiktokUsername);

  // If a connection already exists, disconnect it
  if (tiktokLive) {
    try {
      tiktokLive.disconnect();
      console.log("[TIKTOK CONNECT] Existing session disconnected.");
    } catch (err) {
      console.error("[TIKTOK CONNECT] Error disconnecting existing session:", err.message);
    }
  }

  try {
    tiktokLive = new WebcastPushConnection(tiktokUsername);
    
    tiktokLive.on('connect', () => {
      tiktokConnected = true;
      connectionTimestamp = Date.now();
      console.log(`[TIKTOK] Connected to TikTok Live for ${tiktokUsername} at ${new Date(connectionTimestamp).toLocaleString()}`);
    });

    tiktokLive.on('disconnect', () => {
      tiktokConnected = false;
      console.log(`[TIKTOK] Disconnected from TikTok Live for ${tiktokUsername}`);
    });

    tiktokLive.on('chat', async (data) => {
      console.log(`[TIKTOK CHAT] Full data for ${data.uniqueId}:`, data);
      
      if (data.comment.trim() === db.data.settings.joinCommand) {
        // Check that the user has followStatus > 0 (i.e., 1 or 2)
        if (data.followInfo && data.followInfo.followStatus > 0) {
          // Check that the user is not already in the queue or selected
          if (!db.data.queue.find(u => u.username === data.uniqueId) &&
              (!db.data.selected || db.data.selected.username !== data.uniqueId)) {
            console.log(`[TIKTOK CHAT] Join command received from ${data.uniqueId} (followStatus: ${data.followInfo.followStatus}).`);
            if (db.data.queue.length < db.data.settings.queueLimit) {
              db.data.queue.push({ username: data.uniqueId, joinedAt: Date.now() });
              await db.write();
              console.log(`[TIKTOK CHAT] ${data.uniqueId} added to the queue.`);
            } else {
              console.log("[TIKTOK CHAT] Queue is full, cannot add new user.");
            }
          } else {
            console.log(`[TIKTOK CHAT] ${data.uniqueId} is already in the queue or selected.`);
          }
        } else {
          console.log(`[TIKTOK CHAT] ${data.uniqueId} is not a follower (followStatus: ${data.followInfo ? data.followInfo.followStatus : 'unknown'}). Ignored.`);
        }
      }
    });

    await tiktokLive.connect();
    tiktokConnected = true;
    console.log("[TIKTOK CONNECT] Connection established.");
    return res.json({ success: true, message: "Connected to TikTok Live", connected: tiktokConnected });
  } catch (err) {
    tiktokConnected = false;
    console.error("[TIKTOK CONNECT] Error connecting to TikTok Live:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Return the TikTok Live connection status via GET /api/tiktok/status
app.get('/api/tiktok/status', (req, res) => {
  res.json({ connected: tiktokConnected });
});

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
