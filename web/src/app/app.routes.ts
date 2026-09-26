import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/inbox').then((m) => m.InboxPage) },
  { path: 'thread/:id', loadComponent: () => import('./pages/thread').then((m) => m.ThreadPage) },
  { path: 'glossary', loadComponent: () => import('./pages/glossary').then((m) => m.GlossaryPage) },
  { path: 'settings', loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage) },
  { path: '**', redirectTo: '' },
];
