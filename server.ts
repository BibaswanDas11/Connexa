import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getDb } from "./src/lib/db.ts";
import { v4 as uuidv4 } from "uuid";

const JWT_SECRET = process.env.JWT_SECRET || "connexa-secret-key-12345";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const db = await getDb();

  app.use(cors());
  app.use(express.json());

  // Helper to generate Unique Connexa ID
  function generateConnexaId() {
    return "CX-" + Math.random().toString(36).substring(2, 7).toUpperCase();
  }

  // --- API Routes ---

  // Auth: Register
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, username } = req.body;
      const hashedPassword = await bcrypt.hash(password, 10);
      const id = uuidv4();
      const connexaId = generateConnexaId();

      await db.run(
        "INSERT INTO users (id, email, password, username, connexa_id) VALUES (?, ?, ?, ?, ?)",
        [id, email, hashedPassword, username, connexaId]
      );

      const token = jwt.sign({ id, email, username, connexaId }, JWT_SECRET);
      res.json({ token, user: { id, email, username, connexaId, avatarUrl: null, notificationEnabled: 1 } });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Auth: Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
      
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = jwt.sign({ id: user.id, email: user.email, username: user.username, connexaId: user.connexa_id }, JWT_SECRET);
      res.json({ token, user: { id: user.id, email: user.email, username: user.username, connexaId: user.connexa_id, avatarUrl: user.avatar_url, notificationEnabled: user.notification_enabled } });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // User: Notification Settings
  app.post("/api/users/notification-settings", async (req, res) => {
    try {
      const { userId, enabled } = req.body;
      await db.run("UPDATE users SET notification_enabled = ? WHERE id = ?", [enabled ? 1 : 0, userId]);
      res.json({ message: "Settings updated" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Chat: Create Group
  app.post("/api/chats/group", async (req, res) => {
    try {
      const { name, creatorId, memberIds, avatarUrl } = req.body; // memberIds includes creatorId
      const chatId = uuidv4();
      
      await db.run("INSERT INTO chats (id, name, type, created_by, avatar_url) VALUES (?, ?, 'group', ?, ?)", [chatId, name, creatorId, avatarUrl]);
      
      for (const uid of memberIds) {
        await db.run("INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)", [chatId, uid]);
      }
      
      res.json({ id: chatId, name, type: 'group', avatarUrl, createdBy: creatorId });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Chat: Update Group
  app.post("/api/chats/update", async (req, res) => {
    try {
      const { chatId, userId, name, avatarUrl } = req.body;
      const group = await db.get("SELECT created_by FROM chats WHERE id = ?", [chatId]);
      if (!group || group.created_by !== userId) {
        return res.status(403).json({ error: "Only admin can update group info" });
      }
      await db.run("UPDATE chats SET name = ?, avatar_url = ? WHERE id = ?", [name, avatarUrl, chatId]);
      res.json({ message: "Group updated" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Chat: Add Member
  app.post("/api/chats/members/add", async (req, res) => {
    try {
      const { chatId, adminId, userId } = req.body;
      const group = await db.get("SELECT created_by FROM chats WHERE id = ?", [chatId]);
      if (!group || group.created_by !== adminId) {
        return res.status(403).json({ error: "Only admin can add members" });
      }
      await db.run("INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)", [chatId, userId]);
      res.json({ message: "Member added" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Chat: Remove Member
  app.post("/api/chats/members/remove", async (req, res) => {
    try {
      const { chatId, adminId, userId } = req.body;
      const group = await db.get("SELECT created_by FROM chats WHERE id = ?", [chatId]);
      if (!group || group.created_by !== adminId) {
        return res.status(403).json({ error: "Only admin can remove members" });
      }
      if (group.created_by === userId) {
        return res.status(400).json({ error: "Admin cannot be removed" });
      }
      await db.run("DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?", [chatId, userId]);
      res.json({ message: "Member removed" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Chat: List members
  app.get("/api/chats/members/:chatId", async (req, res) => {
    try {
      const members = await db.all(
        "SELECT u.id, u.username, u.avatar_url, u.online_status FROM users u JOIN chat_members cm ON u.id = cm.user_id WHERE cm.chat_id = ?",
        [req.params.chatId]
      );
      res.json(members.map((m: any) => ({ ...m, avatarUrl: m.avatar_url })));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Chat: List for User
  app.get("/api/chats/list/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const groups = await db.all(
        "SELECT c.id, c.name, c.type, c.avatar_url as avatarUrl, c.created_by as createdBy FROM chats c JOIN chat_members cm ON c.id = cm.chat_id WHERE cm.user_id = ? AND c.type = 'group'",
        [userId]
      );
      res.json(groups);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Chat: Get Messages
  app.get("/api/chats/messages/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { userId } = req.query; // If provided, we assume DM

      let messages;
      if (userId) {
        // DM Logic: Fetch messages between userId and id
        messages = await db.all(
          "SELECT m.*, u.username as sender_name, u.avatar_url as sender_avatar FROM messages m JOIN users u ON m.sender_id = u.id WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?) ORDER BY m.created_at ASC",
          [userId, id, id, userId]
        );
      } else {
        // Group Logic
        messages = await db.all(
          "SELECT m.*, u.username as sender_name, u.avatar_url as sender_avatar FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.chat_id = ? ORDER BY m.created_at ASC",
          [id]
        );
      }

      res.json(messages.map((m: any) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: m.sender_name,
        senderAvatar: m.sender_avatar,
        chatId: m.chat_id,
        receiverId: m.receiver_id,
        content: m.content,
        isForwarded: !!m.is_forwarded,
        createdAt: m.created_at,
        readReceipt: m.read_receipt
      })));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Friend: Search by Connexa ID
  app.get("/api/users/search/:connexaId", async (req, res) => {
    try {
      const { searcherId } = req.query;
      const user = await db.get("SELECT id, username, connexa_id, online_status, avatar_url FROM users WHERE connexa_id = ?", [req.params.connexaId]);
      
      if (!user) return res.status(404).json({ error: "User not found" });

      let relation = null;
      if (searcherId) {
        relation = await db.get(
          "SELECT status FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
          [searcherId, user.id, user.id, searcherId]
        );
      }

      res.json({ 
        id: user.id, 
        username: user.username, 
        connexaId: user.connexa_id, 
        online_status: user.online_status, 
        avatarUrl: user.avatar_url, 
        relation: relation ? relation.status : null 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Friend: Send Request
  app.post("/api/friends/request", async (req, res) => {
    try {
      const { userId, friendId } = req.body;
      if (!userId || !friendId) return res.status(400).json({ error: "Missing user or friend identifier" });
      if (userId === friendId) return res.status(400).json({ error: "You cannot add yourself" });
      
      const existing = await db.get("SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [userId, friendId, friendId, userId]);
      if (existing) {
        if (existing.status === 'pending') {
          return res.status(400).json({ error: "A friend request is already pending between you two." });
        }
        if (existing.status === 'accepted') {
          return res.status(400).json({ error: "You are already connected with this user." });
        }
        return res.status(400).json({ error: "A connection already exists with this user." });
      }

      await db.run("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)", [userId, friendId, 'pending']);
      
      // Notify the receiver in real-time
      console.log(`Sending friend request notification to user ${friendId}`);
      io.to(friendId).emit("friend_request_received", { senderId: userId });
      
      res.json({ message: "Friend request sent successfully" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Friend: List Pending Requests
  app.get("/api/friends/pending/:userId", async (req, res) => {
    try {
      const requests = await db.all(
        "SELECT u.id, u.username, u.connexa_id, u.avatar_url FROM users u JOIN friends f ON u.id = f.user_id WHERE f.friend_id = ? AND f.status = 'pending'",
        [req.params.userId]
      );
      res.json(requests.map((r: any) => ({ ...r, avatarUrl: r.avatar_url })));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Friend: Accept/Decline Request
  app.post("/api/friends/respond", async (req, res) => {
    try {
      const { userId, friendId, action } = req.body; // action: 'accept' or 'decline'
      if (action === 'accept') {
        await db.run("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?", [friendId, userId]);
        // Also create the reverse relationship for 2-way friendship
        await db.run("INSERT OR IGNORE INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')", [userId, friendId]);
        
        // Notify both parties in real-time
        io.to(userId).emit("friend_accepted", { friendId });
        io.to(friendId).emit("friend_accepted", { friendId: userId });
      } else {
        await db.run("DELETE FROM friends WHERE user_id = ? AND friend_id = ?", [friendId, userId]);
      }
      res.json({ message: "Responded successfully" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Friend: Block User
  app.post("/api/friends/block", async (req, res) => {
    try {
      const { userId, friendId } = req.body;
      await db.run("UPDATE friends SET status = 'blocked' WHERE user_id = ? AND friend_id = ?", [userId, friendId]);
      
      // Notify the other user
      io.to(friendId).emit("friend_updated", { friendId: userId });
      
      res.json({ message: "User blocked" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Friend: Unblock User
  app.post("/api/friends/unblock", async (req, res) => {
    try {
      const { userId, friendId } = req.body;
      await db.run("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?", [userId, friendId]);
      
      // Notify the other user
      io.to(friendId).emit("friend_updated", { friendId: userId });
      
      res.json({ message: "User unblocked" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Friend: List Accepted Friends (Excluding Blocked)
  app.get("/api/friends/list/:userId", async (req, res) => {
    try {
      const friends = await db.all(
        "SELECT u.id, u.username, u.connexa_id, u.online_status, u.avatar_url, f.status FROM users u JOIN friends f ON u.id = f.friend_id WHERE f.user_id = ? AND f.status IN ('accepted', 'blocked')",
        [req.params.userId]
      );
      res.json(friends.map((f: any) => ({ ...f, avatarUrl: f.avatar_url, status: f.status })));
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Friend: Remove Connection
  app.post("/api/friends/remove", async (req, res) => {
    try {
      const { userId, friendId } = req.body;
      await db.run("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [userId, friendId, friendId, userId]);
      
      // Notify both parties in real-time
      io.to(userId).emit("friend_removed", { friendId });
      io.to(friendId).emit("friend_removed", { friendId: userId });
      
      res.json({ message: "Connection removed" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Auth: Reset Password (Simulated)
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { email, newPassword } = req.body;
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const result = await db.run("UPDATE users SET password = ? WHERE email = ?", [hashedPassword, email]);
      
      if (result.changes === 0) return res.status(404).json({ error: "User not found" });
      res.json({ message: "Password reset successful" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // User: Update Profile (Username/Avatar)
  app.post("/api/users/update-profile", async (req, res) => {
    try {
      const { userId, username, avatarUrl } = req.body;
      await db.run("UPDATE users SET username = ?, avatar_url = ? WHERE id = ?", [username, avatarUrl, userId]);
      
      // Notify all users about the profile update
      io.emit("profile_updated", { userId, username, avatarUrl });
      
      res.json({ message: "Profile updated" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Message: Delete
  app.delete("/api/messages/:messageId", async (req, res) => {
    try {
      const { userId } = req.body; // In real app, verify with JWT
      const message = await db.get("SELECT * FROM messages WHERE id = ?", [req.params.messageId]);
      
      if (!message || message.sender_id !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      await db.run("DELETE FROM messages WHERE id = ?", [req.params.messageId]);
      res.json({ message: "Message deleted" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // --- Socket Logic ---
  const activeUsers = new Map<string, string>(); // userId -> socketId

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("identify", async (userId) => {
      activeUsers.set(userId, socket.id);
      await db.run("UPDATE users SET online_status = 1 WHERE id = ?", [userId]);
      io.emit("status_change", { userId, status: 1 });
      
      // Join self-room for DMs
      socket.join(userId);
      
      // Join all group rooms
      const userGroups = await db.all("SELECT chat_id FROM chat_members WHERE user_id = ?", [userId]);
      userGroups.forEach(g => socket.join(g.chat_id));
    });

    socket.on("join_chat", (chatId) => {
      socket.join(chatId);
    });

    socket.on("send_message", async (data) => {
      const { senderId, receiverId, chatId, content, isForwarded } = data;
      
      if (receiverId) {
        // DM Logic
        const blockRelation = await db.get(
          "SELECT * FROM friends WHERE (user_id = ? AND friend_id = ? AND status = 'blocked') OR (user_id = ? AND friend_id = ? AND status = 'blocked')",
          [senderId, receiverId, receiverId, senderId]
        );

        if (blockRelation) {
          return socket.emit("error_message", { message: "Message blocked by visibility settings" });
        }

        const messageId = uuidv4();
        await db.run(
          "INSERT INTO messages (id, sender_id, receiver_id, content, is_forwarded) VALUES (?, ?, ?, ?, ?)",
          [messageId, senderId, receiverId, content, isForwarded ? 1 : 0]
        );

        const sender = await db.get("SELECT username, avatar_url FROM users WHERE id = ?", [senderId]);
        const message = { 
          id: messageId, 
          senderId, 
          senderName: sender.username,
          senderAvatar: sender.avatar_url,
          receiverId, 
          content, 
          isForwarded: !!isForwarded,
          createdAt: new Date().toISOString(), 
          readReceipt: 0 
        };
        io.to(receiverId).emit("receive_message", message);
        socket.emit("message_sent", message);
      } else if (chatId) {
        // Group Logic
        const messageId = uuidv4();
        await db.run(
          "INSERT INTO messages (id, sender_id, chat_id, content, is_forwarded) VALUES (?, ?, ?, ?, ?)",
          [messageId, senderId, chatId, content, isForwarded ? 1 : 0]
        );

        const sender = await db.get("SELECT username, avatar_url FROM users WHERE id = ?", [senderId]);
        const message = { 
          id: messageId, 
          senderId, 
          senderName: sender.username, 
          senderAvatar: sender.avatar_url,
          chatId, 
          content, 
          isForwarded: !!isForwarded,
          createdAt: new Date().toISOString() 
        };
        
        socket.to(chatId).emit("receive_message", message);
        socket.emit("message_sent", message);
      }
    });

    socket.on("delete_message", async ({ messageId, userId, targetId, isGroup }) => {
      try {
        const msg = await db.get("SELECT sender_id FROM messages WHERE id = ?", [messageId]);
        if (!msg || msg.sender_id !== userId) return;

        await db.run("DELETE FROM messages WHERE id = ?", [messageId]);
        
        if (isGroup) {
          io.to(targetId).emit("message_deleted", { messageId });
        } else {
          io.to(targetId).to(userId).emit("message_deleted", { messageId });
        }
      } catch (e) {
        console.error("Delete error:", e);
      }
    });

    socket.on("mark_read", async ({ messageId, senderId }) => {
      await db.run("UPDATE messages SET read_receipt = 1 WHERE id = ?", [messageId]);
      const senderSocketId = activeUsers.get(senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit("message_read", { messageId });
      }
    });

    socket.on("disconnect", async () => {
      let disconnectedUserId: string | null = null;
      for (const [userId, socketId] of activeUsers.entries()) {
        if (socketId === socket.id) {
          disconnectedUserId = userId;
          break;
        }
      }

      if (disconnectedUserId) {
        activeUsers.delete(disconnectedUserId);
        await db.run("UPDATE users SET online_status = 0, last_seen = CURRENT_TIMESTAMP WHERE id = ?", [disconnectedUserId]);
        io.emit("status_change", { userId: disconnectedUserId, status: 0 });
      }
      console.log("User disconnected");
    });
  });

  // --- Vite / Production Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = process.env.PORT || 3000;
  httpServer.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
