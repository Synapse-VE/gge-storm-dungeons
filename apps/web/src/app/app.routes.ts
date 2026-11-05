import { Routes } from '@angular/router';

import { SkeletonComponent } from '@ggetracker-components/skeleton/skeleton.component';

export const routes: Routes = [
  {
    path: '',
    component: SkeletonComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'storm-tracker',
      },
      {
        path: 'storm-tracker',
        loadComponent: () =>
          import('@ggetracker-pages/storm-tracker/storm-tracker.component').then((m) => m.StormTrackerComponent),
        data: {
          description: 'HIS1 storm islands tracker: forts and resource isles in real time.',
          titleKey: 'Îles orageuses',
        },
      },
      {
        path: 'dungeons',
        loadComponent: () => import('@ggetracker-pages/tracker/tracker.component').then((m) => m.TrackerComponent),
        data: {
          description: 'HIS1 fortress tracker: cooldowns, attacks and map.',
          titleKey: 'Forteresses',
        },
      },
      {
        path: '**',
        redirectTo: 'storm-tracker',
      },
    ],
  },
];
