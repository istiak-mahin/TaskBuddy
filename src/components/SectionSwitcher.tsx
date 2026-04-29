import { useEffect, useMemo, useState } from 'react';
import { collection, getDoc, getDocs, doc } from 'firebase/firestore';
import { ChevronDown, Layers } from 'lucide-react';
import { db } from '../firebase';
import { Section, UserProfile } from '../types';
import { getActiveSectionId, isSuperAdminEmail, updateActiveSection } from '../services/sectionService';

interface SectionSwitcherProps {
  profile: UserProfile;
  onSectionChange: (sectionId: string) => void;
}

export default function SectionSwitcher({ profile, onSectionChange }: SectionSwitcherProps) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(false);

  const activeSectionId = getActiveSectionId(profile);
  const sectionIds = useMemo(() => profile.sectionIds || [], [profile.sectionIds?.join('|')]);
  const isSuperAdmin = isSuperAdminEmail(profile.email);

  useEffect(() => {
    let cancelled = false;

    const loadSections = async () => {
      setLoading(true);

      try {
        if (isSuperAdmin) {
          const snapshot = await getDocs(collection(db, 'sections'));
          if (!cancelled) {
            setSections(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Section)));
          }
          return;
        }

        if (sectionIds.length === 0) {
          if (!cancelled) setSections([]);
          return;
        }

        // Use direct getDoc calls instead of a query so section members do not need
        // broad `list` permission on the sections collection.
        const loaded: Section[] = [];
        for (const sectionId of sectionIds.filter(Boolean)) {
          const snapshot = await getDoc(doc(db, 'sections', sectionId));
          if (snapshot.exists()) {
            loaded.push({ id: snapshot.id, ...snapshot.data() } as Section);
          }
        }

        if (!cancelled) setSections(loaded);
      } catch (err) {
        console.warn('Section switcher failed to load sections:', err);
        if (!cancelled) setSections([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadSections();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, sectionIds.join('|')]);

  const handleChange = async (sectionId: string) => {
    if (!sectionId || sectionId === activeSectionId) return;

    try {
      await updateActiveSection(profile.uid, sectionId);
      onSectionChange(sectionId);
    } catch (err) {
      console.warn('Could not update active section:', err);
    }
  };

  const currentSection = sections.find((section) => section.id === activeSectionId) || sections[0];
  const hasMultipleSections = isSuperAdmin || sectionIds.length > 1;
  const displayLabel = loading ? 'Loading' : currentSection?.name || 'No Section';

  return (
    <div className="relative flex items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl px-3 py-2 shadow-sm">
      <Layers className="w-4 h-4 text-neutral-400" />
      <select
        value={activeSectionId || currentSection?.id || ''}
        onChange={(event) => handleChange(event.target.value)}
        disabled={loading || !hasMultipleSections || sections.length === 0}
        title={!hasMultipleSections ? 'Your section is assigned by the admin' : 'Switch section'}
        className="appearance-none bg-transparent pr-6 text-xs font-black uppercase tracking-wider text-neutral-700 dark:text-neutral-200 focus:outline-none disabled:opacity-100 disabled:cursor-default"
      >
        {sections.length === 0 ? (
          <option value={activeSectionId || ''}>{displayLabel}</option>
        ) : (
          sections.map((section) => (
            <option key={section.id} value={section.id}>{section.name}</option>
          ))
        )}
      </select>
      {hasMultipleSections && <ChevronDown className="absolute right-2.5 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />}
    </div>
  );
}
