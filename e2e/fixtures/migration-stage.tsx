import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EntityStageStep from '../../src/components/migration/steps/EntityStageStep';

function Fixture() {
  const [finished, setFinished] = React.useState(false);
  return finished ? <p>Step completed</p> : (
    <EntityStageStep batchId="test-batch" entity="customers" title="Customers"
      optional onStaged={() => setFinished(true)} onSkip={() => setFinished(true)}
      onBack={() => setFinished(true)} />
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}><Fixture /></QueryClientProvider>,
);
