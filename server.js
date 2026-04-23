const dotenv = require("dotenv");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const net = require("net");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

// Load environment variables
dotenv.config();

// Import models
const Location = require("./src/models/Location");
const User = require("./src/models/User");
const EmergencyAlert = require("./src/models/EmergencyAlert");

// Import routes
const authRoutes = require("./src/routes/auth");
const sosRoutes = require("./src/routes/sos");
const busRoutes = require("./src/routes/bus");
const adminRoutes = require("./src/routes/admin");
const routeRoutes = require("./src/routes/routes");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src", "views"));

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || "*",
  credentials: true
}));

app.use(morgan("dev"));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files (admin panel)
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// HTTP & SOCKET.IO SETUP
// ============================================

const server = http.createServer(app);
const io = new Server(server, {
  cors: { 
    origin: process.env.ALLOWED_ORIGINS?.split(',') || "*",
    credentials: true 
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Make io available to routes
app.set('io', io);

// ============================================
// DATABASE CONNECTION
// ============================================

mongoose
  .connect(process.env.MONGODB)
  .then(() => {
    console.log("✅ MongoDB connected successfully");
    console.log(`📊 Database: ${mongoose.connection.name}`);
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  });

// Handle MongoDB connection errors
mongoose.connection.on('error', err => {
  console.error('❌ MongoDB error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected. Attempting to reconnect...');
});

// ============================================
// HEALTH CHECK ENDPOINTS
// ============================================

app.get("/", (req, res) => {
  res.json({ 
    status: "running", 
    timestamp: new Date(),
    connections: io.engine.clientsCount,
    version: "2.1.0",
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

app.get("/health", (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    memory: process.memoryUsage(),
    connections: {
      socketio: io.engine.clientsCount,
      gps: gpsClients.size
    }
  };
  
  const statusCode = health.mongodb === "connected" ? 200 : 503;
  res.status(statusCode).json(health);
});

// ============================================
// API ROUTES
// ============================================

app.use("/api/auth", authRoutes);
app.use("/api/sos", sosRoutes);
app.use("/api/bus", busRoutes);
app.use("/api/admin", adminRoutes);
app.use("/admin", adminRoutes);
app.use("/api/routes", routeRoutes);

// ============================================
// GPS LOCATION APIs
// ============================================

// Get latest location for a device
app.get("/api/location/:deviceId/latest", async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    // Input validation
    if (!deviceId || deviceId.length < 10) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid device ID" 
      });
    }
    
    const location = await Location
      .findOne({ deviceId })
      .sort({ time: -1 })
      .lean();
    
    if (!location) {
      return res.status(404).json({ 
        success: false,
        error: "Device not found or no location data available" 
      });
    }
    
    res.json({
      success: true,
      data: location
    });
  } catch (error) {
    console.error("Error fetching location:", error);
    res.status(500).json({ 
      success: false,
      error: "Server error" 
    });
  }
});

// Get location history
app.get("/api/location/:deviceId/history", async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { startDate, endDate, limit = 100 } = req.query;
    
    // Input validation
    if (!deviceId || deviceId.length < 10) {
      return res.status(400).json({ 
        success: false,
        error: "Invalid device ID" 
      });
    }
    
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      return res.status(400).json({ 
        success: false,
        error: "Limit must be between 1 and 1000" 
      });
    }
    
    const query = { deviceId };
    
    if (startDate || endDate) {
      query.time = {};
      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return res.status(400).json({ 
            success: false,
            error: "Invalid startDate format" 
          });
        }
        query.time.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return res.status(400).json({ 
            success: false,
            error: "Invalid endDate format" 
          });
        }
        query.time.$lte = end;
      }
    }
    
    const locations = await Location
      .find(query)
      .sort({ time: -1 })
      .limit(limitNum)
      .lean();
    
    res.json({
      success: true,
      count: locations.length,
      data: locations
    });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ 
      success: false,
      error: "Server error" 
    });
  }
});

// Get all registered devices
app.get("/api/devices", async (req, res) => {
  try {
    const devices = await Location.distinct("deviceId");
    
    // Get latest location for each device
    const devicesWithLocation = await Promise.all(
      devices.map(async (deviceId) => {
        const location = await Location
          .findOne({ deviceId })
          .sort({ time: -1 })
          .lean();
        return {
          deviceId,
          lastSeen: location?.time,
          latitude: location?.latitude,
          longitude: location?.longitude,
          speed: location?.speed
        };
      })
    );
    
    res.json({ 
      success: true,
      count: devices.length,
      data: devicesWithLocation
    });
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ 
      success: false,
      error: "Server error" 
    });
  }
});

// ============================================
// SOCKET.IO CONNECTION HANDLING
// ============================================

const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log("📱 Client connected:", socket.id);

  socket.on("webrtc-join", () => {
    socket.join("webrtc-location");
    const peers = Array.from(io.sockets.adapter.rooms.get("webrtc-location") || [])
      .filter((id) => id !== socket.id);
    socket.emit("webrtc-peers", peers);
    socket.to("webrtc-location").emit("webrtc-peer-joined", socket.id);
  });

  socket.on("webrtc-offer", (payload = {}) => {
    const { targetId, sdp } = payload;
    if (!targetId || !sdp) return;
    io.to(targetId).emit("webrtc-offer", { fromId: socket.id, sdp });
  });

  socket.on("webrtc-answer", (payload = {}) => {
    const { targetId, sdp } = payload;
    if (!targetId || !sdp) return;
    io.to(targetId).emit("webrtc-answer", { fromId: socket.id, sdp });
  });

  socket.on("webrtc-ice-candidate", (payload = {}) => {
    const { targetId, candidate } = payload;
    if (!targetId || !candidate) return;
    io.to(targetId).emit("webrtc-ice-candidate", {
      fromId: socket.id,
      candidate,
    });
  });
  
  // Handle user authentication
  socket.on("authenticate", (data) => {
    if (data.userId) {
      connectedUsers.set(socket.id, data.userId);
      socket.userId = data.userId;
      console.log(`✅ User ${data.userId} authenticated on socket ${socket.id}`);
    }
  });
  
  // Subscribe to specific bus updates
  socket.on("subscribe-bus", (busId) => {
    if (busId) {
      socket.join(`bus-${busId}`);
      console.log(`📍 Socket ${socket.id} subscribed to bus ${busId}`);
    }
  });
  
  // Unsubscribe from bus updates
  socket.on("unsubscribe-bus", (busId) => {
    if (busId) {
      socket.leave(`bus-${busId}`);
      console.log(`📍 Socket ${socket.id} unsubscribed from bus ${busId}`);
    }
  });
  
  // Send active alerts
  socket.on("request-active-alerts", async () => {
    try {
      const alerts = await EmergencyAlert.find({ status: "active" })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      
      socket.emit("active-alerts", alerts);
    } catch (error) {
      console.error("Error fetching active alerts:", error);
      socket.emit("error", { message: "Failed to fetch alerts" });
    }
  });
  
  socket.on("disconnect", () => {
    socket.to("webrtc-location").emit("webrtc-peer-left", socket.id);
    const userId = connectedUsers.get(socket.id);
    if (userId) {
      connectedUsers.delete(socket.id);
      console.log(`📱 User ${userId} disconnected`);
    }
    console.log("📱 Client disconnected:", socket.id);
  });
});

// ============================================
// GT06 GPS PROTOCOL PARSER
// ============================================

function parseGT06Data(buffer) {
  try {
    const hex = buffer.toString('hex');
    console.log('📦 Raw hex:', hex);
    
    // Check for start markers (0x7878 or 0x7979)
    if (!hex.startsWith('7878') && !hex.startsWith('7979')) {
      console.warn('⚠️ Invalid start marker');
      return null;
    }
    
    const length = buffer.readUInt8(2);
    const msgType = buffer.readUInt8(3);
    
    console.log(`📋 Message type: 0x${msgType.toString(16).padStart(2, '0')}, Length: ${length}`);
    
    // Login packet (type 0x01)
    if (msgType === 0x01) {
      if (buffer.length < 12) {
        console.error('❌ Login packet too short');
        return null;
      }
      const imei = buffer.slice(4, 12).toString('hex');
      console.log('🔑 IMEI detected:', imei);
      return { type: 'login', imei: imei };
    }
    
    // GPS Location packets (type 0x22, 0x12, 0x16)
    if (msgType === 0x22 || msgType === 0x12 || msgType === 0x16) {
      try {
        // Check minimum packet size
        if (buffer.length < 24) {
          console.error('❌ GPS packet too short');
          return null;
        }
        
        // Parse datetime
        const year = 2000 + buffer.readUInt8(4);
        const month = buffer.readUInt8(5);
        const day = buffer.readUInt8(6);
        const hour = buffer.readUInt8(7);
        const minute = buffer.readUInt8(8);
        const second = buffer.readUInt8(9);
        
        // Satellite count (upper 4 bits of byte 10)
        const satCount = (buffer.readUInt8(10) >> 4) & 0x0F;
        
        // Check if GPS has a fix
        if (satCount === 0) {
          console.log('⚠️ No GPS fix (0 satellites) - device still searching...');
          return { type: 'no_gps_fix' };
        }
        
        // Parse latitude (4 bytes at offset 11)
        const latRaw = buffer.readUInt32BE(11);
        let latitude = latRaw / 1800000.0;
        
        // Parse longitude (4 bytes at offset 15)
        const lngRaw = buffer.readUInt32BE(15);
        let longitude = lngRaw / 1800000.0;
        
        // Course/status information (2 bytes at offset 19)
        const course = buffer.readUInt16BE(19);
        
        // Extract hemisphere flags
        // GT06 Protocol: Bit 11 (0x0800) = 1 means West, Bit 10 (0x0400) = 1 means South
        const isWest = (course & 0x0800) !== 0;
        const isSouth = (course & 0x0400) !== 0;  // ✅ FIXED: !== 0 (bit SET means South)
        
        // Apply hemisphere corrections
        // For Bangladesh: Northern hemisphere (isSouth = false), Eastern hemisphere (isWest = false)
        // Only negate when the flag is TRUE
        if (isSouth) latitude = -latitude;   // Only negative if actually in Southern hemisphere
        if (isWest) longitude = -longitude;  // Only negative if actually in Western hemisphere
        
        // ✅ SAFETY: Always ensure positive coordinates for Bangladesh
        // Bangladesh is ALWAYS in Northern (positive lat) and Eastern (positive lng) hemispheres
        // Force positive values to prevent any GPS device misconfiguration
        latitude = Math.abs(latitude);
        longitude = Math.abs(longitude);
        
        // Validate coordinates are within Bangladesh boundaries
        if (latitude < 20 || latitude > 27 || longitude < 88 || longitude > 93) {
          console.warn(`⚠️ Coordinates outside Bangladesh: ${latitude}, ${longitude}`);
        }
        
        // Speed (1 byte at offset 21)
        const speed = buffer.readUInt8(21);
        
        console.log('🛰️ Satellites:', satCount);
        console.log('🧭 Hemisphere:', isSouth ? 'S' : 'N', isWest ? 'W' : 'E');
        console.log(`📍 Parsed - Lat: ${latitude.toFixed(6)}, Lng: ${longitude.toFixed(6)}, Speed: ${speed} km/h`);
        
        // Validate coordinates
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          console.error('❌ Invalid coordinates after parsing');
          return null;
        }
        
        // ✅ ADDED: Additional validation for Bangladesh region
        // Bangladesh is between 20.34°N-26.38°N and 88.01°E-92.41°E
        if (process.env.VALIDATE_BANGLADESH_REGION === 'true') {
          if (latitude < 20 || latitude > 27 || longitude < 88 || longitude > 93) {
            console.warn('⚠️ Coordinates outside expected Bangladesh region');
            console.warn(`   Received: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
          }
        }
        
        return {
          type: 'location',
          latitude: latitude,
          longitude: longitude,
          speed: speed,
          satellites: satCount,
          datetime: new Date(year, month - 1, day, hour, minute, second)
        };
        
      } catch (e) {
        console.error('❌ Error parsing location:', e.message);
        return null;
      }
    }
    
    // Heartbeat (type 0x13)
    if (msgType === 0x13) {
      console.log('💓 Heartbeat received');
      return { type: 'heartbeat' };
    }
    
    // LBS/Cell tower data (type 0x17, 0x18, 0x24, 0x14, 0x20, 0x94)
    if ([0x17, 0x18, 0x24, 0x14, 0x20, 0x94].includes(msgType)) {
      console.log('📶 LBS/Cell tower data (no GPS coordinates)');
      return { type: 'lbs' };
    }
    
    // Alarm packet (type 0x26)
    if (msgType === 0x26) {
      console.log('🚨 Alarm packet received');
      return { type: 'alarm' };
    }
    
    console.log(`⚠️ Unknown message type: 0x${msgType.toString(16).padStart(2, '0')}`);
    return { type: 'unknown', msgType };
    
  } catch (error) {
    console.error('❌ Parse error:', error.message);
    return null;
  }
}

// ============================================
// GT06 RESPONSE BUILDER
// ============================================

function sendGT06Response(socket, msgType, serial = 0x0001) {
  try {
    // Build response packet: [start][start][length][type][serial_high][serial_low][crc_high][crc_low][stop][stop]
    const response = Buffer.alloc(10);
    response[0] = 0x78;  // Start byte 1
    response[1] = 0x78;  // Start byte 2
    response[2] = 0x05;  // Length
    response[3] = msgType;  // Message type
    response[4] = (serial >> 8) & 0xFF;  // Serial number high byte
    response[5] = serial & 0xFF;  // Serial number low byte
    
    // Calculate CRC-ITU (CRC-16)
    let crc = 0xFFFF;
    for (let i = 2; i < 6; i++) {
      crc ^= response[i] << 8;
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ 0x1021;
        } else {
          crc = crc << 1;
        }
      }
    }
    crc = crc & 0xFFFF;
    
    response[6] = (crc >> 8) & 0xFF;  // CRC high byte
    response[7] = crc & 0xFF;  // CRC low byte
    response[8] = 0x0D;  // Stop byte 1 (CR)
    response[9] = 0x0A;  // Stop byte 2 (LF)
    
    socket.write(response);
    console.log(`✅ Response sent: ${response.toString('hex')}`);
  } catch (error) {
    console.error('❌ Error sending response:', error.message);
  }
}

// ============================================
// GPS TCP SERVER
// ============================================

const GPS_PORT = parseInt(process.env.TCP_PORT) || 5050;
const gpsClients = new Map();

const tcpServer = net.createServer((socket) => {
  const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📡 New device connected from:', socket.remoteAddress);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  let deviceIMEI = null;
  let packetBuffer = Buffer.alloc(0);
  
  socket.on('data', async (data) => {
    console.log(`📦 Received ${data.length} bytes from: ${clientId}`);
    
    // Append to buffer
    packetBuffer = Buffer.concat([packetBuffer, data]);
    
    // Process complete packets
    while (packetBuffer.length > 0) {
      // Check for minimum packet size
      if (packetBuffer.length < 5) {
        break; // Wait for more data
      }
      
      // Check start marker
      if (packetBuffer[0] !== 0x78 || packetBuffer[1] !== 0x78) {
        console.error('❌ Invalid start marker, clearing buffer');
        packetBuffer = Buffer.alloc(0);
        break;
      }
      
      // Get packet length
      const length = packetBuffer[2];
      const totalLength = length + 5; // length + start(2) + length(1) + crc(2) + stop(2) - 2
      
      if (packetBuffer.length < totalLength) {
        console.log(`⏳ Waiting for complete packet (have ${packetBuffer.length}, need ${totalLength})`);
        break; // Wait for more data
      }
      
      // Extract complete packet
      const packet = packetBuffer.slice(0, totalLength);
      packetBuffer = packetBuffer.slice(totalLength);
      
      // Parse packet
      const parsed = parseGT06Data(packet);
      
      if (parsed) {
        if (parsed.type === 'login') {
          deviceIMEI = parsed.imei;
          gpsClients.set(clientId, deviceIMEI);
          console.log('✅ Device logged in:', deviceIMEI);
          
          // Send login response
          sendGT06Response(socket, 0x01, 0x0001);
          
        } else if (parsed.type === 'location') {
          if (!deviceIMEI) {
            console.warn('⚠️ Location data from unauthorized device');
            continue;
          }
          
          console.log(`📍 ${deviceIMEI} → Lat:${parsed.latitude.toFixed(6)} Lng:${parsed.longitude.toFixed(6)} Speed:${parsed.speed}km/h Satellites:${parsed.satellites}`);
          
          try {
            // Save to MongoDB
            const location = new Location({
              deviceId: deviceIMEI,
              latitude: parsed.latitude,
              longitude: parsed.longitude,
              speed: parsed.speed,
              satellites: parsed.satellites,
              time: parsed.datetime || new Date()
            });
            
            await location.save();
            console.log("✅ Location saved to MongoDB");
            
            // Broadcast to all connected Socket.IO clients
            io.emit("locationUpdate", {
              deviceId: deviceIMEI,
              latitude: parsed.latitude,
              longitude: parsed.longitude,
              speed: parsed.speed,
              satellites: parsed.satellites,
              timestamp: location.time,
            });
            
            // Broadcast to specific bus subscribers
            io.to(`bus-${deviceIMEI}`).emit("busLocationUpdate", {
              busId: deviceIMEI,
              latitude: parsed.latitude,
              longitude: parsed.longitude,
              speed: parsed.speed,
              satellites: parsed.satellites,
              timestamp: location.time,
            });
            
            console.log("✅ Location broadcasted to clients");
            
            // Send location acknowledgment
            sendGT06Response(socket, 0x12, 0x0001);
            
          } catch (error) {
            console.error("❌ Error saving location:", error.message);
          }
          
        } else if (parsed.type === 'heartbeat') {
          console.log('💓 Heartbeat from:', deviceIMEI || clientId);
          sendGT06Response(socket, 0x13, 0x0001);
          
        } else if (parsed.type === 'lbs') {
          console.log('📶 LBS data from:', deviceIMEI || clientId);
          sendGT06Response(socket, 0x17, 0x0001);
          
        } else if (parsed.type === 'alarm') {
          console.log('🚨 Alarm from:', deviceIMEI || clientId);
          if (deviceIMEI) {
            io.emit("deviceAlarm", {
              deviceId: deviceIMEI,
              timestamp: new Date(),
            });
          }
          sendGT06Response(socket, 0x26, 0x0001);
          
        } else if (parsed.type === 'no_gps_fix') {
          console.log('⏳ Device searching for GPS fix...', deviceIMEI || clientId);
          sendGT06Response(socket, 0x12, 0x0001);
        }
      }
    }
  });
  
  socket.on('error', (error) => {
    console.error('❌ Socket error from', clientId, ':', error.message);
  });
  
  socket.on('close', () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔌 Device disconnected:', clientId);
    if (deviceIMEI) {
      console.log('🔌 Device IMEI:', deviceIMEI);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    gpsClients.delete(clientId);
  });
  
  // Set socket timeout
  socket.setTimeout(300000); // 5 minutes
  socket.on('timeout', () => {
    console.log('⏱️ Socket timeout for:', clientId);
    socket.end();
  });
});

tcpServer.on('error', (error) => {
  console.error('❌ TCP Server error:', error.message);
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${GPS_PORT} is already in use!`);
    process.exit(1);
  }
});

tcpServer.listen(GPS_PORT, '0.0.0.0', () => {
  console.log(`📡 GPS TCP Server listening on 0.0.0.0:${GPS_PORT}`);
});

// ============================================
// ERROR HANDLERS
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.stack);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? "Internal server error" 
      : err.message
  });
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

async function gracefulShutdown(signal) {
  console.log(`\n${signal} received, initiating graceful shutdown...`);
  
  // Stop accepting new connections
  tcpServer.close(() => {
    console.log('✅ GPS TCP Server closed');
  });
  
  server.close(() => {
    console.log('✅ HTTP Server closed');
  });
  
  // Close database connection
  try {
    await mongoose.connection.close(false);
    console.log('✅ MongoDB connection closed');
  } catch (error) {
    console.error('❌ Error closing MongoDB:', error.message);
  }
  
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('=================================================');
  console.log('🚍 BRUR Bus Tracker Server v2.1');
  console.log('=================================================');
  console.log(`📡 GPS TCP Server: port ${GPS_PORT}`);
  console.log(`🌐 HTTP & Socket.IO: port ${PORT}`);
  console.log(`🔐 Authentication: ${authRoutes ? 'Enabled' : 'Disabled'}`);
  console.log(`🚨 Emergency Alerts: ${sosRoutes ? 'Enabled' : 'Disabled'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('=================================================');
});