export type SiteNavigationTag = 'tools' | 'discord' | 'official';

export const SITE_NAVIGATION_TAG_LABELS: Record<SiteNavigationTag, string> = {
  tools: 'Outils',
  discord: 'Discord',
  official: 'Officiel',
};

export interface SiteNavigationItem {
  label: string;
  id?: string;
  url?: string;
  iconUrl?: string;
  iconClass?: string;
  tag?: SiteNavigationTag;
  frequency?: 'Temps réel' | 'Par heure';
}

export interface SiteNavigationSection {
  title: string;
  items: SiteNavigationItem[];
}

export const HOME_ROUTE = '/';

export const SITE_NAVIGATION: readonly SiteNavigationSection[] = [
  {
    title: 'Seguimiento HIS1',
    items: [
      {
        label: 'Islas tempestuosas',
        id: 'storm-tracker',
        iconUrl: '/assets/storm-tracker/fort.png',
        frequency: 'Temps réel',
      },
      {
        label: 'Fortalezas',
        id: 'dungeons',
        iconUrl: '/assets/tools/fortresses.webp',
        frequency: 'Temps réel',
      },
    ],
  },
];
