import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

interface Item {
  id: string;
  type: 'bomb' | 'doubleshot';
  position: { x: number, y: number, z: number };
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  // Configurar Socket.io para la comunicación en tiempo real
  const io = new Server(httpServer, {
    cors: {
      origin: "*", // Permitir conexiones desde cualquier origen
    }
  });

  const PORT = 3000;
  
  const rooms = new Map<string, {
    players: Set<string>;
    items: Map<string, Item>;
    interval?: NodeJS.Timeout;
  }>();

  const playerPositions = new Map<string, { x: number, y: number, z: number }>();
  const playerEnergy = new Map<string, number>();

  // --- FASE 1: LÓGICA DEL SERVIDOR MULTIJUGADOR ---
  io.on("connection", (socket) => {
    console.log("🟢 Un jugador se ha conectado:", socket.id);
    playerEnergy.set(socket.id, 100);

    // Unirse a una sala específica
    socket.on("join-room", ({ roomId, playerName }) => {
      socket.join(roomId);
      socket.data.roomId = roomId; // Guardar la sala en la sesión del socket
      socket.data.playerName = playerName;
      console.log(`Jugador ${socket.id} (${playerName}) se unió a la sala: ${roomId}`);
      
      if (!rooms.has(roomId)) {
        const items = new Map<string, Item>();
        const room = { players: new Set<string>(), items, interval: undefined as NodeJS.Timeout | undefined };
        rooms.set(roomId, room);
        
        // Generar items aleatorios cada 5 segundos
        room.interval = setInterval(() => {
          if (room.items.size >= 2) return; // Máximo 2 objetos en simultáneo

          let refX = 0;
          let refZ = 0;
          
          // Buscar la posición del primer jugador para usarla como referencia
          if (room.players.size > 0) {
            const firstPlayerId = Array.from(room.players)[0];
            const firstPlayerPos = playerPositions.get(firstPlayerId);
            if (firstPlayerPos) {
              refX = firstPlayerPos.x;
              refZ = firstPlayerPos.z;
            }
          }

          const id = Math.random().toString(36).substring(2, 9);
          const type: 'bomb' | 'doubleshot' = Math.random() > 0.6 ? 'doubleshot' : 'bomb'; // 40% doubleshot, 60% bomb
          const angle = Math.random() * Math.PI * 2;
          const radius = 0.5 + Math.random() * 1.5; // 0.5 a 2 metros de distancia (más cerca)
          
          const item = {
            id,
            type,
            position: {
              x: refX + Math.cos(angle) * radius,
              y: 0, // El cliente ajustará la altura exacta del piso
              z: refZ + Math.sin(angle) * radius
            }
          };
          
          room.items.set(id, item);
          io.to(roomId).emit("item-spawned", item);
          
          // Solo las bombas desaparecen a los 10 segundos
          if (type === 'bomb') {
            setTimeout(() => {
              const currentRoom = rooms.get(roomId);
              if (currentRoom && currentRoom.items.has(id)) {
                currentRoom.items.delete(id);
                io.to(roomId).emit("item-expired", id);
              }
            }, 10000); // 10 segundos
          }
          
        }, 5000);
      }
      
      const room = rooms.get(roomId)!;
      room.players.add(socket.id);
      
      // Enviar items existentes al jugador que se acaba de unir
      socket.emit("sync-items", Array.from(room.items.values()));

      // Avisar a los demás en la sala
      socket.to(roomId).emit("player-joined", { id: socket.id, playerName, energy: playerEnergy.get(socket.id) });
    });

    // Escuchar cuando este jugador se mueve
    socket.on("player-moved", (data) => {
      if (data.position) {
        playerPositions.set(socket.id, data.position);
      }
      const roomId = socket.data.roomId;
      if (roomId) {
        // Reenviar los datos a todos los demás en la sala, excepto al que los envió
        socket.to(roomId).emit("player-moved", {
          id: socket.id,
          ...data
        });
      }
    });

    // Escuchar disparos
    socket.on("player-shoot", (data) => {
      const roomId = socket.data.roomId;
      if (roomId) {
        socket.to(roomId).emit("player-shoot", {
          id: socket.id,
          ...data
        });
      }
    });

    // Escuchar impactos (cuando un láser golpea a un jugador)
    socket.on("player-hit", (targetId) => {
      const roomId = socket.data.roomId;
      if (roomId) {
        // Reducir energía
        const energy = (playerEnergy.get(targetId) || 100) - 10;
        playerEnergy.set(targetId, Math.max(0, energy));
        
        // Emitir a toda la sala quién fue golpeado y por quién, y su nueva energía
        io.to(roomId).emit("player-hit", { targetId, shooterId: socket.id, energy });
        
        if (energy <= 0) {
          io.to(roomId).emit("player-eliminated", { targetId, shooterId: socket.id });
          playerEnergy.set(targetId, 100); // Reset energy
        }
      }
    });

    // Escuchar eliminaciones
    socket.on("player-eliminated", ({ targetId, shooterId }) => {
      const roomId = socket.data.roomId;
      if (roomId) {
        io.to(roomId).emit("player-eliminated", { targetId, shooterId });
      }
    });
    
    // Escuchar recolección de items
    socket.on("item-collected", (itemId) => {
      const roomId = socket.data.roomId;
      if (roomId && rooms.has(roomId)) {
        const room = rooms.get(roomId)!;
        if (room.items.has(itemId)) {
          const item = room.items.get(itemId)!;
          room.items.delete(itemId);
          // Emitir a toda la sala que el item fue recolectado
          io.to(roomId).emit("item-collected", { itemId, playerId: socket.id, type: item.type });
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("🔴 Un jugador se ha desconectado:", socket.id);
      playerPositions.delete(socket.id);
      playerEnergy.delete(socket.id);
      const roomId = socket.data.roomId;
      if (roomId) {
        // Avisar a los demás que se desconectó
        socket.to(roomId).emit("player-disconnected", socket.id);
        
        if (rooms.has(roomId)) {
          const room = rooms.get(roomId)!;
          room.players.delete(socket.id);
          if (room.players.size === 0) {
            if (room.interval) clearInterval(room.interval);
            rooms.delete(roomId); // Limpiar la sala si está vacía
          }
        }
      }
    });
  });

  // Middleware de Vite para desarrollo
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Servidor Multijugador corriendo en http://localhost:${PORT}`);
  });
}

startServer();
