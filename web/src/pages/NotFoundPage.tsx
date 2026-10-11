import { Anchor } from '@mantine/core';
import { Link } from 'react-router';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/States';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState title="There's no page here">
        Go to the{' '}
        <Anchor component={Link} to="/" size="sm">
          Overview
        </Anchor>
        .
      </EmptyState>
    </>
  );
}
