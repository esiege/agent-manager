import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { AuthGate } from './components/AuthGate';
import { TableSkeleton } from './components/States';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { AgentsPage } from './pages/AgentsPage';
import { LogsPage } from './pages/LogsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';

// The Markdown renderer is only needed on the Instructions tab.
const InstructionsPage = lazy(() => import('./pages/InstructionsPage').then((m) => ({ default: m.InstructionsPage })));

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/detail" element={<AgentDetailPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route
            path="instructions"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <InstructionsPage />
              </Suspense>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
