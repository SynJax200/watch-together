if (typeof io === "undefined") {
  document.getElementById("statusText").textContent =
    "Socket.io failed to load - refresh the page";
  throw new Error("socket.io client library not loaded");
}

const socket = io();

const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const shareBtn = document.getElementById("shareBtn");
const stopBtn = document.getElementById("stopBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const statsLine = document.getElementById("statsLine");

// ---- ICE server config ----
// STUN finds a direct path; TURN relays traffic when a direct path is blocked.
const TURN_USERNAME = "b24bfb098bf0b8b5fa150152";
const TURN_PASSWORD = "iWNYzJVnwefNaVXL";

const ICE_SERVERS = [
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:global.relay.metered.ca:80", username: TURN_USERNAME, credential: TURN_PASSWORD },
  { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: TURN_USERNAME, credential: TURN_PASSWORD },
  { urls: "turn:global.relay.metered.ca:443", username: TURN_USERNAME, credential: TURN_PASSWORD },
  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: TURN_USERNAME, credential: TURN_PASSWORD }
];

let localStream = null;
let peerConnection = null;
let remoteSocketId = null;
let currentRoom = null;
let pendingCandidates = [];
let rejoining = false;
let rejoinAttempts = 0;
let iceRestarts = 0;
let iceState = "-";
let lastRtt = null;
let lastLost = null;
const candidateCounts = { host: 0, srflx: 0, relay: 0 };

// state: "down" | "waiting" | "peer" | "live"
function setStatus(state) {
  const labels = {
    down: "Link down",
    waiting: "Waiting for peer",
    peer: "Peer in room",
    live: "Link established"
  };
  statusDot.classList.toggle("live", state === "live");
  statusText.textContent = labels[state];
}

// Debug line under the videos: shows why a connection works or fails
function renderStatsLine() {
  let line =
    "ICE: " + iceState +
    " | candidates host:" + candidateCounts.host +
    " srflx:" + candidateCounts.srflx +
    " relay:" + candidateCounts.relay;
  if (lastRtt != null) line += " | Ping: " + lastRtt + "ms";
  if (lastLost != null) line += " | Packets lost: " + lastLost;
  statsLine.textContent = line;
}

function joinRoom() {
  if (!currentRoom) return;
  socket.emit("join-room", currentRoom);
}

function closePeerConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  pendingCandidates = [];
  remoteSocketId = null;
  remoteVideo.srcObject = null;
  iceState = "-";
  lastRtt = null;
  lastLost = null;
  renderStatsLine();
}

joinBtn.addEventListener("click", () => {
  const room = roomInput.value.trim();
  if (!room) {
    alert("Please enter a room code first");
    return;
  }
  currentRoom = room;
  rejoining = false;
  joinRoom();
  joinBtn.disabled = true;
  roomInput.disabled = true;
});

// Fires on the first connect and on every automatic reconnect
socket.on("connect", () => {
  if (currentRoom) {
    rejoining = true;
    rejoinAttempts = 0;
    joinRoom();
  }
});

socket.on("disconnect", () => {
  setStatus("down");
  closePeerConnection();
});

socket.on("joined-room", ({ otherUsers }) => {
  rejoining = false;
  shareBtn.disabled = !!localStream;
  if (otherUsers.length > 0) {
    remoteSocketId = otherUsers[0];
    setStatus("peer");
    // If we were already sharing (for example after a reconnect), send a fresh offer
    if (localStream) {
      createPeerConnection();
      addLocalTracks();
      makeOffer();
    }
  } else {
    setStatus("waiting");
  }
});

socket.on("room-full", () => {
  // After a reconnect the old socket may still be counted for a few seconds
  if (rejoining && rejoinAttempts < 6) {
    rejoinAttempts++;
    setTimeout(joinRoom, 3000);
    return;
  }
  rejoining = false;
  currentRoom = null;
  joinBtn.disabled = false;
  roomInput.disabled = false;
  alert("This room is already full (max 2 people). Try a different room code.");
});

socket.on("user-joined", ({ socketId }) => {
  remoteSocketId = socketId;
  setStatus("peer");
  // If we are already sharing, send an offer so the new peer gets our stream
  if (localStream) {
    createPeerConnection();
    addLocalTracks();
    makeOffer();
  }
});

socket.on("user-left", ({ socketId }) => {
  if (socketId && remoteSocketId && socketId !== remoteSocketId) return;
  closePeerConnection();
  setStatus("waiting");
});

socket.on("signal", async ({ from, data }) => {
  remoteSocketId = from;
  if (!peerConnection) createPeerConnection();

  try {
    if (data.type === "offer") {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
      await flushPendingCandidates();
      if (localStream) addLocalTracks();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit("signal", { to: from, data: peerConnection.localDescription });
    } else if (data.type === "answer") {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
      await flushPendingCandidates();
    } else if (data.candidate) {
      // Candidates can arrive before the offer or answer is applied, so queue them
      if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      } else {
        pendingCandidates.push(data);
      }
    }
  } catch (e) {
    console.warn("Signaling error", e);
  }
});

async function flushPendingCandidates() {
  const queued = pendingCandidates;
  pendingCandidates = [];
  for (const c of queued) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      console.warn("ICE candidate error", e);
    }
  }
}

function createPeerConnection() {
  if (peerConnection) return;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConnection = pc;

  candidateCounts.host = 0;
  candidateCounts.srflx = 0;
  candidateCounts.relay = 0;
  iceState = "new";
  renderStatsLine();

  pc.onicecandidate = (event) => {
    if (pc !== peerConnection || !event.candidate) return;
    const type = event.candidate.type;
    if (type in candidateCounts) candidateCounts[type]++;
    renderStatsLine();
    if (remoteSocketId) {
      socket.emit("signal", { to: remoteSocketId, data: event.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc !== peerConnection) return;
    iceState = pc.iceConnectionState;
    renderStatsLine();
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    setStatus("live");
  };

  pc.onconnectionstatechange = () => {
    if (pc !== peerConnection) return;
    console.log("Connection state:", pc.connectionState);
    if (pc.connectionState === "connected") {
      iceRestarts = 0;
      setStatus("live");
    } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      setStatus(remoteSocketId ? "peer" : "down");
      // The sharing side retries a few times by restarting ICE
      if (pc.connectionState === "failed" && localStream && iceRestarts < 3) {
        iceRestarts++;
        pc.restartIce();
        makeOffer();
      }
    }
  };
}

function addLocalTracks() {
  if (!localStream || !peerConnection) return;
  const senders = peerConnection.getSenders().map((s) => s.track);
  localStream.getTracks().forEach((track) => {
    if (!senders.includes(track)) {
      peerConnection.addTrack(track, localStream);
    }
  });
}

async function makeOffer() {
  const pc = peerConnection;
  if (!pc || !remoteSocketId) return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: remoteSocketId, data: pc.localDescription });
  } catch (e) {
    console.warn("Offer error", e);
  }
}

shareBtn.addEventListener("click", async () => {
  try {
    localStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: true,
      // Chrome only: hide this tab from the picker so the page cannot capture itself
      selfBrowserSurface: "exclude"
    });
  } catch (err) {
    alert("Screen share permission was not granted: " + err.message);
    return;
  }

  localVideo.srcObject = localStream;
  shareBtn.disabled = true;
  stopBtn.disabled = false;

  // Stop sharing if the user clicks the browser's own "Stop sharing" control
  localStream.getVideoTracks()[0].addEventListener("ended", stopSharing);

  if (remoteSocketId) {
    createPeerConnection();
    addLocalTracks();
    makeOffer();
  }
});

stopBtn.addEventListener("click", stopSharing);

function stopSharing() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  shareBtn.disabled = false;
  stopBtn.disabled = true;
}

// Poll connection stats every 2 seconds (ping and packet loss)
setInterval(async () => {
  if (!peerConnection) return;
  try {
    const stats = await peerConnection.getStats();
    let rtt = null;
    let lost = null;
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && report.state === "succeeded") {
        if (report.currentRoundTripTime != null) {
          rtt = Math.round(report.currentRoundTripTime * 1000);
        }
      }
      if (report.type === "inbound-rtp" && report.kind === "video") {
        lost = report.packetsLost;
      }
    });
    lastRtt = rtt;
    lastLost = lost;
    renderStatsLine();
  } catch (e) {
    // The connection may have closed while stats were being collected
  }
}, 2000);

// ---- Fullscreen support (like YouTube) ----
function toggleFullscreen(videoEl) {
  if (!document.fullscreenElement) {
    videoEl.requestFullscreen().catch((err) => {
      console.warn("Fullscreen request failed:", err);
    });
  } else {
    document.exitFullscreen();
  }
}

document.querySelectorAll(".fullscreen-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-target");
    toggleFullscreen(document.getElementById(targetId));
  });
});

// Double-click on either video also toggles fullscreen
localVideo.addEventListener("dblclick", () => toggleFullscreen(localVideo));
remoteVideo.addEventListener("dblclick", () => toggleFullscreen(remoteVideo));