# Connexa - Full-Stack Chat Application

This is a full-stack application with a React frontend and an Express/Socket.io backend.

## 🚀 Deployment Instructions

Because this app uses a **Node.js backend** and a **SQLite database**, it cannot be hosted on static-only services like GitHub Pages. You need a platform that supports Node.js.

### Recommended Platforms
- **Render** (Web Service)
- **Railway**
- **Railway.app**
- **DigitalOcean App Platform**

### Deployment Steps (e.g., on Render or Railway)

1. **Build Command:**
   ```bash
   npm install && npm run build
   ```

2. **Start Command:**
   ```bash
   npm start
   ```

3. **Environment Variables:**
   If you have any secrets (like `GEMINI_API_KEY` or `JWT_SECRET`), make sure to add them in the platform's dashboard.

### Why was my screen white?
If you tried to host this on **GitHub Pages**, the screen appeared white because:
1. **Missing Backend:** GitHub Pages only serves static files and doesn't run the `server.ts`.
2. **Path Issues:** Static sites on GitHub Pages often need a specific `base` path in `vite.config.ts`.
3. **Database:** SQLite requires an actual server disk to store your messages and users.

## 🛠ï¸è¿ Local Development

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📁 Project Structure
- `server.ts`: The Express/Socket.io backend.
- `src/`: The React frontend source code.
- `index.html`: The entry point for the frontend.
- `connexa.db`: The SQLite database file (created automatically).
