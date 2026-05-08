import React, { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { UserProfile } from '../types';
import { changeOwnSectionWithJoinCode, normalizeJoinCode } from '../services/sectionService';

interface JoinSectionProps {
  profile: UserProfile;
  onJoined: (sectionId: string) => void;
}

export default function JoinSection({ profile, onJoined }: JoinSectionProps) {
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault();

    const code = normalizeJoinCode(joinCode);
    if (!code || loading) return;

    setLoading(true);
    setMessage('');
    setError('');

    try {
      const result = await changeOwnSectionWithJoinCode(profile, code);
      setMessage(`Joined ${result.sectionName || 'your section'} successfully.`);
      onJoined(result.sectionId);
    } catch (err: any) {
      console.error('Join section failed:', err);
      setError(err?.message || 'Could not join section. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="min-h-[65vh] flex items-center justify-center"
    >
      <div className="max-w-lg w-full bg-white dark:bg-neutral-900 rounded-[2rem] border border-neutral-200 dark:border-neutral-800 shadow-sm p-8 sm:p-10 text-center transition-colors">
        <div className="w-16 h-16 bg-neutral-900 dark:bg-neutral-50 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-xl transition-colors">
          <KeyRound className="w-8 h-8 text-white dark:text-neutral-900" />
        </div>

        <h1 className="text-3xl font-black tracking-tight text-neutral-900 dark:text-neutral-50 mb-3">
          Join Your Section
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 font-medium leading-relaxed mb-8">
          Enter the section enrollment key from your class admin. After joining, you will only see deadlines and announcements for your own section.
        </p>

        <form onSubmit={handleJoin} className="space-y-4">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="SECTION KEY"
            className="w-full px-5 py-4 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl text-center text-sm sm:text-base font-black tracking-[0.2em] text-neutral-900 dark:text-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 uppercase transition-all"
          />

          <button
            disabled={loading || !joinCode.trim()}
            className="w-full bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 py-4 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {loading ? 'Joining...' : 'Join Section'}
          </button>
        </form>

        {error && (
          <div className="mt-5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-300 rounded-2xl px-4 py-3 text-xs font-bold">
            {error}
          </div>
        )}

        {message && (
          <div className="mt-5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded-2xl px-4 py-3 text-xs font-bold">
            {message}
          </div>
        )}

        <p className="mt-6 text-[11px] text-neutral-400 dark:text-neutral-500 font-semibold leading-relaxed">
          No key? Ask your Super Admin or Section Admin to share the correct section enrollment key.
        </p>
      </div>
    </motion.div>
  );
}
