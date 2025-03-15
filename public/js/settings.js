// settings.js

// Load settings from the server and fill in the form fields
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    document.getElementById('username').value = data.settings.username;
    document.getElementById('joinCommand').value = data.settings.joinCommand;
    document.getElementById('queueLimit').value = data.settings.queueLimit;
    console.log("[SETTINGS PAGE] Loaded settings:", data.settings);
  } catch (err) {
    console.error("Error loading settings:", err);
  }
}

// Save modifications made in the settings form
document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = {
    username: document.getElementById('username').value,
    joinCommand: document.getElementById('joinCommand').value,
    queueLimit: parseInt(document.getElementById('queueLimit').value, 10)
  };
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const data = await res.json();
    alert('Settings saved!');
    console.log("[SETTINGS PAGE] Updated settings:", data.settings);
    // Reload settings to confirm update
    loadSettings();
  } catch (err) {
    console.error("Error saving settings:", err);
  }
});

// Connect to TikTok Live and update status
document.getElementById('connectTikTok').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/tiktok/connect', { method: 'POST' });
    const data = await res.json();
    alert(data.message);
    console.log("[SETTINGS PAGE] TikTok connection response:", data);
    updateTikTokStatus();
  } catch (err) {
    console.error("Error connecting to TikTok Live:", err);
  }
});

// Update the TikTok status indicator by querying the server
async function updateTikTokStatus() {
  try {
    const res = await fetch('/api/tiktok/status');
    const data = await res.json();
    document.getElementById('tiktokStatus').innerText = data.connected ? "Connected" : "Disconnected";
    console.log("[SETTINGS PAGE] TikTok status:", data.connected);
  } catch (err) {
    console.error("Error updating TikTok status:", err);
  }
}

// Refresh the status every 5 seconds
setInterval(updateTikTokStatus, 5000);

// On page load, update the status and load settings
updateTikTokStatus();
loadSettings();
