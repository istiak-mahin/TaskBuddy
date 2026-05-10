import 'dotenv/config';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { Resend } from 'resend';

type ReminderWindow = {
  key: '24h' | '1h';
  label: string;
  offsetMs: number;
  title: string;
};

type DueMatch = {
  matched: boolean;
  minutesUntil: number;
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

const runWindowMs = Number(process.env.REMINDER_WINDOW_MINUTES || '45') * 60 * 1000;
const timezoneOffsetMinutes = Number(process.env.REMINDER_TIMEZONE_OFFSET_MINUTES || '360');
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

function initFirebase() {
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

function parseDeadlineToDate(deadline: any): Date | null {
  if (!deadline) return null;

  if (typeof deadline.toDate === 'function') {
    const date = deadline.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (deadline instanceof Date) {
    return Number.isNaN(deadline.getTime()) ? null : deadline;
  }

  if (typeof deadline !== 'string') return null;

  const value = deadline.trim();
  if (!value) return null;

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);

  if (hasTimezone) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );

  if (match) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;

    const utcMs =
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      ) -
      timezoneOffsetMinutes * 60 * 1000;

    const date = new Date(utcMs);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function formatDeadline(deadlineDate: Date | null) {
  if (!deadlineDate) return 'Unknown deadline';

  return deadlineDate.toLocaleString('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getDueMatch(now: Date, deadlineDate: Date, reminderWindow: ReminderWindow): DueMatch {
  const diffMs = deadlineDate.getTime() - now.getTime();
  const minutesUntil = Math.round(diffMs / 60000);

  const windowStart = reminderWindow.offsetMs - runWindowMs;
  const windowEnd = reminderWindow.offsetMs + 5 * 60 * 1000;

  return {
    matched: diffMs >= windowStart && diffMs <= windowEnd,
    minutesUntil,
  };
}

async function sendPushToUser(db: FirebaseFirestore.Firestore, userId: string, payload: { title: string; body: string; assignmentId: string; sectionId: string }) {
  const tokensSnapshot = await db
    .collection('users')
    .doc(userId)
    .collection('notificationTokens')
    .where('active', '==', true)
    .get();

  if (tokensSnapshot.empty) {
    console.warn(`No active push tokens found for user ${userId}. Expected Firestore path: users/${userId}/notificationTokens with active=true.`);
    return { sent: 0, failed: 0 };
  }

  const messaging = getMessaging();
  let sent = 0;
  let failed = 0;

  for (const tokenDoc of tokensSnapshot.docs) {
    const token = tokenDoc.data().token;
    if (!token) continue;

    try {
      await messaging.send({
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        webpush: {
          fcmOptions: {
            link: appUrl,
          },
          notification: {
            icon: `${appUrl.replace(/\/$/, '')}/pwa-192x192.png`,
            badge: `${appUrl.replace(/\/$/, '')}/pwa-192x192.png`,
            requireInteraction: true,
          },
        },
        data: {
          url: appUrl,
          assignmentId: payload.assignmentId,
          sectionId: payload.sectionId,
          type: 'deadline-reminder',
        },
      });
      sent += 1;
    } catch (error: any) {
      failed += 1;
      console.warn(`Push token failed for user ${userId}:`, error?.code || error?.message || error);

      if (
        String(error?.code || '').includes('registration-token-not-registered') ||
        String(error?.code || '').includes('invalid-registration-token')
      ) {
        await tokenDoc.ref.set(
          {
            active: false,
            disabledAt: FieldValue.serverTimestamp(),
            lastError: error?.code || error?.message || 'push failed',
          },
          { merge: true }
        );
      }
    }
  }

  return { sent, failed };
}

async function main() {
  const db = initFirebase();
  const resendKey = process.env.RESEND_API_KEY || '';
  const resend = resendKey ? new Resend(resendKey) : null;
  const now = new Date();

  let assignmentsChecked = 0;
  let notificationsCreated = 0;
  let emailsSent = 0;
  let pushesSent = 0;
  let pushFailures = 0;
  let skipped = 0;

  const sectionsSnapshot = await db.collection('sections').get();

  console.log(`Checking ${sectionsSnapshot.size} sections at ${now.toISOString()}`);
  console.log(
    `Reminder window: ${Math.round(runWindowMs / 60000)} minutes, timezone offset: +${timezoneOffsetMinutes} minutes`
  );

  for (const sectionDoc of sectionsSnapshot.docs) {
    const assignmentsSnapshot = await sectionDoc.ref.collection('assignments').get();

    console.log(`Section ${sectionDoc.id}: checking ${assignmentsSnapshot.size} assignments`);

    for (const assignmentDoc of assignmentsSnapshot.docs) {
      assignmentsChecked += 1;

      const assignment = assignmentDoc.data();
      const reminderSent = assignment.reminderSent || {};
      const deadlineDate = parseDeadlineToDate(assignment.deadline);

      if (!deadlineDate) {
        console.warn(`Skipping ${assignmentDoc.id}: invalid deadline value "${assignment.deadline}"`);
        skipped += 1;
        continue;
      }

      if (assignment.urgency === 'done') {
        skipped += 1;
        continue;
      }

      for (const reminderWindow of reminderWindows) {
        if (reminderSent[reminderWindow.key]) {
          continue;
        }

        const dueMatch = getDueMatch(now, deadlineDate, reminderWindow);
        console.log(
          `Assignment ${assignmentDoc.id}: ${assignment.title || 'Untitled'} due in ${dueMatch.minutesUntil} min, checking ${reminderWindow.key}`
        );

        if (!dueMatch.matched) {
          continue;
        }

        const title = reminderWindow.title;
        const deadlineText = formatDeadline(deadlineDate);
        const message = `Reminder: "${assignment.title}" (${assignment.course}) is due in about ${reminderWindow.label}.`;

        // Collect all user IDs to notify for this section
        const userIdsToNotify = new Set<string>();

        // 1. All students in this section
        const studentsSnapshot = await sectionDoc.ref.collection('students').get();
        for (const s of studentsSnapshot.docs) userIdsToNotify.add(s.id);

        // 2. Section admins who have this section in their sectionIds
        const sectionAdminsSnapshot = await db.collection('users')
          .where('role', 'in', ['sectionAdmin', 'admin'])
          .get();
        for (const u of sectionAdminsSnapshot.docs) {
          const sectionIds = u.data().sectionIds || [];
          if (sectionIds.includes(sectionDoc.id)) userIdsToNotify.add(u.id);
        }

        // 3. Super admins who currently have this section selected (activeSectionId)
        const superAdminsSnapshot = await db.collection('users')
          .where('role', '==', 'superAdmin')
          .get();
        for (const u of superAdminsSnapshot.docs) {
          if (u.data().activeSectionId === sectionDoc.id) userIdsToNotify.add(u.id);
        }

        const allUserIds = Array.from(userIdsToNotify);
        console.log(`Section ${sectionDoc.id}: notifying ${allUserIds.length} users (students + admins) for assignment ${assignmentDoc.id}`);

        for (const studentId of allUserIds) {
          // In-app notification for each student
          await sectionDoc.ref.collection('notifications').add({
            userId: studentId,
            title,
            message,
            type: 'reminder',
            read: false,
            createdAt: now.toISOString(),
            assignmentId: assignmentDoc.id,
            sectionId: sectionDoc.id,
          });
          notificationsCreated += 1;

          // Push notification for each student
          const pushResult = await sendPushToUser(db, studentId, {
            title,
            body: message,
            assignmentId: assignmentDoc.id,
            sectionId: sectionDoc.id,
          });
          pushesSent += pushResult.sent;
          pushFailures += pushResult.failed;

          // Email for each student
          if (resend) {
            const userDoc = await db.collection('users').doc(studentId).get();
            const user = userDoc.data();
            const email = user?.email;
            if (email) {
              await resend.emails.send({
                from: fromEmail,
                to: email,
                subject: `TaskBuddy: ${title}`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #171717;">
                    <h2 style="margin: 0 0 16px; color: #111827;">${escapeHtml(title)}</h2>
                    <p>Hello ${escapeHtml(user?.name || 'there')},</p>
                    <p>A deadline is approaching in your section.</p>
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
            }
          }
        }

        await assignmentDoc.ref.update({
          [`reminderSent.${reminderWindow.key}`]: true,
          [`reminderSentAt.${reminderWindow.key}`]: FieldValue.serverTimestamp(),
        });

        console.log(
          `Sent ${reminderWindow.key} reminder for assignment ${assignmentDoc.id}: users=${allUserIds.length}, notifications=${notificationsCreated}, pushes=${pushesSent}, pushFailures=${pushFailures}, emails=${emailsSent}`
        );
      }
    }
  }

  console.log(
    `Done. assignments=${assignmentsChecked}, notifications=${notificationsCreated}, emails=${emailsSent}, pushes=${pushesSent}, pushFailures=${pushFailures}, skipped=${skipped}`
  );
}

main().catch((error) => {
  console.error('Reminder job failed:', error);
  process.exit(1);
});
