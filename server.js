import express from 'express';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import pkg from 'tiktok-live-connector';
const { WebcastPushConnection } = pkg;

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

const defaultData = {
  queue: [],
  selected: null,
  settings: {
    username: "YourTikTokUsername", // Remplacez par votre nom d'utilisateur TikTok
    joinCommand: "!join",
    queueLimit: 10
  }
};

const adapter = new JSONFile('db.json');
const db = new Low(adapter, defaultData);

// Chargement de la base de données au démarrage
(async () => {
  await db.read();
  db.data ||= defaultData;
  await db.write();
  console.log("Base de données initialisée :", db.data);
})();

let tiktokLive = null;
let tiktokConnected = false;
let connectionTimestamp = null; // Stocke le moment de la connexion

/* ===== ENDPOINTS POUR LA GESTION DE LA FILE ET DES PARAMÈTRES ===== */

// Ajouter un utilisateur à la file via API POST /api/join
app.post('/api/join', async (req, res) => {
  const { username } = req.body;
  console.log(`[JOIN] Tentative d'ajout de ${username}`);
  // Vérifie si l'utilisateur est déjà dans la file ou est actuellement sélectionné
  if (!db.data.queue.find(u => u.username === username) && (!db.data.selected || db.data.selected.username !== username)) {
    if (db.data.queue.length < db.data.settings.queueLimit) {
      db.data.queue.push({ username, joinedAt: Date.now() });
      await db.write();
      console.log(`[JOIN] ${username} ajouté à la file.`);
      return res.json({ success: true });
    } else {
      console.log(`[JOIN] File pleine, impossible d'ajouter ${username}.`);
      return res.status(400).json({ success: false, message: "Queue full" });
    }
  }
  console.log(`[JOIN] ${username} est déjà dans la file ou sélectionné.`);
  res.json({ success: false, message: "Already in queue or selected" });
});

// Sélectionner le prochain joueur via API POST /api/select
app.post('/api/select', async (req, res) => {
  console.log("[SELECT] Tentative de sélection du prochain joueur.");
  if (db.data.queue.length > 0) {
    const nextUser = db.data.queue.shift();
    db.data.selected = nextUser;
    await db.write();
    console.log(`[SELECT] ${nextUser.username} sélectionné.`);
    return res.json({ success: true, selected: nextUser });
  }
  console.log("[SELECT] La file est vide.");
  res.json({ success: false, message: 'La file est vide' });
});

// Récupérer la file et le joueur sélectionné via API GET /api/queue
app.get('/api/queue', (req, res) => {
  console.log("[QUEUE] Récupération de la file d'attente.");
  res.json({ queue: db.data.queue, selected: db.data.selected });
});

// Endpoint pour réinitialiser la file d'attente et le joueur sélectionné
app.post('/api/queue/reset', async (req, res) => {
  console.log("[RESET] Réinitialisation de la file d'attente demandée.");
  db.data.queue = [];
  db.data.selected = null;
  await db.write();
  return res.json({ success: true, message: "La file d'attente a été réinitialisée." });
});

// Récupérer et mettre à jour les paramètres via API GET et POST /api/settings
app.get('/api/settings', (req, res) => {
  console.log("[SETTINGS] Récupération des paramètres.");
  res.json({ settings: db.data.settings });
});
app.post('/api/settings', async (req, res) => {
  console.log("[SETTINGS] Mise à jour des paramètres :", req.body);
  db.data.settings = { ...db.data.settings, ...req.body };
  await db.write();
  console.log("[SETTINGS] Nouveaux paramètres :", db.data.settings);
  res.json({ success: true, settings: db.data.settings });
});

/* ===== ENDPOINTS POUR LA CONNEXION TIKTOK LIVE ===== */

// Lancer la connexion TikTok Live via API POST /api/tiktok/connect
app.post('/api/tiktok/connect', async (req, res) => {
  console.log("[TIKTOK CONNECT] Requête de connexion TikTok Live reçue.");
  await db.read();
  const tiktokUsername = db.data.settings.username;
  console.log("[TIKTOK CONNECT] Nom d'utilisateur utilisé :", tiktokUsername);

  // Si une connexion existe déjà, la déconnecter
  if (tiktokLive) {
    try {
      tiktokLive.disconnect();
      console.log("[TIKTOK CONNECT] Déconnexion de la session existante.");
    } catch (err) {
      console.error("[TIKTOK CONNECT] Erreur lors de la déconnexion :", err.message);
    }
  }

  try {
    tiktokLive = new WebcastPushConnection(tiktokUsername);
    
    tiktokLive.on('connect', () => {
      tiktokConnected = true;
      connectionTimestamp = Date.now();
      console.log(`[TIKTOK] Connecté au live TikTok pour ${tiktokUsername} à ${new Date(connectionTimestamp).toLocaleString()}`);
    });

    tiktokLive.on('disconnect', () => {
      tiktokConnected = false;
      console.log(`[TIKTOK] Déconnecté du live TikTok pour ${tiktokUsername}`);
    });

    tiktokLive.on('chat', async (data) => {
      console.log(`[TIKTOK CHAT] Data complète pour ${data.uniqueId}:`, data);
      
      if (data.comment.trim() === db.data.settings.joinCommand) {
        // Vérifier que l'utilisateur a followStatus > 0 (donc 1 ou 2)
        if (data.followInfo && data.followInfo.followStatus > 0) {
          // Vérifier que l'utilisateur n'est pas déjà dans la file ou sélectionné
          if (!db.data.queue.find(u => u.username === data.uniqueId) && (!db.data.selected || db.data.selected.username !== data.uniqueId)) {
            console.log(`[TIKTOK CHAT] Commande join reçue de ${data.uniqueId} (followStatus: ${data.followInfo.followStatus}).`);
            if (db.data.queue.length < db.data.settings.queueLimit) {
              db.data.queue.push({ username: data.uniqueId, joinedAt: Date.now() });
              await db.write();
              console.log(`[TIKTOK CHAT] ${data.uniqueId} ajouté à la file.`);
            } else {
              console.log("[TIKTOK CHAT] La file est pleine, impossible d’ajouter un nouvel utilisateur.");
            }
          } else {
            console.log(`[TIKTOK CHAT] ${data.uniqueId} est déjà dans la file ou sélectionné.`);
          }
        } else {
          console.log(`[TIKTOK CHAT] ${data.uniqueId} n'est pas follower (followStatus: ${data.followInfo ? data.followInfo.followStatus : 'inconnu'}). Ignoré.`);
        }
      }
    });

    await tiktokLive.connect();
    tiktokConnected = true;
    console.log("[TIKTOK CONNECT] Connexion établie.");
    return res.json({ success: true, message: "Connecté à TikTok Live", connected: tiktokConnected });
  } catch (err) {
    tiktokConnected = false;
    console.error("[TIKTOK CONNECT] Erreur lors de la connexion à TikTok Live :", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Retourner le statut de la connexion TikTok Live via API GET /api/tiktok/status
app.get('/api/tiktok/status', (req, res) => {
  res.json({ connected: tiktokConnected });
});

app.listen(port, () => {
  console.log(`Application en écoute sur le port ${port}`);
});
