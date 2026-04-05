import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp, getApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

if (getApps().length === 0) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}
const adminApp = getApp();

const fdb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId || "(default)");
const authAdmin = getAuth(adminApp);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/reminders/email", async (req, res) => {
    const { userId, title, message } = req.body;
    
    try {
      // 1. Get user email from Firebase Admin
      const userRecord = await authAdmin.getUser(userId);
      const email = userRecord.email;

      if (!email) {
        return res.status(400).json({ error: "User has no email" });
      }

      // 2. Send email via Resend (if API key is present)
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const { Resend } = await import("resend");
        const resend = new Resend(resendKey);
        
        await resend.emails.send({
          from: 'StudyTracker <notifications@studytracker.app>',
          to: email,
          subject: title,
          text: message,
        });
        
        console.log(`Email sent to ${email}`);
        res.json({ status: "sent" });
      } else {
        console.warn("RESEND_API_KEY not found. Skipping email send.");
        res.json({ status: "skipped", message: "API key missing" });
      }
    } catch (error) {
      console.error("Error sending email reminder:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  // Vite middleware for development
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Background Task: Check for upcoming deadlines every 15 minutes
  setInterval(async () => {
    console.log("Running background deadline check...");
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const fifteenMinutesAfterThat = new Date(oneHourFromNow.getTime() + 15 * 60 * 1000);

    try {
      const assignmentsRef = fdb.collection("assignments");
      const snapshot = await assignmentsRef
        .where("deadline", ">=", oneHourFromNow.toISOString())
        .where("deadline", "<", fifteenMinutesAfterThat.toISOString())
        .get();

      for (const doc of snapshot.docs) {
        const assignment = doc.data();
        const userId = assignment.userId;
        const title = "⏰ Deadline Approaching!";
        const message = `Your ${assignment.type} "${assignment.title}" is due in about 1 hour! Finish it now.`;

        // Create in-app notification
        await fdb.collection("notifications").add({
          userId,
          title,
          message,
          type: "reminder",
          read: false,
          createdAt: new Date().toISOString(),
          assignmentId: doc.id
        });
        
        console.log(`Sent 1-hour reminder to user ${userId} for assignment ${doc.id}`);
      }
    } catch (error) {
      console.error("Error in background deadline check:", error);
    }
  }, 15 * 60 * 1000);

  // Background Task: Send motivational reminders every 6 hours
  setInterval(async () => {
    console.log("Sending motivational reminders...");
    const motivations = [
      "Complete your assignment early to avoid stress!",
      "You still have time, start now!",
      "Focus on your goals and keep moving forward.",
      "Small steps lead to big achievements. Keep going!"
    ];

    try {
      const usersSnapshot = await fdb.collection("users").where("role", "==", "student").get();
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const message = motivations[Math.floor(Math.random() * motivations.length)];
        
        await fdb.collection("notifications").add({
          userId,
          title: "💡 Motivation for You",
          message,
          type: "system",
          read: false,
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error("Error sending motivational reminders:", error);
    }
  }, 6 * 60 * 60 * 1000);
}

startServer();
