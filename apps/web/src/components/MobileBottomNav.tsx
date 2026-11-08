import React from 'react';

export type MobileTab = 'home' | 'cashout' | 'history';

interface MobileBottomNavProps {
  active: MobileTab;
  onNavigate: (tab: MobileTab) => void;
}

const TABS: { id: MobileTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'cashout', label: 'Cash out' },
  { id: 'history', label: 'History' },
];

/** Bottom tab bar shared by the mobile Home and History screens. */
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ active, onNavigate }) => (
  <nav
    aria-label="Bottom navigation"
    className="gc-nav fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[420px] z-50 md:!hidden"
  >
    {TABS.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onNavigate(tab.id)}
        aria-current={active === tab.id ? 'page' : undefined}
        className={active === tab.id ? 'gc-nav__item gc-nav__item--on' : 'gc-nav__item'}
      >
        {tab.label}
      </button>
    ))}
  </nav>
);

export default MobileBottomNav;
