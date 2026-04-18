import express from "express";
import 'dotenv/config';
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

// Reusable email sender
async function sendEmailReminder(userId: string, subject: string, htmlMessage: string, textMessage: string) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn("RESEND_API_KEY not found. Skipping email send.");
    return { status: "skipped", message: "API key missing" };
  }

  try {
    const userRecord = await authAdmin.getUser(userId);
    const email = userRecord.email;

    if (!email) {
      console.warn(`User ${userId} has no email address.`);
      return { status: "error", message: "No email" };
    }

    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);
    
    await resend.emails.send({
      from: 'TaskBuddy <onboarding@resend.dev>',
      to: email,
      subject: subject,
      html: htmlMessage,
      text: textMessage, // Fallback text
    });
    
    console.log(`Email successfully sent to ${email}`);
    return { status: "sent" };
  } catch (error) {
    console.error(`Failed to send email to ${userId}:`, error);
    return { status: "error", error };
  }
}

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
    
    const htmlMessage = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #171717;">
        <h2 style="color: #000;">⏰ Important Assignment Reminder</h2>
        <p>Hello,</p>
        <p>A manual reminder has been sent regarding your studies:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 10px; margin: 20px 0;">
          <p><b>Announcement:</b> ${title}</p>
          <p>${message}</p>
        </div>
        <p style="color: #ef4444;"><b>Keep up with your tasks to ensure academic success!</b></p>
        <br>
        <p style="font-size: 12px; color: #737373;">— TaskBuddy Automated System</p>
      </div>
    `;

    const result = await sendEmailReminder(userId, title, htmlMessage, message);
    if (result.status === "sent") {
      res.json({ status: "sent" });
    } else {
      res.status(result.status === "error" ? 500 : 400).json(result);
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

  // Background Task: Check for upcoming deadlines every 30 minutes
  setInterval(async () => {
    console.log("Running background deadline check...");
    const now = new Date();
    
    // Check for 1, 6, and 24 hour reminders
    const timeWindows = [
      { label: "1 hour", offsetMs: 60 * 60 * 1000, title: "⏰ Deadline Approaching!" },
      { label: "24 hours", offsetMs: 24 * 60 * 60 * 1000, title: "📅 Deadline Tomorrow" }
    ];

    try {
      const assignmentsRef = fdb.collection("assignments");
      
      for (const window of timeWindows) {
        const startTime = new Date(now.getTime() + window.offsetMs);
        const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 min window to match interval

        const snapshot = await assignmentsRef
          .where("deadline", ">=", startTime.toISOString())
          .where("deadline", "<", endTime.toISOString())
          .get();

        for (const doc of snapshot.docs) {
          const assignment = doc.data();
          if (assignment.urgency === 'done') continue;

          const userId = assignment.userId;
          const message = `Reminder: Your ${assignment.type} "${assignment.title}" for ${assignment.course} is due in about ${window.label}. Good luck!`;

          // 1. Create in-app notification
          await fdb.collection("notifications").add({
            userId,
            title: window.title,
            message,
            type: "reminder",
            read: false,
            createdAt: new Date().toISOString(),
            assignmentId: doc.id
          });
          
          // 2. Send automated email via Resend
          const htmlMessage = `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #171717;">
              <h2 style="color: #000;">⏰ Assignment Reminder</h2>
              <p>Hello,</p>
              <p>Your assignment deadline is approaching.</p>
              <div style="background: #f5f5f5; padding: 15px; border-radius: 10px; margin: 20px 0;">
                <p><b>Title:</b> ${assignment.title}</p>
                <p><b>Course:</b> ${assignment.course}</p>
                <p><b>Due in:</b> ${window.label}</p>
                <p><b>Deadline:</b> ${new Date(assignment.deadline).toLocaleString()}</p>
              </div>
              <p style="color: #ef4444;"><b>Don't forget to submit on time!</b></p>
              <br>
              <p style="font-size: 12px; color: #737373;">— TaskBuddy Automated System</p>
            </div>
          `;

          await sendEmailReminder(userId, window.title, htmlMessage, message);
          
          console.log(`Sent ${window.label} reminder (App & Email) to user ${userId} for assignment ${doc.id}`);
        }
      }
    } catch (error) {
      console.error("Error in background deadline check:", error);
    }
  }, 30 * 60 * 1000);

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
