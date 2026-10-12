// server.js
// This is the "signaling server". Its only job is to introduce two users
// to each other (like a matchmaker). The actual screen data does NOT pass
// through this server — it flows directly peer-to-peer via WebRTC.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

// room -> list of socket ids currently in that room
const rooms = {};

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  socket.on("join-room", (roomId) => {
    // Simple 2-person room logic
    if (!rooms[roomId]) rooms[roomId] = [];

    if (rooms[roomId].length >= 2) {
      socket.emit("room-full");
      return;
    }

    rooms[roomId].push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;

    const otherUsers = rooms[roomId].filter((id) => id !== socket.id);
    socket.emit("joined-room", { roomId, otherUsers });

    // tell existing user in room that someone new joined
    socket.to(roomId).emit("user-joined", { socketId: socket.id });
  });

  // Relay WebRTC signaling messages (offer/answer/ice-candidates) between the two peers
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
      socket.to(roomId).emit("user-left", { socketId: socket.id });
      if (rooms[roomId].length === 0) delete rooms[roomId];
    }
    console.log("Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});