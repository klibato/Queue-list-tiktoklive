async function fetchQueue() {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      const queueList = document.getElementById('queueList');
      const selectedList = document.getElementById('selectedList');
      
      if (data.queue.length > 0) {
        queueList.innerHTML = data.queue.map(u => `<li>${u.username}</li>`).join('');
      } else {
        queueList.innerHTML = '<li>The queue is empty</li>';
      }
      
      if (data.selected) {
        selectedList.innerHTML = `<li>${data.selected.username}</li>`;
      } else {
        selectedList.innerHTML = '<li>No player selected</li>';
      }
    } catch (err) {
      console.error("Error retrieving the queue:", err);
    }
  }
  
  document.getElementById('selectBtn').addEventListener('click', async () => {
    await fetch('/api/select', { method: 'POST' });
    fetchQueue();
  });
  
  document.getElementById('resetQueue').addEventListener('click', async () => {
    if (confirm("Are you sure you want to reset the queue?")) {
      const res = await fetch('/api/queue/reset', { method: 'POST' });
      const data = await res.json();
      alert(data.message);
      fetchQueue();
    }
  });
  
  // "Home" button: redirects to the home page (modify the link if necessary)
  document.getElementById('returnHome').addEventListener('click', () => {
    window.location.href = "home.html"; // or "index.html" depending on your configuration
  });
  
  // Optional: manually add a player for testing
  document.getElementById('addPlayerBtn').addEventListener('click', async () => {
    const playerInput = document.getElementById('playerInput');
    const username = playerInput.value.trim();
    if (username) {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (data.success) {
        alert(username + " added to the queue.");
      } else {
        alert("Error: " + data.message);
      }
      playerInput.value = "";
      fetchQueue();
    }
  });
  
  // Automatically update every 5 seconds
  setInterval(fetchQueue, 1000);
  fetchQueue();
  