import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';

type ReminderWindow = {
  key: '24h' | '1h';
  label: string;
  offsetMs: number;
  title: string;
};

const reminderWindows: ReminderWindow[] = [
  {
    key: '24h',
    label: '24 hours',
    offsetMs: 24 * 60 * 60 * 1000,
    title: '📅 Deadline Tomorrow',
  },
  {
    key: '1h',
    label: '1 hour',
    offsetMs: 60 * 60 * 1000,
    title: '⏰ Deadline Approaching!',
  },
];

const runWindowMs = Number(process.env.REMINDER_WINDOW_MINUTES || '35') * 60 * 1000;
const fromEmail = process.env.REMINDER_FROM_EMAIL || 'TaskBuddy <onboarding@resend.dev>';
const appUrl = process.env.APP_URL || 'https://istiak-mahin.github.io/TaskBuddy/';

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing.`);
  }
  return value;
}

function parseServiceAccount() {
  const raw = requireEnv('FIREBASE_SERVICE_ACCOUNT');
  const parsed = JSON.parse(raw);

  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
}

function initFirestore() {
  const serviceAccount = parseServiceAccount();

  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });
  }

  return getFirestore(process.env.FIREBASE_DATABASE_ID || '(default)');
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getDeadlineIso(deadline: any) {
  if (!deadline) return '';
  if (typeof deadline === 'string') return deadline;
  if (typeof deadline.toDate === 'function') return deadline.toDate().toISOString();
  return '';
}

async function main() {
  const db = initFirestore();
  const resendKey = requireEnv('RESEND_API_KEY');
  const resend = new Resend(resendKey);
  const now = new Date();

  let notificationsCreated = 0;
  let emailsSent = 0;
  let skipped = 0;

  const sectionsSnapshot = await db.collection('sections').get();
  console.log(`Checking ${sectionsSnapshot.size} sections at ${now.toISOString()}`);

  for (const sectionDoc of sectionsSnapshot.docs) {
    for (const reminderWindow of reminderWindows) {
      const startTime = new Date(now.getTime() + reminderWindow.offsetMs);
      const endTime = new Date(startTime.getTime() + runWindowMs);

      const assignmentsSnapshot = await sectionDoc.ref
        .collection('assignments')
        .where('deadline', '>=', startTime.toISOString())
        .where('deadline', '<', endTime.toISOString())
        .get();

      for (const assignmentDoc of assignmentsSnapshot.docs) {
        const assignment = assignmentDoc.data();
        const userId = assignment.userId;
        const reminderSent = assignment.reminderSent || {};

        if (!userId || assignment.urgency === 'done' || reminderSent[reminderWindow.key]) {
          skipped += 1;
          continue;
        }

        const userDoc = await db.collection('users').doc(userId).get();
        const user = userDoc.data();
        const email = user?.email;

        if (!email) {
          console.warn(`Skipping assignment ${assignmentDoc.id}: user ${userId} has no email.`);
          skipped += 1;
          continue;
        }

        const title = reminderWindow.title;
        const deadlineIso = getDeadlineIso(assignment.deadline);
        const deadlineText = deadlineIso ? new Date(deadlineIso).toLocaleString('en-US') : 'Unknown deadline';
        const message = `Reminder: Your ${assignment.type || 'task'} "${assignment.title}" for ${assignment.course} is due in about ${reminderWindow.label}.`;

        await sectionDoc.ref.collection('notifications').add({
          userId,
          title,
          message,
          type: 'reminder',
          read: false,
          createdAt: now.toISOString(),
          assignmentId: assignmentDoc.id,
          sectionId: sectionDoc.id,
        });
        notificationsCreated += 1;

        await resend.emails.send({
          from: fromEmail,
          to: email,
          subject: `TaskBuddy: ${title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #171717;">
              <h2 style="margin: 0 0 16px; color: #111827;">${escapeHtml(title)}</h2>
              <p>Hello ${escapeHtml(user?.name || 'there')},</p>
              <p>Your deadline is approaching.</p>
              <div style="background: #f5f5f5; padding: 16px; border-radius: 12px; margin: 20px 0;">
                <p><b>Title:</b> ${escapeHtml(assignment.title)}</p>
                <p><b>Course:</b> ${escapeHtml(assignment.course)}</p>
                <p><b>Type:</b> ${escapeHtml(assignment.type || 'Task')}</p>
                <p><b>Due in:</b> ${escapeHtml(reminderWindow.label)}</p>
                <p><b>Deadline:</b> ${escapeHtml(deadlineText)}</p>
              </div>
              <p><a href="${escapeHtml(appUrl)}" style="color: #2563eb;">Open TaskBuddy</a></p>
              <p style="font-size: 12px; color: #737373;">— TaskBuddy Automated Reminder</p>
            </div>
          `,
          text: `${message}\nDeadline: ${deadlineText}\nOpen TaskBuddy: ${appUrl}`,
        });
        emailsSent += 1;

        await assignmentDoc.ref.update({
          [`reminderSent.${reminderWindow.key}`]: true,
          [`reminderSentAt.${reminderWindow.key}`]: FieldValue.serverTimestamp(),
        });

        console.log(`Sent ${reminderWindow.key} reminder to ${email} for assignment ${assignmentDoc.id}`);
      }
    }
  }

  console.log(
    `Done. notifications=${notificationsCreated}, emails=${emailsSent}, skipped=${skipped}`
  );
}

main().catch((error) => {
  console.error('Reminder job failed:', error);
  process.exit(1);
});
