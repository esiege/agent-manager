import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { AuthGate } from './components/AuthGate';
import { TableSkeleton } from './components/States';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { AgentsPage } from './pages/AgentsPage';
import { DashboardPage } from './pages/DashboardPage';
import { KeysPage } from './pages/KeysPage';
import { LogsPage } from './pages/LogsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';

// The Markdown renderer is only needed on the Instructions and Blockers tabs.
// The charts are only needed on the Reporting and Game tabs.
const ReportingPage = lazy(() => import('./pages/ReportingPage').then((m) => ({ default: m.ReportingPage })));
const PerformancePage = lazy(() => import('./pages/PerformancePage').then((m) => ({ default: m.PerformancePage })));
const PerfSessionPage = lazy(() => import('./pages/PerfSessionPage').then((m) => ({ default: m.PerfSessionPage })));
const BlockersPage = lazy(() => import('./pages/BlockersPage').then((m) => ({ default: m.BlockersPage })));
const InstructionsPage = lazy(() => import('./pages/InstructionsPage').then((m) => ({ default: m.InstructionsPage })));

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route
            path="blockers"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <BlockersPage />
              </Suspense>
            }
          />
          <Route
            path="reporting"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <ReportingPage />
              </Suspense>
            }
          />
          <Route
            path="performance"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <PerformancePage />
              </Suspense>
            }
          />
          <Route
            path="performance/session"
            element={
              <Suspense fallback={<TableSkeleton rows={10} />}>
                <PerfSessionPage />
              </Suspense>
            }
          />
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
          <Route path="keys" element={<KeysPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
