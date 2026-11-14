// Settings: phone alerts and hidden agents. Keys have their own tab (KeysPage).

import { AlertsSettings } from '../components/AlertsSettings';
import { HiddenAgents } from '../components/HiddenAgents';
import { PageHeader } from '../components/PageHeader';

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <AlertsSettings />
      <HiddenAgents />
    </>
  );
}
